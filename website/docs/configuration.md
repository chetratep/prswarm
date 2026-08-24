---
sidebar_position: 5
---

# Configuration

Nothing here is required to just run PRSwarm. A `.env` file placed next
to the standalone binary (or in the repo root when running from source)
is only for customizing defaults.

| Variable | Default | Purpose |
|---|---|---|
| `API_PORT` | `3000` | Port the app listens on. Same effect as the CLI's `--port` flag (see [CLI Reference](./cli-reference) for precedence). |
| `VITE_PORT` | `5173` | The web dev server's own port — **dev-from-source only**, has no effect on the compiled binary or Docker (both serve the frontend from the same process/port as the API). |
| `DATABASE_PATH` | OS-appropriate per-user data directory | Where the SQLite database lives. |
| `ENCRYPTION_KEY` | auto-generated | 32-byte key (64-char hex or base64) used to encrypt stored credentials at rest. Generate one explicitly with `bun -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`, or leave unset — one is generated on first run and persisted to the same data directory as the database. See [Security & Privacy](./security-and-privacy). |
| `AUTH_ENABLED` | `false` | Puts a login screen in front of the whole app. See [Multi-user access & admin](./guides/multi-user-and-admin). |
| `AUTH_USERNAME` / `AUTH_PASSWORD_HASH` | — | Bootstrap a specific admin account on first run instead of the auto-generated one. `AUTH_PASSWORD_HASH` must already be a bcrypt hash. |
| `SESSION_SECRET` | auto-generated | Signs the login session cookie. Only relevant when `AUTH_ENABLED=true`. |
| `SLACK_WEBHOOK_URL` | — | Posts a one-line summary to this incoming webhook when a job reaches a terminal state. Job completion never blocks on this — a broken or unreachable webhook is logged and ignored. |

## Where the default data directory is

When `DATABASE_PATH` isn't set, the database and auto-generated
encryption key live in the OS-appropriate per-user data directory:

| OS | Path |
|---|---|
| Windows | `%APPDATA%\prswarm` |
| macOS | `~/Library/Application Support/prswarm` |
| Linux | `$XDG_DATA_HOME/prswarm` (or `~/.local/share/prswarm`) |

The CLI's remembered port preference (`cli-config.json`) lives here too.
"Clear app data" from the interactive CLI menu wipes this entire
directory.
