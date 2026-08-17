import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDatabase } from "./db.js";

let dbPath: string;
let db: ReturnType<typeof openDatabase> | undefined;

afterEach(() => {
  if (db) {
    db.close();
    db = undefined;
  }
  if (dbPath && fs.existsSync(dbPath)) {
    try {
      fs.rmSync(dbPath);
    } catch (e) {
      // File may still be locked by Bun's sqlite; ignore cleanup errors
    }
  }
});

describe("openDatabase transactions", () => {
  it("commits all writes when the transaction function returns normally", () => {
    dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "bulk-tool-db-test-")), "test.db");
    db = openDatabase(dbPath);

    db.transaction(() => {
      db!.prepare("DELETE FROM connections").run();
      db!.prepare(
        `INSERT INTO connections (id, type, login, app_id, installation_id, encrypted_token, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run("id-1", "PAT", "octocat", null, null, "enc", "2026-01-01T00:00:00.000Z");
    })();

    const row = db.prepare("SELECT * FROM connections WHERE id = ?").get("id-1");
    expect(row).toBeTruthy();
  });

  it("rolls back all writes if the transaction function throws", () => {
    dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "bulk-tool-db-test-")), "test.db");
    db = openDatabase(dbPath);

    expect(() =>
      db!.transaction(() => {
        db!.prepare(
          `INSERT INTO connections (id, type, login, app_id, installation_id, encrypted_token, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        ).run("id-2", "PAT", "octocat", null, null, "enc", "2026-01-01T00:00:00.000Z");
        throw new Error("boom");
      })()
    ).toThrow("boom");

    const row = db.prepare("SELECT * FROM connections WHERE id = ?").get("id-2");
    expect(row).toBeFalsy();
  });
});
