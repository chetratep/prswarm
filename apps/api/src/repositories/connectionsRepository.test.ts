import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDatabase, type AppDatabase } from "../db.js";
import {
  deleteCurrentConnection,
  getCurrentConnection,
  reassignOrphanedConnections,
  replaceWithPatConnection,
} from "./connectionsRepository.js";

let dbPath: string;
let db: AppDatabase | undefined;

afterEach(() => {
  if (db) {
    db.close();
    db = undefined;
  }
  if (dbPath && fs.existsSync(dbPath)) {
    try {
      fs.rmSync(dbPath);
    } catch {
      // File may still be locked by Bun's sqlite; ignore cleanup errors
    }
  }
});

function freshDb(): AppDatabase {
  dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "bulk-tool-connections-test-")), "test.db");
  db = openDatabase(dbPath);
  return db;
}

describe("connectionsRepository", () => {
  it("deleteCurrentConnection removes only that user's connection", () => {
    const database = freshDb();
    replaceWithPatConnection(database, "user-a", { login: "octocat", host: null, encryptedToken: "enc" });
    expect(getCurrentConnection(database, "user-a")).not.toBeNull();

    deleteCurrentConnection(database, "user-a");

    expect(getCurrentConnection(database, "user-a")).toBeNull();
  });

  it("deleteCurrentConnection is a no-op when that user has no connection", () => {
    const database = freshDb();
    expect(() => deleteCurrentConnection(database, "nobody")).not.toThrow();
  });

  it("reconnecting one user's PAT never touches another user's connection", () => {
    const database = freshDb();
    replaceWithPatConnection(database, "user-a", { login: "alice-gh", host: null, encryptedToken: "enc-a" });
    replaceWithPatConnection(database, "user-b", { login: "bob-gh", host: null, encryptedToken: "enc-b" });

    // user-a reconnects with a new token — must not delete user-b's row.
    replaceWithPatConnection(database, "user-a", { login: "alice-gh-2", host: null, encryptedToken: "enc-a-2" });

    expect(getCurrentConnection(database, "user-a")?.login).toBe("alice-gh-2");
    expect(getCurrentConnection(database, "user-b")?.login).toBe("bob-gh");
  });

  it("stores and returns a GitHub Enterprise host", () => {
    const database = freshDb();
    const connection = replaceWithPatConnection(database, "user-a", {
      login: "octocat",
      host: "ghe.example.com",
      encryptedToken: "enc",
    });
    expect(connection.host).toBe("ghe.example.com");
    expect(getCurrentConnection(database, "user-a")?.host).toBe("ghe.example.com");
  });

  it("reassignOrphanedConnections assigns pre-migration rows (user_id NULL) to the given admin", () => {
    const database = freshDb();
    // Simulate a pre-migration row directly — replaceWithPatConnection
    // always sets user_id now, so this bypasses it to model legacy data.
    // (In practice db.ts's own migration already backfills NULL -> 'local'
    // unconditionally on every boot, so a real NULL row rarely reaches this
    // function — but it's still exercised here as a defensive belt-and-
    // braces case.)
    database
      .prepare(
        `INSERT INTO connections (id, user_id, type, login, host, app_id, installation_id, encrypted_token, created_at)
         VALUES ('legacy-1', NULL, 'PAT', 'legacy-login', NULL, NULL, NULL, 'enc', '2020-01-01T00:00:00.000Z')`
      )
      .run();

    reassignOrphanedConnections(database, "admin-1");

    expect(getCurrentConnection(database, "admin-1")?.login).toBe("legacy-login");
  });

  it("reassignOrphanedConnections also assigns 'local'-owned rows to the given admin (auth turned on after single-user use)", () => {
    const database = freshDb();
    // A connection created while AUTH_ENABLED was off is owned by the
    // 'local' sentinel (see auth/currentUser.ts). Turning auth on
    // afterward must not orphan it — reassignOrphanedConnections has to
    // catch this case too, not just user_id IS NULL, mirroring how
    // reassignLegacyJobs treats created_by = 'local' in jobsRepository.ts.
    replaceWithPatConnection(database, "local", {
      login: "local-user-login",
      host: null,
      encryptedToken: "enc",
    });

    reassignOrphanedConnections(database, "admin-1");

    expect(getCurrentConnection(database, "admin-1")?.login).toBe("local-user-login");
    expect(getCurrentConnection(database, "local")).toBeNull();
  });
});
