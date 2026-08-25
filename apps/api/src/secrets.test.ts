import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveEncryptionKey } from "./secrets.js";
import { getFromKeychain, setInKeychain } from "./keychain.js";

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
  const unreachableKeychain = {
    getFromKeychain: (() => undefined) as typeof getFromKeychain,
    setInKeychain: (() => false) as typeof setInKeychain,
  };

  it("uses ENCRYPTION_KEY from the environment when set, and never touches dataDir", () => {
    process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("hex");
    const result = resolveEncryptionKey(tempDir, unreachableKeychain);
    expect(result.source).toBe("env");
    expect(result.key.length).toBe(32);
    expect(fs.existsSync(path.join(tempDir, "encryption.key"))).toBe(false);
  });

  it("generates and persists a key on first run when unset", () => {
    const result = resolveEncryptionKey(tempDir, unreachableKeychain);
    expect(result.source).toBe("generated");
    expect(result.key.length).toBe(32);
    expect(fs.existsSync(path.join(tempDir, "encryption.key"))).toBe(true);
  });

  it("reuses a previously-generated key on the next call", () => {
    const first = resolveEncryptionKey(tempDir, unreachableKeychain);
    const second = resolveEncryptionKey(tempDir, unreachableKeychain);
    expect(second.source).toBe("existing-file");
    expect(second.key.equals(first.key)).toBe(true);
  });

  it("throws a clear error if ENCRYPTION_KEY doesn't decode to 32 bytes", () => {
    process.env.ENCRYPTION_KEY = "too-short";
    expect(() => resolveEncryptionKey(tempDir, unreachableKeychain)).toThrow(/32 bytes/);
  });

  it("uses a keychain-stored key when the OS keychain has one and no env var is set", () => {
    const fakeStore = new Map<string, string>();
    const fakeGet = ((service: string, account: string) => fakeStore.get(`${service}/${account}`)) as typeof getFromKeychain;
    const fakeSet = ((service: string, account: string, value: string) => {
      fakeStore.set(`${service}/${account}`, value);
      return true;
    }) as typeof setInKeychain;

    fakeStore.set("prswarm/encryption-key", Buffer.alloc(32, 3).toString("hex"));

    const result = resolveEncryptionKey(tempDir, { getFromKeychain: fakeGet, setInKeychain: fakeSet });
    expect(result.source).toBe("keychain");
    expect(result.key.equals(Buffer.alloc(32, 3))).toBe(true);
    expect(fs.existsSync(path.join(tempDir, "encryption.key"))).toBe(false);
  });

  it("generates a key and persists it to the keychain when the keychain is reachable but empty", () => {
    const fakeStore = new Map<string, string>();
    const fakeGet = ((service: string, account: string) => fakeStore.get(`${service}/${account}`)) as typeof getFromKeychain;
    const fakeSet = ((service: string, account: string, value: string) => {
      fakeStore.set(`${service}/${account}`, value);
      return true;
    }) as typeof setInKeychain;

    const result = resolveEncryptionKey(tempDir, { getFromKeychain: fakeGet, setInKeychain: fakeSet });
    expect(result.source).toBe("generated-keychain");
    expect(fakeStore.get("prswarm/encryption-key")).toBe(result.key.toString("hex"));
    expect(fs.existsSync(path.join(tempDir, "encryption.key"))).toBe(false);
  });

  it("falls back to the file-based scheme when the keychain is unreachable (headless/Docker)", () => {
    const fakeGet = (() => undefined) as typeof getFromKeychain;
    const fakeSet = (() => false) as typeof setInKeychain;

    const result = resolveEncryptionKey(tempDir, { getFromKeychain: fakeGet, setInKeychain: fakeSet });
    expect(result.source).toBe("generated");
    expect(fs.existsSync(path.join(tempDir, "encryption.key"))).toBe(true);
  });

  it("prefers keychain over existing file when both are present", () => {
    const fakeStore = new Map<string, string>();
    const keychainKey = Buffer.alloc(32, 5).toString("hex");
    const fileKey = Buffer.alloc(32, 6).toString("hex");

    const fakeGet = ((service: string, account: string) => fakeStore.get(`${service}/${account}`)) as typeof getFromKeychain;
    const fakeSet = ((service: string, account: string, value: string) => {
      fakeStore.set(`${service}/${account}`, value);
      return true;
    }) as typeof setInKeychain;

    // Pre-populate both keychain and file with different keys
    fakeStore.set("prswarm/encryption-key", keychainKey);
    fs.mkdirSync(tempDir, { recursive: true });
    fs.writeFileSync(path.join(tempDir, "encryption.key"), fileKey, { mode: 0o600 });

    const result = resolveEncryptionKey(tempDir, { getFromKeychain: fakeGet, setInKeychain: fakeSet });
    expect(result.source).toBe("keychain");
    expect(result.key.equals(Buffer.from(keychainKey, "hex"))).toBe(true);
    expect(result.key.equals(Buffer.from(fileKey, "hex"))).toBe(false);
  });

  it("prefers env var over keychain when both are present", () => {
    const fakeStore = new Map<string, string>();
    const envKey = Buffer.alloc(32, 9).toString("hex");
    const keychainKey = Buffer.alloc(32, 8).toString("hex");

    const fakeGet = ((service: string, account: string) => fakeStore.get(`${service}/${account}`)) as typeof getFromKeychain;
    const fakeSet = ((service: string, account: string, value: string) => {
      fakeStore.set(`${service}/${account}`, value);
      return true;
    }) as typeof setInKeychain;

    // Pre-populate env var and keychain with different keys
    process.env.ENCRYPTION_KEY = envKey;
    fakeStore.set("prswarm/encryption-key", keychainKey);

    const result = resolveEncryptionKey(tempDir, { getFromKeychain: fakeGet, setInKeychain: fakeSet });
    expect(result.source).toBe("env");
    expect(result.key.equals(Buffer.from(envKey, "hex"))).toBe(true);
    expect(result.key.equals(Buffer.from(keychainKey, "hex"))).toBe(false);
  });
});
