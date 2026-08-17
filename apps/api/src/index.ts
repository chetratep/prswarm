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
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { registerSession } from "./auth/session.js";
import { assertEncryptionKeyConfigured } from "./crypto.js";
import { openDatabase } from "./db.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerChangesetsRoutes } from "./routes/changesets.js";
import { registerConnectionsRoutes } from "./routes/connections.js";
import { registerFetchContentRoutes } from "./routes/fetchContent.js";
import { registerGithubRoutes } from "./routes/github.js";
import { registerHealthRoutes } from "./routes/health.js";
import { registerJobsRoutes } from "./routes/jobs.js";

// apps/api/src (dev, via tsx) and apps/api/dist (after build) sit at the
// same depth below the repo root, so the same relative path resolves env
// correctly in both cases: src|dist -> api -> apps -> repo root.
const repoRoot = path.resolve(import.meta.dirname, "../../..");

dotenv.config({ path: path.resolve(repoRoot, ".env") });

async function main(): Promise<void> {
  const authEnabled = process.env.AUTH_ENABLED === "true";

  // Fail fast: an app that stores encrypted secrets should never boot with a
  // missing/malformed encryption key, even before any connection exists.
  assertEncryptionKeyConfigured();

  const port = process.env.PORT ? Number(process.env.PORT) : 3000;
  const databasePath = path.resolve(repoRoot, process.env.DATABASE_PATH ?? "./data/app.db");

  const db = openDatabase(databasePath);

  const app = Fastify({ logger: true });

  await registerSession(app, {
    authEnabled,
    sessionSecret: process.env.SESSION_SECRET,
  });

  await app.register(
    async (apiScope) => {
      await registerHealthRoutes(apiScope);
      await registerAuthRoutes(apiScope, {
        authEnabled,
        authUsername: process.env.AUTH_USERNAME,
        authPasswordHash: process.env.AUTH_PASSWORD_HASH,
      });
      await registerConnectionsRoutes(apiScope, { db });
      await registerGithubRoutes(apiScope, { db });
      await registerChangesetsRoutes(apiScope, { db });
      await registerJobsRoutes(apiScope, { db });
      await registerFetchContentRoutes(apiScope);
    },
    { prefix: "/api" }
  );

  // Serve the built frontend (apps/web/dist) as static files, so the Docker
  // image is genuinely one process to run — no separate web server/container.
  // Only when it actually exists: in local dev, the frontend runs under its
  // own Vite dev server (proxying /api here) and this directory is never
  // built, so skip registering rather than fail startup over a missing dir.
  const publicDir = path.resolve(import.meta.dirname, "../public");
  if (fs.existsSync(publicDir)) {
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
  }

  await app.listen({ port, host: "0.0.0.0" });
  app.log.info(`API listening on port ${port}`);
}

main().catch((err) => {
  console.error("Failed to start API server:", err);
  process.exit(1);
});
