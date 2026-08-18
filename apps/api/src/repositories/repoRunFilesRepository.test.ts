import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDatabase, type AppDatabase } from "../db.js";
import { insertChangeSet, insertChangeSetFile, insertTargetSelection } from "./changesetsRepository.js";
import { insertJob } from "./jobsRepository.js";
import { insertRepoRun } from "./repoRunsRepository.js";
import { getRepoRunFilesByJobId, getRepoRunFilesByRepoRunId, insertRepoRunFile } from "./repoRunFilesRepository.js";

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
  dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "bulk-tool-repo-run-files-test-")), "test.db");
  db = openDatabase(dbPath);
  return db;
}

/** Builds a changeset + one file + one target selection + one job, the
 * minimum scaffolding repo_run_files' foreign keys need to attach to. */
function seedJob(database: AppDatabase) {
  const changeSet = insertChangeSet(database, {
    name: "test",
    branchStrategy: "NEW_BRANCH",
    commitStrategy: "DIRECT_COMMIT",
    commitMessage: "test",
    prTitle: null,
    prBody: null,
  });
  const file = insertChangeSetFile(database, {
    changeSetId: changeSet.id,
    orderIndex: 0,
    filePath: "a.yml",
    mode: "UPSERT",
    contentSource: "STATIC",
    content: "content",
    templateVarsSchema: null,
  });
  const targetSelection = insertTargetSelection(database, {
    changeSetId: changeSet.id,
    orgs: ["acme"],
    selectAllInOrg: false,
    filters: {},
    explicitRepoList: ["acme/repo-one"],
    resolvedRepoCount: 1,
  });
  const job = insertJob(database, {
    changeSetId: changeSet.id,
    targetSelectionId: targetSelection.id,
    status: "PREVIEWING",
    createdBy: "local",
  });
  return { changeSet, file, job };
}

describe("repoRunFilesRepository", () => {
  it("inserts a repo_run_file and reads it back by repo_run_id", () => {
    const database = freshDb();
    const { file, job } = seedJob(database);
    const repoRun = insertRepoRun(database, {
      jobId: job.id,
      repoFullName: "acme/repo-one",
      status: "DIFF_COMPUTED",
      branchProtected: null,
      directToDefault: false,
      commitSha: null,
      prUrl: null,
      errorMessage: null,
      attemptCount: 0,
    });

    insertRepoRunFile(database, {
      repoRunId: repoRun.id,
      changeSetFileId: file.id,
      filePath: file.filePath,
      diffSummary: "@@ -0,0 +1 @@\n+content",
      beforeSha: null,
      afterSha: null,
      errorMessage: null,
      renderedContent: "content",
    });

    const files = getRepoRunFilesByRepoRunId(database, repoRun.id);
    expect(files).toHaveLength(1);
    expect(files[0].filePath).toBe("a.yml");
    expect(files[0].changeSetFileId).toBe(file.id);
  });

  it("getRepoRunFilesByJobId returns files across every repo_run in the job", () => {
    const database = freshDb();
    const { file, job } = seedJob(database);
    const repoRunOne = insertRepoRun(database, {
      jobId: job.id,
      repoFullName: "acme/repo-one",
      status: "DIFF_COMPUTED",
      branchProtected: null,
      directToDefault: false,
      commitSha: null,
      prUrl: null,
      errorMessage: null,
      attemptCount: 0,
    });
    const repoRunTwo = insertRepoRun(database, {
      jobId: job.id,
      repoFullName: "acme/repo-two",
      status: "DIFF_COMPUTED",
      branchProtected: null,
      directToDefault: false,
      commitSha: null,
      prUrl: null,
      errorMessage: null,
      attemptCount: 0,
    });
    insertRepoRunFile(database, {
      repoRunId: repoRunOne.id,
      changeSetFileId: file.id,
      filePath: file.filePath,
      diffSummary: null,
      beforeSha: null,
      afterSha: null,
      errorMessage: null,
      renderedContent: "one",
    });
    insertRepoRunFile(database, {
      repoRunId: repoRunTwo.id,
      changeSetFileId: file.id,
      filePath: file.filePath,
      diffSummary: null,
      beforeSha: null,
      afterSha: null,
      errorMessage: null,
      renderedContent: "two",
    });

    const files = getRepoRunFilesByJobId(database, job.id);
    expect(files).toHaveLength(2);
    expect(files.map((f) => f.renderedContent).sort()).toEqual(["one", "two"]);
  });
});
