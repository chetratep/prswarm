// Data access for the `repo_run_files` table — one row per (repo_run,
// changeset file) pair, created once at diff-preview time and never
// updated afterward (see RepoRunFile's field docs in shared-types for
// why). Same row<->domain-object mapping style as repoRunsRepository.ts.
import { randomUUID } from "node:crypto";
import type { RepoRunFile } from "@prswarm/shared-types";
import type { AppDatabase } from "../db.js";

export interface RepoRunFileRow {
  id: string;
  repo_run_id: string;
  change_set_file_id: string;
  file_path: string;
  diff_summary: string | null;
  before_sha: string | null;
  after_sha: string | null;
  error_message: string | null;
  rendered_content: string | null;
}

function rowToRepoRunFile(row: RepoRunFileRow): RepoRunFile {
  return {
    id: row.id,
    repoRunId: row.repo_run_id,
    changeSetFileId: row.change_set_file_id,
    filePath: row.file_path,
    diffSummary: row.diff_summary,
    beforeSha: row.before_sha,
    afterSha: row.after_sha,
    errorMessage: row.error_message,
    renderedContent: row.rendered_content,
  };
}

export interface InsertRepoRunFileInput {
  repoRunId: string;
  changeSetFileId: string;
  filePath: string;
  diffSummary: string | null;
  beforeSha: string | null;
  afterSha: string | null;
  errorMessage: string | null;
  renderedContent: string | null;
}

export function insertRepoRunFile(db: AppDatabase, input: InsertRepoRunFileInput): RepoRunFile {
  const id = randomUUID();

  db.prepare(
    `INSERT INTO repo_run_files
      (id, repo_run_id, change_set_file_id, file_path, diff_summary, before_sha, after_sha, error_message, rendered_content)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.repoRunId,
    input.changeSetFileId,
    input.filePath,
    input.diffSummary,
    input.beforeSha,
    input.afterSha,
    input.errorMessage,
    input.renderedContent
  );

  return {
    id,
    repoRunId: input.repoRunId,
    changeSetFileId: input.changeSetFileId,
    filePath: input.filePath,
    diffSummary: input.diffSummary,
    beforeSha: input.beforeSha,
    afterSha: input.afterSha,
    errorMessage: input.errorMessage,
    renderedContent: input.renderedContent,
  };
}

export function getRepoRunFilesByRepoRunId(db: AppDatabase, repoRunId: string): RepoRunFile[] {
  const rows = db
    .prepare("SELECT * FROM repo_run_files WHERE repo_run_id = ?")
    .all(repoRunId) as unknown as RepoRunFileRow[];
  return rows.map(rowToRepoRunFile);
}

/** Flat list across every repo_run in a job — JobView.repoRunFiles is flat
 * by design (see shared-types), the frontend groups by repoRunId itself. */
export function getRepoRunFilesByJobId(db: AppDatabase, jobId: string): RepoRunFile[] {
  const rows = db
    .prepare(
      `SELECT repo_run_files.*
       FROM repo_run_files
       JOIN repo_runs ON repo_run_files.repo_run_id = repo_runs.id
       WHERE repo_runs.job_id = ?`
    )
    .all(jobId) as unknown as RepoRunFileRow[];
  return rows.map(rowToRepoRunFile);
}
