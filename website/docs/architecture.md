---
sidebar_position: 6
---

# Architecture

## Tech stack

Picked specifically for "self-hosted, no service to stand up besides the
app itself":

| Layer | Choice |
|---|---|
| Runtime | [Bun](https://bun.sh), not Node.js |
| Frontend | React + TypeScript, Vite, TanStack Query, CodeMirror 6 (content editor) |
| Backend | Bun + TypeScript (Fastify), Octokit.js (REST + GitHub App JWT/installation tokens) |
| Queue | In-process, concurrency-limited — **no Redis** |
| Datastore | SQLite via Bun's built-in `bun:sqlite` — **no Postgres, no extra dependency at all** |
| Realtime | Server-sent events for job progress — not WebSocket |
| Secrets | Envelope-encrypted credentials at rest, decrypted only inside the GitHub integration layer, never sent to the browser after entry |

One accepted tradeoff: the in-process queue means job state doesn't
survive a killed process mid-run — a crashed job falls back to
"retry failed only" on next launch rather than resuming seamlessly.

## Repo layout

```
apps/web              React frontend
apps/api              Fastify backend, GitHub integration, job engine
packages/shared-types  Types shared between web and api
scripts/               bun run compile — the standalone-binary build pipeline
website/                This documentation site (Docusaurus)
```

## Core entities

```
Connection (PAT | GitHub App)
        │
        ▼
ChangeSet (name, branch/commit strategy)
        │
        ├── ChangeSetFile (path, mode, content, template schema) × N, ordered
        │
        ▼
TargetSelection (orgs, filters, or explicit repo list)
        │
        ▼
Job
        │
        ▼
RepoRun (one per targeted repo — status, commit/PR result)
        │
        └── RepoRunFile (per-file diff, status, rendered content) × N
```

Every file in a `ChangeSet` becomes one `ChangeSetFile` row; every
targeted repo gets one `RepoRun`, which in turn gets one `RepoRunFile` per
file — all of a repo's files land in a single atomic commit via the Git
Data API (`git.createBlob` → `createTree` → `createCommit` → `updateRef`
or `createRef`), never one API call per file.

## The standalone binary

`bun run compile` does three things:

1. Builds the frontend (`apps/web/dist`).
2. Bakes it into the API bundle as base64 (`apps/api/scripts/embed-assets.ts`)
   — no separate `public/` folder needed at runtime.
3. Compiles a single-file executable via `bun build --compile`.

The result is one file that serves both the API and the entire frontend
from the same process and port, with zero required configuration. See
[CLI Reference](./cli-reference) for the interactive wizard and daemon
mode this binary also gets.

Docker uses a different mechanism for the same outcome (the frontend is
copied into `apps/api/public` and served via `@fastify/static`) — both
paths converge on "one process, no separate web server."
