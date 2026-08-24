// Command-line flags for the compiled binary (also harmless no-ops under
// `bun run dev`/Docker, which just never reach the code paths that check
// `daemon`/`port`). Deliberately tiny — no argv-parsing dependency for four
// flags (see CLAUDE.md: be conservative about adding dependencies here).
import { isValidPort } from "./port.js";

export interface CliArgs {
  /** Skip the interactive wizard even at a real terminal — for services,
   * process managers, and scripts that want a plain headless run. */
  daemon: boolean;
  /** Explicit port. Valid in both daemon and interactive mode (in
   * interactive mode it skips the port prompt, same as API_PORT does). null
   * if not passed; NaN if passed but not a valid port number, so the caller
   * can distinguish "not given" from "given wrong" and fail loudly on the
   * latter instead of silently falling through to a default port the user
   * didn't ask for. */
  port: number | null;
  help: boolean;
}

export function parseCliArgs(argv: string[]): CliArgs {
  let daemon = false;
  let port: number | null = null;
  let help = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--daemon" || arg === "-d") {
      daemon = true;
    } else if (arg === "--help" || arg === "-h") {
      help = true;
    } else if (arg === "--port" || arg === "-p") {
      i += 1;
      port = Number(argv[i]);
    } else if (arg.startsWith("--port=")) {
      port = Number(arg.slice("--port=".length));
    }
  }

  return { daemon, port, help };
}

export const HELP_TEXT = `PRSwarm — push one file change across a set of GitHub repos.

Usage:
  prswarm                    Interactive mode: prompts for a port, then
                              shows a menu (open browser / change port /
                              clear app data / exit).
  prswarm --daemon           Run headless — no prompts, no menu. For
                              services, process managers, and scripts.
  prswarm --port <number>    Use this port. Skips the port prompt in
                              interactive mode too. Same effect as setting
                              API_PORT.
  prswarm --help             Show this help.

No config file is required to just run it — a .env next to the binary is
only for customizing things (port, database location, auth). See
.env.example in the repo for the full list.`;
