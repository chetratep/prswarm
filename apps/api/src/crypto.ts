// AES-256-GCM encryption for secrets at rest (the PAT stored in
// `connections.encrypted_token`). Key resolution (env var, persisted file,
// or first-run generation) lives in secrets.ts — this file stays pure
// encrypt/decrypt logic.
import crypto from "node:crypto";
import { findExistingEncryptionKey, resolveEncryptionKey, type KeychainDeps } from "./secrets.js";
import { classifyDatabaseFile } from "./databaseFormat.js";
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

/**
 * Refuses to let a brand-new key be generated when an already-encrypted
 * database exists that only the *old* key can open — and must therefore run
 * before anything else that could resolve a key for this process.
 *
 * Why this exists: keychain reads fail closed by design (keychain.ts returns
 * undefined for a missing entry, a missing tool, a blocked spawn and a
 * PowerShell execution-policy rejection alike — all indistinguishable from
 * "nothing stored"). Without this guard, one such failure on a machine with
 * no key *file* sends key resolution straight to "generate a new one and
 * persist it", and persisting overwrites in place (`security
 * add-generic-password -U`, `CredWrite`) — destroying the only key that could
 * decrypt the database, before loadEncryptedDatabase's fail-fast check ever
 * gets to run.
 *
 * Deliberately narrow: a database that is *absent* (fresh install) or still
 * *legacy plaintext* (the pre-encryption format, which the first flush
 * encrypts) has nothing to orphan, so both keep generating a key as normal.
 *
 * On success the key it found is cached, so the resolution that follows costs
 * nothing extra (a keychain read is a process spawn on every platform).
 */
export function assertEncryptionKeyAvailableFor(
  databasePath: string,
  deps: { dataDir?: string; keychainDeps?: KeychainDeps } = {}
): void {
  // A key is already in hand for this process, so nothing downstream can
  // reach the generate-and-persist branch.
  if (cachedKey) return;
  if (classifyDatabaseFile(databasePath) !== "encrypted") return;

  const dataDir = deps.dataDir ?? defaultDataDir();
  const existing = findExistingEncryptionKey(dataDir, deps.keychainDeps);
  if (!existing) {
    throw new Error(
      `An encrypted database already exists at ${databasePath}, but no encryption key could be found ` +
        `(checked the ENCRYPTION_KEY environment variable, the OS keychain, and ${dataDir}). ` +
        "Refusing to generate a new key, which would permanently orphan the existing database. " +
        "If the key was lost, this data is not recoverable — if you're certain a fresh start is " +
        "intended, delete the database file first."
    );
  }

  cachedKey = existing.key;
}

/** Resolves the encryption key eagerly (generating and persisting one on first
 * run if none is configured) so a *malformed* key still fails fast at startup
 * rather than the first time a connection is saved. */
export function assertEncryptionKeyConfigured(): void {
  // Already resolved — in practice by assertEncryptionKeyAvailableFor above,
  // which runs first at startup and caches whatever it found. Re-resolving
  // would spawn a second keychain lookup for the same answer.
  if (cachedKey) return;

  const resolved = resolveEncryptionKey(defaultDataDir());
  cachedKey = resolved.key;
  if (resolved.source === "generated") {
    console.log(
      `Generated a new encryption key at ${resolved.filePath}. No OS keychain was available ` +
        "(expected on headless and Docker deployments) — for a stronger guarantee, supply " +
        "ENCRYPTION_KEY via your deployment platform's own secret mechanism (a Docker secret, a " +
        "Kubernetes secret, a cloud secrets manager) instead of relying on this auto-generated " +
        "file, which sits in the same directory as the encrypted database it protects."
    );
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
