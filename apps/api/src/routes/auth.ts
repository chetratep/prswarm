// Login/logout/session-status routes. Login has a simple in-memory
// rate limiter keyed by IP: after 5 failed attempts within a rolling
// 15-minute window, that IP is rejected with 429 for the rest of the
// window, even if it later supplies the correct password.
import bcrypt from "bcryptjs";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { LoginRequest, SessionStatus } from "@bulk-github-update-tool/shared-types";

const MAX_FAILED_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000;

interface AttemptRecord {
  count: number;
  windowStart: number;
}

// Single-process, single-user tool — an in-memory map is sufficient and
// avoids standing up any additional storage for this.
const attemptsByIp = new Map<string, AttemptRecord>();

function isRateLimited(ip: string): boolean {
  const record = attemptsByIp.get(ip);
  if (!record) return false;

  if (Date.now() - record.windowStart > WINDOW_MS) {
    attemptsByIp.delete(ip);
    return false;
  }

  return record.count >= MAX_FAILED_ATTEMPTS;
}

function recordFailedAttempt(ip: string): void {
  const now = Date.now();
  const record = attemptsByIp.get(ip);

  if (!record || now - record.windowStart > WINDOW_MS) {
    attemptsByIp.set(ip, { count: 1, windowStart: now });
    return;
  }

  record.count += 1;
}

const loginBodySchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

export interface AuthRouteOptions {
  authEnabled: boolean;
  authUsername: string | undefined;
  authPasswordHash: string | undefined;
}

export async function registerAuthRoutes(app: FastifyInstance, opts: AuthRouteOptions): Promise<void> {
  const { authEnabled, authUsername, authPasswordHash } = opts;

  app.post<{ Body: LoginRequest }>("/login", async (request, reply) => {
    const ip = request.ip;

    if (isRateLimited(ip)) {
      return reply.code(429).send({ error: "Too many failed login attempts. Try again later." });
    }

    const parsed = loginBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "username and password are required" });
    }
    const { username, password } = parsed.data;

    if (!authEnabled || !authUsername || !authPasswordHash) {
      // Login is being called on an instance that hasn't configured (or has
      // disabled) instance auth — never treat this as a valid credential.
      recordFailedAttempt(ip);
      return reply.code(401).send({ error: "Invalid credentials" });
    }

    const usernameMatches = username === authUsername;
    const passwordMatches = await bcrypt.compare(password, authPasswordHash);

    if (!usernameMatches || !passwordMatches) {
      recordFailedAttempt(ip);
      return reply.code(401).send({ error: "Invalid credentials" });
    }

    request.session.set("authenticated", true);
    return { ok: true };
  });

  app.post("/logout", async (request) => {
    request.session.delete();
    return { ok: true };
  });

  app.get("/session", async (request): Promise<SessionStatus> => {
    return {
      authRequired: authEnabled,
      authenticated: authEnabled ? request.session.get("authenticated") === true : true,
    };
  });
}
