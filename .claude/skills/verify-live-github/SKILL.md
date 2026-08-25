---
name: verify-live-github
description: Use when verifying a PRSwarm change that writes to a real GitHub account (Execute flow, commit strategies, GitHub App/PAT auth, branch protection) rather than against stubs — covers how to test safely, how to prove the write actually happened, and how to diagnose permission failures.
---

# Verifying against a real GitHub account

Stub-Octokit unit tests cover the diff/execute *decision logic* (new/modified/unchanged, 403-vs-404 branch-protection handling, skip guards, error isolation). They cannot catch real-account issues: actual permission scopes, actual GitHub API response shapes, actual rate limits. Use this procedure whenever a change touches `apps/api/src/github/**`, execution/commit behavior, or auth exchange, and a real connected account is available.

## Keep it inert

- Use **direct-commit-to-a-new-branch** as the test strategy, not a PR and not direct-to-default. This produces a real, verifiable commit without opening anything for anyone else to see or requiring cleanup beyond deleting a branch.
- Never target a batch of real repos for a speculative test — target one or two throwaway/personal repos.
- After the run, tell the user exactly what was left behind (branch names, file paths, which repos) and that deleting them needs their own go-ahead — this tool doesn't delete things unprompted, and neither should verification of it.

## Prove the write actually happened, not just that the app reports success

App-level success (a 200 from `/api/jobs/:id/execute`, a "Completed" status in the UI) is not proof the commit contains what you think it does. Confirm independently via GitHub's own API — fetch the raw file content from the branch after execute and diff it against what was supposed to be written. This is the only way to catch "the app thinks it wrote X per repo but actually wrote the same unsubstituted template everywhere" style bugs, which look identical to success from the app's own perspective.

## Diagnosing permission failures

If execute fails identically across every repo in a job, it's very likely a GitHub App/PAT permission gap, not a logic bug — see `.claude/rules/github-integration.md` for the two specific, easily-conflated permission gotchas (`workflow` scope vs. **Contents: Read and write**). To confirm exactly what an installation token actually has rather than guessing from the error text:

```ts
const installationOctokit = /* build via appAuth.ts helpers */;
const auth = await installationOctokit.auth({ type: "installation" });
console.log(auth.permissions); // the real, granted permission set
```

GitHub also names a missing permission in the `x-accepted-github-permissions` response header on a 403 — not surfaced in the error message this app currently stores, so check the raw HTTP response if the stored error message alone isn't enough to diagnose.

## When no real credentials are available

If a live account genuinely isn't available in the session, say so explicitly rather than silently falling back to stub-only coverage without flagging it — verification claims should distinguish "verified against stubs" from "verified against a real account," since they catch different classes of bug.
