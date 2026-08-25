// Keeps the working database entirely in memory and persists it to disk
// only as an AES-256-GCM-encrypted blob, written atomically (temp file +
// fsync + rename). No plaintext SQLite bytes are ever written to disk by
// this module.
//
// Assumes a single process owns `databasePath` — flush() replaces the whole
// file and cleanupStaleTempFiles() sweeps every temp file beside it, neither
// of which is safe against a concurrent sibling instance. See the
// SINGLE INSTANCE PER DATABASE PATH note at the top of db.ts for why that
// constraint is the app's architecture rather than an oversight here.
import { Database } from "bun:sqlite";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { decryptBuffer, encryptBuffer } from "./crypto.js";
import { SQLITE_MAGIC } from "./databaseFormat.js";

function tempFilePathFor(databasePath: string): string {
  const dir = path.dirname(databasePath);
  const suffix = crypto.randomBytes(6).toString("hex");
  return path.join(dir, `.${path.basename(databasePath)}.tmp-${suffix}`);
}

function tempFilePrefix(databasePath: string): string {
  return `.${path.basename(databasePath)}.tmp-`;
}

export function loadEncryptedDatabase(databasePath: string): Database {
  if (!fs.existsSync(databasePath)) {
    return new Database(":memory:");
  }

  const raw = fs.readFileSync(databasePath);

  if (raw.subarray(0, SQLITE_MAGIC.length).toString("utf8") === SQLITE_MAGIC) {
    return migrateLegacyPlaintextDatabase(databasePath);
  }

  let decrypted: Buffer;
  try {
    decrypted = decryptBuffer(raw);
  } catch (cause) {
    throw new Error(
      `Cannot decrypt the database at ${databasePath} with the currently configured encryption key. ` +
        "If ENCRYPTION_KEY changed, or a generated key file/keychain entry was lost, this data is not " +
        "recoverable without the original key.",
      { cause: cause as Error }
    );
  }

  return Database.deserialize(decrypted);
}

/**
 * Loads a pre-upgrade plaintext bun:sqlite file (from before this feature
 * shipped) into memory, once, so the caller's next flush() encrypts it for
 * the first time.
 *
 * A first attempt at this copied `databasePath` (and any `-wal`/`-shm`
 * sidecars — a legacy instance ran in WAL mode, see db.ts, so a process
 * killed before a clean close can leave committed-but-uncheckpointed
 * frames there) to a throwaway path and reopened *that*, specifically to
 * avoid ever touching `databasePath` with a bun:sqlite handle at all.
 * That turned out to be actively wrong: reopening copied `-wal`/`-shm`
 * files this way does not reliably replay the WAL on this bun:sqlite
 * build — `serialize()` (and even a forced `PRAGMA wal_checkpoint`)
 * silently returned just the base file's pages, dropping every
 * committed-but-uncheckpointed row, even though plain `SELECT`s against
 * that same reopened copy read the merged data back correctly. Copying
 * live WAL/SHM files is exactly the kind of thing SQLite's own docs warn
 * isn't safe to do outside its Online Backup API, and this is that warning
 * made concrete — silent data loss on the one path this function exists to
 * protect, not just a Windows-only quirk.
 *
 * What's here instead: open `databasePath` itself readonly (never
 * writable — VACUUM INTO's target is a separate throwaway file, so this
 * connection never performs a write against `databasePath`), and run
 * `VACUUM INTO` a fresh temp path. That goes through SQLite's real query
 * engine against the live file, which — like a plain `SELECT` — correctly
 * merges any uncheckpointed WAL frames. The temp file it produces is then
 * read and deserialized like any other on-disk SQLite image.
 *
 * This does mean a bun:sqlite handle briefly touches `databasePath` after
 * all, which looks like reintroducing the Windows close()-timing race this
 * rewrite was meant to avoid. It doesn't: that race was only ever
 * reproducible when a connection *wrote* to a given file earlier in the
 * *same process* — closing any later handle to that file (even a
 * read-only one) then stayed poisoned until a GC pass. A readonly
 * connection that never writes to `databasePath` does not trigger it.
 * Verified directly against a scenario matching real deployment — a
 * *separate* child process creates and abandons the legacy WAL file (so
 * this process has never touched it before), then this function's exact
 * readonly-open + VACUUM INTO + close sequence runs, immediately followed
 * by a flush()-style rename onto `databasePath`: the rename succeeds
 * immediately, no delay or GC needed. (The unit test for this path in
 * encryptedStore.test.ts still writes the legacy file in the *same*
 * process for simplicity, which — as documented on that test — needs its
 * own test-only GC nudge for unrelated reasons: cleaning up its *own*
 * still-open writer connection so the test's tempDir can be removed
 * afterward. That's test teardown hygiene, unconnected to this function.)
 */
