import { describe, expect, it } from "vitest";
import type { ChangeSet, ChangeSetFile } from "@prswarm/shared-types";
import { computeRepoRunPreview } from "./repoDiff.js";

function stubChangeSet(overrides: Partial<ChangeSet> = {}): ChangeSet {
  return {
    id: "cs-1",
    name: "test changeset",
    branchStrategy: "NEW_BRANCH",
    commitStrategy: "DIRECT_COMMIT",
    commitMessage: "test",
    prTitle: null,
    prBody: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function stubFile(overrides: Partial<ChangeSetFile> = {}): ChangeSetFile {
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

function notFoundError(): Error & { status: number } {
  return Object.assign(new Error("Not Found"), { status: 404 });
}

describe("computeRepoRunPreview", () => {
  it("computes a DIFF_COMPUTED preview with one file row per changeset file, for new files", async () => {
    const fileA = stubFile({ id: "file-a", filePath: "a.yml" });
    const fileB = stubFile({ id: "file-b", filePath: "b.yml" });
    const calls: string[] = [];

    const octokit = {
      rest: {
        repos: {
          get: async () => {
            calls.push("repos.get");
            return { data: { default_branch: "main" } };
          },
          getContent: async ({ path }: { path: string }) => {
            calls.push(`getContent:${path}`);
            throw notFoundError();
          },
          getBranchProtection: async () => {
            calls.push("getBranchProtection");
            throw notFoundError();
          },
        },
      },
    } as any;

    const result = await computeRepoRunPreview(
      octokit,
      stubChangeSet({ commitStrategy: "DIRECT_COMMIT", branchStrategy: "DEFAULT" }),
      [fileA, fileB],
      "acme/repo",
      { "file-a": "new a content", "file-b": "new b content" }
    );

    expect(result.repoRun.status).toBe("DIFF_COMPUTED");
    expect(result.repoRun.branchProtected).toBe(false);
    expect(result.files).toHaveLength(2);
    expect(result.files[0].beforeSha).toBeNull();
    expect(result.files[0].renderedContent).toBe("new a content");
    expect(result.files[1].renderedContent).toBe("new b content");
    expect(calls).toEqual(["repos.get", "getContent:a.yml", "getContent:b.yml", "getBranchProtection"]);
  });

  it("marks only the failed file's row with an error, and fails the whole repo_run, when one of several files can't be previewed", async () => {
    const fileA = stubFile({ id: "file-a", filePath: "a.yml" });
    const fileB = stubFile({ id: "file-b", filePath: "some-dir" });

    const octokit = {
      rest: {
        repos: {
          get: async () => ({ data: { default_branch: "main" } }),
          getContent: async ({ path }: { path: string }) => {
            if (path === "a.yml") {
              throw notFoundError();
            }
            // "some-dir" resolves to a directory listing, not a file.
            return { data: [{ name: "nested.txt" }] };
          },
        },
      },
    } as any;

    const result = await computeRepoRunPreview(
      octokit,
      stubChangeSet(),
      [fileA, fileB],
      "acme/repo",
      { "file-a": "content a", "file-b": "content b" }
    );

    expect(result.repoRun.status).toBe("FAILED");
    expect(result.repoRun.errorMessage).toContain("1 of 2 files failed to preview");
    expect(result.repoRun.errorMessage).toContain("some-dir");

    const fileAResult = result.files.find((f) => f.changeSetFileId === "file-a");
    const fileBResult = result.files.find((f) => f.changeSetFileId === "file-b");
    expect(fileAResult?.errorMessage).toBeNull();
    expect(fileBResult?.errorMessage).toBe("Path is a directory, not a file");
  });

  it("fails the whole repo_run with no file rows when the repo itself can't be fetched", async () => {
    const octokit = {
      rest: {
        repos: {
          get: async () => {
            throw new Error("connection refused");
          },
        },
      },
    } as any;

    const result = await computeRepoRunPreview(octokit, stubChangeSet(), [stubFile()], "acme/repo", {
      "file-1": "content",
    });

    expect(result.repoRun.status).toBe("FAILED");
    expect(result.repoRun.errorMessage).toBe("connection refused");
    expect(result.files).toEqual([]);
  });
});
