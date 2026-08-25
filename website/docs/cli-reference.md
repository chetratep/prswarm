---
sidebar_position: 4
---

# CLI Reference

The standalone binary can run two ways: interactively at a real terminal,
or headless for services and scripts.

## Interactive mode

Running `./prswarm` at a real terminal, with no `--daemon` flag, starts a
short wizard:

```
PRSwarm

? Port to run PRSwarm on [3000]:
```

Press Enter to accept the default (remembered from your last run, or
3000 the very first time), or type a different port. Once it's listening:

```
➜  PRSwarm is running at http://localhost:3000

────────────────────────────────────────────
  o  Open in browser
  p  Change port
  s  Configure Slack notifications
  c  Clear app data
  x  Exit
────────────────────────────────────────────
❯
```

Navigate with the arrow keys and Enter, or just type the letter — both
work. **Ctrl+C** behaves exactly like picking Exit (a clean shutdown, not
a raw kill).

- **Open in browser** launches your default browser at the running URL.
- **Change port** hands off to a freshly spawned copy of the same binary
  on the new port, rather than rebuilding the server in-process — the
  same trick file-watchers use on a restart.
- **Configure Slack notifications** prompts for a webhook URL (or type
  `clear` to remove it, or leave it blank to keep the current value) —
  stored in the database, so it's remembered across restarts with no
  `.env` file involved. Same setting the web UI's Settings page edits;
  either one reflects what the other set. If `SLACK_WEBHOOK_URL` is set
  as an environment variable, this tells you that instead of prompting,
  since the env var always takes precedence.
- **Clear app data** deletes everything in the data directory — the
  encrypted database and saved preferences, including anything configured
  via the option above — *and* removes the encryption key from your OS
  keychain, since on a desktop install that's where it lives rather than
  in the data directory. Requires typing `DELETE` to confirm; there's no
  undo, and without the key a copy of the database file is unreadable
  anyway.
- **Exit** shuts down cleanly.

Colors respect `NO_COLOR` and disable automatically when output isn't a
real terminal (piped, redirected).

## Daemon mode

For services, process managers, or scripts — no prompts, no menu:

```bash
./prswarm --daemon
./prswarm --daemon --port 3777
```

## Flags

| Flag | Effect |
|---|---|
| `--daemon`, `-d` | Skip the interactive wizard even at a real terminal. |
| `--port <number>`, `-p <number>` | Use this port. Also skips the port prompt in interactive mode. Same effect as setting `API_PORT`. |
| `--help`, `-h` | Print usage and exit. |

## Precedence for the port

1. `--port` flag
2. `API_PORT` environment variable
3. The port remembered from your last interactive run
4. `3000`

Whichever port is actually used gets remembered for next time — including
in daemon mode, so an interactive run later offers it as the default.
