// Startup wizard + running menu for a standalone `bun run compile`d binary
// launched at a real terminal (gated in index.ts's main() — never runs for
// `bun run dev` or the Docker image). Prompts for a port (defaulting to
// whatever was used last time), then keeps the process alive showing a
// small menu: open the app in a browser, change port, wipe app data, exit.
// Cross-platform by construction — everything here is readline + Bun.spawn
// with a per-OS argv (see openBrowser.ts), nothing shell- or OS-specific.
import { createInterface } from "node:readline/promises";
import fs from "node:fs";
import type { FastifyInstance } from "fastify";
import type { AppDatabase } from "../db.js";
import { deleteSettingValue, setSettingValue } from "../repositories/settingsRepository.js";
import {
  resolveSlackWebhookUrl,
  SLACK_WEBHOOK_URL_SETTING_KEY,
  type ResolvedSlackWebhookUrl,
} from "../notifications/slack.js";
import { deleteFromKeychain } from "../keychain.js";
import { KEYCHAIN_ACCOUNT, KEYCHAIN_SERVICE } from "../secrets.js";
import { readLastUsedPort, saveLastUsedPort } from "./cliConfig.js";
import { openInBrowser } from "./openBrowser.js";
import { isValidPort } from "./port.js";
import { color } from "./color.js";
import { selectMenuOption, type MenuOption } from "./menuSelect.js";

const MENU_OPTIONS: MenuOption[] = [
  { key: "o", label: "Open in browser", value: "open" },
  { key: "p", label: "Change port", value: "port" },
  { key: "s", label: "Configure Slack notifications", value: "slack" },
  { key: "c", label: "Clear app data", value: "clear" },
  { key: "x", label: "Exit", value: "exit", aliases: ["q", "quit"] },
];

function questionPrompt(question: string, currentValue: number): string {
  return `${color.cyan(color.bold("?"))} ${question} ${color.dim(`[${currentValue}]`)}: `;
}

interface RunInteractiveCliOptions {
  dataDir: string;
  db: AppDatabase;
  /** Builds a fresh Fastify instance bound to `port`; rejects (EADDRINUSE
   * etc.) if it can't bind. */
  listen: (port: number) => Promise<FastifyInstance>;
  /** Skip the port prompt and go straight to this port — set when an
   * explicit API_PORT env var is present, including the CLI's own
   * "change port" self-relaunch (see the "port" branch below). */
  initialPort?: number;
  /** Guaranteed final flush before an intentional exit or self-relaunch —
   * see index.ts's SIGINT/SIGTERM handlers for the OS-signal equivalent.
   * Optional so the many existing tests that don't care about flush
   * behavior don't need to supply it; defaults to a no-op. */
  flushNow?: () => void;
  // Everything below has a real default (see runInteractiveCli's defaults
  // object) and exists as a parameter purely so tests can substitute a
  // fake without this module actually opening a browser, spawning a real
  // process, deleting real files, or killing the test runner via a real
  // process.exit().
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
  openBrowser?: (url: string) => Promise<boolean>;
  spawnRestart?: (port: number) => void;
  rmDataDir?: (dir: string) => void;
  /** Removes the encryption key from the OS keychain. Separate from
   * rmDataDir because on a desktop install the key doesn't live in dataDir
   * at all — see the "clear" branch below. */
  deleteKeychainKey?: () => boolean;
  exit?: (code: number) => never;
  getSlackWebhookStatus?: () => ResolvedSlackWebhookUrl;
  setSlackWebhookUrl?: (url: string) => void;
  clearSlackWebhookUrl?: () => void;
}

function isPortInUseError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: unknown }).code === "EADDRINUSE"
  );
}

/** Empty input keeps the running default; otherwise must be a valid port
 * number. Returns null for anything else so the caller can re-prompt. */
function parsePort(input: string, fallback: number): number | null {
  const trimmed = input.trim();
  if (trimmed === "") return fallback;
  const parsed = Number(trimmed);
  return isValidPort(parsed) ? parsed : null;
}

function defaultSpawnRestart(port: number): void {
  Bun.spawn([process.execPath], {
    env: { ...process.env, API_PORT: String(port) },
    stdio: ["inherit", "inherit", "inherit"],
    cwd: process.cwd(),
  });
}

