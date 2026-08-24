// Data access for the `repo_runs` table — one row per targeted repo within
// a job, tracking the whole-repo outcome from diff preview through to
// execute-time result. Per-file diff/content data lives in
// repo_run_files instead (see repoRunFilesRepository.ts) — this table
// only tracks the repo-level outcome now that one commit covers every
// file in a changeset. Same row<->domain-object mapping style as
// connectionsRepository.ts.
import { randomUUID } from "node:crypto";
import type { RepoRun, RepoRunStatus } from "@prswarm/shared-types";
import type { AppDatabase } from "../db.js";

export interface RepoRunRow {
  id: string;
  job_id: string;
  repo_full_name: string;
  status: RepoRunStatus;
  branch_protected: number | null;
  direct_to_default: number;
  commit_sha: string | null;
  pr_url: string | null;
  error_message: string | null;
  attempt_count: number;
}

function rowToRepoRun(row: RepoRunRow): RepoRun {
  return {
    id: row.id,
    jobId: row.job_id,
    repoFullName: row.repo_full_name,
    status: row.status,
    branchProtected: row.branch_protected === null ? null : Boolean(row.branch_protected),
    directToDefault: Boolean(row.direct_to_default),
    commitSha: row.commit_sha,
    prUrl: row.pr_url,
    errorMessage: row.error_message,
    attemptCount: row.attempt_count,
  };
}

export interface InsertRepoRunInput {
  jobId: string;
  repoFullName: string;
  status: RepoRunStatus;
  branchProtected: boolean | null;
  directToDefault: boolean;
  commitSha: string | null;
  prUrl: string | null;
  errorMessage: string | null;
  attemptCount: number;
}

export function insertRepoRun(db: AppDatabase, input: InsertRepoRunInput): RepoRun {
  const id = randomUUID();

  db.prepare(
    `INSERT INTO repo_runs
      (id, job_id, repo_full_name, status, branch_protected, direct_to_default, commit_sha, pr_url, error_message, attempt_count)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.jobId,
    input.repoFullName,
    input.status,
    input.branchProtected === null ? null : input.branchProtected ? 1 : 0,
    input.directToDefault ? 1 : 0,
    input.commitSha,
    input.prUrl,
    input.errorMessage,
    input.attemptCount
  );

  return {
    id,
    jobId: input.jobId,
    repoFullName: input.repoFullName,
    status: input.status,
    branchProtected: input.branchProtected,
    directToDefault: input.directToDefault,
    commitSha: input.commitSha,
    prUrl: input.prUrl,
    errorMessage: input.errorMessage,
    attemptCount: input.attemptCount,
  };
}

export function getRepoRunsByJobId(db: AppDatabase, jobId: string): RepoRun[] {
  const rows = db.prepare("SELECT * FROM repo_runs WHERE job_id = ?").all(jobId) as unknown as RepoRunRow[];
  return rows.map(rowToRepoRun);
}

export function getRepoRunById(db: AppDatabase, id: string): RepoRun | null {
  const row = db.prepare("SELECT * FROM repo_runs WHERE id = ?").get(id) as RepoRunRow | undefined;
  return row ? rowToRepoRun(row) : null;
}

export interface RepoRunUpdate {
  status?: RepoRunStatus;
  branchProtected?: boolean | null;
  directToDefault?: boolean;
  commitSha?: string | null;
  prUrl?: string | null;
  errorMessage?: string | null;
  attemptCount?: number;
}

const REPO_RUN_UPDATE_COLUMN_MAP: Record<keyof RepoRunUpdate, string> = {
  status: "status",
  branchProtected: "branch_protected",
  directToDefault: "direct_to_default",
  commitSha: "commit_sha",
  prUrl: "pr_url",
  errorMessage: "error_message",
  attemptCount: "attempt_count",
};

/** Partial update by repo_run id — used at execute time to layer the
 * repo-level outcome (SUCCESS/FAILED/SKIPPED + commit/PR/error detail) on
 * top of the row created during diff preview. Only columns present as keys
 * in `update` are touched; a key present with value `null` clears that
 * column. */
export function updateRepoRun(db: AppDatabase, id: string, update: RepoRunUpdate): RepoRun {
  const keys = Object.keys(update) as (keyof RepoRunUpdate)[];
  if (keys.length > 0) {
    const setClause = keys.map((key) => `${REPO_RUN_UPDATE_COLUMN_MAP[key]} = ?`).join(", ");
    const values = keys.map((key): string | number | null => {
      const value = update[key];
      if (key === "branchProtected") {
        return value === null || value === undefined ? null : value ? 1 : 0;
      }
      if (key === "directToDefault") {
        return value ? 1 : 0;
      }
      return (value as string | number | null | undefined) ?? null;
    });
    db.prepare(`UPDATE repo_runs SET ${setClause} WHERE id = ?`).run(...values, id);
  }

  const updated = getRepoRunById(db, id);
  if (!updated) {
    throw new Error(`repo_run ${id} not found after update`);
  }
  return updated;
}
