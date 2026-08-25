import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
  // Defensive: if a fake-timers test above threw somewhere other than its
  // own try/finally, this guarantees real timers are restored before the
  // next test runs, rather than leaking fake time across tests.
  vi.useRealTimers();
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

function insertConnectionRow(id: string): void {
  db!.prepare(
    `INSERT INTO connections (id, type, login, app_id, installation_id, encrypted_token, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(id, "PAT", "octocat", null, null, "enc", "2026-01-01T00:00:00.000Z");
}

describe("openDatabase auto-flush debounce", () => {
  // Each on-disk flush re-encrypts with a fresh random IV (see crypto.ts's
  // encryptBuffer), so the encrypted bytes on disk differ after every real
  // flush even when the underlying plaintext is identical. That makes "did
  // the file on disk change" a reliable, decryption-free signal for "did a
  // flush actually happen" — no need to spy on encryptedStore.js's flush()
  // export (ESM export bindings aren't reliably spy-able) or decrypt the
  // file to check its content.

  it("does not flush before the 500ms debounce window elapses, then flushes once it does", () => {
    vi.useFakeTimers();
    try {
      dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "bulk-tool-db-test-")), "test.db");
      db = openDatabase(dbPath);
      const afterOpen = fs.readFileSync(dbPath);

      insertConnectionRow("id-debounce-1");

      // Still within the debounce window: no flush yet.
      vi.advanceTimersByTime(400);
      expect(fs.readFileSync(dbPath).equals(afterOpen)).toBe(true);

      // Past the 500ms mark since the write: the debounced flush should
      // have fired.
      vi.advanceTimersByTime(150);
      expect(fs.readFileSync(dbPath).equals(afterOpen)).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("forces a flush within the 5s max delay even under writes that never stop long enough for the 500ms debounce to fire on its own", () => {
    vi.useFakeTimers();
    try {
      dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "bulk-tool-db-test-")), "test.db");
      db = openDatabase(dbPath);
      const afterOpen = fs.readFileSync(dbPath);

      let flushed = false;
      // 200ms between writes never leaves a 500ms quiet gap for the plain
      // debounce to fire on its own — only the 5s max-delay cap can force a
      // flush here. 30 iterations * 200ms = 6s of simulated time, well past
      // the 5s cap, so a flush must happen before the loop ends.
      for (let i = 0; i < 30 && !flushed; i++) {
        insertConnectionRow(`id-sustained-${i}`);
        vi.advanceTimersByTime(200);
        flushed = !fs.readFileSync(dbPath).equals(afterOpen);
      }

      expect(flushed).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

/**
 * Creates a pre-encryption plaintext WAL database at `dbPath` from a *child*
 * process that exits without closing it — the only way to end up with the
 * sidecar files a real upgrading user has. A clean `.close()` triggers
 * SQLite's checkpoint-and-delete, removing the very files under test, and
 * simply leaving the connection open in *this* process would hold OS handles
 * that don't exist in the real scenario (where the pre-upgrade process is
 * long gone). Returns once the child has exited.
 */
function createAbandonedLegacyWalDatabase(dbPath: string, value: string): void {
  const scriptPath = path.join(path.dirname(dbPath), "seed-legacy.ts");
  fs.writeFileSync(
    scriptPath,
    [
      'import { Database } from "bun:sqlite";',
      "const db = new Database(process.argv[2]);",
      'db.exec("PRAGMA journal_mode = WAL");',
      'db.exec("CREATE TABLE legacy (secret TEXT)");',
      'db.prepare("INSERT INTO legacy VALUES (?)").run(process.argv[3]);',
      "process.exit(0);",
    ].join("\n"),
    "utf8"
  );
  const result = Bun.spawnSync([process.execPath, scriptPath, dbPath, value]);
  fs.rmSync(scriptPath, { force: true });
  if (result.exitCode !== 0) {
    throw new Error(`legacy seed process failed: ${result.stderr?.toString("utf8")}`);
  }
}

describe("openDatabase legacy plaintext migration", () => {
  it("deletes the pre-upgrade plaintext -wal/-shm sidecars once the first encrypted flush succeeds", () => {
    dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "bulk-tool-db-test-")), "test.db");
    createAbandonedLegacyWalDatabase(dbPath, "recoverable-from-plaintext-wal");

    // Precondition: the sidecars exist and really do hold the plaintext.
    expect(fs.existsSync(`${dbPath}-wal`)).toBe(true);
    expect(fs.readFileSync(`${dbPath}-wal`).includes("recoverable-from-plaintext-wal")).toBe(true);

    db = openDatabase(dbPath);

    // The migration itself worked...
    expect(db.prepare("SELECT secret FROM legacy").get()).toEqual({
      secret: "recoverable-from-plaintext-wal",
    });
    // ...and left no plaintext behind next to the now-encrypted database.
    expect(fs.existsSync(`${dbPath}-wal`)).toBe(false);
    expect(fs.existsSync(`${dbPath}-shm`)).toBe(false);
    expect(fs.readFileSync(dbPath).subarray(0, 16).toString("utf8")).not.toBe("SQLite format 3\0");
  });

  it("keeps the sidecars when the migration's first flush fails, so a retry can still recover them", () => {
    dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "bulk-tool-db-test-")), "test.db");
    createAbandonedLegacyWalDatabase(dbPath, "still-needed-after-a-failed-flush");

    const renameSpy = vi.spyOn(fs, "renameSync").mockImplementation(() => {
      throw new Error("ENOSPC: no space left on device");
    });
    try {
      expect(() => openDatabase(dbPath)).toThrow(/ENOSPC/);
    } finally {
      renameSpy.mockRestore();
    }

    // Nothing was deleted: app.db is still the untouched plaintext original,
    // and the WAL frames it needs are still beside it.
    expect(fs.existsSync(`${dbPath}-wal`)).toBe(true);
    expect(fs.readFileSync(dbPath).subarray(0, 16).toString("utf8")).toBe("SQLite format 3\0");

    // And the retry, once the disk is writable again, still recovers the data.
    db = openDatabase(dbPath);
    expect(db.prepare("SELECT secret FROM legacy").get()).toEqual({
      secret: "still-needed-after-a-failed-flush",
    });
    expect(fs.existsSync(`${dbPath}-wal`)).toBe(false);
  });
});

describe("openDatabase flush failure handling", () => {
  // flush() is made to fail by way of fs.renameSync — the last step of its
  // temp-write/fsync/rename sequence, and the one most likely to fail for
  // real (an antivirus scanner, a backup agent or a search indexer holding a
  // transient handle on the target path produces exactly this on Windows).
  // Spying on encryptedStore's own exported flush() isn't an option here —
  // ESM export bindings aren't reliably spy-able — so the failure is injected
  // one layer down, which also exercises the real flush() code path rather
  // than replacing it.

  it("does not crash and retries when a debounced flush fails, eventually persisting the write", () => {
    vi.useFakeTimers();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    let renameSpy: ReturnType<typeof vi.spyOn> | undefined;
    try {
      dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "bulk-tool-db-test-")), "test.db");
      db = openDatabase(dbPath);
      const afterOpen = fs.readFileSync(dbPath);

      // Installed only after openDatabase's own startup flush, so the single
      // scripted failure lands on the *debounced* flush under test.
      renameSpy = vi.spyOn(fs, "renameSync").mockImplementationOnce(() => {
        throw new Error("EPERM: simulated antivirus lock on the database file");
      });

      insertConnectionRow("id-flush-fail-1");

      // The debounced flush fires inside a timer callback: an unhandled throw
      // here is an uncaught exception that takes the whole process down.
      expect(() => vi.advanceTimersByTime(600)).not.toThrow();
      expect(errorSpy).toHaveBeenCalled();
      // Nothing was written, and — crucially — the previous complete file is
      // still exactly as it was.
      expect(fs.readFileSync(dbPath).equals(afterOpen)).toBe(true);

      // The store stayed dirty and re-armed a retry, so the write reaches
      // disk on the next attempt without needing another incidental write.
      vi.advanceTimersByTime(2100);
      expect(fs.readFileSync(dbPath).equals(afterOpen)).toBe(false);

      renameSpy.mockRestore();
      renameSpy = undefined;
      db.close();
      db = undefined;

      const reopened = openDatabase(dbPath);
      expect(reopened.prepare("SELECT * FROM connections WHERE id = ?").get("id-flush-fail-1")).toBeTruthy();
      reopened.close();
    } finally {
      renameSpy?.mockRestore();
      errorSpy.mockRestore();
      vi.useRealTimers();
    }
  });

  it("still closes the database when the flush on close fails, and leaves no retry timer armed", () => {
    vi.useFakeTimers();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    let renameSpy: ReturnType<typeof vi.spyOn> | undefined;
    try {
      dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "bulk-tool-db-test-")), "test.db");
      db = openDatabase(dbPath);
      insertConnectionRow("id-close-fail-1");

      renameSpy = vi.spyOn(fs, "renameSync").mockImplementationOnce(() => {
        throw new Error("ENOSPC: no space left on device");
      });

      // A throw here would block originalClose() — and, via the CLI's
      // "clear app data" flow, would stop rmDataDir() from ever running.
      expect(() => db!.close()).not.toThrow();
      expect(errorSpy).toHaveBeenCalled();

      // The underlying handle really was closed, not just skipped over.
      expect(() => db!.prepare("SELECT 1").get()).toThrow();

      // No retry timer may survive the close: it would call serialize() on a
      // closed database from inside a timer callback and crash the process.
      const renameCallsAtClose = renameSpy.mock.calls.length;
      expect(() => vi.advanceTimersByTime(10_000)).not.toThrow();
      expect(renameSpy.mock.calls.length).toBe(renameCallsAtClose);

      db = undefined;
    } finally {
      renameSpy?.mockRestore();
      errorSpy.mockRestore();
      vi.useRealTimers();
    }
  });
});

describe("openDatabase write interception", () => {
  it("tracks a write made via db.run() (not just prepare().run()) for auto-flush", () => {
    vi.useFakeTimers();
    try {
      dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "bulk-tool-db-test-")), "test.db");
      db = openDatabase(dbPath);
      const afterOpen = fs.readFileSync(dbPath);

      db.run(
        `INSERT INTO connections (id, type, login, app_id, installation_id, encrypted_token, created_at)
         VALUES ('id-direct-run', 'PAT', 'octocat', NULL, NULL, 'enc', '2026-01-01T00:00:00.000Z')`
      );

      vi.advanceTimersByTime(600);
      expect(fs.readFileSync(dbPath).equals(afterOpen)).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("tracks a write made via db.query(sql).run() (not just db.prepare(sql).run()) for auto-flush", () => {
    vi.useFakeTimers();
    try {
      dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "bulk-tool-db-test-")), "test.db");
      db = openDatabase(dbPath);
      const afterOpen = fs.readFileSync(dbPath);

      db
        .query(
          `INSERT INTO connections (id, type, login, app_id, installation_id, encrypted_token, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run("id-query-run", "PAT", "octocat", null, null, "enc", "2026-01-01T00:00:00.000Z");

      vi.advanceTimersByTime(600);
      expect(fs.readFileSync(dbPath).equals(afterOpen)).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("supports db.transaction(fn).immediate(...) without throwing, and still tracks it for auto-flush", () => {
    vi.useFakeTimers();
    try {
      dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "bulk-tool-db-test-")), "test.db");
      db = openDatabase(dbPath);
      const afterOpen = fs.readFileSync(dbPath);

      const insertImmediate = db.transaction((id: string) => {
        insertConnectionRow(id);
      });

      expect(() => insertImmediate.immediate("id-tx-immediate")).not.toThrow();

      const row = db.prepare("SELECT * FROM connections WHERE id = ?").get("id-tx-immediate");
      expect(row).toBeTruthy();

      vi.advanceTimersByTime(600);
      expect(fs.readFileSync(dbPath).equals(afterOpen)).toBe(false);
    } finally {
      vi.useRealTimers();
    }
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
