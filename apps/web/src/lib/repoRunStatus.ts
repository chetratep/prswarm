import type { ComponentType, SVGProps } from "react";
import type { JobStatus, RepoRunFile, RepoRunStatus } from "@bulk-github-update-tool/shared-types";
import {
  IconAlertTriangle,
  IconCheckCircle,
  IconClock,
  IconMinusCircle,
  IconPencil,
  IconPlusCircle,
  IconXCircle,
} from "../components/icons";

type Icon = ComponentType<SVGProps<SVGSVGElement> & { size?: number }>;

/** Shared between Results and History — both show a job's lifecycle status
 * and must use the same label/class mapping (`.results-banner--${status
 * .toLowerCase()}` and `.chip--job-${status.toLowerCase()}` both key off
 * this same lowercased status). */
export const JOB_STATUS_LABEL: Record<JobStatus, string> = {
  DRAFT: "Draft",
  PREVIEWING: "Previewing",
  READY: "Ready",
  RUNNING: "Running",
  COMPLETED: "Completed",
  PARTIAL_FAILURE: "Partial failure",
  FAILED: "Failed",
};

// The three statuses the backend treats as "the job is done" — matches the
// set GET /jobs/:id/events closes its own stream on, and the set
// POST /jobs/:id/execute now rejects re-running once every repo_run has
// moved past it (see routes/jobs.ts).
export const TERMINAL_JOB_STATUSES: JobStatus[] = ["COMPLETED", "PARTIAL_FAILURE", "FAILED"];

export function isTerminalJobStatus(status: JobStatus): boolean {
  return TERMINAL_JOB_STATUSES.includes(status);
}

export const JOB_STATUS_ICON: Record<JobStatus, Icon> = {
  DRAFT: IconClock,
  PREVIEWING: IconClock,
  READY: IconClock,
  RUNNING: IconClock,
  COMPLETED: IconCheckCircle,
  PARTIAL_FAILURE: IconAlertTriangle,
  FAILED: IconXCircle,
};

/** PENDING/QUEUED/RUNNING aren't actually reachable from this MVP's
 * concurrency model beyond "not done yet" — they share one "Queued" label
 * with DIFF_COMPUTED rather than inventing a fake distinct in-between
 * state (see ExecutePage's original comment on this, now generalized here
 * since Results shows the same statuses after the fact). */
export const REPO_RUN_STATUS_LABEL: Record<RepoRunStatus, string> = {
  PENDING: "Queued",
  DIFF_COMPUTED: "Queued",
  QUEUED: "Queued",
  RUNNING: "Running",
  SUCCESS: "Success",
  FAILED: "Failed",
  SKIPPED: "Skipped",
};

export const REPO_RUN_STATUS_ICON: Record<RepoRunStatus, Icon> = {
  PENDING: IconClock,
  DIFF_COMPUTED: IconClock,
  QUEUED: IconClock,
  RUNNING: IconClock,
  SUCCESS: IconCheckCircle,
  FAILED: IconXCircle,
  SKIPPED: IconMinusCircle,
};

/** Chip class per RepoRunStatus — deliberately its own class family
 * (chip--run-*) rather than reusing chip--new/modified/unchanged/error,
 * which are specifically about diff content, not run lifecycle.
 * PENDING/QUEUED/RUNNING/DIFF_COMPUTED all render the same muted "not done
 * yet" look rather than inventing a fake distinct in-between state. */
export function repoRunChipClass(status: RepoRunStatus): string {
  switch (status) {
    case "SUCCESS":
      return "chip chip--run-success";
    case "FAILED":
      return "chip chip--run-failed";
    case "SKIPPED":
      return "chip chip--run-skipped";
    default:
      return "chip chip--run-pending";
  }
}

export type DiffStatus = "error" | "new" | "unchanged" | "modified";

export const DIFF_STATUS_LABEL: Record<DiffStatus, string> = {
  error: "Error",
  new: "New file",
  unchanged: "Unchanged",
  modified: "Modified",
};

export const DIFF_STATUS_ICON: Record<DiffStatus, Icon> = {
  error: IconAlertTriangle,
  new: IconPlusCircle,
  unchanged: IconMinusCircle,
  modified: IconPencil,
};

/**
 * Derives the user-facing diff status for a RepoRunFile. Must match the
 * backend's derivation exactly (same four-way rule, now read from a
 * per-file row instead of the whole repo run — see CLAUDE.md / the API
 * contract in shared-types), since both sides compute it independently
 * from the same RepoRunFile fields:
 *
 *   - errorMessage set            -> "error"
 *   - beforeSha === null          -> "new"
 *   - diffSummary has no "@@" line -> "unchanged"
 *   - otherwise                   -> "modified"
 */
export function deriveDiffStatus(file: RepoRunFile): DiffStatus {
  if (file.errorMessage) return "error";
  if (file.beforeSha === null) return "new";
  const hasHunk = (file.diffSummary ?? "").split("\n").some((line) => line.startsWith("@@"));
  if (!hasHunk) return "unchanged";
  return "modified";
}

const STATUS_SEVERITY: Record<DiffStatus, number> = {
  unchanged: 0,
  new: 1,
  modified: 2,
  error: 3,
};

/** The "worst" status across a repo's files, for the summary badge shown
 * before a repo row is expanded — error > modified > new > unchanged,
 * matching how a human would want to scan for trouble first. Returns
 * "unchanged" for an empty list (a repo with no file rows yet). */
export function worstDiffStatus(statuses: DiffStatus[]): DiffStatus {
  return statuses.reduce<DiffStatus>(
    (worst, status) => (STATUS_SEVERITY[status] > STATUS_SEVERITY[worst] ? status : worst),
    "unchanged"
  );
}

/** Groups a job's flat repoRunFiles list by which repo_run each belongs
 * to — JobView.repoRunFiles is flat by design (see shared-types), pages
 * that render per-repo file lists need this grouping. */
export function groupRepoRunFilesByRepoRunId(files: RepoRunFile[]): Map<string, RepoRunFile[]> {
  const map = new Map<string, RepoRunFile[]>();
  for (const file of files) {
    const existing = map.get(file.repoRunId);
    if (existing) {
      existing.push(file);
    } else {
      map.set(file.repoRunId, [file]);
    }
  }
  return map;
}

/** Groups any repo-run-shaped list by the org/owner segment of
 * `repoFullName` ("owner/repo"), preserving first-seen order — Preview and
 * Confirm both target a set of repos that can span several orgs (select-all
 * across accessible orgs is a normal action per CLAUDE.md), so a flat list
 * makes it hard to tell which org a run belongs to at a glance. */
export function groupByOrg<T extends { repoFullName: string }>(items: T[]): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const org = item.repoFullName.split("/")[0] ?? "";
    const existing = map.get(org);
    if (existing) {
      existing.push(item);
    } else {
      map.set(org, [item]);
    }
  }
  return map;
}
