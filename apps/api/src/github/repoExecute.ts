// Executes the write for a single repo_run that's ready to go (status
// DIFF_COMPUTED at call time): create-only guard, no-op skip, then either a
// direct commit to the default branch or a new branch (+ optional PR).
// Never throws — every failure from step (c) "refetch default branch"
// onward is caught and turned into a FAILED update so that one repo's
// failure can't stop the rest of the job (routes/jobs.ts loops over
// eligible repo_runs sequentially and persists whatever this returns).
import type { Octokit } from "@octokit/rest";
import type { ChangeSet, RepoRun } from "@bulk-github-update-tool/shared-types";
import { diffHasChanges } from "../diffUtils.js";
import type { RepoRunUpdate } from "../repositories/repoRunsRepository.js";

function errorMessageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** lowercase; runs of non-alphanumeric characters collapse to a single "-";
 * no leading/trailing "-". */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export async function executeRepoRun(
  octokit: Octokit,
  changeSet: ChangeSet,
  repoRun: RepoRun
): Promise<RepoRunUpdate> {
  const [owner, repo] = repoRun.repoFullName.split("/");

  // (a) create-only guard — never call GitHub if the file already exists
  // and this changeset is only allowed to create new files.
  if (changeSet.mode === "CREATE_ONLY" && repoRun.beforeSha !== null) {
    return {
      status: "FAILED",
      errorMessage: "File already exists and mode is create-only",
      attemptCount: repoRun.attemptCount + 1,
    };
  }

  // (b) no-op guard — the file exists and the preview diff has no actual
  // changes. Skip rather than writing a pointless empty commit.
  if (
    repoRun.beforeSha !== null &&
    repoRun.diffSummary !== null &&
    !diffHasChanges(repoRun.diffSummary)
  ) {
    return {
      status: "SKIPPED",
      errorMessage: null,
    };
  }

  try {
    // (c) refetch default branch fresh — don't trust the preview-time
    // snapshot for the actual write, it may be stale.
    const { data: repoInfo } = await octokit.rest.repos.get({ owner, repo });
    const defaultBranch = repoInfo.default_branch;

    const isDirectToDefault =
      changeSet.commitStrategy === "DIRECT_COMMIT" && changeSet.branchStrategy === "DEFAULT";

    // (d) determine target ref. PULL_REQUEST always implies a new branch
    // regardless of the stored branchStrategy — you can't PR a branch
    // against itself.
    let target: string;
    if (isDirectToDefault) {
      target = defaultBranch;
    } else {
      const { data: branchData } = await octokit.rest.repos.getBranch({
        owner,
        repo,
        branch: defaultBranch,
      });
      const latestSha = branchData.commit.sha;
      const branchName = `bulk-update/${slugify(changeSet.name)}-${Date.now().toString(36)}`;
      await octokit.rest.git.createRef({
        owner,
        repo,
        ref: `refs/heads/${branchName}`,
        sha: latestSha,
      });
      target = branchName;
    }

    // (e) write the file.
    const { data: commitData } = await octokit.rest.repos.createOrUpdateFileContents({
      owner,
      repo,
      path: changeSet.filePath,
      message: changeSet.commitMessage,
      content: Buffer.from(repoRun.renderedContent ?? changeSet.content, "utf-8").toString(
        "base64"
      ),
      branch: target,
      sha: repoRun.beforeSha ?? undefined,
    });

    const commitSha = commitData.commit.sha ?? null;
    const afterSha = commitData.content?.sha ?? null;
    let prUrl: string | null = null;

    // (f) optionally open the PR.
    if (changeSet.commitStrategy === "PULL_REQUEST") {
      const { data: prData } = await octokit.rest.pulls.create({
        owner,
        repo,
        title: changeSet.prTitle || changeSet.commitMessage,
        body: changeSet.prBody ?? "",
        head: target,
        base: defaultBranch,
      });
      prUrl = prData.html_url;
    }

    return {
      status: "SUCCESS",
      commitSha,
      afterSha,
      prUrl,
      errorMessage: null,
      attemptCount: repoRun.attemptCount + 1,
    };
  } catch (err) {
    return {
      status: "FAILED",
      errorMessage: errorMessageOf(err),
      attemptCount: repoRun.attemptCount + 1,
    };
  }
}
