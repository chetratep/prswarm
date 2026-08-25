// Best-effort Slack notification on job completion. Off by default — no-ops
// silently if no webhook URL is configured, since most self-hosted instances
// won't want this. Never throws: a broken/unreachable webhook must not take
// down job execution, so every failure here is caught and just logged.
import type { AppDatabase } from "../db.js";
import { getSettingValue } from "../repositories/settingsRepository.js";

const NOTIFY_TIMEOUT_MS = 5_000;

export const SLACK_WEBHOOK_URL_SETTING_KEY = "slackWebhookUrl";

export type SlackWebhookUrlSource = "env" | "db" | null;

export interface ResolvedSlackWebhookUrl {
  url: string | null;
  source: SlackWebhookUrlSource;
}

/** SLACK_WEBHOOK_URL always wins when set — matches how every other env
 * var in this app overrides a persisted default (API_PORT vs the CLI's
 * remembered port, etc.) — and lets a scripted/Docker deployment configure
 * this without touching the database at all. Otherwise falls back to
 * whatever's stored via the CLI's "Configure Slack notifications" menu
 * option or the web UI's Settings page (routes/settings.ts) — both write
 * through the same settings table, so either one reflects what the other
 * set. */
export function resolveSlackWebhookUrl(db: AppDatabase): ResolvedSlackWebhookUrl {
  const envUrl = process.env.SLACK_WEBHOOK_URL;
  if (envUrl) {
    return { url: envUrl, source: "env" };
  }
  const dbUrl = getSettingValue(db, SLACK_WEBHOOK_URL_SETTING_KEY);
  return { url: dbUrl, source: dbUrl ? "db" : null };
}

export async function notifySlack(webhookUrl: string | null, message: string): Promise<void> {
  if (!webhookUrl) return;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), NOTIFY_TIMEOUT_MS);

  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: message }),
      signal: controller.signal,
    });
    if (!res.ok) {
      console.error(`notifySlack: webhook responded ${res.status} ${res.statusText}`);
    }
  } catch (err) {
    console.error("notifySlack: failed to post to Slack webhook:", err);
  } finally {
    clearTimeout(timeout);
  }
}
