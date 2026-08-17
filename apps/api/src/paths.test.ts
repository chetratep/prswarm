import { afterEach, describe, expect, it } from "vitest";
import os from "node:os";
import path from "node:path";
import { defaultDataDir } from "./paths.js";

const originalPlatform = process.platform;
const originalXdgDataHome = process.env.XDG_DATA_HOME;
const originalAppData = process.env.APPDATA;

function setPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, "platform", { value: platform });
}

function restoreEnvVar(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}

afterEach(() => {
  setPlatform(originalPlatform);
  restoreEnvVar("XDG_DATA_HOME", originalXdgDataHome);
  restoreEnvVar("APPDATA", originalAppData);
});

describe("defaultDataDir", () => {
  it("uses XDG_DATA_HOME on linux when set", () => {
    setPlatform("linux");
    process.env.XDG_DATA_HOME = "/custom/data";
    expect(defaultDataDir()).toBe(path.join("/custom/data", "bulk-github-update-tool"));
  });

  it("falls back to ~/.local/share on linux when XDG_DATA_HOME is unset", () => {
    setPlatform("linux");
    delete process.env.XDG_DATA_HOME;
    expect(defaultDataDir()).toBe(
      path.join(os.homedir(), ".local", "share", "bulk-github-update-tool")
    );
  });

  it("uses Library/Application Support on macOS", () => {
    setPlatform("darwin");
    expect(defaultDataDir()).toBe(
      path.join(os.homedir(), "Library", "Application Support", "bulk-github-update-tool")
    );
  });

  it("uses APPDATA on Windows when set", () => {
    setPlatform("win32");
    process.env.APPDATA = "C:\\Users\\test\\AppData\\Roaming";
    expect(defaultDataDir()).toBe(
      path.join("C:\\Users\\test\\AppData\\Roaming", "bulk-github-update-tool")
    );
  });

  it("falls back to a homedir-derived path on Windows when APPDATA is unset", () => {
    setPlatform("win32");
    delete process.env.APPDATA;
    expect(defaultDataDir()).toBe(
      path.join(os.homedir(), "AppData", "Roaming", "bulk-github-update-tool")
    );
  });
});