function defaultRmDataDir(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

export async function runInteractiveCli(options: RunInteractiveCliOptions): Promise<void> {
  const {
    dataDir,
    db,
    listen,
    initialPort,
    flushNow = () => {},
    input = process.stdin,
    output = process.stdout,
    openBrowser = openInBrowser,
    spawnRestart = defaultSpawnRestart,
    rmDataDir = defaultRmDataDir,
    deleteKeychainKey = () => deleteFromKeychain(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT),
    exit = process.exit,
    getSlackWebhookStatus = () => resolveSlackWebhookUrl(db),
    setSlackWebhookUrl = (url: string) => setSettingValue(db, SLACK_WEBHOOK_URL_SETTING_KEY, url),
    clearSlackWebhookUrl = () => deleteSettingValue(db, SLACK_WEBHOOK_URL_SETTING_KEY),
  } = options;

  // A fresh readline.Interface per question rather than one held open for
  // the whole run: the arrow-key menu (menuSelect.ts) needs exclusive raw-
  // mode access to `input`, and a long-lived cooked-mode Interface sitting
  // on the same stream at the same time is a well-known source of stray or
  // duplicated input. Closing each Interface right after its question
  // guarantees the two never overlap.
  async function askQuestion(prompt: string): Promise<string> {
    const rl = createInterface({ input, output });
    try {
      return await rl.question(prompt);
    } finally {
      rl.close();
    }
  }

  console.log(`\n${color.bold(color.cyan("PRSwarm"))}\n`);

  let app: FastifyInstance | null = null;
  let port = initialPort ?? readLastUsedPort(dataDir) ?? 3000;

  if (initialPort !== undefined) {
    try {
      app = await listen(initialPort);
    } catch (err) {
      if (!isPortInUseError(err)) throw err;
      console.log(`${color.red("✗")} Port ${initialPort} is already in use.`);
    }
  }

  while (!app) {
    const answer = await askQuestion(questionPrompt("Port to run PRSwarm on", port));
    const parsed = parsePort(answer, port);
    if (parsed === null) {
      console.log(
        `${color.yellow("⚠")} Enter a port number between 1 and 65535, or press Enter to accept the default.`
      );
      continue;
    }
    try {
      app = await listen(parsed);
      port = parsed;
    } catch (err) {
      if (!isPortInUseError(err)) throw err;
      console.log(`${color.red("✗")} Port ${parsed} is already in use — try another.`);
    }
  }

  saveLastUsedPort(dataDir, port);
  const url = `http://localhost:${port}`;
  console.log(
    `${color.green("➜")}  PRSwarm is running at ${color.bold(color.underline(color.cyan(url)))}\n`
  );

  for (;;) {
    const choice = await selectMenuOption(input, output, MENU_OPTIONS, askQuestion);

    if (choice === "open") {
      const opened = await openBrowser(url);
      if (!opened) {
        console.log(`${color.yellow("⚠")} Could not open a browser automatically — visit ${url} manually.`);
      }
      continue;
    }

    if (choice === "port") {
      const answer = await askQuestion(questionPrompt("New port", port));
      const parsed = parsePort(answer, port);
      if (parsed === null) {
        console.log(`${color.yellow("⚠")} Enter a port number between 1 and 65535.`);
        continue;
      }
      if (parsed === port) {
        console.log(color.gray(`Already running on ${port}.`));
        continue;
      }
      // Restarting in-process (close this Fastify instance, build a new one)
      // would mean re-registering the session plugin, every route, and the
      // static/embedded-asset handler a second time on the same process —
      // plausible but needlessly fragile for a rarely-used menu action.
      // Handing off to a brand new process is the same trick `bun --watch`
      // itself uses on file changes, and it's trivial here: this *is* a
      // single compiled executable, so re-exec'ing it is just spawning
      // itself again with the new port pre-selected via API_PORT (which
      // skips the prompt above but still reaches this same menu).
      console.log(`${color.cyan("↻")} Restarting on port ${parsed}...`);
      flushNow();
      await app.close();
      db.close();
      spawnRestart(parsed);
      exit(0);
      return;
    }

    if (choice === "slack") {
      const { url: currentUrl, source } = getSlackWebhookStatus();
      if (source === "env") {
        console.log(
          `${color.yellow("⚠")} SLACK_WEBHOOK_URL is set via environment variable and takes precedence — unset it to configure this here.`
        );
        continue;
      }
      console.log(
        color.dim(currentUrl ? "Slack notifications are currently configured." : "Slack notifications are not configured.")
      );
      const answer = await askQuestion(
        `${color.cyan(color.bold("?"))} Slack webhook URL ${color.dim('(blank to keep, "clear" to remove)')}: `
      );
      const trimmed = answer.trim();
      if (trimmed === "") {
        console.log(color.gray("Unchanged."));
      } else if (trimmed.toLowerCase() === "clear") {
        clearSlackWebhookUrl();
        console.log(`${color.green("✓")} Slack notifications disabled.`);
      } else if (!trimmed.startsWith("https://")) {
        console.log(`${color.yellow("⚠")} That doesn't look like a URL (expected it to start with https://) — not saved.`);
      } else {
        setSlackWebhookUrl(trimmed);
        console.log(`${color.green("✓")} Slack notifications configured.`);
      }
      continue;
    }

    if (choice === "clear") {
      const confirmed = await askQuestion(
        `${color.red(`⚠ This deletes everything under ${dataDir} — the database and saved preferences — plus the encryption key, wherever it is stored (this app's OS keychain entry included).`)}\nType ${color.bold(color.red("DELETE"))} to confirm: `
      );
      if (confirmed.trim() !== "DELETE") {
        console.log(color.gray("Not cleared."));
        continue;
      }
      await app.close();
      db.close();
      rmDataDir(dataDir);
      // On a desktop install the encryption key lives in the OS keychain, not
      // in dataDir, so wiping the directory alone would leave a live secret
      // behind in Credential Manager/Keychain — after the user explicitly
      // asked to delete everything, and after being told that's what would
      // happen. A false return just means there was nothing there to delete
      // (headless installs keep the key in dataDir, already gone above).
      deleteKeychainKey();
      console.log(`${color.green("✓")} App data cleared. Run the app again to start fresh.`);
      exit(0);
      return;
    }

    // choice === "exit" (including Ctrl+C during the arrow-key menu, which
    // menuSelect.ts resolves as "exit" for exactly this graceful shutdown).
    flushNow();
    await app.close();
    db.close();
    console.log(color.dim("Goodbye."));
    exit(0);
    return;
  }
}
