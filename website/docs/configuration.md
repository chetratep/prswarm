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
| `DATABASE_PATH` | OS-appropriate per-user data directory | Where the encrypted database file lives. One instance per file — see [Security & Privacy](./security-and-privacy). |
| `ENCRYPTION_KEY` | auto-generated | 32-byte key (64-char hex or base64) that encrypts **the whole database file**, plus the stored GitHub credential inside it. Generate one explicitly with `bun -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`, or leave it unset — on a desktop OS one is generated on first run and stored in your OS keychain; on a headless server or in Docker it falls back to a file in the data directory. **Lose this key and the database is unrecoverable.** See [Security & Privacy](./security-and-privacy). |
| `AUTH_ENABLED` | `false` | Puts a login screen in front of the whole app. See [Multi-user access & admin](./guides/multi-user-and-admin). |
| `AUTH_USERNAME` / `AUTH_PASSWORD_HASH` | — | Bootstrap a specific admin account on first run instead of the auto-generated one. `AUTH_PASSWORD_HASH` must already be a bcrypt hash. |
| `SESSION_SECRET` | auto-generated | Signs the login session cookie. Only relevant when `AUTH_ENABLED=true`. |
| `SLACK_WEBHOOK_URL` | — | Posts a one-line summary to this incoming webhook when a job reaches a terminal state. Job completion never blocks on this — a broken or unreachable webhook is logged and ignored. Optional — see below for two other ways to set this that don't involve a `.env` file at all. |

## Where the default data directory is

When `DATABASE_PATH` isn't set, the encrypted database lives in the
OS-appropriate per-user data directory:

| OS | Path |
|---|---|
| Windows | `%APPDATA%\prswarm` |
| macOS | `~/Library/Application Support/prswarm` |
| Linux | `$XDG_DATA_HOME/prswarm` (or `~/.local/share/prswarm`) |

The CLI's remembered port preference (`cli-config.json`) lives here too.

The encryption key usually does **not**: on Windows and macOS it goes into
the OS keychain instead, and only a headless install with no reachable
keychain writes an `encryption.key` file here. "Clear app data" from the
interactive CLI menu wipes this whole directory *and* removes the keychain
entry, so back the key up separately if you want the database to remain
readable.

## Settings that don't need a `.env` file

The `.env`-based settings above are all *startup* configuration — the kind
that has to exist before the app can even open its database. A smaller
set of settings can instead be configured after the app is already
running, stored in that same database rather than a file you have to
place in the right directory (see the note on the standalone binary's
`.env` resolution above — it depends on your current working directory,
which trips people up). Today that's just:

- **Slack webhook URL** — configurable from the **Settings** page in the
  web UI (visible in the header once you're logged in as an admin, or
  always if `AUTH_ENABLED` is off), or from the interactive CLI menu's
  **Configure Slack notifications** option (see [CLI Reference](./cli-reference)).

If `SLACK_WEBHOOK_URL` is set as an environment variable, it always wins
over whatever's configured through either of those — both surfaces show
this explicitly (the web UI disables the field; the CLI tells you why it
won't prompt) rather than silently ignoring what you type.
