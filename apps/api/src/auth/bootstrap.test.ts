import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDatabase, type AppDatabase } from "../db.js";
import { countUsers, getUserRowByUsername } from "../repositories/usersRepository.js";
import { getCurrentConnection } from "../repositories/connectionsRepository.js";
import { bootstrapAuth } from "./bootstrap.js";

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
  dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "bulk-tool-bootstrap-test-")), "test.db");
  db = openDatabase(dbPath);
  return db;
}

describe("bootstrapAuth", () => {
  it("does nothing when auth is disabled", () => {
    const database = freshDb();
    bootstrapAuth(database, { authEnabled: false, authUsername: undefined, authPasswordHash: undefined });
    expect(countUsers(database)).toBe(0);
  });

  it("creates a generated 'admin' account when no env credentials are set", () => {
    const database = freshDb();
    bootstrapAuth(database, { authEnabled: true, authUsername: undefined, authPasswordHash: undefined });
    expect(countUsers(database)).toBe(1);
    const row = getUserRowByUsername(database, "admin");
    expect(row?.role).toBe("admin");
    expect(row?.password_hash).toBeTruthy();
  });

  it("seeds the admin from AUTH_USERNAME/AUTH_PASSWORD_HASH when both are set", () => {
    const database = freshDb();
    bootstrapAuth(database, {
      authEnabled: true,
      authUsername: "ops",
      authPasswordHash: "$2a$10$existinghashvalue",
    });
    const row = getUserRowByUsername(database, "ops");
    expect(row?.password_hash).toBe("$2a$10$existinghashvalue");
    expect(row?.role).toBe("admin");
  });

  it("is idempotent — a second call makes no changes once a user exists", () => {
    const database = freshDb();
    bootstrapAuth(database, { authEnabled: true, authUsername: undefined, authPasswordHash: undefined });
    bootstrapAuth(database, { authEnabled: true, authUsername: undefined, authPasswordHash: undefined });
    expect(countUsers(database)).toBe(1);
  });

  it("reassigns orphaned connections and legacy jobs to the bootstrap admin", () => {
    const database = freshDb();
    database
      .prepare(
        `INSERT INTO connections (id, user_id, type, login, host, app_id, installation_id, encrypted_token, created_at)
         VALUES ('legacy-conn', NULL, 'PAT', 'legacy-login', NULL, NULL, NULL, 'enc', '2020-01-01T00:00:00.000Z')`
      )
      .run();
    database
      .prepare(
        `INSERT INTO jobs (id, change_set_id, target_selection_id, status, created_by, started_at, completed_at, created_at)
         VALUES ('legacy-job', 'cs-1', 'ts-1', 'COMPLETED', 'local', NULL, NULL, '2020-01-01T00:00:00.000Z')`
      )
      .run();

    bootstrapAuth(database, { authEnabled: true, authUsername: undefined, authPasswordHash: undefined });

    const admin = getUserRowByUsername(database, "admin");
    expect(admin).not.toBeNull();
    expect(getCurrentConnection(database, admin!.id)?.login).toBe("legacy-login");
    const job = database.prepare("SELECT created_by FROM jobs WHERE id = 'legacy-job'").get() as {
      created_by: string;
    };
    expect(job.created_by).toBe(admin!.id);
  });
});
