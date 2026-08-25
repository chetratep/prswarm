// Bootstrap: load env from the repo root, open the DB, build the Fastify
// instance, register the session plugin/hook and all route files under
// /api, then listen.
//
// Safe to dotenv.config() after the static imports below: none of these
// modules read process.env at module top-level — only inside functions
// called from main(), by which point env is already loaded.
import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import Fastify, { type FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";
import type { AppDatabase } from "./db.js";
import { bootstrapAuth } from "./auth/bootstrap.js";
import { registerSession } from "./auth/session.js";
import { assertEncryptionKeyAvailableFor, assertEncryptionKeyConfigured } from "./crypto.js";
import { openDatabase } from "./db.js";
import { flush } from "./encryptedStore.js";
import { embeddedAssets } from "./embeddedAssets.generated.js";
import { defaultDataDir } from "./paths.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerChangesetsRoutes } from "./routes/changesets.js";
import { registerConnectionsRoutes } from "./routes/connections.js";
import { registerFetchContentRoutes } from "./routes/fetchContent.js";
import { registerGithubRoutes } from "./routes/github.js";
import { registerHealthRoutes } from "./routes/health.js";
import { registerJobsRoutes } from "./routes/jobs.js";
import { registerSettingsRoutes } from "./routes/settings.js";
import { registerUsersRoutes } from "./routes/users.js";
import { runInteractiveCli } from "./cli/interactiveCli.js";
import { HELP_TEXT, parseCliArgs } from "./cli/args.js";
import { isValidPort } from "./cli/port.js";
import { readLastUsedPort, saveLastUsedPort } from "./cli/cliConfig.js";

// `bun run dev`/`start` and the Dockerfile's CMD both run this file straight
// out of apps/api/src (Bun executes TypeScript directly), so import.meta.dirname
// is genuinely apps/api/src, three levels below a real repo root: src -> api
// -> apps -> repo root. A `bun build --compile` standalone binary is
// different: import.meta.dirname resolves to a *virtual* in-binary path
// (e.g. "B:/~BUN/root/prswarm") that shares no filesystem with wherever the
// binary actually runs — resolving against it 404s/EPERMs. Detect that case
// by checking whether the computed root actually has this repo's
// package.json on real disk; if not, fall back to the process's actual cwd
// (wherever the user launched the binary from) so `.env`/DATABASE_PATH are
// optional, user-supplied overrides rather than a hard requirement.
const sourceRepoRoot = path.resolve(import.meta.dirname, "../../..");
const isStandaloneBinary = !fs.existsSync(path.join(sourceRepoRoot, "package.json"));
const configBaseDir = isStandaloneBinary ? process.cwd() : sourceRepoRoot;

dotenv.config({ path: path.join(configBaseDir, ".env") });

// Builds a fresh Fastify instance — DB and auth bootstrap already done —
// registers everything, and binds it to `port`. Split out from main() so
// the interactive CLI (standalone binary + a real terminal, see main() below)
// can call it more than once: once for the initial port prompt (retrying on
// a bad/taken port picks a *new* instance rather than reusing a half-failed
// one), though in practice a running instance only ever changes port by
// having the CLI hand off to a whole new process (see cli/interactiveCli.ts)
// rather than calling this again in-process.
async function buildAndListen(
  db: AppDatabase,
  authEnabled: boolean,
  port: number
): Promise<FastifyInstance> {
  const app = Fastify({ logger: true });

  await registerSession(app, {
    authEnabled,
    sessionSecret: process.env.SESSION_SECRET,
  });

  await app.register(
    async (apiScope) => {
      await registerHealthRoutes(apiScope);
      await registerAuthRoutes(apiScope, { authEnabled, db });
      await registerConnectionsRoutes(apiScope, { db });
      await registerGithubRoutes(apiScope, { db });
      await registerChangesetsRoutes(apiScope, { db });
      await registerJobsRoutes(apiScope, { db });
      await registerUsersRoutes(apiScope, { db });
      await registerSettingsRoutes(apiScope, { db });
      await registerFetchContentRoutes(apiScope, { db });
    },
    { prefix: "/api" }
  );

  // Serve the built frontend so the Docker image / standalone binary is
  // genuinely one process to run — no separate web server. Two sources,
  // mutually exclusive:
  // - apps/api/public on real disk (Docker: apps/web/dist copied there at
  //   image build time). Never present in local dev (Vite dev server proxies
  //   /api here instead) or inside a compiled binary (see isStandaloneBinary
  //   above — the path it'd resolve to isn't real).
  // - embeddedAssets (non-empty only when `bun run compile` baked the built
  //   frontend directly into the binary as base64 — see
  //   apps/api/scripts/embed-assets.ts). This is what makes the compiled
  //   binary a single file with zero required config or companion folders.
  const publicDir = path.resolve(import.meta.dirname, "../public");
  const hasEmbeddedAssets = Object.keys(embeddedAssets).length > 0;
  if (!isStandaloneBinary && fs.existsSync(publicDir)) {
    await app.register(fastifyStatic, { root: publicDir });
    // SPA fallback: any GET that isn't a real static file and isn't under
    // /api (that 404s from within the /api scope above, untouched) serves
    // index.html, so client-side routes like /select or /define work on a
    // hard refresh instead of 404ing at the server.
    app.setNotFoundHandler((request, reply) => {
      if (request.method === "GET" && !request.url.startsWith("/api/")) {
        return reply.sendFile("index.html");
      }
      return reply.code(404).send({ error: "Not found" });
    });
  } else if (hasEmbeddedAssets) {
    app.setNotFoundHandler((request, reply) => {
      if (request.method !== "GET" || request.url.startsWith("/api/")) {
        return reply.code(404).send({ error: "Not found" });
      }
      const urlPath = request.url.split("?")[0];
      const asset = embeddedAssets[urlPath] ?? embeddedAssets["/index.html"];
      if (!asset) {
        return reply.code(404).send({ error: "Not found" });
      }
      reply.header("Content-Type", asset.contentType);
      return reply.send(Buffer.from(asset.base64, "base64"));
    });
  }

  await app.listen({ port, host: "0.0.0.0" });
  app.log.info(`API listening on port ${port}`);
  return app;
}

async function main(): Promise<void> {
  const cliArgs = parseCliArgs(process.argv.slice(2));

  if (cliArgs.help) {
    console.log(HELP_TEXT);
    process.exit(0);
  }

  if (cliArgs.port !== null && !isValidPort(cliArgs.port)) {
    console.error("Invalid --port value — must be an integer between 1 and 65535.");
    process.exit(1);
  }

  const authEnabled = process.env.AUTH_ENABLED === "true";

  const databasePath = process.env.DATABASE_PATH
    ? path.resolve(configBaseDir, process.env.DATABASE_PATH)
    : path.join(defaultDataDir(), "app.db");

  // Ordered ahead of assertEncryptionKeyConfigured() on purpose: that call
  // *generates and persists* a key when it can't find one, which would
  // silently overwrite the keychain entry an existing encrypted database
  // depends on. This refuses that case up front, and caches the key it does
  // find so the call below doesn't pay for a second keychain lookup.
  assertEncryptionKeyAvailableFor(databasePath);

  // Resolves the encryption key eagerly (generating and persisting one on first
  // run if none is configured) so a *malformed* key still fails fast at startup
  // rather than the first time a connection is saved.
  assertEncryptionKeyConfigured();

  const db = openDatabase(databasePath);

  // A final flush is best-effort by definition: the process is on its way out
  // either way, so a failure here (disk full, an AV/backup lock on the target
  // path) must be reported and moved past, never allowed to turn a clean stop
  // into an uncaught-exception crash that skips the rest of the shutdown.
  // flush() writes to a temp file and renames, so a failure leaves the
  // existing on-disk database intact — the cost is the last few seconds of
  // writes, not corruption.
  const safeFinalFlush = (): void => {
    try {
      flush(db, databasePath);
    } catch (err) {
      console.error(
        `Failed to write the encrypted database to ${databasePath} during shutdown. ` +
          "The existing file on disk is unchanged, but changes made since the last successful " +
          "flush are lost.",
        err
      );
    }
  };

  // Guaranteed final flush on an OS-level stop (Ctrl+C, `docker stop`,
  // `systemctl stop`) — the debounced auto-flush inside openDatabase()
  // already covers steady-state writes, but a signal can arrive mid-debounce
  // window, and this makes sure that last write isn't lost.
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      safeFinalFlush();
      process.exit(0);
    });
  }

  bootstrapAuth(db, {
    authEnabled,
    authUsername: process.env.AUTH_USERNAME,
    authPasswordHash: process.env.AUTH_PASSWORD_HASH,
  });

  const envPort = process.env.API_PORT ? Number(process.env.API_PORT) : undefined;

  // The interactive port prompt + running menu (open browser / change port /
  // clear app data / exit) only makes sense for someone who just double-
  // clicked or ran a downloaded standalone binary at a real terminal — never
  // for `bun run dev` or the Docker image (both !isStandaloneBinary), never
  // when stdin isn't a TTY (piped input, a service manager, CI) since
  // there'd be nothing to read prompts from, and never with --daemon (an
  // explicit request for a plain headless run despite having a terminal —
  // e.g. launching it under a process manager that does attach a TTY). An
  // explicit --port or API_PORT (e.g. from the CLI's own "change port"
  // self-relaunch, see cli/interactiveCli.ts) skips *asking* for a port but
  // still shows the running menu — it's still an interactive session.
  if (isStandaloneBinary && process.stdin.isTTY && !cliArgs.daemon) {
    await runInteractiveCli({
      dataDir: defaultDataDir(),
      db,
      listen: (port) => buildAndListen(db, authEnabled, port),
      initialPort: cliArgs.port ?? envPort,
      flushNow: safeFinalFlush,
    });
    return;
  }

  const port = cliArgs.port ?? envPort ?? (isStandaloneBinary ? (readLastUsedPort(defaultDataDir()) ?? 3000) : 3000);
  await buildAndListen(db, authEnabled, port);
  // Keeps a daemon-mode or scripted run's port choice in sync with what the
  // interactive wizard would show as next time's default — same reasoning
  // as the wizard persisting it after a successful listen, just without a
  // prompt in the way. Docker/dev never reach here with isStandaloneBinary
  // true, so this never touches either of those.
  if (isStandaloneBinary) {
    saveLastUsedPort(defaultDataDir(), port);
  }
}

main().catch((err) => {
  console.error("Failed to start API server:", err);
  process.exit(1);
});
