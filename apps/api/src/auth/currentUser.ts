// Reads who's making this request, for ownership/scoping checks throughout
// the app (which connection to use, whose jobs to show).
//
// Resolution itself happens in auth/session.ts's onRequest hook — that's
// the one place that actually knows AUTH_ENABLED, so it's the one place
// allowed to decide whether a request resolves to a real session user or
// the `local` sentinel (LOCAL_SENTINEL_USER below). This function used to
// make that call itself, inferring "auth is off" from "the session is
// empty" — which meant a session with userId set but role missing (a
// malformed or pre-plan-format session shape) could resolve to full admin
// instead of being rejected. That inference is gone: this is now a pure
// read of whatever the hook already decided, so the sentinel is reachable
// if and only if AUTH_ENABLED is genuinely false (see the final
// whole-branch review's I3 finding).
import type { FastifyRequest } from "fastify";
import type { UserRole } from "@bulk-github-update-tool/shared-types";

export interface SessionUser {
  userId: string;
  role: UserRole;
}

export const LOCAL_SENTINEL_USER: SessionUser = { userId: "local", role: "admin" };

export function resolveCurrentUser(request: FastifyRequest): SessionUser {
  if (!request.currentUser) {
    // Every route that needs the current user lives under /api and runs
    // behind auth/session.ts's onRequest hook, which always sets
    // request.currentUser before the handler runs — except for the small,
    // explicit set of public routes (login/signup/session/health), none of
    // which call this function. Reaching here means either a bug (a new
    // route calling resolveCurrentUser was added to that public-route
    // exemption list) or a test constructed a bare request without going
    // through the hook. Fail loudly rather than silently granting the
    // admin sentinel — the exact failure mode this function used to have.
    throw new Error(
      "resolveCurrentUser() called on a request with no resolved session user. " +
        "This route must run behind auth/session.ts's onRequest hook and must not be " +
        "one of its public-route exemptions."
    );
  }
  return request.currentUser;
}
