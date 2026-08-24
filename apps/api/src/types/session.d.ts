import "@fastify/secure-session";
import type { UserRole } from "@prdispatch/shared-types";

declare module "@fastify/secure-session" {
  interface SessionData {
    /** @deprecated Pre-multi-user session key, replaced by userId/role.
     * Left declared only so any stray reference doesn't silently widen to
     * `any` — nothing should set this anymore. */
    authenticated: boolean;
    userId: string;
    role: UserRole;
  }
}
