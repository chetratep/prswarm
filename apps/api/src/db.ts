// SQLite setup: loads the database (as an in-memory bun:sqlite instance,
// decrypted from an encrypted on-disk blob — see encryptedStore.ts) and runs
// idempotent CREATE TABLE IF NOT EXISTS migrations for the full schema.
//
// Uses bun:sqlite rather than better-sqlite3: this repo's whole stack pitch
// is "no native toolchain to stand up" (see CLAUDE.md), and better-sqlite3
// needs a working Python + C++ build chain to compile from source whenever
// no prebuilt binary matches. bun:sqlite ships in the Bun binary itself, so
// there's nothing to compile at all — and unlike node:sqlite (used before
// this migration), it has a native `.transaction()` method, so callers no
// longer need a hand-rolled BEGIN/COMMIT/ROLLBACK wrapper.
//
// Encryption at rest: the working copy of the database lives entirely in
// memory (bun:sqlite `:memory:`/deserialized, never opened directly against
// `databasePath`) and only ever reaches disk as an AES-256-GCM-encrypted
// blob, written atomically by encryptedStore.ts's flush(). Writes are
// tracked here via a monkey-patch of the returned Database instance's own
// prepare/transaction/exec/close methods, and flushed on a short debounce
// (see wireAutoFlush below) rather than after every single write.
//
// SINGLE INSTANCE PER DATABASE PATH. This is a hard constraint, and one that
// changed with encryption at rest: two processes pointed at the same
// DATABASE_PATH used to be arbitrated by SQLite's own file locking, and now
// are not. Each process loads its own private in-memory copy at startup and
// each flush replaces the entire file — so the second process to flush
// silently discards everything the first one wrote, whole tables included,
// not just conflicting rows. cleanupStaleTempFiles() below compounds it: it
// deletes every `.<db>.tmp-*` file in the directory at startup, which would
// include a live sibling's in-flight temp file.
//
// This matches the architecture the app already had — one Bun process, one
// openDatabase() call at boot, an in-process job queue with no cross-process
// coordination (see CLAUDE.md's Tech stack notes) — so it is a documented
// constraint rather than a bug to fix here. Running two instances against one
// database file was never supported; it just used to fail more visibly.
// Anything that changes that (a supervisor running replicas, a shared volume
// mounted into two containers) needs a real coordination mechanism designed
// for it, not a tweak to the flush path.
import { Database } from "bun:sqlite";
import { assertEncryptionKeyAvailableFor } from "./crypto.js";
import { classifyDatabaseFile } from "./databaseFormat.js";
import {
  cleanupStaleTempFiles,
  finalizeLegacyMigration,
  flush,
  loadEncryptedDatabase,
} from "./encryptedStore.js";

export type AppDatabase = Database;

const AUTO_FLUSH_DEBOUNCE_MS = 500;
const AUTO_FLUSH_MAX_DELAY_MS = 5000;
// How long to wait before re-attempting a flush that failed (disk full, an
// antivirus/backup process holding a transient lock on the target path, a
// permissions blip). Deliberately longer than the debounce window: a failing
// flush is retried until it succeeds, and retrying every 500ms would just
// spin the CPU and spam stderr while, say, a full disk stays full.
const AUTO_FLUSH_RETRY_DELAY_MS = 2000;

