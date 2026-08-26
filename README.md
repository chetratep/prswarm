# PRSwarm

[![CI](https://github.com/chetratep/prswarm/actions/workflows/ci.yml/badge.svg)](https://github.com/chetratep/prswarm/actions/workflows/ci.yml)

Push a file change — or a set of file changes — across a chosen set of
GitHub orgs/repos, with a reviewed diff per file per repo before anything
writes. Self-hosted, open source, MIT licensed.

**[Documentation](https://chetratep.github.io/prswarm/)** · [Releases](https://github.com/chetratep/prswarm/releases) · [`CLAUDE.md`](./CLAUDE.md) (architecture reference & working conventions)

## Install

**Linux / macOS:**

```bash
curl -fsSL https://raw.githubusercontent.com/chetratep/prswarm/main/install.sh | bash
```

**Windows (PowerShell):**

```powershell
irm https://raw.githubusercontent.com/chetratep/prswarm/main/install.ps1 | iex
```

Both fetch the latest [release](https://github.com/chetratep/prswarm/releases)
for your platform (Linux/macOS/Windows, x64/arm64) and verify it against
the release's checksums. No config file is required to run it afterward —
see the [Installation docs](https://chetratep.github.io/prswarm/installation)
for Docker and from-source options.

## Status

Full workflow (Connect → Select → Define → Preview → Confirm → Execute →
Results) end to end, with:

- PAT and GitHub App auth (including GitHub Enterprise Server hosts)
- Multi-user accounts with admin/member roles, or single-instance login,
  or no login at all — your choice
- Filtered targeting, select-all-in-org, cross-org batches
- Async execution with live per-repo progress over SSE, retry-failed-only
- Multi-file changesets in one atomic commit, per-repo template variables
- Slack notifications
- A standalone single-file binary for Linux/macOS/Windows with an
  interactive CLI (port wizard, daemon mode) — no separate runtime or
  config required
- Docker image (single container, no external database)

See [`CLAUDE.md`](./CLAUDE.md) for the detailed history and what's next.

## Layout

```
apps/web              React frontend
apps/api              Fastify backend, GitHub integration, job engine
packages/shared-types Types shared between web and api
scripts/               bun run compile — standalone-binary build pipeline
website/                Documentation site (Docusaurus)
```

## Running from source

Requires [Bun](https://bun.sh) ≥ 1.3.14.

```bash
bun install
cp .env.example .env
bun run dev
```

Web dev server: http://localhost:5173 (proxies `/api` to the backend).

To build your own standalone binary:

```bash
bun run compile
```

## Running with Docker

Single container — no separate database or cache service to run.

```bash
docker build -t prswarm .
docker run -p 3000:3000 -v prswarm-data:/app/data prswarm
```

The app (frontend + API) is served entirely from port 3000.

## Security & privacy

Self-hosted with no hosted/managed edition — nothing you connect ever
leaves your own instance. Stored credentials (PAT or GitHub App private
key) are AES-256-GCM encrypted at rest. See the
[Security & Privacy docs](https://chetratep.github.io/prswarm/security-and-privacy)
for the full picture.

## License

MIT — see [`LICENSE`](./LICENSE).
