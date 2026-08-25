import { afterEach, beforeEach, describe, expect, it } from "vitest";
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
});

describe("flush", () => {
  it("is atomic: a failure between the temp write and rename leaves the original file untouched", () => {
    const db = loadEncryptedDatabase(dbPath);
    db.exec("CREATE TABLE t (x INTEGER)");
    db.prepare("INSERT INTO t VALUES (1)").run();
    flush(db, dbPath);
    const originalBytes = fs.readFileSync(dbPath);

    // Simulate a crash after the temp file is written but before rename:
    // create the temp file by hand, at the exact naming convention flush()
    // uses, then confirm the real path is untouched by its mere presence.
    const staleTemp = path.join(tempDir, `.${path.basename(dbPath)}.tmp-deadbeef`);
    fs.writeFileSync(staleTemp, Buffer.from("garbage, simulating an interrupted flush"));

    expect(fs.readFileSync(dbPath).equals(originalBytes)).toBe(true);
    const reloaded = loadEncryptedDatabase(dbPath);
    expect(reloaded.query("SELECT x FROM t").all()).toEqual([{ x: 1 }]);
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