export function openDatabase(databasePath: string): AppDatabase {
  // Must come first: everything below eventually resolves the encryption key,
  // and resolution's last resort is to generate a new one and persist it over
  // whatever the keychain already held. Against an existing encrypted
  // database that is unrecoverable data loss, so this refuses outright rather
  // than letting it happen. index.ts calls this too, ahead of its own
  // assertEncryptionKeyConfigured(); both calls are cheap and idempotent.
  assertEncryptionKeyAvailableFor(databasePath);

  cleanupStaleTempFiles(databasePath);

  // Checked before the load, because loading is what changes the answer.
  const wasLegacyPlaintext = classifyDatabaseFile(databasePath) === "legacy-plaintext";

  const db = loadEncryptedDatabase(databasePath);
  db.exec("PRAGMA foreign_keys = ON;");
  // No WAL pragma: nothing writes SQLite's native on-disk format directly
  // any more — the working copy lives in memory and reaches disk only via
  // flush()'s atomic encrypted write, so WAL's own on-disk journal has
  // nothing to do here (and would have been written in plaintext).

  runMigrations(db);

  // Ensures a valid encrypted file exists immediately after a fresh install
  // or a legacy-plaintext migration, rather than waiting for the first
  // real write's debounced flush.
  flush(db, databasePath);

  // Strictly after the flush above: that call is what replaced the plaintext
  // file with ciphertext, and only once it has succeeded are the pre-upgrade
  // plaintext -wal/-shm sidecars safe (and necessary) to delete. If flush
  // threw, this is skipped and openDatabase fails outright, leaving the whole
  // pre-upgrade file set intact for a retry.
  if (wasLegacyPlaintext) {
    finalizeLegacyMigration(databasePath);
  }

  wireAutoFlush(db, databasePath);

  return db;
}

function wireAutoFlush(db: AppDatabase, databasePath: string): void {
  let dirty = false;
  let firstDirtyAt: number | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let closed = false;
  // Set for the duration of a failing flush's retry cycle, cleared the
  // instant one succeeds. See onWrite() below for why this exists.
  let flushFailing = false;

  const flushNow = (): void => {
    if (!dirty || closed) return;
    try {
      flush(db, databasePath);
    } catch (err) {
      // A failed flush must never take the process down or drop the pending
      // writes: the in-memory database is still the authoritative copy, and
      // the on-disk file is still the last complete, decryptable snapshot
      // (flush() writes to a temp file and renames, so a failure anywhere in
      // it leaves the existing file untouched). Keep `dirty` set — and
      // `firstDirtyAt` unchanged, so the 5s max-delay cap still measures from
      // the *original* write — and re-arm a timer so the next attempt happens
      // on its own rather than waiting for the next incidental write.
      console.error(
        `Failed to write the encrypted database to ${databasePath}. The pending changes are still ` +
          `held in memory and the existing file on disk is unchanged; retrying in ` +
          `${AUTO_FLUSH_RETRY_DELAY_MS}ms.`,
        err
      );
      flushFailing = true;
      if (timer) clearTimeout(timer);
      timer = setTimeout(flushNow, AUTO_FLUSH_RETRY_DELAY_MS);
      return;
    }
    flushFailing = false;
    dirty = false;
    firstDirtyAt = undefined;
    if (timer) {
      clearTimeout(timer);
      timer = undefined;
    }
  };

  const onWrite = (): void => {
    dirty = true;
    if (firstDirtyAt === undefined) firstDirtyAt = Date.now();

    // While a flush is actively failing and retrying, leave that retry timer
    // alone rather than rescheduling it here. Without this guard, once the
    // store has been continuously dirty for AUTO_FLUSH_MAX_DELAY_MS, the
    // debounce math below evaluates to 0 on every subsequent write — turning
    // the deliberate AUTO_FLUSH_RETRY_DELAY_MS backoff into an immediate
    // retry on every write, which hammers disk/CPU/stderr during exactly the
    // degraded conditions (e.g. a full disk through an entire job run) this
    // backoff exists to survive. The already-armed retry timer keeps firing
    // on its own schedule; flushNow() clears this flag as soon as one of
    // those retries succeeds, and normal debounce behavior resumes.
    if (flushFailing) return;

    if (timer) clearTimeout(timer);
    const elapsed = Date.now() - firstDirtyAt;
    const delay = Math.min(AUTO_FLUSH_DEBOUNCE_MS, Math.max(0, AUTO_FLUSH_MAX_DELAY_MS - elapsed));
    timer = setTimeout(flushNow, delay);
  };

  // Flush on the way out too, whether close() is called directly (tests,
  // the CLI's own explicit paths added in Task 6) or the process exits —
  // this is a best-effort belt-and-braces flush; Task 6 adds the real
  // guaranteed shutdown flush via SIGINT/SIGTERM and the CLI's own flows.
  const originalClose = db.close.bind(db);
  db.close = ((...args: Parameters<typeof db.close>) => {
    // flushNow() already swallows flush failures, but this second boundary is
    // deliberate: close() must reach originalClose() no matter what. The CLI's
    // "clear app data" flow calls db.close() before rmDataDir(), so a throw
    // here would leave the data directory un-wiped after the user typed
    // DELETE — a worse outcome than a lost final flush.
    try {
      flushNow();
    } catch (err) {
      console.error(`Failed to flush the encrypted database at ${databasePath} while closing it.`, err);
    }
    // Past this point nothing may schedule another flush: the underlying
    // handle is about to go away, so a retry timer left armed would fire
    // db.serialize() against a closed database and throw from inside a timer
    // callback — an uncaught exception that kills the process.
    closed = true;
    if (timer) {
      clearTimeout(timer);
      timer = undefined;
    }
    return originalClose(...args);
  }) as typeof db.close;

  interceptWrites(db, onWrite);
}

