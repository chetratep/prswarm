import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDatabase, type AppDatabase } from "../db.js";
import { getAllJobsOrderedByCreatedAtDesc, insertJob } from "./jobsRepository.js";

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
  dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "bulk-tool-jobs-test-")), "test.db");
  db = openDatabase(dbPath);
  return db;
}

describe("jobsRepository", () => {
  it("insertJob stamps a createdAt", () => {
    const database = freshDb();
    const job = insertJob(database, {
      changeSetId: "cs-1",
      targetSelectionId: "ts-1",
      status: "READY",
      createdBy: "local",
    });

    expect(job.createdAt).toEqual(expect.any(String));
    expect(new Date(job.createdAt).toString()).not.toBe("Invalid Date");
  });

  it("getAllJobsOrderedByCreatedAtDesc returns newest first", () => {
    const database = freshDb();
    const first = insertJob(database, {
      changeSetId: "cs-1",
      targetSelectionId: "ts-1",
      status: "READY",
      createdBy: "local",
    });
    const second = insertJob(database, {
      changeSetId: "cs-2",
      targetSelectionId: "ts-2",
      status: "READY",
      createdBy: "local",
    });

    const jobs = getAllJobsOrderedByCreatedAtDesc(database);

    expect(jobs.map((j) => j.id)).toEqual([second.id, first.id]);
  });

  it("returns an empty array when there are no jobs", () => {
    const database = freshDb();
    expect(getAllJobsOrderedByCreatedAtDesc(database)).toEqual([]);
  });
});
