// Login/signup/logout/session-status routes. Login and signup share the
// same in-memory IP rate limiter (5 failed attempts / rolling 15 minutes)
// used for login attempts specifically — signup itself isn't rate-limited
// beyond the normal Fastify request handling, since a failed signup
// (username taken) isn't a credential-guessing vector.
import bcrypt from "bcryptjs";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type {
  LoginRequest,
  SessionStatus,
  SignupRequest,
  SignupResponse,
} from "@bulk-github-update-tool/shared-types";
import type { AppDatabase } from "../db.js";
import { getUserById, getUserRowByUsername, insertUser } from "../repositories/usersRepository.js";

const MAX_FAILED_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000;
const BCRYPT_ROUNDS = 10;

interface AttemptRecord {
  count: number;
  windowStart: number;
}

// Single-process — an in-memory map is sufficient and avoids standing up
// any additional storage for this.
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

const signupBodySchema = z.object({
  username: z.string().min(1),
  password: z.string().min(8),
});

export interface AuthRouteOptions {
  authEnabled: boolean;
  db: AppDatabase;
}

export async function registerAuthRoutes(app: FastifyInstance, opts: AuthRouteOptions): Promise<void> {
  const { authEnabled, db } = opts;

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

    if (!authEnabled) {
      // Login is being called on an instance that hasn't enabled instance
      // auth — never treat this as a valid credential.
      recordFailedAttempt(ip);
      return reply.code(401).send({ error: "Invalid credentials" });
    }

    const userRow = getUserRowByUsername(db, username);
    const passwordMatches = userRow ? await bcrypt.compare(password, userRow.password_hash) : false;

    if (!userRow || !passwordMatches) {
      recordFailedAttempt(ip);
      return reply.code(401).send({ error: "Invalid credentials" });
    }

    request.session.set("userId", userRow.id);
    request.session.set("role", userRow.role);
    return { ok: true };
  });

  app.post<{ Body: SignupRequest }>("/signup", async (request, reply) => {
    if (!authEnabled) {
      return reply.code(400).send({ error: "Instance login is not enabled on this server." });
    }

    const parsed = signupBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "username and password (min 8 characters) are required" });
    }
    const { username, password } = parsed.data;

    if (getUserRowByUsername(db, username)) {
      return reply.code(409).send({ error: "That username is already taken." });
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const user = insertUser(db, { username, passwordHash, role: "member" });

    request.session.set("userId", user.id);
    request.session.set("role", user.role);

    const response: SignupResponse = { user };
    return response;
  });

  app.post("/logout", async (request) => {
    request.session.delete();
    return { ok: true };
  });

  app.get("/session", async (request): Promise<SessionStatus> => {
    if (!authEnabled) {
      return { authRequired: false, authenticated: true, username: null, role: null };
    }

    const userId = request.session.get("userId") as string | undefined;
    if (!userId) {
      return { authRequired: true, authenticated: false, username: null, role: null };
    }

    // The session refers to a user that no longer exists — treat as
    // logged out rather than trusting stale session data.
    const user = getUserById(db, userId);
    if (!user) {
      return { authRequired: true, authenticated: false, username: null, role: null };
    }

    return { authRequired: true, authenticated: true, username: user.username, role: user.role };
  });
}
