import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Database } from "bun:sqlite";
import {
  assertEncryptionKeyAvailableFor,
  decryptBuffer,
  encryptBuffer,
  getEncryptionKey,
  __resetKeyCacheForTests,
} from "./crypto.js";
import type { getFromKeychain, setInKeychain } from "./keychain.js";

let tempDir: string;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "prswarm-crypto-test-"));
  process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("hex");
  __resetKeyCacheForTests();
});

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
  delete process.env.ENCRYPTION_KEY;
  __resetKeyCacheForTests();
});

describe("encryptBuffer / decryptBuffer", () => {
  it("round-trips arbitrary binary data, including bytes that are not valid UTF-8", () => {
    const original = Buffer.from([0x00, 0xff, 0x80, 0x01, 0xfe, 0x00, 0x00, 0x00]);
    const encrypted = encryptBuffer(original);
    const decrypted = decryptBuffer(encrypted);
    expect(decrypted.equals(original)).toBe(true);
  });

  it("round-trips a large buffer (1MB) without corruption", () => {
    const original = Buffer.alloc(1024 * 1024);
    for (let i = 0; i < original.length; i++) original[i] = i % 256;
    const decrypted = decryptBuffer(encryptBuffer(original));
    expect(decrypted.equals(original)).toBe(true);
  });

  it("produces ciphertext that does not contain the plaintext as a substring", () => {
    const original = Buffer.from("SQLite format 3\0some recognizable plaintext marker");
    const encrypted = encryptBuffer(original);
    expect(encrypted.includes(original)).toBe(false);
  });

  it("throws when decrypting with the wrong key", () => {
    const encrypted = encryptBuffer(Buffer.from("secret"));
    __resetKeyCacheForTests();
    process.env.ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("hex");
    expect(() => decryptBuffer(encrypted)).toThrow();
  });
});

describe("assertEncryptionKeyAvailableFor", () => {
  // Every case here pins its own dataDir and fake keychain, so nothing
  // depends on (or writes to) the real machine's keychain or data directory.
  function emptyKeychain(): { deps: { getFromKeychain: typeof getFromKeychain; setInKeychain: typeof setInKeychain }; setSpy: ReturnType<typeof vi.fn> } {
    const setSpy = vi.fn(() => true);
    return {
      deps: {
        getFromKeychain: (() => undefined) as typeof getFromKeychain,
        setInKeychain: setSpy as unknown as typeof setInKeychain,
      },
      setSpy,
    };
  }

  function writeEncryptedDatabaseFile(): string {
    const databasePath = path.join(tempDir, "app.db");
    // Any bytes that aren't SQLite's own header look exactly like this app's
    // encrypted format from the outside — which is the whole point: the file
    // is opaque without the key.
    fs.writeFileSync(databasePath, encryptBuffer(Buffer.from("SQLite format 3\0pretend database")));
    return databasePath;
  }

  it("refuses, without touching the keychain or writing a key file, when an encrypted database exists but no key can be found", () => {
    const databasePath = writeEncryptedDatabaseFile();

    delete process.env.ENCRYPTION_KEY;
    __resetKeyCacheForTests();
    const { deps, setSpy } = emptyKeychain();

    expect(() => assertEncryptionKeyAvailableFor(databasePath, { dataDir: tempDir, keychainDeps: deps })).toThrow(
      /encrypted database already exists/i
    );

    // The actual damage this guard prevents: a generated key being written
    // over the keychain entry (or into a key file) that the existing database
    // still depends on.
    expect(setSpy).not.toHaveBeenCalled();
    expect(fs.existsSync(path.join(tempDir, "encryption.key"))).toBe(false);
  });

  it("allows key generation on a fresh install, where no database file exists at all", () => {
    delete process.env.ENCRYPTION_KEY;
    __resetKeyCacheForTests();
    const { deps, setSpy } = emptyKeychain();

    expect(() =>
      assertEncryptionKeyAvailableFor(path.join(tempDir, "app.db"), { dataDir: tempDir, keychainDeps: deps })
    ).not.toThrow();
    // The guard itself never persists anything — it only decides whether the
    // caller is allowed to.
    expect(setSpy).not.toHaveBeenCalled();
  });

  it("allows key generation when the existing database is still legacy plaintext (the migration case)", () => {
    const databasePath = path.join(tempDir, "app.db");
    const legacyDb = new Database(databasePath);
    legacyDb.exec("CREATE TABLE legacy (y TEXT)");
    legacyDb.close();

    delete process.env.ENCRYPTION_KEY;
    __resetKeyCacheForTests();
    const { deps } = emptyKeychain();

    expect(() =>
      assertEncryptionKeyAvailableFor(databasePath, { dataDir: tempDir, keychainDeps: deps })
    ).not.toThrow();
  });

  it("accepts an encrypted database when the keychain does hold its key, and caches it", () => {
    const databasePath = writeEncryptedDatabaseFile();
    const storedKey = Buffer.alloc(32, 3);

    delete process.env.ENCRYPTION_KEY;
    __resetKeyCacheForTests();

    const deps = {
      getFromKeychain: (() => storedKey.toString("hex")) as typeof getFromKeychain,
      setInKeychain: (() => true) as typeof setInKeychain,
    };

    expect(() => assertEncryptionKeyAvailableFor(databasePath, { dataDir: tempDir, keychainDeps: deps })).not.toThrow();
    expect(getEncryptionKey().equals(storedKey)).toBe(true);
  });

  it("accepts an encrypted database when only a key file exists", () => {
    const databasePath = writeEncryptedDatabaseFile();
    const fileKey = Buffer.alloc(32, 6);
    fs.writeFileSync(path.join(tempDir, "encryption.key"), fileKey.toString("hex"), { mode: 0o600 });

    delete process.env.ENCRYPTION_KEY;
    __resetKeyCacheForTests();
    const { deps } = emptyKeychain();

    expect(() => assertEncryptionKeyAvailableFor(databasePath, { dataDir: tempDir, keychainDeps: deps })).not.toThrow();
    expect(getEncryptionKey().equals(fileKey)).toBe(true);
  });
});

describe("getEncryptionKey", () => {
  it("returns a 32-byte Buffer matching the configured key", () => {
    const key = getEncryptionKey();
    expect(key).toBeInstanceOf(Buffer);
    expect(key.length).toBe(32);
    // Test env sets ENCRYPTION_KEY to Buffer.alloc(32, 7).toString("hex")
    const expectedKey = Buffer.alloc(32, 7);
    expect(key.equals(expectedKey)).toBe(true);
  });

  it("reflects key cache resets when ENCRYPTION_KEY changes", () => {
    const key1 = getEncryptionKey();
    const expectedKey1 = Buffer.alloc(32, 7);
    expect(key1.equals(expectedKey1)).toBe(true);

    // Change the env var and reset the cache
    __resetKeyCacheForTests();
    process.env.ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("hex");

    const key2 = getEncryptionKey();
    const expectedKey2 = Buffer.alloc(32, 9);
    expect(key2.equals(expectedKey2)).toBe(true);
    // Confirm the keys are actually different
    expect(key1.equals(key2)).toBe(false);
  });
});
