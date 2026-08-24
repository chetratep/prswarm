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
- **Clear app data** deletes the database, encryption key, and saved
  preferences. Requires typing `DELETE` to confirm; there's no
  undo.
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
