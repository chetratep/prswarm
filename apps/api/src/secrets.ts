// Resolves the AES key crypto.ts's encrypt/decrypt use. Precedence:
//   1. ENCRYPTION_KEY env var, if set (today's dev workflow via .env,
//      unchanged).
//   2. A previously-generated key file in dataDir.
//   3. Generate a new 32-byte key, persist it to dataDir, and use that —
//      so a curl-installed binary with no .env can still start.
// Kept separate from crypto.ts (which stays pure encrypt/decrypt logic) so
// this filesystem/env resolution can be unit-tested against a temp
// directory without touching the real one.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const KEY_FILE_NAME = "encryption.key";

export interface ResolvedEncryptionKey {
  key: Buffer;
  source: "env" | "existing-file" | "generated";
  filePath: string | null;
}

function decodeKey(raw: string, sourceDescription: string): Buffer {
  const key = /^[0-9a-fA-F]{64}$/.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error(
      `${sourceDescription} must decode to exactly 32 bytes (got ${key.length}). ` +
        "Use a 64-character hex string or a base64-encoded 32-byte value."
    );
  }
  return key;
}

export function resolveEncryptionKey(dataDir: string): ResolvedEncryptionKey {
  const envValue = process.env.ENCRYPTION_KEY;
  if (envValue) {
    return { key: decodeKey(envValue, "ENCRYPTION_KEY"), source: "env", filePath: null };
  }

  const filePath = path.join(dataDir, KEY_FILE_NAME);

  if (fs.existsSync(filePath)) {
    const raw = fs.readFileSync(filePath, "utf-8").trim();
    return { key: decodeKey(raw, filePath), source: "existing-file", filePath };
  }

  fs.mkdirSync(dataDir, { recursive: true });
  const generated = crypto.randomBytes(32).toString("hex");
  fs.writeFileSync(filePath, generated, { mode: 0o600 });
  return { key: decodeKey(generated, "generated key"), source: "generated", filePath };
}
