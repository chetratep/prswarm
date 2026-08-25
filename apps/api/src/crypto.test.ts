import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { decryptBuffer, encryptBuffer, __resetKeyCacheForTests } from "./crypto.js";

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
