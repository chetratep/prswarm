// Registers @fastify/secure-session and the global auth gate hook.
//
// AUTH_ENABLED=true + no SESSION_SECRET => throw at startup (fail fast,
// never boot half-configured). AUTH_ENABLED=false => the onRequest hook is a
// no-op; no auth code path runs at all, per the "off means off" stance.
import crypto from "node:crypto";
import secureSession from "@fastify/secure-session";
import type { FastifyInstance } from "fastify";

export interface SessionOptions {
  authEnabled: boolean;
  sessionSecret: string | undefined;
}

export async function registerSession(app: FastifyInstance, opts: SessionOptions): Promise<void> {
  const { authEnabled, sessionSecret } = opts;

  if (authEnabled && (!sessionSecret || sessionSecret.trim().length === 0)) {
    throw new Error(
      "AUTH_ENABLED is true but SESSION_SECRET is not set. Set SESSION_SECRET " +
        "in your .env to a long random string before enabling instance login."
    );
  }

  // The secure-session plugin always needs a 32-byte key to boot, even when
  // auth is disabled. When auth is off no session data is ever trusted, so an
  // ephemeral random key (regenerated per process start) is fine there.
  const keySource =
    sessionSecret && sessionSecret.trim().length > 0
      ? sessionSecret
      : crypto.randomBytes(32).toString("hex");
  const key = crypto.createHash("sha256").update(keySource).digest();

  await app.register(secureSession, {
    key,
    cookieName: "session",
    cookie: {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    },
  });

  app.addHook("onRequest", async (request, reply) => {
    if (!authEnabled) return;

    // Matched by raw pathname rather than Fastify's route-introspection APIs
    // (which have shifted across major versions) so this stays correct
    // regardless of exactly how routes are registered under the /api prefix.
    const pathname = request.url.split("?")[0];

    // Static assets (the built SPA shell, served outside /api in production —
    // see the @fastify/static registration in index.ts) are never gated.
    // They have to load *before* the client can even show a login form, so
    // blocking them here would make the app un-loadable rather than
    // login-gated. The data those assets can reach is still fully protected —
    // every /api/* call the SPA makes goes through this same hook.
    if (!pathname.startsWith("/api/")) return;

    // GET /api/session must stay public even though it reports auth state:
    // it's how the frontend discovers "you need to log in" in the first
    // place. Gating it would make it 401 for every logged-out visitor, so
    // the client could never distinguish "not logged in" from "server
    // unreachable" — the exact bug this comment is here to prevent regressing.
    const isPublicRoute =
      (request.method === "POST" && pathname === "/api/login") ||
      (request.method === "POST" && pathname === "/api/signup") ||
      (request.method === "GET" && pathname === "/api/health") ||
      (request.method === "GET" && pathname === "/api/session");

    if (isPublicRoute) return;

    if (!request.session.get("userId")) {
      return reply.code(401).send({ error: "Unauthorized" });
    }
  });
}
