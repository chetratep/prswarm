import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDatabase, type AppDatabase } from "../db.js";
import {
  countUsers,
  getUserById,
  getUserRowByUsername,
  insertUser,
  listUsers,
  updateUserPasswordHash,
  updateUserRole,
} from "./usersRepository.js";

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
  dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "bulk-tool-users-test-")), "test.db");
  db = openDatabase(dbPath);
  return db;
}

describe("usersRepository", () => {
  it("inserts a user and reads it back without exposing the password hash", () => {
    const database = freshDb();
    const user = insertUser(database, { username: "alice", passwordHash: "hashed", role: "member" });

    expect(user.username).toBe("alice");
    expect(user.role).toBe("member");
    expect((user as unknown as { passwordHash?: string }).passwordHash).toBeUndefined();

    const fetched = getUserById(database, user.id);
    expect(fetched).toEqual(user);
  });

  it("getUserRowByUsername returns the row including the hash, for login", () => {
    const database = freshDb();
    insertUser(database, { username: "bob", passwordHash: "secret-hash", role: "member" });

    const row = getUserRowByUsername(database, "bob");
    expect(row?.password_hash).toBe("secret-hash");
  });

  it("returns null for an unknown username or id", () => {
    const database = freshDb();
    expect(getUserRowByUsername(database, "nobody")).toBeNull();
    expect(getUserById(database, "does-not-exist")).toBeNull();
  });

  it("countUsers reflects the number of rows", () => {
    const database = freshDb();
    expect(countUsers(database)).toBe(0);
    insertUser(database, { username: "carol", passwordHash: "h", role: "admin" });
    expect(countUsers(database)).toBe(1);
  });

  it("listUsers returns everyone, oldest first", () => {
    const database = freshDb();
    const first = insertUser(database, { username: "first", passwordHash: "h", role: "member" });
    const second = insertUser(database, { username: "second", passwordHash: "h", role: "member" });
    expect(listUsers(database).map((u) => u.id)).toEqual([first.id, second.id]);
  });

  it("updateUserRole promotes a member to admin", () => {
    const database = freshDb();
    const user = insertUser(database, { username: "dave", passwordHash: "h", role: "member" });
    const promoted = updateUserRole(database, user.id, "admin");
    expect(promoted.role).toBe("admin");
    expect(getUserById(database, user.id)?.role).toBe("admin");
  });

  it("updateUserPasswordHash changes the stored hash", () => {
    const database = freshDb();
    const user = insertUser(database, { username: "erin", passwordHash: "old-hash", role: "member" });
    updateUserPasswordHash(database, user.id, "new-hash");
    expect(getUserRowByUsername(database, "erin")?.password_hash).toBe("new-hash");
  });
});
