import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDatabase } from "./db.js";
import { __resetKeyCacheForTests } from "./crypto.js";

let dbPath: string;
let db: ReturnType<typeof openDatabase> | undefined;

beforeEach(() => {
  process.env.ENCRYPTION_KEY = Buffer.alloc(32, 4).toString("hex");
  __resetKeyCacheForTests();
});

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
  delete process.env.ENCRYPTION_KEY;
  __resetKeyCacheForTests();
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

describe("openDatabase schema", () => {
  it("creates change_set_files and repo_run_files, and drops the old single-file columns", () => {
    dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "bulk-tool-db-test-")), "test.db");
    db = openDatabase(dbPath);

    const changeSetColumns = (db.prepare("PRAGMA table_info(change_sets)").all() as Array<{ name: string }>).map(
      (c) => c.name
    );
    expect(changeSetColumns).not.toContain("file_path");
    expect(changeSetColumns).not.toContain("content");
    expect(changeSetColumns).not.toContain("mode");
    expect(changeSetColumns).not.toContain("content_source");
    expect(changeSetColumns).not.toContain("template_vars_schema");
    expect(changeSetColumns).toContain("name");
    expect(changeSetColumns).toContain("branch_strategy");

    const changeSetFileColumns = (
      db.prepare("PRAGMA table_info(change_set_files)").all() as Array<{ name: string }>
    ).map((c) => c.name);
    expect(changeSetFileColumns).toEqual(
      expect.arrayContaining([
        "id",
        "change_set_id",
        "order_index",
        "file_path",
        "mode",
        "content_source",
        "content",
        "template_vars_schema",
      ])
    );

    const repoRunColumns = (db.prepare("PRAGMA table_info(repo_runs)").all() as Array<{ name: string }>).map(
      (c) => c.name
    );
    expect(repoRunColumns).not.toContain("diff_summary");
    expect(repoRunColumns).not.toContain("before_sha");
    expect(repoRunColumns).not.toContain("after_sha");
    expect(repoRunColumns).not.toContain("rendered_content");
    expect(repoRunColumns).toContain("branch_protected");

    const repoRunFileColumns = (
      db.prepare("PRAGMA table_info(repo_run_files)").all() as Array<{ name: string }>
    ).map((c) => c.name);
    expect(repoRunFileColumns).toEqual(
      expect.arrayContaining([
        "id",
        "repo_run_id",
        "change_set_file_id",
        "file_path",
        "diff_summary",
        "before_sha",
        "after_sha",
        "error_message",
        "rendered_content",
      ])
    );
  });

  it("running migrations twice against the same database file does not throw", () => {
    dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "bulk-tool-db-test-")), "test.db");
    db = openDatabase(dbPath);
    db.close();
    expect(() => {
      db = openDatabase(dbPath);
    }).not.toThrow();
  });

  it("backfills connections.user_id IS NULL to the 'local' sentinel unconditionally, regardless of AUTH_ENABLED", () => {
    // Simulates a pre-migration connection row (user_id was never set) that
    // predates the multi-user access-control work. Without this backfill
    // running unconditionally at migration time (not just inside
    // bootstrapAuth, which no-ops whenever AUTH_ENABLED is off — the
    // documented default), this row would be permanently invisible to
    // getCurrentConnectionRow(db, 'local'), the sentinel userId used for
    // every request in that mode.
    dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "bulk-tool-db-test-")), "test.db");
    db = openDatabase(dbPath);
    db.prepare(
      `INSERT INTO connections (id, user_id, type, login, host, app_id, installation_id, encrypted_token, created_at)
       VALUES ('legacy-1', NULL, 'PAT', 'legacy-login', NULL, NULL, NULL, 'enc', '2020-01-01T00:00:00.000Z')`
    ).run();
    db.close();

    // Reopening runs runMigrations() again — this is where the backfill
    // must fire, since the row already existed with user_id NULL before
    // this second open.
    db = openDatabase(dbPath);

    const row = db.prepare("SELECT user_id FROM connections WHERE id = 'legacy-1'").get() as {
      user_id: string | null;
    };
    expect(row.user_id).toBe("local");
  });
});

describe("openDatabase encryption at rest", () => {
  it("writes an encrypted file to disk, not plaintext SQLite, after opening", () => {
    dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "bulk-tool-db-test-")), "test.db");
    db = openDatabase(dbPath);

    const raw = fs.readFileSync(dbPath);
    expect(raw.subarray(0, 16).toString("utf8")).not.toBe("SQLite format 3\0");
  });

  it("persists writes across a close and reopen", () => {
    dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "bulk-tool-db-test-")), "test.db");
    db = openDatabase(dbPath);
    db.prepare(
      `INSERT INTO connections (id, type, login, app_id, installation_id, encrypted_token, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run("id-flush-1", "PAT", "octocat", null, null, "enc", "2026-01-01T00:00:00.000Z");

    // Force the debounced auto-flush to fire before reopening, rather than
    // waiting on the real timer in a test.
    db.close();

    const reopened = openDatabase(dbPath);
    const row = reopened.prepare("SELECT * FROM connections WHERE id = ?").get("id-flush-1");
    expect(row).toBeTruthy();
    reopened.close();
    db = undefined;
  });
});
