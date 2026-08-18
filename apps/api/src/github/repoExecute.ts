// Executes the write for a single repo_run that's ready to go (status
// DIFF_COMPUTED at call time): builds ONE atomic commit covering every
// non-skipped file via the Git Data API (blob per file, one tree, one
// commit), then either updates the default branch in place or creates a
// new branch pointing at that commit (+ optional PR). Never throws — every
// failure from step "refetch default branch" onward is caught and turned
// into a FAILED update so that one repo's failure can't stop the rest of
// the job (jobQueue.ts loops over eligible repo_runs concurrently and
// persists whatever this returns).
import type { Octokit } from "@octokit/rest";
import type { ChangeSet, ChangeSetFile, RepoRun, RepoRunFile } from "@bulk-github-update-tool/shared-types";
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

interface FileToCommit {
  repoRunFile: RepoRunFile;
  mode: ChangeSetFile["mode"];
}

/** A file is skipped (left untouched in the commit) if create-only and it
 * already exists, or if the preview diff was a no-op. Evaluated per file,
 * not per repo — a changeset with 3 files where 1 is unchanged still
 * commits the other 2. */
function isSkipped(file: FileToCommit): boolean {
  if (file.mode === "CREATE_ONLY" && file.repoRunFile.beforeSha !== null) {
    return true;
  }
  if (
    file.repoRunFile.beforeSha !== null &&
    file.repoRunFile.diffSummary !== null &&
    !diffHasChanges(file.repoRunFile.diffSummary)
  ) {
    return true;
  }
  return false;
}

export async function executeRepoRun(
  octokit: Octokit,
  changeSet: ChangeSet,
  changeSetFiles: ChangeSetFile[],
  repoRun: RepoRun,
  repoRunFiles: RepoRunFile[]
): Promise<RepoRunUpdate> {
  const [owner, repo] = repoRun.repoFullName.split("/");

  const changeSetFileById = new Map(changeSetFiles.map((f) => [f.id, f]));
  const filesToCommit: FileToCommit[] = repoRunFiles.map((repoRunFile) => {
    const changeSetFile = changeSetFileById.get(repoRunFile.changeSetFileId);
    if (!changeSetFile) {
      throw new Error(
        `repo_run_file ${repoRunFile.id} references change_set_file ${repoRunFile.changeSetFileId}, which was not found`
      );
    }
    return { repoRunFile, mode: changeSetFile.mode };
  });

  const nonSkippedFiles = filesToCommit.filter((file) => !isSkipped(file));

  // All files skipped — nothing to commit, same semantics as a single-file
  // skip, evaluated across all files first.
  if (nonSkippedFiles.length === 0) {
    return {
      status: "SKIPPED",
      errorMessage: null,
    };
  }

  try {
    // Refetch the default branch fresh — don't trust the preview-time
    // snapshot for the actual write, it may be stale.
    const { data: repoInfo } = await octokit.rest.repos.get({ owner, repo });
    const defaultBranch = repoInfo.default_branch;

    const isDirectToDefault =
      changeSet.commitStrategy === "DIRECT_COMMIT" && changeSet.branchStrategy === "DEFAULT";

    // The base tree/commit is always the default branch's current tip —
    // true whether we're committing directly to it or forking a new
    // branch from it, since a brand-new branch's virtual base IS the
    // default branch's tip before any new commit exists.
    const { data: baseBranch } = await octokit.rest.repos.getBranch({
      owner,
      repo,
      branch: defaultBranch,
    });
    const baseCommitSha = baseBranch.commit.sha;

    const { data: baseCommit } = await octokit.rest.git.getCommit({
      owner,
      repo,
      commit_sha: baseCommitSha,
    });
    const baseTreeSha = baseCommit.tree.sha;

    const treeEntries = await Promise.all(
      nonSkippedFiles.map(async (file) => {
        const { data: blob } = await octokit.rest.git.createBlob({
          owner,
          repo,
          content: file.repoRunFile.renderedContent ?? "",
          encoding: "utf-8",
        });
        return {
          path: file.repoRunFile.filePath,
          mode: "100644" as const,
          type: "blob" as const,
          sha: blob.sha,
        };
      })
    );

    const { data: newTree } = await octokit.rest.git.createTree({
      owner,
      repo,
      base_tree: baseTreeSha,
      tree: treeEntries,
    });

    const { data: newCommit } = await octokit.rest.git.createCommit({
      owner,
      repo,
      message: changeSet.commitMessage,
      tree: newTree.sha,
      parents: [baseCommitSha],
    });

    let target: string;
    if (isDirectToDefault) {
      await octokit.rest.git.updateRef({
        owner,
        repo,
        ref: `heads/${defaultBranch}`,
        sha: newCommit.sha,
      });
      target = defaultBranch;
    } else {
      const branchName = `bulk-update/${slugify(changeSet.name)}-${Date.now().toString(36)}`;
      await octokit.rest.git.createRef({
        owner,
        repo,
        ref: `refs/heads/${branchName}`,
        sha: newCommit.sha,
      });
      target = branchName;
    }

    let prUrl: string | null = null;
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
      commitSha: newCommit.sha,
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
