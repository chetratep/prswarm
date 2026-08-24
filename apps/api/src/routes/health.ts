import type { FastifyInstance } from "fastify";
import type { HealthResponse } from "@prdispatch/shared-types";

export async function registerHealthRoutes(app: FastifyInstance): Promise<void> {
  // No auth required — see the onRequest hook in src/auth/session.ts, which
  // always exempts GET /api/health.
  app.get("/health", async (): Promise<HealthResponse> => {
    return { status: "ok" };
  });
}
