// Best-effort Slack notification on job completion. Off by default — no-ops
// silently if SLACK_WEBHOOK_URL isn't set, since most self-hosted instances
// won't want this. Never throws: a broken/unreachable webhook must not take
// down job execution, so every failure here is caught and just logged.
const NOTIFY_TIMEOUT_MS = 5_000;

export async function notifySlack(message: string): Promise<void> {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;
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
