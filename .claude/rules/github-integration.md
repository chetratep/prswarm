---
paths:
  - "apps/api/src/github/**/*.ts"
---

# GitHub integration conventions

## Atomic multi-file commits

`executeRepoRun` (`apps/api/src/github/repoExecute.ts`) never calls `repos.createOrUpdateFileContents` per file — it builds one commit for every non-skipped file in a repo via the Git Data API:

`repos.get` (current default branch) → `repos.getBranch` on that default branch (**always** — a new branch's base is always the default branch's tip, never a previously-created branch from earlier in the same run) → `git.getCommit`/tree → one `git.createBlob` per non-skipped file → one `git.createTree` layering all blobs onto the base tree → one `git.createCommit` → only then `git.updateRef` (direct-to-default) **or** `git.createRef` (new branch), never both.

A repo where every file is a no-op skips straight to `SKIPPED` with zero GitHub calls. Per-file skip logic (`CREATE_ONLY` + already-exists, or a no-op diff) is evaluated per file *before* the commit is built, so a repo can write some files and skip others in the same commit.

`executeRepoRun`'s contract is "never throws, always resolves to a `RepoRunUpdate`" — `jobQueue.ts` awaits it expecting that. Any lookup that can fail (e.g. a `repo_run_file` referencing a nonexistent `change_set_file`) must resolve to `FAILED`, not reject, and must sit *inside* the top-level `try`.

PR strategy always implies a new branch, even if `branchStrategy` on the request says otherwise — never write direct-to-default when a PR was requested.

## Permission gotchas (two distinct failure modes, easy to conflate)

1. **Writing to `.github/workflows/*`** needs a permission GitHub checks separately from normal repo write access: a classic PAT needs the `workflow` scope (sibling to `repo`); a fine-grained PAT needs "Workflows: Read and write" *in addition to* "Contents: Read and write". Missing it → a plain **404** on the write call, not an obviously-scope-related error.
2. **Any commit at all**, for both PAT and GitHub App connections, goes through the Git Data API (see above), which needs **Contents: Read and write**. Missing it → **403 `Resource not accessible by integration`** on `git/blobs`, identically for every repo in the job. GitHub actually names the missing permission in an `x-accepted-github-permissions: contents=write` response header — not surfaced in the error message the app stores, only visible on the raw HTTP response.

These are unrelated permissions on adjacent checkboxes in a GitHub App's settings (both have "workflow" in the name people associate with the error) — gotcha #1 needs **Workflows**, gotcha #2 needs **Contents**. To inspect what an installation token actually has, build a fresh installation Octokit and call `octokit.auth({ type: "installation" })` — it returns a `permissions` object; don't guess from error text alone. After changing an App's permissions in its settings, GitHub can require the installation owner to explicitly re-accept the updated permission set before it takes effect on new tokens.

## Branch protection

Checked at **preview** time (`repoDiff.ts`), not discovered at execute time — a repo flagged protected in Preview should surface a warning before Confirm, not fail silently at Execute. Distinguish a real 403 (protected) from a 404 (protection not configured, or repo doesn't exist) — they mean different things.

## GitHub App auth

`apps/api/src/github/appAuth.ts` does JWT + installation-token exchange via `@octokit/auth-app`. No token caching — installation tokens are re-exchanged per request. Correct, but a known future optimization if request volume grows.
