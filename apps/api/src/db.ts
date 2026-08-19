// SQLite setup: opens the database file (creating its parent directory if
// needed) and runs idempotent CREATE TABLE IF NOT EXISTS migrations for the
// full schema.
//
// Uses bun:sqlite rather than better-sqlite3: this repo's whole stack pitch
// is "no native toolchain to stand up" (see CLAUDE.md), and better-sqlite3
// needs a working Python + C++ build chain to compile from source whenever
// no prebuilt binary matches. bun:sqlite ships in the Bun binary itself, so
// there's nothing to compile at all — and unlike node:sqlite (used before
// this migration), it has a native `.transaction()` method, so callers no
// longer need a hand-rolled BEGIN/COMMIT/ROLLBACK wrapper.
import { Database } from "bun:sqlite";
import fs from "node:fs";
import path from "node:path";

export type AppDatabase = Database;

export function openDatabase(databasePath: string): AppDatabase {
  const dir = path.dirname(databasePath);
  fs.mkdirSync(dir, { recursive: true });

  const db = new Database(databasePath);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");

  runMigrations(db);

  return db;
}

function runMigrations(db: AppDatabase): void {
  db.exec(`
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
