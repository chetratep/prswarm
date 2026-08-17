# Bulk GitHub Update Tool

Push one file change (e.g. `.github/workflows/pr-review.yml`) across a chosen set of GitHub orgs/repos, with a reviewed diff per repo before anything writes. Self-hosted, single-user, MIT licensed.

Full design spec: https://claude.ai/code/artifact/89d010c4-46f9-4343-b51d-b15f9f57a494

See [`CLAUDE.md`](./CLAUDE.md) for the condensed architecture reference and working conventions.

## Status

Phase 1 (MVP) and Phase 2 complete — the full workflow (Connect → Select → Define → Preview → Confirm → Execute → Results) works end to end, with GitHub App auth, filtered targeting, async execution with live progress, retry-failed-only, per-repo template variables, and Slack notifications. See `CLAUDE.md` for details and what's left (Phase 3: scheduled runs, multi-file changesets).

## Layout

```
apps/web              React frontend
apps/api              Fastify backend, GitHub integration, job engine
packages/shared-types Types shared between web and api
```

## Getting started

```bash
bun install
cp .env.example .env
# Optional — ENCRYPTION_KEY now auto-generates on first run if left unset.
bun run dev
```

Web dev server: http://localhost:5173 (proxies `/api` to the backend on port 3000).

## Running with Docker

Single container — no separate database or cache service to run.

```bash
docker build -t bulk-github-update-tool .
docker run -p 3000:3000 \
  -e ENCRYPTION_KEY=<generate one, see .env.example> \
  -v bulk-tool-data:/app/data \
  bulk-github-update-tool
```

The app (frontend + API) is served entirely from port 3000 — there's no separate Vite dev server in this mode.

## License

MIT — see [`LICENSE`](./LICENSE).
