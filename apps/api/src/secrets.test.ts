import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveEncryptionKey } from "./secrets.js";

let tempDir: string;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "bulk-tool-secrets-test-"));
  delete process.env.ENCRYPTION_KEY;
});

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
  delete process.env.ENCRYPTION_KEY;
});

describe("resolveEncryptionKey", () => {
  it("uses ENCRYPTION_KEY from the environment when set, and never touches dataDir", () => {
    process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("hex");
    const result = resolveEncryptionKey(tempDir);
    expect(result.source).toBe("env");
    expect(result.key.length).toBe(32);
    expect(fs.existsSync(path.join(tempDir, "encryption.key"))).toBe(false);
  });

  it("generates and persists a key on first run when unset", () => {
    const result = resolveEncryptionKey(tempDir);
    expect(result.source).toBe("generated");
    expect(result.key.length).toBe(32);
    expect(fs.existsSync(path.join(tempDir, "encryption.key"))).toBe(true);
  });

  it("reuses a previously-generated key on the next call", () => {
    const first = resolveEncryptionKey(tempDir);
    const second = resolveEncryptionKey(tempDir);
    expect(second.source).toBe("existing-file");
    expect(second.key.equals(first.key)).toBe(true);
  });

  it("throws a clear error if ENCRYPTION_KEY doesn't decode to 32 bytes", () => {
    process.env.ENCRYPTION_KEY = "too-short";
    expect(() => resolveEncryptionKey(tempDir)).toThrow(/32 bytes/);
  });
});
