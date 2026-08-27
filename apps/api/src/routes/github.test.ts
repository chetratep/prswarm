import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import fastifyRateLimit from "@fastify/rate-limit";
import { RATE_LIMIT_CONFIG } from "./github.js";

// Exercises the exact plugin registration + per-route config used in
// index.ts and github.ts (global: false, opt-in per route, keyed off
// request.currentUser) against a minimal route, rather than re-testing
// @fastify/rate-limit's own internals or standing up the real GitHub-calling
// routes just to reach the same onRequest hook.
async function buildTestApp(): Promise<FastifyInstance> {
  const app = Fastify();
  app.decorateRequest("currentUser", undefined);
  app.addHook("onRequest", async (request) => {
    request.currentUser = { userId: request.headers["x-test-user"] as string, role: "member" };
  });
  await app.register(fastifyRateLimit, {
    global: false,
    keyGenerator: (request) => request.currentUser!.userId,
  });
  app.get("/protected", { config: RATE_LIMIT_CONFIG }, async () => ({ ok: true }));
  await app.ready();
  return app;
}

function injectAs(app: FastifyInstance, userId: string) {
  return app.inject({ method: "GET", url: "/protected", headers: { "x-test-user": userId } });
}

describe("rate limiting on the GitHub discovery routes", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await buildTestApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it("allows requests up to the configured limit", async () => {
    for (let i = 0; i < RATE_LIMIT_CONFIG.rateLimit.max; i++) {
      const res = await injectAs(app, "user-1");
      expect(res.statusCode).toBe(200);
    }
  });

  it("blocks the request once the limit is exceeded", async () => {
    for (let i = 0; i < RATE_LIMIT_CONFIG.rateLimit.max; i++) {
      await injectAs(app, "user-1");
    }
    const res = await injectAs(app, "user-1");
    expect(res.statusCode).toBe(429);
  });

  it("tracks each user independently, on the same shared limiter", async () => {
    for (let i = 0; i < RATE_LIMIT_CONFIG.rateLimit.max; i++) {
      await injectAs(app, "user-a");
    }
    const blocked = await injectAs(app, "user-a");
    expect(blocked.statusCode).toBe(429);

    const stillOk = await injectAs(app, "user-b");
    expect(stillOk.statusCode).toBe(200);
  });
});
