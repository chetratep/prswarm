// Resolves who's making this request, for ownership/scoping checks
// throughout the app (which connection to use, whose jobs to show). When
// AUTH_ENABLED is off there's no session to read — every request resolves
// to the same fixed sentinel, matching this app's pre-multi-user behavior
// (one implicit user, sees and owns everything). This means the exact same
// scoping code runs whether auth is on or off; auth off just always
// resolves to an all-access user rather than needing a separate code path.
import type { FastifyRequest } from "fastify";
import type { UserRole } from "@bulk-github-update-tool/shared-types";

export interface SessionUser {
  userId: string;
  role: UserRole;
}

export const LOCAL_SENTINEL_USER: SessionUser = { userId: "local", role: "admin" };

export function resolveCurrentUser(request: FastifyRequest): SessionUser {
  const userId = request.session.get("userId") as string | undefined;
  const role = request.session.get("role") as UserRole | undefined;
  if (!userId || !role) {
    return LOCAL_SENTINEL_USER;
  }
  return { userId, role };
}
