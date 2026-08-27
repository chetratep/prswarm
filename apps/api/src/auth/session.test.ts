import { describe, expect, it } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { registerSession } from "./session.js";

// Exercises the cookie session mechanism that replaced @fastify/secure-session
// (see the comment at the top of session.ts for why: sodium-native's native
// addon can't be embedded by `bun build --compile`, so every release binary
// crashed on startup). These tests cover exactly what that swap needs to
// preserve: set/get round-trips through an encrypted cookie, tampering is
// rejected rather than trusted, and logout actually clears the session.
//
// Deliberately probes session state through routes registered at "/api/session"
// (public, per registerSession's own allowlist) rather than through a
// protected route's 401 response: reply.code(401).send() called from inside
// an onRequest hook and observed via app.inject() triggers an unrelated,
// pre-existing Bun 1.3.14 + Fastify 5.12 + light-my-request interaction bug
// in this environment (reproduced with a bare Fastify app, no session code
// at all — an onRequest hook calling reply.send() intermittently throws
// "Cannot writeHead headers after they are sent" from Fastify's error
// handler after the response has already gone out). Reading session state
// back through a 200-returning route sidesteps it while still exercising
// the exact encrypt/decrypt/cookie logic these tests are meant to cover.
async function buildTestApp(opts: { authEnabled: boolean; sessionSecret?: string }): Promise<FastifyInstance> {
  const app = Fastify();
  await registerSession(app, { authEnabled: opts.authEnabled, sessionSecret: opts.sessionSecret });

  // Reuses the real public-route paths (login/session/logout) so these hit
  // the exact same allowlist branch production login/logout/session do.
  app.post("/api/login", async (request) => {
    request.session.set("userId", "user-1");
    request.session.set("role", "admin");
    return { ok: true };
  });
  app.get("/api/session", async (request) => ({
    userId: request.session.get("userId"),
    role: request.session.get("role"),
  }));
  app.post("/api/logout", async (request) => {
    request.session.delete();
    return { ok: true };
  });
  app.get("/api/whoami", async (request) => ({
    userId: request.currentUser?.userId,
    role: request.currentUser?.role,
  }));

  await app.ready();
  return app;
}

function getCookie(response: { headers: Record<string, unknown> }): string {
  const raw = response.headers["set-cookie"];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== "string") throw new Error("expected a set-cookie header");
  return value.split(";")[0]!; // "session=<value>"
}

describe("cookie session (auth disabled)", () => {
  it("resolves every /api request to the local sentinel, no cookie needed", async () => {
    const app = await buildTestApp({ authEnabled: false });
    const response = await app.inject({ method: "GET", url: "/api/whoami" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ userId: "local", role: "admin" });
  });
});

describe("cookie session (auth enabled)", () => {
  it("throws at registration if SESSION_SECRET is missing", async () => {
    const app = Fastify();
    await expect(registerSession(app, { authEnabled: true, sessionSecret: undefined })).rejects.toThrow(
      /SESSION_SECRET/
    );
  });

  it("reports no session when no cookie is sent", async () => {
    const app = await buildTestApp({ authEnabled: true, sessionSecret: "test-secret" });
    const response = await app.inject({ method: "GET", url: "/api/session" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ userId: undefined, role: undefined });
  });

  it("round-trips userId/role through the encrypted cookie set by login", async () => {
    const app = await buildTestApp({ authEnabled: true, sessionSecret: "test-secret" });

    const loginResponse = await app.inject({ method: "POST", url: "/api/login" });
    expect(loginResponse.statusCode).toBe(200);
    const cookieHeader = getCookie(loginResponse);
    expect(cookieHeader.startsWith("session=")).toBe(true);

    const rawSetCookie = loginResponse.headers["set-cookie"];
    const fullCookieLine = Array.isArray(rawSetCookie) ? rawSetCookie[0]! : (rawSetCookie as string);
    expect(fullCookieLine).toMatch(/HttpOnly/i);
    expect(fullCookieLine).toMatch(/SameSite=Lax/i);

    const sessionResponse = await app.inject({
      method: "GET",
      url: "/api/session",
      headers: { cookie: cookieHeader },
    });
    expect(sessionResponse.statusCode).toBe(200);
    expect(sessionResponse.json()).toEqual({ userId: "user-1", role: "admin" });

    // Also confirm the currentUser-resolving gate accepts the same cookie on
    // a genuinely protected route (success path only — see file header for
    // why the 401 path isn't asserted here).
    const whoamiResponse = await app.inject({
      method: "GET",
      url: "/api/whoami",
      headers: { cookie: cookieHeader },
    });
    expect(whoamiResponse.statusCode).toBe(200);
    expect(whoamiResponse.json()).toEqual({ userId: "user-1", role: "admin" });
  });

  it("treats a tampered cookie as no session rather than trusting it", async () => {
    const app = await buildTestApp({ authEnabled: true, sessionSecret: "test-secret" });

    const loginResponse = await app.inject({ method: "POST", url: "/api/login" });
    const cookieHeader = getCookie(loginResponse);
    // Flip a byte in the middle of the decoded buffer, not a character in
    // the encoded string. Base64url's last character can carry encoding-
    // insignificant trailing bits (how many depends on total byte length
    // mod 3) that a lenient decoder ignores — flipping only the string's
    // last character landed there ~6% of the time (measured empirically),
    // silently decoding back to the *same* bytes and making this test flake
    // in CI. A mid-buffer byte flip is never insignificant.
    const value = cookieHeader.slice("session=".length);
    const raw = Buffer.from(value, "base64url");
    const mutated = Buffer.from(raw);
    const midIndex = Math.floor(mutated.length / 2);
    mutated[midIndex] = mutated[midIndex]! ^ 0xff;
    const tampered = `session=${mutated.toString("base64url")}`;

    const sessionResponse = await app.inject({
      method: "GET",
      url: "/api/session",
      headers: { cookie: tampered },
    });
    expect(sessionResponse.statusCode).toBe(200);
    expect(sessionResponse.json()).toEqual({ userId: undefined, role: undefined });
  });

  it("clears the session on logout", async () => {
    const app = await buildTestApp({ authEnabled: true, sessionSecret: "test-secret" });

    const loginResponse = await app.inject({ method: "POST", url: "/api/login" });
    const cookieHeader = getCookie(loginResponse);

    const logoutResponse = await app.inject({
      method: "POST",
      url: "/api/logout",
      headers: { cookie: cookieHeader },
    });
    expect(logoutResponse.statusCode).toBe(200);
    const clearedCookieLine = logoutResponse.headers["set-cookie"];
    const clearedLine = Array.isArray(clearedCookieLine) ? clearedCookieLine[0]! : (clearedCookieLine as string);
    expect(clearedLine).toMatch(/session=;/);
  });

  it("keeps two requests' sessions independent (no shared mutable state across requests)", async () => {
    const app = await buildTestApp({ authEnabled: true, sessionSecret: "test-secret" });

    const loginResponse = await app.inject({ method: "POST", url: "/api/login" });
    const cookieHeader = getCookie(loginResponse);

    const [a, b] = await Promise.all([
      app.inject({ method: "GET", url: "/api/session", headers: { cookie: cookieHeader } }),
      app.inject({ method: "GET", url: "/api/session" }),
    ]);
    expect(a.json()).toEqual({ userId: "user-1", role: "admin" });
    expect(b.json()).toEqual({ userId: undefined, role: undefined });
  });
});
