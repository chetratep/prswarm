// Computes the diff-preview state for a single repo within a job, across
// every file in the changeset: fetches the repo's default branch once,
// then for each changeset file the current content (if any) and the
// unified diff against that file's target content, and — only for
// direct-to-default commits, where the guardrail actually matters — branch
// protection status (checked once per repo, not per file — it's a
// property of the branch, not the file). Never throws: every GitHub
// failure is captured into the returned preview's status/errorMessage so
// that one repo's failure can't abort the whole job-creation request
// (routes/changesets.ts loops over repos sequentially and inserts whatever
// this returns).
import { createTwoFilesPatch } from "diff";
import type { Octokit } from "@octokit/rest";
import type { ChangeSet, ChangeSetFile } from "@prdispatch/shared-types";
import type { InsertRepoRunInput } from "../repositories/repoRunsRepository.js";
import type { InsertRepoRunFileInput } from "../repositories/repoRunFilesRepository.js";

export type RepoRunPreview = Omit<InsertRepoRunInput, "jobId" | "repoFullName">;
export type RepoRunFilePreview = Omit<InsertRepoRunFileInput, "repoRunId">;

export interface ComputeRepoRunPreviewResult {
  repoRun: RepoRunPreview;
  files: RepoRunFilePreview[];
}

function errorMessageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function statusOf(err: unknown): number | undefined {
  return typeof err === "object" && err !== null && "status" in err
    ? (err as { status?: number }).status
    : undefined;
}

function failedRepoRun(directToDefault: boolean, errorMessage: string): RepoRunPreview {
  return {
    status: "FAILED",
    branchProtected: null,
    directToDefault,
    commitSha: null,
    prUrl: null,
    errorMessage,
    attemptCount: 0,
  };
}

export async function computeRepoRunPreview(
  octokit: Octokit,
  changeSet: ChangeSet,
  changeSetFiles: ChangeSetFile[],
  repoFullName: string,
  afterContentByFileId: Record<string, string>
): Promise<ComputeRepoRunPreviewResult> {
  const [owner, repo] = repoFullName.split("/");

  const directToDefault =
    changeSet.commitStrategy === "DIRECT_COMMIT" && changeSet.branchStrategy === "DEFAULT";

  let defaultBranch: string;
  try {
    const { data: repoInfo } = await octokit.rest.repos.get({ owner, repo });
    defaultBranch = repoInfo.default_branch;
  } catch (err) {
    return { repoRun: failedRepoRun(directToDefault, errorMessageOf(err)), files: [] };
  }

  const files: RepoRunFilePreview[] = [];
  const failedFilePaths: string[] = [];

  for (const changeSetFile of changeSetFiles) {
    const afterContent = afterContentByFileId[changeSetFile.id] ?? "";

    let beforeContent: string;
    let beforeSha: string | null;
    try {
      const { data } = await octokit.rest.repos.getContent({
        owner,
        repo,
        path: changeSetFile.filePath,
        ref: defaultBranch,
      });

      if (Array.isArray(data) || data.type !== "file") {
        failedFilePaths.push(changeSetFile.filePath);
        files.push({
          changeSetFileId: changeSetFile.id,
          filePath: changeSetFile.filePath,
          diffSummary: null,
          beforeSha: null,
          afterSha: null,
          errorMessage: "Path is a directory, not a file",
          renderedContent: null,
        });
        continue;
      }

      beforeContent = Buffer.from(data.content, "base64").toString("utf-8");
      beforeSha = data.sha;
    } catch (err) {
      if (statusOf(err) === 404) {
        // File doesn't exist yet on the default branch — not an error,
        // this just means the preview is a "new file" diff.
        beforeContent = "";
        beforeSha = null;
      } else {
        failedFilePaths.push(changeSetFile.filePath);
        files.push({
          changeSetFileId: changeSetFile.id,
          filePath: changeSetFile.filePath,
          diffSummary: null,
          beforeSha: null,
          afterSha: null,
          errorMessage: errorMessageOf(err),
          renderedContent: null,
        });
        continue;
      }
    }

    const diffSummary = createTwoFilesPatch(
      changeSetFile.filePath,
      changeSetFile.filePath,
      beforeContent,
      afterContent,
      "",
      "",
      { context: 3 }
    );

    files.push({
      changeSetFileId: changeSetFile.id,
      filePath: changeSetFile.filePath,
      diffSummary,
      beforeSha,
      afterSha: null,
      errorMessage: null,
      renderedContent: afterContent,
    });
  }

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

  if (failedFilePaths.length > 0) {
    return {
      repoRun: {
        status: "FAILED",
        branchProtected,
        directToDefault,
        commitSha: null,
        prUrl: null,
        errorMessage: `${failedFilePaths.length} of ${changeSetFiles.length} files failed to preview: ${failedFilePaths.join(", ")}`,
        attemptCount: 0,
      },
      files,
    };
  }

  return {
    repoRun: {
      status: "DIFF_COMPUTED",
      branchProtected,
      directToDefault,
      commitSha: null,
      prUrl: null,
      errorMessage: null,
      attemptCount: 0,
    },
    files,
  };
}
