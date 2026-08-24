import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readLastUsedPort, saveLastUsedPort } from "./cliConfig.js";

let tempDir: string;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "prswarm-cli-config-test-"));
});

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("readLastUsedPort", () => {
  it("returns null when nothing was ever saved", () => {
    expect(readLastUsedPort(tempDir)).toBeNull();
  });

  it("returns null for a malformed config file rather than throwing", () => {
    fs.mkdirSync(tempDir, { recursive: true });
    fs.writeFileSync(path.join(tempDir, "cli-config.json"), "not json");
    expect(readLastUsedPort(tempDir)).toBeNull();
  });

  it("returns null when the saved value isn't an integer", () => {
    fs.mkdirSync(tempDir, { recursive: true });
    fs.writeFileSync(path.join(tempDir, "cli-config.json"), JSON.stringify({ port: "3000" }));
    expect(readLastUsedPort(tempDir)).toBeNull();
  });

  it("round-trips a saved port", () => {
    saveLastUsedPort(tempDir, 4200);
    expect(readLastUsedPort(tempDir)).toBe(4200);
  });

  it("overwrites a previously saved port", () => {
    saveLastUsedPort(tempDir, 4200);
    saveLastUsedPort(tempDir, 8080);
    expect(readLastUsedPort(tempDir)).toBe(8080);
  });

  it("creates the data directory if it doesn't exist yet", () => {
    const nested = path.join(tempDir, "nested", "dir");
    saveLastUsedPort(nested, 5000);
    expect(readLastUsedPort(nested)).toBe(5000);
  });
});