function interceptWrites(db: AppDatabase, onWrite: () => void): void {
  // Shared between prepare() and query(): both return a Statement whose own
  // .run() performs a write, and both need the exact same "call through,
  // then mark dirty" wrapping — a caller that reaches for db.query(sql).run()
  // instead of db.prepare(sql).run() must be tracked identically, not
  // silently skipped.
  //
  // Tracked in a WeakSet because bun:sqlite caches prepared statements by SQL
  // text — db.query(sql) hands back the *same* Statement object every time it
  // is called with the same SQL. Without this check each call wrapped the
  // already-wrapped run(), nesting one closure deeper every time: onWrite()
  // fired once per layer, and around 17k identical calls the call stack
  // overflowed outright. Wrapping is idempotent now, and a statement's run()
  // stays the same function reference across repeat lookups.
  const wrappedStatements = new WeakSet<object>();

  const wrapStatementRun = <S extends { run: (...args: any[]) => unknown }>(stmt: S): S => {
    if (wrappedStatements.has(stmt)) return stmt;
    wrappedStatements.add(stmt);

    const originalRun = (stmt.run as (...a: unknown[]) => unknown).bind(stmt);
    stmt.run = ((...runArgs: unknown[]) => {
      const result = originalRun(...runArgs);
      onWrite();
      return result;
    }) as S["run"];
    return stmt;
  };

  const originalPrepare = db.prepare.bind(db);
  db.prepare = ((sql: string, ...rest: unknown[]) => {
    const stmt = (originalPrepare as (...a: unknown[]) => ReturnType<typeof db.prepare>)(sql, ...rest);
    return wrapStatementRun(stmt);
  }) as typeof db.prepare;

  const originalQuery = db.query.bind(db);
  db.query = ((sql: string, ...rest: unknown[]) => {
    const stmt = (originalQuery as (...a: unknown[]) => ReturnType<typeof db.query>)(sql, ...rest);
    return wrapStatementRun(stmt);
  }) as typeof db.query;

  // Shared between the base transaction function and its deferred/
  // immediate/exclusive variants — each of those independently begins and
  // commits a transaction (BEGIN DEFERRED/IMMEDIATE/EXCLUSIVE respectively),
  // so each needs its own "call through, then mark dirty" wrapping, not just
  // an alias to the base wrapper.
  const wrapTransactionFn = <F extends (...args: unknown[]) => unknown>(fn: F): F =>
    ((...args: unknown[]) => {
      const result = fn(...args);
      onWrite();
      return result;
    }) as F;

  const originalTransaction = db.transaction.bind(db);
  db.transaction = ((fn: (...args: unknown[]) => unknown) => {
    const wrapped = originalTransaction(fn);
    const outer = wrapTransactionFn(wrapped as (...args: unknown[]) => unknown) as typeof wrapped;
    outer.deferred = wrapTransactionFn(wrapped.deferred);
    outer.immediate = wrapTransactionFn(wrapped.immediate);
    outer.exclusive = wrapTransactionFn(wrapped.exclusive);
    return outer;
  }) as typeof db.transaction;

  const originalExec = db.exec.bind(db);
  db.exec = ((sql: string, ...rest: unknown[]) => {
    const result = (originalExec as (...a: unknown[]) => unknown)(sql, ...rest);
    onWrite();
    return result;
  }) as typeof db.exec;

  // db.run() is a direct-write convenience method distinct from
  // db.prepare(sql).run() (see bun:sqlite's Database.run) — same
  // "call through, then mark dirty" wrapping as everything else here.
  const originalRun = db.run.bind(db);
  db.run = ((sql: string, ...rest: unknown[]) => {
    const result = (originalRun as (...a: unknown[]) => unknown)(sql, ...rest);
    onWrite();
    return result;
  }) as typeof db.run;
}

