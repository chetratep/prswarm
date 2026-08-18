import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDatabase, type AppDatabase } from "../db.js";
import {
  getChangeSetById,
  getChangeSetFilesByChangeSetId,
  insertChangeSet,
  insertChangeSetFile,
} from "./changesetsRepository.js";

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
  dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "bulk-tool-changesets-test-")), "test.db");
  db = openDatabase(dbPath);
  return db;
}

describe("changesetsRepository", () => {
  it("inserts and reads back a changeset with no file fields on it", () => {
    const database = freshDb();
    const changeSet = insertChangeSet(database, {
      name: "Add PR review workflow",
      branchStrategy: "NEW_BRANCH",
      commitStrategy: "DIRECT_COMMIT",
      commitMessage: "Add PR review workflow",
      prTitle: null,
      prBody: null,
    });

    expect(changeSet.name).toBe("Add PR review workflow");
    expect((changeSet as unknown as { filePath?: string }).filePath).toBeUndefined();

    const fetched = getChangeSetById(database, changeSet.id);
    expect(fetched).toEqual(changeSet);
  });

  it("returns null for a changeset id that doesn't exist", () => {
    const database = freshDb();
    expect(getChangeSetById(database, "does-not-exist")).toBeNull();
  });

  it("inserts multiple files and returns them ordered by orderIndex, not insertion order", () => {
    const database = freshDb();
    const changeSet = insertChangeSet(database, {
      name: "Multi-file test",
      branchStrategy: "NEW_BRANCH",
      commitStrategy: "DIRECT_COMMIT",
      commitMessage: "test",
      prTitle: null,
      prBody: null,
    });

    insertChangeSetFile(database, {
      changeSetId: changeSet.id,
      orderIndex: 1,
      filePath: "second.yml",
      mode: "UPSERT",
      contentSource: "STATIC",
      content: "second",
      templateVarsSchema: null,
    });
    insertChangeSetFile(database, {
      changeSetId: changeSet.id,
      orderIndex: 0,
      filePath: "first.yml",
      mode: "CREATE_ONLY",
      contentSource: "TEMPLATE",
      content: "{{team}}",
      templateVarsSchema: { team: "" },
    });

    const files = getChangeSetFilesByChangeSetId(database, changeSet.id);
    expect(files.map((f) => f.filePath)).toEqual(["first.yml", "second.yml"]);
    expect(files[0].mode).toBe("CREATE_ONLY");
    expect(files[0].contentSource).toBe("TEMPLATE");
    expect(files[0].templateVarsSchema).toEqual({ team: "" });
    expect(files[1].templateVarsSchema).toBeNull();
  });
});
