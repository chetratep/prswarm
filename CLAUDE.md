# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# PRSwarm

Push one file (or a set of files) across a chosen set of GitHub orgs/repos, with a real per-repo diff reviewed before anything writes. Open source, MIT licensed, self-hosted only — no hosted/managed edition, ever.

Original design spec: https://claude.ai/code/artifact/89d010c4-46f9-4343-b51d-b15f9f57a494 — useful for historical rationale, but the architecture has moved on since (multi-file changesets, multi-user auth). This file describes the current shape; where they disagree, this file wins.

Docs site: https://chetratep.github.io/prswarm/ (source in `website/`).

## Commands

Everything runs through **Bun** (`>=1.3.14`) workspaces — never npm/pnpm.

```bash
bun install                    # install all workspace deps
bun run dev                    # api (watch) + web (vite), together
bun run build                  # build all workspace packages
bun run typecheck              # tsc --noEmit across all packages
bun run test                   # bun test, fanned out per package
bun run compile                # build the standalone binary (scripts/compile.ts)
```

Per-package, from the repo root:

```bash
cd apps/api && bun test                                 # all backend tests
cd apps/api && bun test src/github/repoExecute.test.ts  # a single file
cd apps/api && bun --watch src/index.ts                 # api only
cd apps/web && vite                                      # web only
```

`apps/api/dist/` is gitignored build output — a stale copy left over from `bun run build` gets picked up by `bun test` too (old compiled `.test.js` files), inflating the count. Delete it first if a test count looks off.

Local setup: `cp .env.example .env` (`ENCRYPTION_KEY` is optional — auto-generated and persisted on first run if left unset).

## Architecture

**Flow**: Connect → Select → Define → Preview → Confirm → Execute → Results — one page per step under `apps/web/src/pages/*Page.tsx`, `Stepper.tsx` drives the wizard.