function runMigrations(db: AppDatabase): void {
  db.exec(`
    -- Instance-wide, admin-configurable settings (currently just the Slack
    -- webhook URL — see notifications/slack.ts) that need to live somewhere
    -- other than an env var, since the standalone binary's whole pitch is
    -- "no config file required" and an env var means finding the right cwd
    -- (see docs site's Configuration page). A plain key/value table rather
    -- than dedicated columns since this is expected to grow.
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS connections (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      login TEXT,
      app_id TEXT,
      installation_id TEXT,
      encrypted_token TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS change_sets (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      branch_strategy TEXT NOT NULL,
      commit_strategy TEXT NOT NULL,
      commit_message TEXT NOT NULL,
      pr_title TEXT,
      pr_body TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS change_set_files (
      id TEXT PRIMARY KEY,
      change_set_id TEXT NOT NULL,
      order_index INTEGER NOT NULL,
      file_path TEXT NOT NULL,
      mode TEXT NOT NULL,
      content_source TEXT NOT NULL,
      content TEXT NOT NULL,
      template_vars_schema TEXT
    );

    CREATE TABLE IF NOT EXISTS target_selections (
      id TEXT PRIMARY KEY,
      change_set_id TEXT NOT NULL,
      orgs TEXT NOT NULL,
      select_all_in_org INTEGER NOT NULL,
      filters TEXT NOT NULL,
      explicit_repo_list TEXT NOT NULL,
      resolved_repo_count INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      change_set_id TEXT NOT NULL,
      target_selection_id TEXT NOT NULL,
      status TEXT NOT NULL,
      created_by TEXT NOT NULL,
      started_at TEXT,
      completed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS repo_runs (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL,
      repo_full_name TEXT NOT NULL,
      status TEXT NOT NULL,
      branch_protected INTEGER,
      direct_to_default INTEGER NOT NULL,
      commit_sha TEXT,
      pr_url TEXT,
      error_message TEXT,
      attempt_count INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS repo_run_files (
      id TEXT PRIMARY KEY,
      repo_run_id TEXT NOT NULL,
      change_set_file_id TEXT NOT NULL,
      file_path TEXT NOT NULL,
      diff_summary TEXT,
      before_sha TEXT,
      after_sha TEXT,
      error_message TEXT,
      rendered_content TEXT
    );
  `);

  // Guarded column drops: change_sets/repo_runs may already exist (from
  // before this migration) with the old single-file schema. CREATE TABLE
  // IF NOT EXISTS above is a no-op against an existing table, so the old
  // columns have to be removed explicitly. Safe on both a fresh DB (the
  // columns were never created, so these no-op via the guard) and an
  // existing dev DB (columns actually drop once, then this is a no-op on
  // every later startup) — same idempotent-guard idiom this file already
  // used for adding the rendered_content column.
  dropColumnIfExists(db, "change_sets", "file_path");
  dropColumnIfExists(db, "change_sets", "mode");
  dropColumnIfExists(db, "change_sets", "content_source");
  dropColumnIfExists(db, "change_sets", "content");
  dropColumnIfExists(db, "change_sets", "template_vars_schema");

  dropColumnIfExists(db, "repo_runs", "diff_summary");
  dropColumnIfExists(db, "repo_runs", "before_sha");
  dropColumnIfExists(db, "repo_runs", "after_sha");
  dropColumnIfExists(db, "repo_runs", "rendered_content");

  // jobs.created_at: needed to order the run-history list newest-first.
  // started_at doesn't cover it — a job can sit at READY (never executed)
  // with no started_at at all, and changeSetId isn't 1:1 with job (a
  // changeset can be retried into more than one job), so neither existing
  // timestamp is a safe stand-in. Backfilled from started_at where a job
  // already has one, otherwise "now" — same "won't crash, doesn't
  // resurrect lost data" guarantee the other guarded migrations in this
  // file make.
  addColumnIfNotExists(db, "jobs", "created_at", "TEXT");
  db.exec("UPDATE jobs SET created_at = COALESCE(started_at, datetime('now')) WHERE created_at IS NULL");

  // connections.user_id / connections.host: connections move from "at most
  // one row, period" to "at most one row per user" (multi-user access
  // control), and gain an optional GitHub Enterprise Server host. Both
  // additive/idempotent, same pattern as every column added above.
  // user_id is backfilled separately by bootstrapAuth() at startup (see
  // auth/bootstrap.ts) once it knows which user should own pre-migration
  // rows — not backfilled here, since db.ts has no concept of "the admin".
  addColumnIfNotExists(db, "connections", "user_id", "TEXT");
  addColumnIfNotExists(db, "connections", "host", "TEXT");

  // Backfill user_id IS NULL rows to the 'local' sentinel unconditionally,
  // regardless of AUTH_ENABLED. This has to run here (not only inside
  // bootstrapAuth) because bootstrapAuth returns early whenever auth is
  // off — which is the documented default — so a pre-migration connection
  // row would otherwise never be picked up by getCurrentConnectionRow(db,
  // 'local') (the sentinel userId used for every request when auth is
  // off) and would sit in the table forever, invisible and undeletable
  // through the app. Idempotent: a second run finds nothing left with
  // user_id IS NULL.
  db.exec("UPDATE connections SET user_id = 'local' WHERE user_id IS NULL");

  // connections.is_active / the 2-slot model: a user may now save one PAT
  // connection and one GitHub App connection at once instead of at most one
  // connection total — switching which is active no longer deletes the
  // other (see connectionsRepository.ts's replaceWith*/activateConnection).
  // DEFAULT 1 means every pre-existing row (at most one per user, today's
  // invariant) becomes active on migration, which is exactly correct: it
  // was already "the" connection for that user.
  addColumnIfNotExists(db, "connections", "is_active", "INTEGER NOT NULL DEFAULT 1");

  // At most one row per (user, type) — the 2-slot rule itself.
  db.exec(
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_connections_user_type ON connections(user_id, type)"
  );
  // At most one active row per user, enforced at the DB layer, not just in
  // application logic. Partial index — rows with is_active = 0 don't
  // participate, so a user can have an inactive second slot freely.
  db.exec(
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_connections_one_active ON connections(user_id) WHERE is_active = 1"
  );
}

function dropColumnIfExists(db: AppDatabase, table: string, column: string): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (columns.some((col) => col.name === column)) {
    db.exec(`ALTER TABLE ${table} DROP COLUMN ${column}`);
  }
}

function addColumnIfNotExists(db: AppDatabase, table: string, column: string, type: string): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!columns.some((col) => col.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  }
}
