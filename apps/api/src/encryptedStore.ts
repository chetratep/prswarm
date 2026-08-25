// Keeps the working database entirely in memory and persists it to disk
// only as an AES-256-GCM-encrypted blob, written atomically (temp file +
// fsync + rename). No plaintext SQLite bytes are ever written to disk by
// this module.
import { Database } from "bun:sqlite";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { decryptBuffer, encryptBuffer } from "./crypto.js";

const SQLITE_MAGIC = "SQLite format 3\0";

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
    // Pre-upgrade plaintext bun:sqlite file — load it directly, once, and
    // let the caller's next flush() encrypt it for the first time.
    const legacyDb = new Database(databasePath, { readonly: true });
    const bytes = legacyDb.serialize();
    legacyDb.close();
    const migrated = Database.deserialize(bytes);

    // bun:sqlite on Windows releases a closed Database's underlying OS file
    // handle only when its native finalizer runs, which close() alone does
    // not guarantee happens synchronously. Without forcing that here, a
    // flush() called immediately after this returns can fail to rename its
    // temp file over `databasePath` with EPERM because the plaintext file
    // (this one, or whatever handle produced it) still looks "open" to
    // Windows. Forcing a GC pass makes the release deterministic before we
    // hand control back to the caller.
    Bun.gc(true);

    return migrated;
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

export function flush(db: Database, databasePath: string): void {
  const serialized = db.serialize();
  const encrypted = encryptBuffer(Buffer.from(serialized));

  const dir = path.dirname(databasePath);
  fs.mkdirSync(dir, { recursive: true });

  const tmpPath = tempFilePathFor(databasePath);
  const fd = fs.openSync(tmpPath, "w");
  try {
    fs.writeSync(fd, encrypted);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }

  fs.renameSync(tmpPath, databasePath);
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
