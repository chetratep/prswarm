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
});
