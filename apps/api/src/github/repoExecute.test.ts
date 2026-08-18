import { describe, expect, it } from "vitest";
import type { ChangeSet, ChangeSetFile, RepoRun, RepoRunFile } from "@bulk-github-update-tool/shared-types";
import { executeRepoRun, slugify } from "./repoExecute.js";

function stubChangeSet(overrides: Partial<ChangeSet> = {}): ChangeSet {
  return {
    id: "cs-1",
    name: "Add PR review workflow",
    branchStrategy: "NEW_BRANCH",
    commitStrategy: "DIRECT_COMMIT",
    commitMessage: "Add PR review workflow",
    prTitle: null,
    prBody: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function stubChangeSetFile(overrides: Partial<ChangeSetFile> = {}): ChangeSetFile {
  return {
    id: "file-1",
    changeSetId: "cs-1",
    orderIndex: 0,
    filePath: "a.yml",
    mode: "UPSERT",
    contentSource: "STATIC",
    content: "content",
    templateVarsSchema: null,
    ...overrides,
  };
}

function stubRepoRun(overrides: Partial<RepoRun> = {}): RepoRun {
  return {
    id: "run-1",
    jobId: "job-1",
    repoFullName: "acme/repo",
    status: "DIFF_COMPUTED",
    branchProtected: null,
    directToDefault: false,
    commitSha: null,
    prUrl: null,
    errorMessage: null,
    attemptCount: 0,
    ...overrides,
  };
}

function stubRepoRunFile(overrides: Partial<RepoRunFile> = {}): RepoRunFile {
  return {
    id: "rrf-1",
    repoRunId: "run-1",
    changeSetFileId: "file-1",
    filePath: "a.yml",
    diffSummary: "@@ -0,0 +1 @@\n+content",
    beforeSha: null,
    afterSha: null,
    errorMessage: null,
    renderedContent: "content",
    ...overrides,
  };
}

function makeOctokit(gitOverrides: Record<string, unknown> = {}) {
  const calls: string[] = [];
  const octokit = {
    rest: {
      repos: {
        get: async () => {
          calls.push("repos.get");
          return { data: { default_branch: "main" } };
        },
        getBranch: async () => {
          calls.push("repos.getBranch");
          return { data: { commit: { sha: "base-commit-sha" } } };
        },
      },
      git: {
        getCommit: async () => {
          calls.push("git.getCommit");
          return { data: { tree: { sha: "base-tree-sha" } } };
        },
        createBlob: async ({ content }: { content: string }) => {
          calls.push(`git.createBlob:${content}`);
          return { data: { sha: `blob-sha-${content}` } };
        },
        createTree: async () => {
          calls.push("git.createTree");
          return { data: { sha: "new-tree-sha" } };
        },
        createCommit: async () => {
          calls.push("git.createCommit");
          return { data: { sha: "new-commit-sha" } };
        },
        updateRef: async () => {
          calls.push("git.updateRef");
        },
        createRef: async () => {
          calls.push("git.createRef");
        },
        ...gitOverrides,
      },
      pulls: {
        create: async () => {
          calls.push("pulls.create");
          return { data: { html_url: "https://github.com/acme/repo/pull/1" } };
        },
      },
    },
  };
  return { octokit: octokit as any, calls };
}

describe("executeRepoRun", () => {
  it("returns SKIPPED and makes no GitHub calls when every file is skipped", async () => {
    const { octokit, calls } = makeOctokit();
    const changeSetFile = stubChangeSetFile({ mode: "CREATE_ONLY" });
    // beforeSha set => file already exists => CREATE_ONLY skips it.
    const repoRunFile = stubRepoRunFile({ beforeSha: "existing-sha" });

    const result = await executeRepoRun(octokit, stubChangeSet(), [changeSetFile], stubRepoRun(), [
      repoRunFile,
    ]);

    expect(result.status).toBe("SKIPPED");
    expect(calls).toEqual([]);
  });

  it("builds one commit from blobs for every non-skipped file, in order, then createRef for a new branch", async () => {
    const { octokit, calls } = makeOctokit();
    const fileA = stubChangeSetFile({ id: "file-a", filePath: "a.yml" });
    const fileB = stubChangeSetFile({ id: "file-b", filePath: "b.yml" });
    const repoRunFileA = stubRepoRunFile({ changeSetFileId: "file-a", filePath: "a.yml", renderedContent: "content-a" });
    const repoRunFileB = stubRepoRunFile({ changeSetFileId: "file-b", filePath: "b.yml", renderedContent: "content-b" });

    const result = await executeRepoRun(
      octokit,
      stubChangeSet({ branchStrategy: "NEW_BRANCH", commitStrategy: "DIRECT_COMMIT" }),
      [fileA, fileB],
      stubRepoRun(),
      [repoRunFileA, repoRunFileB]
    );

    expect(result.status).toBe("SUCCESS");
    expect(result.commitSha).toBe("new-commit-sha");
    expect(calls).toEqual([
      "repos.get",
      "repos.getBranch",
      "git.getCommit",
      "git.createBlob:content-a",
      "git.createBlob:content-b",
      "git.createTree",
      "git.createCommit",
      "git.createRef",
    ]);
  });

  it("uses updateRef (not createRef) when committing direct-to-default", async () => {
    const { octokit, calls } = makeOctokit();

    await executeRepoRun(
      octokit,
      stubChangeSet({ branchStrategy: "DEFAULT", commitStrategy: "DIRECT_COMMIT" }),
      [stubChangeSetFile()],
      stubRepoRun({ directToDefault: true }),
      [stubRepoRunFile()]
    );

    expect(calls).toContain("git.updateRef");
    expect(calls).not.toContain("git.createRef");
  });

  it("opens a PR after creating the branch when commitStrategy is PULL_REQUEST", async () => {
    const { octokit, calls } = makeOctokit();

    const result = await executeRepoRun(
      octokit,
      stubChangeSet({ branchStrategy: "NEW_BRANCH", commitStrategy: "PULL_REQUEST" }),
      [stubChangeSetFile()],
      stubRepoRun(),
      [stubRepoRunFile()]
    );

    expect(calls.indexOf("git.createRef")).toBeLessThan(calls.indexOf("pulls.create"));
    expect(result.prUrl).toBe("https://github.com/acme/repo/pull/1");
  });

  it("only creates blobs for non-skipped files when some files are unchanged", async () => {
    const { octokit, calls } = makeOctokit();
    const fileA = stubChangeSetFile({ id: "file-a", filePath: "a.yml" });
    const fileB = stubChangeSetFile({ id: "file-b", filePath: "b.yml" });
    // file-a is unchanged (has a beforeSha and a diff with no @@ hunk) => skipped.
    const repoRunFileA = stubRepoRunFile({
      changeSetFileId: "file-a",
      filePath: "a.yml",
      beforeSha: "sha-a",
      diffSummary: "Index: a.yml\n===",
      renderedContent: "unchanged-content",
    });
    const repoRunFileB = stubRepoRunFile({
      changeSetFileId: "file-b",
      filePath: "b.yml",
      renderedContent: "changed-content",
    });

    await executeRepoRun(octokit, stubChangeSet(), [fileA, fileB], stubRepoRun(), [
      repoRunFileA,
      repoRunFileB,
    ]);

    const blobCalls = calls.filter((c) => c.startsWith("git.createBlob"));
    expect(blobCalls).toEqual(["git.createBlob:changed-content"]);
  });

  it("never calls updateRef or createRef if a step before the commit is built fails", async () => {
    const { octokit, calls } = makeOctokit({
      getCommit: async () => {
        calls.push("git.getCommit");
        throw new Error("network error");
      },
    });

    const result = await executeRepoRun(octokit, stubChangeSet(), [stubChangeSetFile()], stubRepoRun(), [
      stubRepoRunFile(),
    ]);

    expect(result.status).toBe("FAILED");
    expect(result.errorMessage).toBe("network error");
    expect(calls).not.toContain("git.updateRef");
    expect(calls).not.toContain("git.createRef");
  });

  it("resolves to FAILED (never rejects) when a repo_run_file references a change_set_file that doesn't exist", async () => {
    const { octokit, calls } = makeOctokit();
    const changeSetFile = stubChangeSetFile({ id: "file-a" });
    // References "file-does-not-exist", which is not in changeSetFiles.
    const repoRunFile = stubRepoRunFile({ changeSetFileId: "file-does-not-exist" });

    const result = await executeRepoRun(octokit, stubChangeSet(), [changeSetFile], stubRepoRun(), [
      repoRunFile,
    ]);

    expect(result.status).toBe("FAILED");
    expect(result.errorMessage).toContain("file-does-not-exist");
    expect(calls).toEqual([]);
  });
});

describe("slugify", () => {
  it("lowercases and collapses non-alphanumeric runs to a single dash", () => {
    expect(slugify("Add PR Review Workflow!")).toBe("add-pr-review-workflow");
  });
});
