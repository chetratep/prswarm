import type { RepoRunFile } from "@bulk-github-update-tool/shared-types";

export type DiffStatus = "error" | "new" | "unchanged" | "modified";

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
