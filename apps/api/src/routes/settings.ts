// Admin-only instance settings — currently just the Slack webhook URL (see
// notifications/slack.ts). "Admin" here includes the LOCAL_SENTINEL_USER
// (role "admin") when AUTH_ENABLED is off, so this works the same way in
// both single-instance and multi-user deployments — same gating pattern as
// routes/users.ts.
import type { FastifyInstance } from "fastify";
import type { SettingsResponse, UpdateSettingsRequest } from "@prswarm/shared-types";
import type { AppDatabase } from "../db.js";
import { resolveCurrentUser } from "../auth/currentUser.js";
import {
  resolveSlackWebhookUrl,
  SLACK_WEBHOOK_URL_SETTING_KEY,
} from "../notifications/slack.js";
import { deleteSettingValue, setSettingValue } from "../repositories/settingsRepository.js";

export interface SettingsRouteOptions {
  db: AppDatabase;
}

function currentSettings(db: AppDatabase): SettingsResponse {
  const { url, source } = resolveSlackWebhookUrl(db);
  return { slackWebhookUrl: url, slackWebhookUrlSource: source };
}

export async function registerSettingsRoutes(app: FastifyInstance, opts: SettingsRouteOptions): Promise<void> {
  const { db } = opts;

  app.get("/settings", async (request, reply): Promise<SettingsResponse | { error: string }> => {
    const currentUser = resolveCurrentUser(request);
    if (currentUser.role !== "admin") {
      return reply.code(403).send({ error: "Admin only" });
    }
    return currentSettings(db);
  });

  app.post<{ Body: UpdateSettingsRequest }>("/settings", async (request, reply) => {
    const currentUser = resolveCurrentUser(request);
    if (currentUser.role !== "admin") {
      return reply.code(403).send({ error: "Admin only" });
    }

    if (process.env.SLACK_WEBHOOK_URL) {
      return reply.code(400).send({
        error:
          "SLACK_WEBHOOK_URL is set via environment variable on this server and takes precedence — unset it there to configure this here instead.",
      });
    }

    const value = request.body?.slackWebhookUrl;
    if (value === null || value === "") {
      deleteSettingValue(db, SLACK_WEBHOOK_URL_SETTING_KEY);
    } else if (typeof value === "string") {
      if (!value.startsWith("https://")) {
        return reply.code(400).send({ error: "That doesn't look like a URL — expected it to start with https://." });
      }
      setSettingValue(db, SLACK_WEBHOOK_URL_SETTING_KEY, value);
    }

    return currentSettings(db);
  });
}
