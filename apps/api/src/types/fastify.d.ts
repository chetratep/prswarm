import "fastify";
import type { SessionUser } from "../auth/currentUser.js";

declare module "fastify" {
  interface FastifyRequest {
    /** Set exactly once per request by auth/session.ts's onRequest hook —
     * the sole place that knows AUTH_ENABLED and is responsible for
     * deciding whether a request resolves to a real session user or the
     * `local` sentinel. Undecorated (stays undefined) for the small set of
     * routes the hook itself exempts as public (login/signup/session/
     * health) — none of those call resolveCurrentUser. See
     * auth/currentUser.ts for how this is consumed. */
    currentUser?: SessionUser;
  }
}
