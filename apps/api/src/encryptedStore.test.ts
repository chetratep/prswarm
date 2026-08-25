import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Database } from "bun:sqlite";
import { cleanupStaleTempFiles, flush, loadEncryptedDatabase } from "./encryptedStore.js";
import { __resetKeyCacheForTests } from "./crypto.js";

let tempDir: string;
let dbPath: string;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "prswarm-encrypted-store-test-"));
  dbPath = path.join(tempDir, "app.db");
  process.env.ENCRYPTION_KEY = Buffer.alloc(32, 5).toString("hex");
  __resetKeyCacheForTests();
});

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
  delete process.env.ENCRYPTION_KEY;
  __resetKeyCacheForTests();
});

describe("loadEncryptedDatabase", () => {
  it("returns a fresh in-memory database when no file exists yet", () => {
    const db = loadEncryptedDatabase(dbPath);
    db.exec("CREATE TABLE t (x INTEGER)");
    db.prepare("INSERT INTO t VALUES (1)").run();
    expect(db.query("SELECT x FROM t").all()).toEqual([{ x: 1 }]);
  });

  it("round-trips data through flush and a fresh load", () => {
    const db1 = loadEncryptedDatabase(dbPath);
    db1.exec("CREATE TABLE t (x INTEGER)");
    db1.prepare("INSERT INTO t VALUES (42)").run();
    flush(db1, dbPath);
    db1.close();

    const db2 = loadEncryptedDatabase(dbPath);
    expect(db2.query("SELECT x FROM t").all()).toEqual([{ x: 42 }]);
  });

  it("writes ciphertext, not a valid SQLite header, to disk", () => {
    const db = loadEncryptedDatabase(dbPath);
    db.exec("CREATE TABLE t (x INTEGER)");
    flush(db, dbPath);

    const raw = fs.readFileSync(dbPath);
    expect(raw.subarray(0, 16).toString("utf8")).not.toBe("SQLite format 3\0");
  });

  it("throws a clear error when the file exists but decrypts with the wrong key", () => {
    const db1 = loadEncryptedDatabase(dbPath);
    db1.exec("CREATE TABLE t (x INTEGER)");
    flush(db1, dbPath);
    db1.close();

    process.env.ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("hex");
    __resetKeyCacheForTests();

    expect(() => loadEncryptedDatabase(dbPath)).toThrow(/cannot decrypt/i);
  });

  it("transparently migrates a legacy plaintext bun:sqlite file on first load", () => {
    const legacyDb = new Database(dbPath);
    legacyDb.exec("CREATE TABLE legacy (y TEXT)");
    legacyDb.prepare("INSERT INTO legacy VALUES ('pre-migration data')").run();
    legacyDb.close();

    // Test-only: bun:sqlite on Windows doesn't reliably release a closed,
    // data-written connection's OS file handle synchronously with close()
    // (see migrateLegacyPlaintextDatabase's comment in encryptedStore.ts
    // for the full story). In real deployment this legacy file was written
    // and closed by a *previous, already-exited* process, so there's
    // nothing to release by the time migration runs here. This test writes
    // it in the *same* process for simplicity, which reintroduces that
    // same-process-only hazard purely as a test artifact — nudge it clear
    // before exercising the migration + flush() below, which itself must
    // stay entirely free of any such nudge.
    Bun.gc(true);

    const migrated = loadEncryptedDatabase(dbPath);
    expect(migrated.query("SELECT y FROM legacy").all()).toEqual([{ y: "pre-migration data" }]);

    flush(migrated, dbPath);
    const raw = fs.readFileSync(dbPath);
    expect(raw.subarray(0, 16).toString("utf8")).not.toBe("SQLite format 3\0");

    // Second boot takes the normal encrypted-load path, not the migration
    // path again — proves idempotency.
    const reloaded = loadEncryptedDatabase(dbPath);
    expect(reloaded.query("SELECT y FROM legacy").all()).toEqual([{ y: "pre-migration data" }]);
  });

  it("recovers committed-but-uncheckpointed WAL data during migration (process killed before a clean close)", () => {
    // A real legacy instance of this app runs in WAL mode (see db.ts). A
    // clean `.close()` on the last connection to a WAL database triggers
    // SQLite's own automatic checkpoint, which would consolidate everything
    // into the base .db file and silently pass this test even if migration
    // never looked at the -wal file at all. To exercise the actual recovery
    // path, this test writes data and deliberately never calls `.close()`
    // on the writer connection — simulating a process that was killed
    // before a clean shutdown, leaving committed frames sitting only in the
    // `-wal` sidecar.
    const legacyDb = new Database(dbPath);
    legacyDb.exec("PRAGMA journal_mode = WAL");
    legacyDb.exec("CREATE TABLE legacy (y TEXT)");
    legacyDb.prepare("INSERT INTO legacy VALUES ('uncheckpointed wal data')").run();

    expect(fs.existsSync(`${dbPath}-wal`)).toBe(true);

    const migrated = loadEncryptedDatabase(dbPath);
    expect(migrated.query("SELECT y FROM legacy").all()).toEqual([
      { y: "uncheckpointed wal data" },
    ]);

    // Test-only cleanup: close the writer connection now that the recovery
    // assertion above is done, and force a GC pass so its OS file handle is
    // actually released before this test's tempDir gets removed (bun:sqlite
    // on Windows doesn't reliably release a closed, data-written
    // connection's handle synchronously with close() — the same underlying
    // quirk documented on migrateLegacyPlaintextDatabase in
    // encryptedStore.ts). This is purely local test teardown hygiene, not a
    // production code path — the module under test never does this itself.
    legacyDb.close();
    Bun.gc(true);
  });
});

