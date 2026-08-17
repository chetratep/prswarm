// AES-256-GCM encryption for secrets at rest (the PAT stored in
// `connections.encrypted_token`). Key is derived from the ENCRYPTION_KEY env
// var — separate from SESSION_SECRET, which only signs cookies. Never
// silently no-ops: encrypt/decrypt (and the startup assertion) throw a clear
// error if ENCRYPTION_KEY is missing or malformed.
import crypto from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH_BYTES = 12; // recommended IV length for GCM
const AUTH_TAG_LENGTH_BYTES = 16;

function getKey(): Buffer {
  const raw = process.env.ENCRYPTION_KEY;

  if (!raw) {
    throw new Error(
      "ENCRYPTION_KEY is not set. Generate one with " +
        '`node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"` ' +
        "and set it in your .env before the API can start."
    );
  }

  const key = /^[0-9a-fA-F]{64}$/.test(raw)
    ? Buffer.from(raw, "hex")
    : Buffer.from(raw, "base64");

  if (key.length !== 32) {
    throw new Error(
      `ENCRYPTION_KEY must decode to exactly 32 bytes (got ${key.length}). ` +
        "Use a 64-character hex string or a base64-encoded 32-byte value."
    );
  }

  return key;
}

/** Validates ENCRYPTION_KEY eagerly so a misconfigured instance fails at
 * startup rather than the first time a connection is saved. */
export function assertEncryptionKeyConfigured(): void {
  getKey();
}

export function encrypt(plaintext: string): string {
  const key = getKey();
  const iv = crypto.randomBytes(IV_LENGTH_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  // Store iv || authTag || ciphertext together, base64-encoded, so decrypt
  // only needs the single stored string plus the key.
  return Buffer.concat([iv, authTag, encrypted]).toString("base64");
}

export function decrypt(ciphertext: string): string {
  const key = getKey();
  const raw = Buffer.from(ciphertext, "base64");

  const iv = raw.subarray(0, IV_LENGTH_BYTES);
  const authTag = raw.subarray(IV_LENGTH_BYTES, IV_LENGTH_BYTES + AUTH_TAG_LENGTH_BYTES);
  const encrypted = raw.subarray(IV_LENGTH_BYTES + AUTH_TAG_LENGTH_BYTES);

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}