- **Connect** — bind a GitHub credential: PAT or GitHub App (`.pem`), optionally against a GitHub Enterprise Server host via Octokit's `baseUrl`. Scoped per user.
- **Select** — discover orgs/repos reachable by the connected credential only (`GET /user/orgs` + `/user/repos` for PAT; `GET /app/installations` + `/installation/repositories` for GitHub App) — never GitHub's global search, which could surface repos the credential can't write to. Supports `language`/`topic`/`archived` filters; "select all in this org / every accessible org" is a first-class action, not an edge case — discovery, diff, and execution all assume paginated, potentially thousands-of-repos runs.
- **Define** — one or more files per changeset (`ChangeSetFile` rows, ordered), each with a path, mode, content (optionally with `{{variable}}` placeholders), and a commit strategy — PR, new branch, or direct-to-default, never pre-selected, chosen explicitly every time. `POST /api/changesets` then `POST /api/changesets/:id/jobs` computes a real diff per targeted repo synchronously, including a branch-protection check when the strategy is direct-to-default.
- **Preview** — a repo's status is the *worst* status across its files (error > modified > new > unchanged — `worstDiffStatus` in `apps/web/src/lib/repoRunStatus.ts`), each file independently expandable to its own colored diff. Protected-branch repos get a "will likely fail" warning.
- **Confirm** — unconditional typed `RUN` gate whenever any repo run has `directToDefault: true`, regardless of batch size.
- **Execute** — `POST /api/jobs/:id/execute` returns almost immediately (job → `RUNNING`); the writes run in the background, 5x concurrent (`apps/api/src/jobQueue.ts`, `p-limit`), streamed live over SSE (`GET /api/jobs/:id/events`, hand-rolled via Fastify's `reply.hijack()`). One repo's failure never stops the rest; a no-op diff resolves straight to `SKIPPED`. `POST /api/jobs/:id/retry` re-runs only `FAILED` repo_runs.
- **Results** — final per-repo status with commit/PR links or error messages.

**Core entities**: `Connection` (PAT | GitHub App, per user) → `ChangeSet` (name, commit strategy, ordered `ChangeSetFile` rows) → `TargetSelection` → `Job` → one `RepoRun` per targeted repo, each with one or more `RepoRunFile` rows. All files on one `RepoRun` land in a single atomic commit.

Path-scoped conventions for the GitHub integration layer, the data model/migrations, and the frontend editor live in `.claude/rules/` and load automatically when you touch the matching files — check there rather than re-deriving them.

## Encrypted database at rest

`app.db` is never plaintext SQLite on disk any more. `bun:sqlite` stays exactly as it was for querying (no driver swap, no native addon — SQLCipher-style drivers were explicitly rejected for `bun build --compile` bundling risk, same reasoning as the Bun migration): the working database is loaded into memory via `Database.deserialize()` and only ever written back as an AES-256-GCM blob. Every file under `repositories/*.ts` is untouched — `openDatabase()` is the single integration point.

- **`encryptedStore.ts`** — `loadEncryptedDatabase()` (four branches: absent → fresh `:memory:`; encrypted → decrypt + deserialize; wrong key → **fail fast**, never a silent empty DB; legacy plaintext → one-time transparent migration), `flush()` (serialize → encrypt → temp file → fsync → rename, so an interrupted write leaves the previous complete file rather than a torn one), `finalizeLegacyMigration()`, `cleanupStaleTempFiles()`.
- **`db.ts`** — wires all of that through `openDatabase()`, monkey-patches the returned `Database`'s `prepare`/`query`/`run`/`exec`/`transaction`/`close` to mark the store dirty, and flushes on a 500ms debounce with a 5s max-delay cap. **`PRAGMA journal_mode = WAL` is gone** — nothing writes SQLite's own on-disk format any more, and WAL's journal would have been plaintext.
- **Key management** — precedence is env → **OS keychain** → key file → generate. `keychain.ts` shells out to each OS's own tool with no third-party dependency (macOS `security`, Windows Credential Manager via a PowerShell `CredRead`/`CredWrite`/`CredDelete` helper script invoked with `-File` *and* `-ExecutionPolicy Bypass` — both learned the hard way, see the comments there; Linux `secret-tool`, absent on headless/Docker). Every function degrades to undefined/false rather than throwing, so a headless box falls straight through to the file/env source.
- **Two things that are now permanent and were made loud on purpose.** (1) Key loss = total data loss, so `assertEncryptionKeyAvailableFor()` (`crypto.ts`) refuses to generate-and-persist a replacement key whenever an already-*encrypted* database exists and no key can be found anywhere — because keychain reads fail closed by design, and persisting a generated key overwrites in place, one keychain hiccup would otherwise orphan the database irreversibly. A *legacy plaintext* database is exempt: that's the migration case, and it legitimately needs a fresh key. (2) Flush failures never crash the process — they log, keep the store dirty, and retry (spec-mandated), with `db.close()` and the SIGINT/SIGTERM handlers each having their own boundary so a failing flush can't block a clean shutdown or the CLI's `rmDataDir()`.
- **Upgrading users** get the plaintext `app.db-wal`/`app.db-shm` sidecars deleted after the first successful encrypted flush — the pre-encryption WAL file genuinely held recoverable usernames and password hashes, and migration rewriting `app.db` alone left them beside it forever.
- **"Clear app data"** now also removes the keychain entry, since on a desktop install the key doesn't live under `dataDir` at all and the confirmation prompt claimed otherwise.

Out of scope by decision: key rotation, KMS/remote key custody (deferred, not rejected — it's the only approach that survives full local-disk compromise, but it adds a mandatory network dependency to a zero-config tool), audit logging, and code-signing the release binaries so keychain entries could be ACL'd to this exact binary (the known gap that keeps same-user malware in scope).

Known gap, not yet fixed: under a *sustained* flush failure (e.g. disk stays full through an entire job run), the retry backoff above stops actually backing off — every write during the outage triggers an immediate full flush attempt instead of one every ~2s. CPU/IO/log noise, not data loss (confirmed the on-disk file stays correct throughout) — a small, understood fix, just not applied yet.

## Tech stack

| Layer | Choice |
|---|---|
| Frontend | React + TypeScript, Vite, TanStack Query, CodeMirror 6, Radix/shadcn |
| Backend | Bun + TypeScript (Fastify), Octokit.js (REST + GitHub App JWT/installation tokens) |
| Queue | In-process, concurrency-limited (`p-limit`) — no Redis |
| Datastore | SQLite via `bun:sqlite` only — no Postgres, no extra dependency at all — one file holds everything. **Encrypted at rest as a whole file** (AES-256-GCM): the working database lives in memory and only reaches disk as ciphertext, written atomically — the file is never plaintext SQLite. See "Encrypted database at rest" above. |
| Realtime | Server-sent events for job progress — not WebSocket |
| Secrets | One 32-byte key covers both the whole-file database encryption and the envelope-encrypted PAT/PEM column inside it (kept as additive defense-in-depth, not replaced). Resolved env → **OS keychain** → key file → generate; decrypted only inside the GitHub integration layer, never sent to the browser after entry |

Known tradeoff: the in-process queue means job state doesn't survive a killed process mid-run — a crashed job falls back to "retry failed only," not seamless resume. Accepted for on-demand, self-hosted usage rather than an always-on multi-tenant service.

Second known tradeoff, new with whole-file encryption: **one process per database file.** Two instances against one `DATABASE_PATH` used to be arbitrated by SQLite's own file locking; now each holds a private in-memory copy and each flush rewrites the entire file, so the second flush silently discards everything the first instance wrote. Documented in `db.ts` (see the SINGLE INSTANCE PER DATABASE PATH note) rather than defended against — it matches the app's existing single-process architecture, and it was never a supported configuration, it just used to fail visibly.

## Repo layout

Bun workspaces are `apps/*` and `packages/*` only — `scripts/` and `website/` are deliberately outside that glob (each has its own dependency tree).

```
apps/web               React frontend
apps/api                Fastify backend, GitHub integration, job engine
packages/shared-types    Types shared between web and api (template-variable extraction/rendering lives here)
scripts/                 bun run compile — the standalone-binary build pipeline
website/                 Docusaurus docs site, deployed to GitHub Pages
```

Single-container packaging: `Dockerfile` builds all three workspace packages and serves `apps/web`'s built output as static files from the API (`@fastify/static`) — only active inside the built image; local `bun run dev` still runs the Vite dev server separately.

## Product decisions

- **License / deployment**: MIT, self-hosted only, no hosted edition, ever.
- **Users**: real multi-user access — open self-signup, `admin`/`member` roles, per-user GitHub connections, run history scoped to "your own runs" for members / "everything" for admins (`apps/api/src/auth/`).
- **Auth**: PAT and GitHub App both supported, selectable per connection and scoped per user. GitHub Enterprise Server hosts supported for both.
- **Commit strategy**: PR / new branch / direct-to-default are equal, first-class options — the form never pre-selects one.
- **Instance login**: `AUTH_ENABLED` toggle, off by default (fine for localhost-only use). Backed by the real `users` table; `AUTH_USERNAME`/`AUTH_PASSWORD_HASH` only bootstrap the first admin account on a fresh instance, not a standing credential.
- **Open, not yet decided**: second-reviewer approval before execute (now that real multi-user access exists, this is a live question, not a settled skip). **Not yet built**: scheduled/recurring runs.

Treat this section as current state, not a decision log — when a decision changes, edit the line in place rather than appending a reversal note.

## Working conventions

This project uses the `superpowers` skill set — invoke it per `superpowers:using-superpowers` at the start of work:

- **New feature or behavior work** → `superpowers:brainstorming`, then `superpowers:writing-plans` for anything multi-step, then `superpowers:test-driven-development`.
- **Bugs or unexpected behavior** → `superpowers:systematic-debugging` before proposing a fix.
- **Before claiming something is done** → `superpowers:verification-before-completion` — run the actual commands, don't assert from reading a diff.
- **Wrapping up** → `superpowers:requesting-code-review` (or `code-review:code-review` for a PR), then `superpowers:finishing-a-development-branch`.
- Independent, parallelizable chunks of work → `superpowers:dispatching-parallel-agents` / `superpowers:subagent-driven-development`.
- Verifying a change that writes to a real GitHub account → `.claude/skills/verify-live-github/`.
