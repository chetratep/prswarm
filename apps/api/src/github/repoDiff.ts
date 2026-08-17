// Computes the diff-preview state for a single repo within a job: fetches
// the repo's default branch, the current file content (if any), the
// unified diff against the changeset's target content, and — only for
// direct-to-default commits, where the guardrail actually matters — branch
// protection status. Never throws: every GitHub failure is captured into
// the returned preview's status/errorMessage so that one repo's failure
// can't abort the whole job-creation request (routes/changesets.ts loops
// over repos sequentially and inserts whatever this returns).
import { createTwoFilesPatch } from "diff";
import type { Octokit } from "@octokit/rest";
import type { ChangeSet } from "@bulk-github-update-tool/shared-types";
import type { InsertRepoRunInput } from "../repositories/repoRunsRepository.js";

export type RepoRunPreview = Omit<InsertRepoRunInput, "jobId" | "repoFullName">;

function errorMessageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function statusOf(err: unknown): number | undefined {
  return typeof err === "object" && err !== null && "status" in err
    ? (err as { status?: number }).status
    : undefined;
}

function failedPreview(directToDefault: boolean, errorMessage: string): RepoRunPreview {
  return {
    status: "FAILED",
    diffSummary: null,
    beforeSha: null,
    afterSha: null,
    branchProtected: null,
    directToDefault,
    commitSha: null,
    prUrl: null,
    errorMessage,
    attemptCount: 0,
    renderedContent: null,
  };
}

export async function computeRepoRunPreview(
  octokit: Octokit,
  changeSet: ChangeSet,
  repoFullName: string,
  afterContent: string
): Promise<RepoRunPreview> {
  const [owner, repo] = repoFullName.split("/");

  const directToDefault =
    changeSet.commitStrategy === "DIRECT_COMMIT" && changeSet.branchStrategy === "DEFAULT";

  let defaultBranch: string;
  try {
    const { data: repoInfo } = await octokit.rest.repos.get({ owner, repo });
    defaultBranch = repoInfo.default_branch;
  } catch (err) {
    return failedPreview(directToDefault, errorMessageOf(err));
  }

  let beforeContent: string;
  let beforeSha: string | null;
  try {
    const { data } = await octokit.rest.repos.getContent({
      owner,
      repo,
      path: changeSet.filePath,
      ref: defaultBranch,
    });

    if (Array.isArray(data) || data.type !== "file") {
      return failedPreview(directToDefault, "Path is a directory, not a file");
    }

    beforeContent = Buffer.from(data.content, "base64").toString("utf-8");
    beforeSha = data.sha;
  } catch (err) {
    if (statusOf(err) === 404) {
      // File doesn't exist yet on the default branch — not an error, this
      // just means the preview is a "new file" diff.
      beforeContent = "";
      beforeSha = null;
    } else {
      return failedPreview(directToDefault, errorMessageOf(err));
    }
  }

  const diffSummary = createTwoFilesPatch(
    changeSet.filePath,
    changeSet.filePath,
    beforeContent,
    afterContent,
    "",
    "",
    { context: 3 }
  );

  let branchProtected: boolean | null = null;
  if (directToDefault) {
    try {
      await octokit.rest.repos.getBranchProtection({ owner, repo, branch: defaultBranch });
      branchProtected = true;
    } catch (err) {
      // A 403 here is common (many PATs lack admin rights to view branch
      // protection) — treat that as unknown, never as "not protected".
      branchProtected = statusOf(err) === 404 ? false : null;
    }
  }

  return {
    status: "DIFF_COMPUTED",
    diffSummary,
    beforeSha,
    afterSha: null,
    branchProtected,
    directToDefault,
    commitSha: null,
    prUrl: null,
    errorMessage: null,
    attemptCount: 0,
    renderedContent: afterContent,
  };
}
