// "What kind of file is sitting at this path?" — a tiny shared module because
// two unrelated layers need the answer and neither can import the other:
// encryptedStore.ts owns the on-disk format, and the key-resolution guard
// (crypto.ts's assertEncryptionKeyAvailableFor) needs the same answer *before*
// any key is resolved. Putting this check in either of those files would make
// an import cycle (crypto -> secrets -> encryptedStore -> crypto).
import fs from "node:fs";

export const SQLITE_MAGIC = "SQLite format 3\0";

export type DatabaseFileKind =
  /** Nothing at this path — a fresh install. */
  | "absent"
  /** A pre-encryption plaintext bun:sqlite file, from before encryption at
   * rest shipped. loadEncryptedDatabase() migrates these on first load, which
   * legitimately needs a newly generated key. */
  | "legacy-plaintext"
  /** This app's encrypted format. Only the key it was written with can ever
   * open it again. */
  | "encrypted";

export function classifyDatabaseFile(databasePath: string): DatabaseFileKind {
  if (!fs.existsSync(databasePath)) return "absent";

  let fd: number | undefined;
  try {
    // Read only the header, not the file — this runs at startup against a
    // database that may be many megabytes.
    fd = fs.openSync(databasePath, "r");
    const header = Buffer.alloc(SQLITE_MAGIC.length);
    const bytesRead = fs.readSync(fd, header, 0, header.length, 0);
    if (bytesRead === SQLITE_MAGIC.length && header.toString("utf8") === SQLITE_MAGIC) {
      return "legacy-plaintext";
    }
    return "encrypted";
  } catch {
    // Present but unreadable right now (permissions, an exclusive lock from
    // another process). "encrypted" is the conservative answer: it's the one
    // that makes callers refuse to mint a replacement key over a file that
    // may still need the original one.
    return "encrypted";
  } finally {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd);
      } catch {
        // nothing useful to do — the descriptor leaks at worst, and this
        // function must not throw for a housekeeping failure
      }
    }
  }
}
