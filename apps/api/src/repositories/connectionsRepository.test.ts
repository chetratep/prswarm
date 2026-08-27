import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDatabase, type AppDatabase } from "../db.js";
import {
  activateConnection,
  ConnectionNotFoundError,
  deleteConnection,
  getCurrentConnection,
  listConnections,
  reassignOrphanedConnections,
  replaceWithGithubAppConnection,
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
  it("deleteConnection removes only that specific connection", () => {
    const database = freshDb();
    const connection = replaceWithPatConnection(database, "user-a", {
      login: "octocat",
      host: null,
      encryptedToken: "enc",
    });
    expect(getCurrentConnection(database, "user-a")).not.toBeNull();

    deleteConnection(database, "user-a", connection.id);

    expect(getCurrentConnection(database, "user-a")).toBeNull();
  });

  it("deleteConnection is a no-op when that id doesn't exist for that user", () => {
    const database = freshDb();
    expect(() => deleteConnection(database, "nobody", "no-such-id")).not.toThrow();
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

  it("connecting a GitHub App after a PAT leaves the PAT row intact and inactive", () => {
    const database = freshDb();
    const pat = replaceWithPatConnection(database, "user-a", {
      login: "octocat",
      host: null,
      encryptedToken: "enc-pat",
    });

    const app = replaceWithGithubAppConnection(database, "user-a", {
      login: "my-org",
      host: null,
      appId: "app-1",
      installationId: 99,
      encryptedPrivateKeyPem: "enc-pem",
    });

    const connections = listConnections(database, "user-a");
    expect(connections).toHaveLength(2);

    const patRow = connections.find((c) => c.id === pat.id);
    const appRow = connections.find((c) => c.id === app.id);
    expect(patRow?.active).toBe(false);
    expect(appRow?.active).toBe(true);
    // The active connection resolved for job execution is the one just connected.
    expect(getCurrentConnection(database, "user-a")?.id).toBe(app.id);
  });

  it("reconnecting a PAT after a GitHub App is already saved leaves the GitHub App intact and inactive", () => {
    const database = freshDb();
    const app = replaceWithGithubAppConnection(database, "user-a", {
      login: "my-org",
      host: null,
      appId: "app-1",
      installationId: 99,
      encryptedPrivateKeyPem: "enc-pem",
    });
    const pat = replaceWithPatConnection(database, "user-a", {
      login: "octocat",
      host: null,
      encryptedToken: "enc-pat",
    });

    const connections = listConnections(database, "user-a");
    expect(connections.find((c) => c.id === app.id)?.active).toBe(false);
    expect(connections.find((c) => c.id === pat.id)?.active).toBe(true);
    expect(getCurrentConnection(database, "user-a")?.id).toBe(pat.id);
  });

  it("reconnecting the same type twice replaces only that type's row (still 2-slot max)", () => {
    const database = freshDb();
    replaceWithGithubAppConnection(database, "user-a", {
      login: "my-org",
      host: null,
      appId: "app-1",
      installationId: 99,
      encryptedPrivateKeyPem: "enc-pem",
    });
    replaceWithPatConnection(database, "user-a", {
      login: "octocat",
      host: null,
      encryptedToken: "enc-pat-1",
    });
    // Reconnect PAT with a different token — must replace the PAT slot, not add a third row.
    replaceWithPatConnection(database, "user-a", {
      login: "octocat-2",
      host: null,
      encryptedToken: "enc-pat-2",
    });

    const connections = listConnections(database, "user-a");
    expect(connections).toHaveLength(2);
    expect(connections.find((c) => c.type === "PAT")?.login).toBe("octocat-2");
  });

  it("activateConnection switches which connection is active without touching the other", () => {
    const database = freshDb();
    const pat = replaceWithPatConnection(database, "user-a", {
      login: "octocat",
      host: null,
      encryptedToken: "enc-pat",
    });
    const app = replaceWithGithubAppConnection(database, "user-a", {
      login: "my-org",
      host: null,
      appId: "app-1",
      installationId: 99,
      encryptedPrivateKeyPem: "enc-pem",
    });
    expect(getCurrentConnection(database, "user-a")?.id).toBe(app.id); // most recently connected

    const activated = activateConnection(database, "user-a", pat.id);

    expect(activated.active).toBe(true);
    expect(getCurrentConnection(database, "user-a")?.id).toBe(pat.id);
    expect(listConnections(database, "user-a").find((c) => c.id === app.id)?.active).toBe(false);
  });

  it("activateConnection rejects an id that doesn't belong to that user", () => {
    const database = freshDb();
    const pat = replaceWithPatConnection(database, "user-b", {
      login: "someone-else",
      host: null,
      encryptedToken: "enc",
    });

    expect(() => activateConnection(database, "user-a", pat.id)).toThrow(ConnectionNotFoundError);
  });

  it("deleteConnection auto-activates the remaining slot when the active one is removed", () => {
    const database = freshDb();
    const pat = replaceWithPatConnection(database, "user-a", {
      login: "octocat",
      host: null,
      encryptedToken: "enc-pat",
    });
    const app = replaceWithGithubAppConnection(database, "user-a", {
      login: "my-org",
      host: null,
      appId: "app-1",
      installationId: 99,
      encryptedPrivateKeyPem: "enc-pem",
    });
    expect(getCurrentConnection(database, "user-a")?.id).toBe(app.id);

    deleteConnection(database, "user-a", app.id);

    const remaining = listConnections(database, "user-a");
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.id).toBe(pat.id);
    expect(remaining[0]?.active).toBe(true);
    expect(getCurrentConnection(database, "user-a")?.id).toBe(pat.id);
  });

  it("deleteConnection leaves no active connection when the only slot is removed", () => {
    const database = freshDb();
    const pat = replaceWithPatConnection(database, "user-a", {
      login: "octocat",
      host: null,
      encryptedToken: "enc-pat",
    });

    deleteConnection(database, "user-a", pat.id);

    expect(listConnections(database, "user-a")).toHaveLength(0);
    expect(getCurrentConnection(database, "user-a")).toBeNull();
  });
});
