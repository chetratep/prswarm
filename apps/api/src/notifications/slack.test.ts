import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDatabase, type AppDatabase } from "../db.js";
import { setSettingValue } from "../repositories/settingsRepository.js";
import { resolveSlackWebhookUrl, SLACK_WEBHOOK_URL_SETTING_KEY } from "./slack.js";

let dbPath: string;
let db: AppDatabase | undefined;
const originalEnv = process.env.SLACK_WEBHOOK_URL;

beforeEach(() => {
  delete process.env.SLACK_WEBHOOK_URL;
});

afterEach(() => {
  if (originalEnv === undefined) delete process.env.SLACK_WEBHOOK_URL;
  else process.env.SLACK_WEBHOOK_URL = originalEnv;
  if (db) {
    db.close();
    db = undefined;
  }
  if (dbPath && fs.existsSync(dbPath)) {
    try {
      fs.rmSync(dbPath);
    } catch {
      // File may still be locked by Bun's sqlite; ignore cleanup errors
    }
  }
});

function freshDb(): AppDatabase {
  dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "prswarm-slack-test-")), "test.db");
  db = openDatabase(dbPath);
  return db;
}

describe("resolveSlackWebhookUrl", () => {
  it("returns null/null when nothing is configured anywhere", () => {
    const database = freshDb();
    expect(resolveSlackWebhookUrl(database)).toEqual({ url: null, source: null });
  });

  it("falls back to the DB-stored value when the env var isn't set", () => {
    const database = freshDb();
    setSettingValue(database, SLACK_WEBHOOK_URL_SETTING_KEY, "https://hooks.slack.com/services/db-value");
    expect(resolveSlackWebhookUrl(database)).toEqual({
      url: "https://hooks.slack.com/services/db-value",
      source: "db",
    });
  });

  it("the env var wins over a DB-stored value when both are set", () => {
    const database = freshDb();
    setSettingValue(database, SLACK_WEBHOOK_URL_SETTING_KEY, "https://hooks.slack.com/services/db-value");
    process.env.SLACK_WEBHOOK_URL = "https://hooks.slack.com/services/env-value";
    expect(resolveSlackWebhookUrl(database)).toEqual({
      url: "https://hooks.slack.com/services/env-value",
      source: "env",
    });
  });

  it("reports source env even if the DB has nothing stored", () => {
    const database = freshDb();
    process.env.SLACK_WEBHOOK_URL = "https://hooks.slack.com/services/env-only";
    expect(resolveSlackWebhookUrl(database)).toEqual({
      url: "https://hooks.slack.com/services/env-only",
      source: "env",
    });
  });
});
