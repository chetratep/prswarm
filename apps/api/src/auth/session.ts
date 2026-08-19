// Registers @fastify/secure-session and the global auth gate hook.
//
// AUTH_ENABLED=true + no SESSION_SECRET => throw at startup (fail fast,
// never boot half-configured). AUTH_ENABLED=false => no session data is
// ever trusted or required — every /api request resolves to the fixed
// `local` sentinel, per the "off means off" stance.
//
// This hook is also the sole place responsible for resolving *who* is
// making the request (auth/currentUser.ts's resolveCurrentUser just reads
// what's decorated here) — it's the only place that actually knows
// AUTH_ENABLED, so it's the only place allowed to decide whether the
// sentinel applies. See the final whole-branch review's I3 finding: the
// old design let currentUser.ts infer "auth is off" from "the session is
// empty", which could resolve an incomplete session (userId set, role
// missing) to full admin. Now: authEnabled=false always sentinel;
// authEnabled=true requires BOTH userId AND role to be present in the
// session, or the request is rejected (401) — never falls through to the
// sentinel.
import crypto from "node:crypto";
import secureSession from "@fastify/secure-session";
import type { FastifyInstance } from "fastify";
import { LOCAL_SENTINEL_USER, type SessionUser } from "./currentUser.js";

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

  app.decorateRequest("currentUser", undefined);

  app.addHook("onRequest", async (request, reply) => {
    // Matched by raw pathname rather than Fastify's route-introspection APIs
    // (which have shifted across major versions) so this stays correct
    // regardless of exactly how routes are registered under the /api prefix.
    const pathname = request.url.split("?")[0];

    // Static assets (the built SPA shell, served outside /api in production —
    // see the @fastify/static registration in index.ts) are never gated.
    // They have to load *before* the client can even show a login form, so
    // blocking them here would make the app un-loadable rather than
    // login-gated. The data those assets can reach is still fully protected —
    // every /api/* call the SPA makes goes through this same hook. No route
    // handler here ever calls resolveCurrentUser, so no decoration needed.
    if (!pathname.startsWith("/api/")) return;

    if (!authEnabled) {
      // Auth is genuinely off — this IS the documented single-user mode,
      // not a fallback for an incomplete session. Every /api request
      // resolves to the same fixed sentinel; no session data is read or
      // required at all.
      request.currentUser = LOCAL_SENTINEL_USER;
      return;
    }

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

    const userId = request.session.get("userId") as string | undefined;
    const role = request.session.get("role") as SessionUser["role"] | undefined;
    if (!userId || !role) {
      // Auth is on, and the session is missing either key — reject
      // outright. Never fall through to the sentinel: that would grant
      // full admin to a malformed/incomplete session (see I3).
      return reply.code(401).send({ error: "Unauthorized" });
    }
    request.currentUser = { userId, role };
  });
}
