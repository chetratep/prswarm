# Bulk GitHub Update Tool

Push one file change (e.g. `.github/workflows/pr-review.yml`) across a chosen set of GitHub orgs/repos, with a real per-repo diff reviewed before anything writes. Open source, MIT licensed, self-hosted, single-user.

Full spec: https://claude.ai/code/artifact/89d010c4-46f9-4343-b51d-b15f9f57a494

This file is the quick-reference for working in this repo. When it and the spec disagree, the spec is source of truth until this file is updated to match — update this file when a spec decision changes.

## Status

Full 7-step Phase 1 MVP flow built and verified (2026-08-17): Connect → Select → Define → Preview → Confirm → Execute → Results all work end to end against a real backend. Typechecks, builds, and boots clean across the whole workspace.

- **Define** — `POST /api/changesets` then `POST /api/changesets/:id/jobs`, which computes a real diff per targeted repo (fetches current content, `diff`'s `createTwoFilesPatch`, branch-protection check when direct-to-default) synchronously.
- **Preview** — renders each repo's derived status (new/modified/unchanged/error — see `deriveDiffStatus` in `apps/web/src/lib/repoRunStatus.ts`, and the matching "no `@@` line" unchanged-rule in `apps/api/src/diffUtils.ts`), with a "protected — will likely fail" warning and an expandable colored diff.
- **Confirm** — unconditional typed "RUN" gate whenever any repo run has `directToDefault: true`, regardless of batch size.
- **Execute** — `POST /api/jobs/:id/execute`, synchronous per-repo write (direct commit / new branch / PR — PR always implies a new branch even if `branchStrategy` says otherwise), failure-isolated (one repo's error never stops the rest), `SKIPPED` for no-op diffs.
- **Results** — final per-repo status with commit/PR links or error messages.

Verified two ways: (1) 12 stub-Octokit unit checks covering the diff/execute logic's judgment calls (new/modified/unchanged detection, 403-vs-404 branch-protection handling, create-only guard, skip-unchanged guard, PR overriding branchStrategy, error isolation) — no real GitHub credentials were available in the building session; (2) live browser walkthrough of every page against a running instance, using DB-seeded fixture data for Preview/Confirm/Results since a real PAT wasn't available to drive Connect for real.

**To actually run it:** `cp .env.example .env`, set `ENCRYPTION_KEY` (see the comment in `.env.example` for the one-liner to generate it), `pnpm install`, `pnpm dev`.

## Phase 2 — Wave 1 (2026-08-17)

Built and verified **live against a real GitHub account** (not just stub tests this time — real repos, real branches, real commits):

- **GitHub App auth** — second connection method alongside PAT. Two-step (`POST /api/connections/github-app/installations` to discover which accounts the App is installed on, `POST /api/connections/github-app` to bind the connection to one of them) since one App can be installed on several orgs but this is still a single-connection tool. `apps/api/src/github/appAuth.ts` (JWT + installation-token exchange via `@octokit/auth-app`), Connect page gained a method tab switcher. No token caching yet (installation tokens re-exchanged per request) — correct but a known future optimization. Not exercised against a real App/PEM in this session (none available) — verified via the discovery endpoint's error path (bad App ID/key → clean 400) and a full read of the auth-exchange code.
- **Filtered targeting** — `GET /api/orgs/:org/repos` gained `language`/`topic`/`archived` query params (AND-combined with the existing `q` name search), applied against the already-fetched full repo list (GitHub's list response already includes these fields, no extra API calls). Select page has matching filter controls, debounced like the existing search box. Verified live: filtering `rakutentech` (250+ repos) by `language=Go` correctly returned 39 repos.
- **Async execution with live progress** — the biggest change. `POST /api/jobs/:id/execute` now returns almost immediately (job flips to `RUNNING`, persisted) instead of blocking until every repo is done; the actual writes run in the background (`apps/api/src/jobQueue.ts`, 5x concurrent via `p-limit`) and stream live over SSE (`GET /api/jobs/:id/events`, hand-rolled via Fastify's `reply.hijack()` — no SSE plugin dependency). New `ExecutePage` on the frontend opens an `EventSource` and renders live per-repo status as `repo_run_update` events arrive, closing the stream itself once the job hits a terminal status. `POST /api/jobs/:id/retry` re-runs only `FAILED` repo_runs, reusing the same queue. **Verified end to end against real GitHub, twice** — once via raw `curl -N` watching the SSE stream while executing, once through the actual browser UI (Select → filter by language → Define → fetch content from a URL → Preview → Confirm → Execute, watching `ExecutePage` go from "0 of 1 done" to "Completed" live) — both produced real commits on real branches, confirmed via GitHub's own API afterward.

**Test artifacts left in the connected account** from this verification — not cleaned up automatically (deleting things needs the user's own go-ahead, not something this tool does unprompted): branches `bulk-update/bulk-tool-live-test-*` on `chetratep/diskache` and `chetratep/gobrew` (files `bulk-tool-test.md`), and `bulk-update/wave-1-live-browser-test-*` on `chetratep/session` (file `bulk-tool-browser-test.md`). No PRs were opened (direct-commit-to-new-branch was used deliberately, to keep the test inert) — safe to ignore or delete at your convenience.

## Phase 2 — Wave 2, part 1 (2026-08-17)

- **Single-container packaging** — `Dockerfile` (multi-stage: builds all three workspace packages, `pnpm deploy --prod` to prune the API's `node_modules`, copies the built frontend into the runtime image as static files). The API now serves `apps/web/dist` directly via `@fastify/static` when a `public/` dir exists next to it (only true inside the built image — local `pnpm dev` still runs the Vite dev server separately, unaffected). Found and fixed a real bug while wiring this up: the auth-gate hook only recognized `/api/*` paths, so with `AUTH_ENABLED=true` every static asset request would 401 — including the JS bundle needed to even render the login form. Fixed in `apps/api/src/auth/session.ts`: only `/api/*` is ever gated now; static assets are always public (the data behind them still isn't — every `/api/*` call the SPA makes stays gated). **Verified without Docker actually running** (the daemon wasn't up and starting it wasn't requested) by replicating the image's exact layout locally — built the frontend into `apps/api/public`, booted the server, confirmed `/` serves the SPA, static assets 200, unknown non-API routes fall back to `index.html` (client-side routing survives a hard refresh), `/api/*` 404s stay real 404s, and — with auth temporarily enabled — static assets stayed public while `/api/orgs` correctly 401'd.
- **Slack notifications** — optional (`SLACK_WEBHOOK_URL` in `.env`, off if unset). Posts a one-line summary (changeset name, final status, succeeded/skipped/failed counts) to the webhook when a job reaches a terminal state. `apps/api/src/notifications/slack.ts` — never throws, 5s timeout, logs and moves on if the webhook is unreachable. Verified live: ran a real job with a deliberately broken webhook URL — job completed normally, failure was caught and logged, nothing blocked.

## Phase 2 — Wave 2, part 2: template variables (2026-08-17)

- **Template variables** — content can contain `{{variableName}}` placeholders; `contentSource`/`templateVarsSchema` are derived server-side from the content itself (never a client-supplied flag — same "server is the source of truth" pattern used for GitHub App login derivation). Each targeted repo gets its own values via `CreateJobRequest.templateValues` (repoFullName → varName → value); the Define page shows a live per-repo × per-variable input grid once `{{...}}` is detected in the editor. The rendered-per-repo content is computed once at preview time and stored on the `RepoRun` itself (`renderedContent` — new `repo_runs` column, added via an idempotent `ALTER TABLE` migration in `db.ts` since the table already existed with real data) and reused verbatim by execute, rather than re-deriving from the shared `changeSet.content` — this is what actually makes per-repo values possible (execute would otherwise write the same unsubstituted template to every repo) and also tightens the existing static-content path (preview and execute are now guaranteed to agree, not just assumed to). Shared logic (`extractTemplateVariables`, `renderTemplate`) lives in `packages/shared-types` so frontend detection and backend rendering can never disagree about what counts as a variable. **Verified live end-to-end against real GitHub**: one changeset targeting two repos with different `{team, contact}` values each — confirmed via `GET /api/changesets/:id/jobs` that `renderedContent` differed per repo before execute, then confirmed via GitHub's own raw-content API *after* execute that the actually-committed files differed per repo (`# Owned by Platform` / `platform@example.com` vs `# Owned by Data` / `data@example.com`) — proving execute genuinely writes the per-repo rendered content, not the shared template. The per-repo input grid itself (a straightforward controlled-input table) was verified by source review rather than a live click-through — CodeMirror's editing model doesn't cooperate with this session's browser-automation tooling (same friction hit earlier for the content editor itself), so typing test content into it programmatically wasn't reliable; the API-level risk (rendering/storage/execute-time usage, the part with actual logic to get wrong) is the part that got the real live-GitHub verification.

**Not yet built:** scheduled/recurring runs, multi-file changesets. **Deliberately skipped:** Phase 3's "second-reviewer approval" — contradicts the resolved single-user-tool decision (no second user exists to review anything); revisit only if that decision changes.

## Fixes from first real-account testing (2026-08-17)

- **Personal (non-org) repos weren't listed or targetable.** `GET /api/orgs` only called GitHub's list-orgs endpoint, which by definition excludes your own account namespace. Fixed: it now also fetches the authenticated user and lists them first (tagged `type: "User"` vs `"Organization"` in `GitHubOrgSummary`), and `GET /api/orgs/:org/repos` detects when `:org` is your own login and calls `repos.listForAuthenticatedUser({ affiliation: "owner" })` instead of `repos.listForOrg` (GitHub 404s if you call the org-repos endpoint on a user account).
- **Cross-org selection looked broken but wasn't.** `selectedRepos` already lived in `SelectionContext` above the currently-browsed org, so picks always persisted across org switches — the UI just never showed that, so switching orgs looked like it reset you. Fixed with a `.selection-summary` panel on `SelectPage` (grouped by owner, removable per-repo chips) that's visible regardless of which org's repo list is currently showing.
- **Writing to `.github/workflows/*` needs a permission GitHub checks separately from normal repo write access** — not a bug in this app, but worth documenting since it's the first thing anyone will hit testing with a workflow file: a classic PAT needs the `workflow` scope (sibling to `repo`), a fine-grained PAT needs "Workflows: Read and write" in addition to "Contents: Read and write". Without it, GitHub returns a plain 404 on `createOrUpdateFileContents`, not an obviously-scope-related error.
- **Define form gives no feedback on why the button is disabled.** Fixed: every field is now marked `*` (required) or `(optional)`, and a live "Complete these to continue: …" checklist tracks exactly what's missing — including catching a real bug where `canSubmit` didn't account for PR title even though the input had `required`, so the button could look clickable while the browser silently blocked submission.

## Content editor + fetch-from-URL (2026-08-17)

- **Editor**: the Define page's Content field is now `@uiw/react-codemirror` (CodeMirror 6 — the same engine GitHub's own web file editor uses) instead of a plain `<textarea>`, with language detection off the File path extension (`yml`/`yaml`, `json`, `md` — anything else falls back to plain text). Lazy-loaded (`React.lazy` + `Suspense` in `App.tsx`) since CodeMirror + language packages roughly quadrupled the JS bundle (230KB → 860KB minified) — splitting it into its own chunk keeps every other page at the original size and only pays that cost once someone reaches Define.
- **Fetch from URL**: a "load from URL" row above the editor calls `POST /api/fetch-content` (`apps/api/src/routes/fetchContent.ts`), which fetches server-side rather than from the browser. That's deliberate, not incidental: a server endpoint that fetches an arbitrary user-supplied URL is a classic SSRF vector, so it's guarded — http(s) only, DNS-resolved and rejected if the address is loopback/link-local/private-range (covers `169.254.169.254` cloud metadata), guard re-checked on **every** redirect hop (not just the initial URL — a public URL that 302s to an internal one is the bypass a naive check misses), capped at 5 redirects, 5MB response size, and a 10s timeout.

## Product decisions (resolved — do not re-litigate without the user)

- **License:** MIT, `LICENSE` at repo root from the first commit.
- **Deployment:** self-hosted only. No hosted/managed edition, ever.
- **Users:** single-user tool. No per-user scoping, no shared job history, no in-app RBAC.
- **Auth:** PAT and GitHub App (`.pem` key) both supported, selectable per connection.
- **Commit strategy:** PR, new branch, or **direct push to the default branch** — all three are equal, first-class options. The changeset form never pre-selects one; the user must choose explicitly every time.
- **Direct-to-default pushes** get extra guardrails: branch-protection is checked at *preview* time (not discovered at execute time), the confirmation gate is never skippable for this path regardless of batch size, and every such write is tagged `direct_to_default` in the audit trail.
- **Scale:** "select all repos in this org" (or all accessible orgs) is a normal action, not an edge case. Discovery, diff preview, and execution assume paginated, potentially hundreds-to-thousands-of-repos runs, not just tens.
- **Discovery:** the tool only lists/searches orgs and repos the connected credential can actually reach (`GET /user/orgs` + `/user/repos` for PAT; `GET /app/installations` + `/installation/repositories` for GitHub App) — never GitHub's global search, which could surface repos the credential can't write to.
- **Instance login (optional, off by default):** a config toggle (`AUTH_ENABLED`) puts a username/password login in front of the whole app — one credential pair (`AUTH_USERNAME` / `AUTH_PASSWORD_HASH`, bcrypt), stateless signed session cookie (`SESSION_SECRET`), no user table, no Redis-backed session store. For localhost-only use it stays off; flip it on if the instance is ever reachable past localhost.

## Tech stack

Picked specifically for "single-user, self-hosted" — no service to stand up besides the app itself.

| Layer | Choice |
|---|---|
| Frontend | React + TypeScript, Vite, TanStack Query, CodeMirror 6 (content editor) |
| Backend | Node.js + TypeScript (Fastify), Octokit.js (REST + GitHub App JWT/installation tokens) |
| Queue | In-process, concurrency-limited (`p-queue` or similar) — **no Redis** |
| Datastore | SQLite via Node's built-in `node:sqlite` — **no Postgres, no extra dependency at all** — one file holds changesets, jobs, run history |
| Realtime | Server-sent events for job progress (not WebSocket) |
| Secrets | Envelope-encrypted PAT/PEM at rest, decrypted only inside the GitHub integration layer, never sent to the browser after entry |

Known tradeoff: an in-process queue means job state doesn't survive a killed process mid-run — a crashed job falls back to "retry failed only" on next launch rather than resuming seamlessly. Accepted, given single-user/on-demand usage.

## Repo layout (planned)

Monorepo, pnpm workspaces:

```
apps/web              React frontend
apps/api              Fastify backend, GitHub integration, job engine
packages/shared-types Types shared between web and api
```

## Core entities

`Connection` (PAT | GitHub App) → `ChangeSet` (file path, mode, content, branch/commit strategy) → `TargetSelection` (orgs, filters, or select-all) → `Job` → one `RepoRun` per targeted repo (diff, status, commit/PR result). See the spec for full field lists.

## Roadmap

1. **MVP** — PAT auth, manual + select-all-in-org targeting, all three commit strategies, synchronous execution, basic diff view, optional instance login, `LICENSE`/README/CI from the first commit.
2. **Phase 2** — ~~GitHub App auth~~, ~~filtered targeting (topic/language/archived)~~, ~~async job queue with live progress~~, ~~retry-failed-only~~ (all done, Wave 1, 2026-08-17) — remaining: ~~single-container packaging~~ (done, Wave 2, 2026-08-17). Phase 2 complete.
3. **Phase 3** — ~~per-repo template variables~~ (done, Wave 2, 2026-08-17), scheduled runs, multi-file changesets, ~~second-reviewer approval~~ (skipped — contradicts single-user), ~~Slack notifications~~ (done, Wave 2, 2026-08-17).

## Working conventions

This project uses the `superpowers` skill set — invoke it as directed by `superpowers:using-superpowers` at the start of work. In particular, for this repo:

- **New feature or behavior work** → `superpowers:brainstorming` before implementation to pin down intent, then `superpowers:writing-plans` for anything multi-step, then `superpowers:test-driven-development` while writing the code.
- **Bugs or unexpected behavior** → `superpowers:systematic-debugging` before proposing a fix.
- **Before claiming something is done** → `superpowers:verification-before-completion` — run the actual verification commands, don't assert from reading the diff.
- **Wrapping up a change** → `superpowers:requesting-code-review` (or `code-review:code-review` for a PR), then `superpowers:finishing-a-development-branch` to decide merge/PR/cleanup.
- Independent, parallelizable chunks of work (e.g. scaffolding `apps/web` and `apps/api` at the same time) → `superpowers:dispatching-parallel-agents` or `superpowers:subagent-driven-development`.

Given the security surface (this tool stores and uses PATs and GitHub App private keys), be conservative about adding dependencies and never log or echo credential material — see the spec's Security section.
