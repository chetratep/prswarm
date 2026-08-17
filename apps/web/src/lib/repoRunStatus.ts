import type { RepoRun } from "@bulk-github-update-tool/shared-types";

export type DiffStatus = "error" | "new" | "unchanged" | "modified";

/**
 * Derives the user-facing diff status for a RepoRun. This is deliberately
 * NOT the same thing as RepoRun.status (the job-run lifecycle, e.g.
 * DIFF_COMPUTED/SUCCESS/FAILED) — it's purely about what the diff itself
 * looks like, and isn't stored anywhere. Must match the backend's derivation
 * exactly (see CLAUDE.md / the v2 API contract in shared-types), since both
 * sides compute it independently from the same RepoRun fields:
 *
 *   - errorMessage set            -> "error"
 *   - beforeSha === null          -> "new"
 *   - diffSummary has no "@@" line -> "unchanged"
 *   - otherwise                   -> "modified"
 */
export function deriveDiffStatus(run: RepoRun): DiffStatus {
  if (run.errorMessage) return "error";
  if (run.beforeSha === null) return "new";
  const hasHunk = (run.diffSummary ?? "").split("\n").some((line) => line.startsWith("@@"));
  if (!hasHunk) return "unchanged";
  return "modified";
}
