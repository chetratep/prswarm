// Admin-only user management: list accounts, promote to admin, reset a
// password. Account *creation* is exclusively via POST /api/signup
// (routes/auth.ts) — there is deliberately no "admin creates a user"
// endpoint here, per the design spec's non-goals.
//
// POST /users/me/password below is the one non-admin-only route here:
// any authenticated user can change their own password. It requires the
// caller's current password (unlike the admin reset, which is a trusted
// override for a forgotten password) so that a hijacked session alone
// can't silently lock the real owner out.
import bcrypt from "bcryptjs";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type {
  ChangeOwnPasswordRequest,
  ListUsersResponse,
  ResetPasswordRequest,
} from "@bulk-github-update-tool/shared-types";
import type { AppDatabase } from "../db.js";
import { LOCAL_SENTINEL_USER, resolveCurrentUser } from "../auth/currentUser.js";
import {
  getUserRowById,
  listUsers,
  updateUserPasswordHash,
  updateUserRole,
} from "../repositories/usersRepository.js";

const BCRYPT_ROUNDS = 10;

const resetPasswordBodySchema = z.object({
  newPassword: z.string().min(8),
});

const changeOwnPasswordBodySchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8),
});

export interface UsersRouteOptions {
  db: AppDatabase;
}

export async function registerUsersRoutes(app: FastifyInstance, opts: UsersRouteOptions): Promise<void> {
  const { db } = opts;

  app.get("/users", async (request, reply): Promise<ListUsersResponse | { error: string }> => {
    const currentUser = resolveCurrentUser(request);
    if (currentUser.role !== "admin") {
      return reply.code(403).send({ error: "Admin only" });
    }
    return { users: listUsers(db) };
  });

  app.post<{ Params: { id: string } }>("/users/:id/promote", async (request, reply) => {
    const currentUser = resolveCurrentUser(request);
    if (currentUser.role !== "admin") {
      return reply.code(403).send({ error: "Admin only" });
    }
    const promoted = updateUserRole(db, request.params.id, "admin");
    return { user: promoted };
  });

  app.post<{ Params: { id: string }; Body: ResetPasswordRequest }>(
    "/users/:id/reset-password",
    async (request, reply) => {
      const currentUser = resolveCurrentUser(request);
      if (currentUser.role !== "admin") {
        return reply.code(403).send({ error: "Admin only" });
      }

      const parsed = resetPasswordBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "newPassword (min 8 characters) is required" });
      }

      const passwordHash = await bcrypt.hash(parsed.data.newPassword, BCRYPT_ROUNDS);
      updateUserPasswordHash(db, request.params.id, passwordHash);
      return { ok: true };
    }
  );

  app.post<{ Body: ChangeOwnPasswordRequest }>("/users/me/password", async (request, reply) => {
    const currentUser = resolveCurrentUser(request);
    if (currentUser.userId === LOCAL_SENTINEL_USER.userId) {
      return reply.code(400).send({ error: "Instance login is not enabled." });
    }

    const parsed = changeOwnPasswordBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "currentPassword and newPassword (min 8 characters) are required" });
    }

    const row = getUserRowById(db, currentUser.userId);
    if (!row) {
      return reply.code(404).send({ error: "User not found." });
    }

    const matches = await bcrypt.compare(parsed.data.currentPassword, row.password_hash);
    if (!matches) {
      return reply.code(401).send({ error: "Current password is incorrect." });
    }

    const passwordHash = await bcrypt.hash(parsed.data.newPassword, BCRYPT_ROUNDS);
    updateUserPasswordHash(db, currentUser.userId, passwordHash);
    return { ok: true };
  });
}