describe("flush", () => {
  it("is atomic: a failure between the temp write and rename leaves the original file untouched", () => {
    const db = loadEncryptedDatabase(dbPath);
    db.exec("CREATE TABLE t (x INTEGER)");
    db.prepare("INSERT INTO t VALUES (1)").run();
    flush(db, dbPath);
    const originalBytes = fs.readFileSync(dbPath);

    // Mutate the in-memory DB further, then simulate a crash that happens
    // after the temp file has been fully written and fsynced but before the
    // rename that would publish it, by making the rename itself throw. This
    // genuinely exercises flush()'s write-then-rename ordering, rather than
    // merely asserting that an unrelated stray file is ignored.
    db.prepare("INSERT INTO t VALUES (2)").run();
    const renameSpy = vi.spyOn(fs, "renameSync").mockImplementationOnce(() => {
      throw new Error("simulated crash between temp write and rename");
    });

    expect(() => flush(db, dbPath)).toThrow(/simulated crash/);
    renameSpy.mockRestore();

    // The real file must be byte-for-byte unchanged — flush() never wrote
    // to it directly, only to the temp file, and the rename that would have
    // published the temp file's contents never completed.
    expect(fs.readFileSync(dbPath).equals(originalBytes)).toBe(true);
    const reloaded = loadEncryptedDatabase(dbPath);
    expect(reloaded.query("SELECT x FROM t").all()).toEqual([{ x: 1 }]);
  });

  it("refuses to publish a short write, leaving the existing encrypted database intact", () => {
    const db = loadEncryptedDatabase(dbPath);
    db.exec("CREATE TABLE t (x INTEGER)");
    db.prepare("INSERT INTO t VALUES (1)").run();
    flush(db, dbPath);
    const originalBytes = fs.readFileSync(dbPath);

    db.prepare("INSERT INTO t VALUES (2)").run();

    // A partial write — legitimate POSIX behaviour under disk-quota pressure,
    // and the one failure mode that produces silent corruption rather than a
    // visible error: truncated ciphertext fails its GCM auth tag, so the next
    // boot finds an undecryptable database instead of an out-of-date one.
    const writeSpy = vi.spyOn(fs, "writeSync").mockImplementationOnce(() => 10);
    const renameSpy = vi.spyOn(fs, "renameSync");
    try {
      expect(() => flush(db, dbPath)).toThrow(/short write/i);
      // The truncated temp file must never be renamed over the real one.
      expect(renameSpy).not.toHaveBeenCalled();
    } finally {
      writeSpy.mockRestore();
      renameSpy.mockRestore();
    }

    expect(fs.readFileSync(dbPath).equals(originalBytes)).toBe(true);
    const reloaded = loadEncryptedDatabase(dbPath);
    expect(reloaded.query("SELECT x FROM t").all()).toEqual([{ x: 1 }]);
  });

  it("cleans up its temp file when a flush fails, so retries don't pile up orphans", () => {
    const db = loadEncryptedDatabase(dbPath);
    db.exec("CREATE TABLE t (x INTEGER)");
    flush(db, dbPath);

    // Five failed attempts, exactly as db.ts's retry timer would produce
    // against a disk that stays full — each picks a fresh random temp name,
    // so nothing is overwritten and every one would otherwise survive.
    const renameSpy = vi.spyOn(fs, "renameSync").mockImplementation(() => {
      throw new Error("ENOSPC: no space left on device");
    });
    try {
      for (let i = 0; i < 5; i++) {
        db.prepare("INSERT INTO t VALUES (?)").run(i);
        expect(() => flush(db, dbPath)).toThrow(/ENOSPC/);
      }
    } finally {
      renameSpy.mockRestore();
    }

    expect(fs.readdirSync(tempDir).filter((e) => e.includes(".tmp-"))).toHaveLength(0);
  });

  it("does not leave orphaned temp files after a normal flush", () => {
    const db = loadEncryptedDatabase(dbPath);
    db.exec("CREATE TABLE t (x INTEGER)");
    flush(db, dbPath);

    const entries = fs.readdirSync(tempDir);
    expect(entries.filter((e) => e.includes(".tmp-"))).toHaveLength(0);
  });
});

describe("cleanupStaleTempFiles", () => {
  it("removes leftover temp files from a killed process, without touching the real database file", () => {
    fs.writeFileSync(dbPath, Buffer.from("real database content"));
    const staleTemp = path.join(tempDir, `.${path.basename(dbPath)}.tmp-abc123`);
    fs.writeFileSync(staleTemp, Buffer.from("orphaned"));

    cleanupStaleTempFiles(dbPath);

    expect(fs.existsSync(staleTemp)).toBe(false);
    expect(fs.existsSync(dbPath)).toBe(true);
  });
});
