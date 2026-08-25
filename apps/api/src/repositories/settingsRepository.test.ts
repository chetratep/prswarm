import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDatabase, type AppDatabase } from "../db.js";
import { deleteSettingValue, getSettingValue, setSettingValue } from "./settingsRepository.js";

let dbPath: string;
let db: AppDatabase | undefined;

afterEach(() => {
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
  dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "prswarm-settings-test-")), "test.db");
  db = openDatabase(dbPath);
  return db;
}

describe("settingsRepository", () => {
  it("returns null for a key that was never set", () => {
    const database = freshDb();
    expect(getSettingValue(database, "nope")).toBeNull();
  });

  it("round-trips a set value", () => {
    const database = freshDb();
    setSettingValue(database, "slackWebhookUrl", "https://hooks.slack.com/services/x");
    expect(getSettingValue(database, "slackWebhookUrl")).toBe("https://hooks.slack.com/services/x");
  });

  it("overwrites a previously set value rather than erroring on the duplicate key", () => {
    const database = freshDb();
    setSettingValue(database, "slackWebhookUrl", "https://hooks.slack.com/services/first");
    setSettingValue(database, "slackWebhookUrl", "https://hooks.slack.com/services/second");
    expect(getSettingValue(database, "slackWebhookUrl")).toBe("https://hooks.slack.com/services/second");
  });

  it("delete removes the value, and is a no-op if it was never set", () => {
    const database = freshDb();
    setSettingValue(database, "slackWebhookUrl", "https://hooks.slack.com/services/x");
    deleteSettingValue(database, "slackWebhookUrl");
    expect(getSettingValue(database, "slackWebhookUrl")).toBeNull();
    expect(() => deleteSettingValue(database, "slackWebhookUrl")).not.toThrow();
  });

  it("keys are independent of each other", () => {
    const database = freshDb();
    setSettingValue(database, "a", "1");
    setSettingValue(database, "b", "2");
    expect(getSettingValue(database, "a")).toBe("1");
    expect(getSettingValue(database, "b")).toBe("2");
  });
});
