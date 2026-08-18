import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDatabase, type AppDatabase } from "../db.js";
import {
  deleteCurrentConnection,
  getCurrentConnection,
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
  it("deleteCurrentConnection removes the stored connection entirely", () => {
    const database = freshDb();
    replaceWithPatConnection(database, { login: "octocat", encryptedToken: "enc" });
    expect(getCurrentConnection(database)).not.toBeNull();

    deleteCurrentConnection(database);

    expect(getCurrentConnection(database)).toBeNull();
  });

  it("deleteCurrentConnection is a no-op when there is no connection", () => {
    const database = freshDb();
    expect(() => deleteCurrentConnection(database)).not.toThrow();
    expect(getCurrentConnection(database)).toBeNull();
  });
});
