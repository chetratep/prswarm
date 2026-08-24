---
sidebar_position: 8
---

# Contributing

## Development setup

Requires [Bun](https://bun.sh) ≥ 1.3.14.

```bash
git clone https://github.com/chetratep/prswarm.git
cd prswarm
bun install
cp .env.example .env
bun run dev
```

Web dev server: `http://localhost:5173` (proxies `/api` to the backend on
`API_PORT`).

## Before opening a PR

```bash
bun run lint
bun run typecheck
bun run test
bun run build
```

These are exactly what CI runs (`.github/workflows/ci.yml`) on every push
and PR.

## Testing the standalone binary locally

```bash
bun run compile
./dist/prswarm          # or dist/prswarm.exe on Windows
```

## Cutting a release

Releases are built by `.github/workflows/release.yml`, triggered by
pushing a `v*` tag:

```bash
git tag v1.2.3
git push origin v1.2.3
```

This builds Linux (x64/arm64), macOS (x64/arm64), and Windows (x64)
binaries from a single runner and publishes them as a **draft** release
with a combined `SHA256SUMS.txt` — nothing goes live until the draft is
reviewed and published by hand on GitHub.

## Project conventions

The codebase uses TypeScript throughout, a Bun workspace monorepo
(`apps/web`, `apps/api`, `packages/shared-types`), and is conservative
about adding runtime dependencies — this is a tool that stores and uses
GitHub credentials, so keeping the dependency surface small is a
deliberate security choice, not an oversight.

## License

MIT — see [`LICENSE`](https://github.com/chetratep/prswarm/blob/main/LICENSE).