function migrateLegacyPlaintextDatabase(databasePath: string): Database {
  const targetPath = tempFilePathFor(databasePath);
  try {
    const sourceDb = new Database(databasePath, { readonly: true });
    try {
      const escapedTargetPath = targetPath.replace(/'/g, "''");
      sourceDb.exec(`VACUUM INTO '${escapedTargetPath}'`);
    } finally {
      sourceDb.close();
    }

    const bytes = fs.readFileSync(targetPath);
    return Database.deserialize(bytes);
  } finally {
    // Best-effort cleanup of the throwaway VACUUM INTO target. If it's
    // transiently locked, it's a harmless orphaned `.tmp-*` file the next
    // cleanupStaleTempFiles() sweep picks up, same as any other
    // interrupted temp file.
    try {
      fs.rmSync(targetPath, { force: true });
    } catch {
      // ignore — see comment above
    }
  }
}

export function flush(db: Database, databasePath: string): void {
  const serialized = db.serialize();
  const encrypted = encryptBuffer(Buffer.from(serialized));

  const dir = path.dirname(databasePath);
  fs.mkdirSync(dir, { recursive: true });

  const tmpPath = tempFilePathFor(databasePath);
  const fd = fs.openSync(tmpPath, "w");
  try {
    // writeSync can legitimately write fewer bytes than it was given (disk
    // quota pressure is the classic case). Ignoring that and continuing to
    // fsync and rename would publish a truncated file over a healthy one —
    // and truncated ciphertext fails its GCM auth tag, so the next boot finds
    // an undecryptable database rather than an old one. Throwing here instead
    // routes it into the caller's retry path (see db.ts's flushNow) and
    // leaves the existing file untouched.
    const bytesWritten = fs.writeSync(fd, encrypted);
    if (bytesWritten !== encrypted.length) {
      throw new Error(
        `Short write while flushing the encrypted database: wrote ${bytesWritten} of ${encrypted.length} bytes to ${tmpPath}.`
      );
    }
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }

  fs.renameSync(tmpPath, databasePath);
}

/**
 * Closes out a one-time legacy-plaintext migration, once the flush that
 * actually wrote the encrypted format has succeeded.
 *
 * The `-wal`/`-shm` sidecars are the whole reason this isn't just a log line.
 * A pre-encryption instance ran in WAL mode (see db.ts), so upgrading users
 * have plaintext `app.db-wal`/`app.db-shm` files sitting next to the database
 * — and migration only rewrites `app.db` itself. Left alone they survive
 * forever, still holding readable rows (usernames, password hashes) from
 * before the upgrade, quietly defeating the point of encrypting at rest for
 * exactly the users who had data worth protecting. Nothing reads them after
 * migration: the working database lives in memory and only ever reaches disk
 * through flush().
 *
 * Must be called only after that flush succeeded — never before. If the flush
 * failed, `app.db` is still the pre-upgrade plaintext file and these sidecars
 * may still hold committed-but-uncheckpointed rows that the next attempt
 * needs.
 */
export function finalizeLegacyMigration(databasePath: string): void {
  console.log("Encrypted existing database at rest for the first time.");

  for (const suffix of ["-wal", "-shm"]) {
    const sidecarPath = `${databasePath}${suffix}`;
    try {
      fs.rmSync(sidecarPath, { force: true });
    } catch (err) {
      // Loud rather than silent: what's left behind is plaintext user data.
      console.error(
        `Could not delete ${sidecarPath}, left over from the pre-encryption database. It still ` +
          "contains readable data from before the upgrade and nothing reads it any more — delete it " +
          "manually once no process is holding it open.",
        err
      );
    }
  }
}

export function cleanupStaleTempFiles(databasePath: string): void {
  const dir = path.dirname(databasePath);
  if (!fs.existsSync(dir)) return;

  const prefix = tempFilePrefix(databasePath);
  for (const entry of fs.readdirSync(dir)) {
    if (entry.startsWith(prefix)) {
      fs.rmSync(path.join(dir, entry), { force: true });
    }
  }
}
