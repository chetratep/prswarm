// AES-256-GCM encryption for secrets at rest (the PAT stored in
// `connections.encrypted_token`). Key resolution (env var, persisted file,
// or first-run generation) lives in secrets.ts — this file stays pure
// encrypt/decrypt logic.
import crypto from "node:crypto";
import { resolveEncryptionKey } from "./secrets.js";
import { defaultDataDir } from "./paths.js";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH_BYTES = 12; // recommended IV length for GCM
const AUTH_TAG_LENGTH_BYTES = 16;

let cachedKey: Buffer | undefined;

function getKey(): Buffer {
  if (!cachedKey) {
    cachedKey = resolveEncryptionKey(defaultDataDir()).key;
  }
  return cachedKey;
}

/** Resolves the encryption key eagerly (generating and persisting one on first
 * run if none is configured) so a *malformed* key still fails fast at startup
 * rather than the first time a connection is saved. */
export function assertEncryptionKeyConfigured(): void {
  const resolved = resolveEncryptionKey(defaultDataDir());
  cachedKey = resolved.key;
  if (resolved.source === "generated") {
    console.log(`Generated a new encryption key at ${resolved.filePath}`);
  } else if (resolved.source === "generated-keychain") {
    console.log("Generated a new encryption key and stored it in the OS keychain");
  }
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

export function encryptBuffer(plaintext: Buffer): Buffer {
  const key = getKey();
  const iv = crypto.randomBytes(IV_LENGTH_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]);
}

export function decryptBuffer(ciphertext: Buffer): Buffer {
  const key = getKey();
  const iv = ciphertext.subarray(0, IV_LENGTH_BYTES);
  const authTag = ciphertext.subarray(IV_LENGTH_BYTES, IV_LENGTH_BYTES + AUTH_TAG_LENGTH_BYTES);
  const encrypted = ciphertext.subarray(IV_LENGTH_BYTES + AUTH_TAG_LENGTH_BYTES);

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  return Buffer.concat([decipher.update(encrypted), decipher.final()]);
}

/** Exposes the resolved key to encryptedStore.ts without re-deriving it —
 * same cached key already used by encrypt()/decrypt() above. */
export function getEncryptionKey(): Buffer {
  return getKey();
}

/** Test-only: clears the module-level key cache so the next call re-resolves
 * from the current environment/dataDir. Without this, tests that change
 * ENCRYPTION_KEY between cases would silently keep using whichever key was
 * cached first, since getKey() only resolves `if (!cachedKey)`. */
export function __resetKeyCacheForTests(): void {
  cachedKey = undefined;
}
