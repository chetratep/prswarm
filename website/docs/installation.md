---
sidebar_position: 2
---

# Installation

Pick whichever fits how you want to run it. All three run the exact same
application.

## Option 1 — Install script (recommended)

Downloads the right binary for your platform from the
[latest release](https://github.com/chetratep/prswarm/releases) and puts
it on your PATH.

**Linux / macOS:**

```bash
curl -fsSL https://raw.githubusercontent.com/chetratep/prswarm/main/install.sh | bash
```

**Windows (PowerShell):**

```powershell
irm https://raw.githubusercontent.com/chetratep/prswarm/main/install.ps1 | iex
```

Both scripts verify the downloaded binary against the release's
`SHA256SUMS.txt` before installing it. Set `PRSWARM_VERSION` (env var on
Linux/macOS, `$env:PRSWARM_VERSION` on Windows) to install a specific tag
instead of the latest.

## Option 2 — Download a binary directly

Grab the file for your platform from the
[Releases page](https://github.com/chetratep/prswarm/releases/latest):

| Platform | Asset |
|---|---|
| Linux (x64) | `prswarm-linux-x64` |
| Linux (arm64) | `prswarm-linux-arm64` |
| macOS (Intel) | `prswarm-macos-x64` |
| macOS (Apple Silicon) | `prswarm-macos-arm64` |
| Windows (x64) | `prswarm-windows-x64.exe` |

Make it executable and run it:

```bash
chmod +x prswarm-linux-x64
./prswarm-linux-x64
```

## Option 3 — Docker

A single container — no separate database or cache service to run.

```bash
docker build -t prswarm .
docker run -p 3000:3000 \
  -v prswarm-data:/app/data \
  prswarm
```

The whole app (frontend + API) is served from port 3000. An
`ENCRYPTION_KEY` is auto-generated and persisted on the mounted volume on
first run if you don't set one explicitly — see [Configuration](./configuration).

## Option 4 — From source

Requires [Bun](https://bun.sh) ≥ 1.3.14.

```bash
git clone https://github.com/chetratep/prswarm.git
cd prswarm
bun install
cp .env.example .env
bun run dev
```

The web dev server runs at `http://localhost:5173` and proxies `/api`
calls to the backend. To build your own standalone binary from source:

```bash
bun run compile
```

produces `dist/prswarm` (or `dist/prswarm.exe` on Windows).

## Zero config, by design

None of the above requires a config file to start. A `.env` next to the
binary (see [Configuration](./configuration)) is only for *customizing*
things — port, database location, whether an instance login is required —
never for making it run in the first place.
