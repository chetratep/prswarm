// Registers the cookie session plugin and the global auth gate hook.
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
//
// Session storage is a hand-rolled AES-256-GCM-encrypted cookie (same
// algorithm as crypto.ts's at-rest encryption, kept independent since it
// uses its own SESSION_SECRET-derived key rather than the app's database
// encryption key) built on @fastify/cookie for parsing/serialization only.
// This used to be @fastify/secure-session, which pulls in sodium-native — a
// native N-API addon whose prebuilt .node binary is resolved via a
// dynamically computed path at runtime, invisible to Bun's bundler. That
// meant `bun build --compile` never embedded it into the standalone
// executable: every downloaded release binary crashed on startup with
// "Cannot find addon", referencing the CI build machine's now-nonexistent
// node_modules path, regardless of target platform or architecture
// (confirmed by reproducing the linux-x64 binary — same arch as the CI
// build host — inside a matching container: still failed, `candidates: []`).
// @fastify/cookie has no native dependencies, so this is safe to bundle.
import crypto from "node:crypto";
import cookie from "@fastify/cookie";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { LOCAL_SENTINEL_USER, type SessionUser } from "./currentUser.js";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH_BYTES = 12;
const AUTH_TAG_LENGTH_BYTES = 16;
const COOKIE_NAME = "session";

export interface SessionOptions {
  authEnabled: boolean;
  sessionSecret: string | undefined;
}

interface SessionData {
  userId?: string;
  role?: SessionUser["role"];
}

export interface Session {
  get<K extends keyof SessionData>(key: K): SessionData[K];
  set<K extends keyof SessionData>(key: K, value: NonNullable<SessionData[K]>): void;
  delete(): void;
}

interface SessionInternal {
  data: SessionData;
  dirty: boolean;
  cleared: boolean;
}

// Kept module-private (not a Fastify decoration) so it never needs a public
// type surface beyond the `Session` interface requests actually see —
// entries are dropped automatically once a request is garbage collected.
const internalState = new WeakMap<FastifyRequest, SessionInternal>();

function encryptSession(key: Buffer, data: SessionData): string {
  const iv = crypto.randomBytes(IV_LENGTH_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(data), "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]).toString("base64url");
}

function decryptSession(key: Buffer, value: string): SessionData {
  try {
    const raw = Buffer.from(value, "base64url");
    const iv = raw.subarray(0, IV_LENGTH_BYTES);
    const authTag = raw.subarray(IV_LENGTH_BYTES, IV_LENGTH_BYTES + AUTH_TAG_LENGTH_BYTES);
    const encrypted = raw.subarray(IV_LENGTH_BYTES + AUTH_TAG_LENGTH_BYTES);
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    const json = Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
    const parsed: unknown = JSON.parse(json);
    return parsed && typeof parsed === "object" ? (parsed as SessionData) : {};
  } catch {
    // Missing key, tampered/corrupted cookie, or a cookie encrypted under a
    // since-rotated SESSION_SECRET — all treated as "no session", never as
    // a thrown error, since an untrusted cookie must never crash a request.
    return {};
  }
}

export async function registerSession(app: FastifyInstance, opts: SessionOptions): Promise<void> {
  const { authEnabled, sessionSecret } = opts;

  if (authEnabled && (!sessionSecret || sessionSecret.trim().length === 0)) {
    throw new Error(
      "AUTH_ENABLED is true but SESSION_SECRET is not set. Set SESSION_SECRET " +
        "in your .env to a long random string before enabling instance login."
    );
  }

  // A 32-byte key is always needed to boot, even when auth is disabled. When
  // auth is off no session data is ever trusted, so an ephemeral random key
  // (regenerated per process start) is fine there.
  const keySource =
    sessionSecret && sessionSecret.trim().length > 0
      ? sessionSecret
      : crypto.randomBytes(32).toString("hex");
  const key = crypto.createHash("sha256").update(keySource).digest();

  await app.register(cookie);

  const cookiePath = "/";
  const cookieOptions = {
    path: cookiePath,
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
  };

  // Cast placeholder: the real value is always set synchronously in the
  // onRequest hook below, before any handler can observe it — Fastify's
  // decorateRequest typing just needs something assignable to `Session` up
  // front to establish the hidden class shape.
  app.decorateRequest("session", undefined as unknown as Session);

  app.addHook("onRequest", async (request) => {
    const raw = request.cookies[COOKIE_NAME];
    const data = raw ? decryptSession(key, raw) : {};
    internalState.set(request, { data, dirty: false, cleared: false });

    request.session = {
      get: (k) => internalState.get(request)!.data[k],
      set: (k, v) => {
        const state = internalState.get(request)!;
        state.data = { ...state.data, [k]: v };
        state.dirty = true;
      },
      delete: () => {
        const state = internalState.get(request)!;
        state.data = {};
        state.cleared = true;
      },
    };
  });

  app.addHook("onSend", async (request, reply, payload) => {
    const state = internalState.get(request);
    if (!state) return payload;
    if (state.cleared) {
      reply.clearCookie(COOKIE_NAME, { path: cookiePath });
    } else if (state.dirty) {
      reply.setCookie(COOKIE_NAME, encryptSession(key, state.data), cookieOptions);
    }
    return payload;
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

    const userId = request.session.get("userId");
    const role = request.session.get("role");
    if (!userId || !role) {
      // Auth is on, and the session is missing either key — reject
      // outright. Never fall through to the sentinel: that would grant
      // full admin to a malformed/incomplete session (see I3).
      return reply.code(401).send({ error: "Unauthorized" });
    }
    request.currentUser = { userId, role };
  });
}
