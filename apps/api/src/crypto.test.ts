import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { decryptBuffer, encryptBuffer, getEncryptionKey, __resetKeyCacheForTests } from "./crypto.js";

beforeEach(() => {
  process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("hex");
  __resetKeyCacheForTests();
});

afterEach(() => {
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
