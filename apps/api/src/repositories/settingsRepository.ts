// Data access for the `settings` key/value table (see db.ts's migration).
// Deliberately generic — a plain get/set/delete by string key — since
// notifications/slack.ts (the one consumer today) is the layer that knows
// what any particular key means.
import type { AppDatabase } from "../db.js";

interface SettingRow {
  value: string;
}

export function getSettingValue(db: AppDatabase, key: string): string | null {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as SettingRow | null;
  return row?.value ?? null;
}

export function setSettingValue(db: AppDatabase, key: string, value: string): void {
  db.prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  ).run(key, value);
}

export function deleteSettingValue(db: AppDatabase, key: string): void {
  db.prepare("DELETE FROM settings WHERE key = ?").run(key);
}
