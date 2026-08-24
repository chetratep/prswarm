// Data access for the `jobs` table. Same row<->domain-object mapping style
// as connectionsRepository.ts. `updateJob` builds a dynamic SET clause so
// callers only need to pass the columns actually changing (e.g. just
// `status`, or `status` + `completedAt`).
import { randomUUID } from "node:crypto";
import type { Job, JobStatus } from "@prdispatch/shared-types";
import type { AppDatabase } from "../db.js";

export interface JobRow {
  id: string;
  change_set_id: string;
  target_selection_id: string;
  status: JobStatus;
  created_by: string;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

function rowToJob(row: JobRow): Job {
  return {
    id: row.id,
    changeSetId: row.change_set_id,
    targetSelectionId: row.target_selection_id,
    status: row.status,
    createdBy: row.created_by,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    createdAt: row.created_at,
  };
}

export interface InsertJobInput {
  changeSetId: string;
  targetSelectionId: string;
  status: JobStatus;
  createdBy: string;
}

export function insertJob(db: AppDatabase, input: InsertJobInput): Job {
  const id = randomUUID();
  const createdAt = new Date().toISOString();

  db.prepare(
    `INSERT INTO jobs (id, change_set_id, target_selection_id, status, created_by, started_at, completed_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, input.changeSetId, input.targetSelectionId, input.status, input.createdBy, null, null, createdAt);

  return {
    id,
    changeSetId: input.changeSetId,
    targetSelectionId: input.targetSelectionId,
    status: input.status,
    createdBy: input.createdBy,
    startedAt: null,
    completedAt: null,
    createdAt,
  };
}

export function getJobById(db: AppDatabase, id: string): Job | null {
  const row = db.prepare("SELECT * FROM jobs WHERE id = ?").get(id) as JobRow | undefined;
  return row ? rowToJob(row) : null;
}

/** Newest first, for the run-history list. `rowid` is a secondary sort key
 * so two jobs inserted within the same millisecond (created_at collides)
 * still come back in actual insertion order rather than in
 * SQLite-tie-break-arbitrary order. */
export function getAllJobsOrderedByCreatedAtDesc(db: AppDatabase): Job[] {
  const rows = db
    .prepare("SELECT * FROM jobs ORDER BY created_at DESC, rowid DESC")
    .all() as unknown as JobRow[];
  return rows.map(rowToJob);
}

export interface JobUpdate {
  status?: JobStatus;
  startedAt?: string | null;
  completedAt?: string | null;
}

const JOB_UPDATE_COLUMN_MAP: Record<keyof JobUpdate, string> = {
  status: "status",
  startedAt: "started_at",
  completedAt: "completed_at",
};

export function updateJob(db: AppDatabase, id: string, update: JobUpdate): Job {
  const keys = Object.keys(update) as (keyof JobUpdate)[];
  if (keys.length > 0) {
    const setClause = keys.map((key) => `${JOB_UPDATE_COLUMN_MAP[key]} = ?`).join(", ");
    const values = keys.map((key) => update[key] ?? null);
    db.prepare(`UPDATE jobs SET ${setClause} WHERE id = ?`).run(...values, id);
  }

  const updated = getJobById(db, id);
  if (!updated) {
    throw new Error(`job ${id} not found after update`);
  }
  return updated;
}

/** One-time backfill: jobs created before real users existed are stamped
 * the literal string "local" for created_by. Reassigns them to the
 * bootstrap admin so they don't vanish from anyone's history once
 * ownership-scoped history filtering ships. Idempotent — a second call
 * finds nothing left with created_by = 'local'. */
export function reassignLegacyJobs(db: AppDatabase, adminUserId: string): void {
  db.prepare("UPDATE jobs SET created_by = ? WHERE created_by = 'local'").run(adminUserId);
}
