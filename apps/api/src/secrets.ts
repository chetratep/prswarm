// Resolves the AES key crypto.ts's encrypt/decrypt use. Precedence:
//   1. ENCRYPTION_KEY env var, if set (today's dev workflow via .env,
//      unchanged).
//   2. OS keychain, if available and contains a stored key (preferred on
//      desktop sessions where available — macOS/Windows always, Linux with
//      a running GNOME Keyring/KWallet).
//   3. A previously-generated key file in dataDir.
//   4. Generate a new 32-byte key, persist it to the OS keychain if
//      reachable or to a file otherwise, and use that — so a curl-installed
//      binary with no .env can still start, and headless/Docker with no
//      keychain daemon falls through to file-based storage.
// Kept separate from crypto.ts (which stays pure encrypt/decrypt logic) so
// this filesystem/env/keychain resolution can be unit-tested against a temp
// directory without touching the real one or the OS keychain.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { getFromKeychain as realGetFromKeychain, setInKeychain as realSetInKeychain } from "./keychain.js";

const KEY_FILE_NAME = "encryption.key";
/** Exported so the CLI's "clear app data" flow can delete the same keychain
 * entry this module writes — see cli/interactiveCli.ts. */
export const KEYCHAIN_SERVICE = "prswarm";
export const KEYCHAIN_ACCOUNT = "encryption-key";

export interface ResolvedEncryptionKey {
  key: Buffer;
  source: "env" | "keychain" | "existing-file" | "generated" | "generated-keychain";
  filePath: string | null;
}

export interface KeychainDeps {
  getFromKeychain: typeof realGetFromKeychain;
  setInKeychain: typeof realSetInKeychain;
}

const defaultKeychainDeps: KeychainDeps = {
  getFromKeychain: realGetFromKeychain,
  setInKeychain: realSetInKeychain,
};

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

/**
 * Steps 1-3 of the precedence above — every source that can hand back an
 * *already-existing* key — with step 4 (generate and persist a brand new one)
 * deliberately left out. Returns undefined when nothing is stored anywhere.
 *
 * Split out from resolveEncryptionKey specifically so a caller can ask "is
 * there a key for this installation?" without the act of asking creating one:
 * generation writes to the OS keychain with update-in-place semantics
 * (`security add-generic-password -U`, `CredWrite`), so a speculative
 * resolve against an installation whose key merely failed to *read* would
 * overwrite the real key and orphan the database it protects. See
 * crypto.ts's assertEncryptionKeyAvailableFor.
 */
export function findExistingEncryptionKey(
  dataDir: string,
  keychainDeps: KeychainDeps = defaultKeychainDeps
): ResolvedEncryptionKey | undefined {
  const envValue = process.env.ENCRYPTION_KEY;
  if (envValue) {
    return { key: decodeKey(envValue, "ENCRYPTION_KEY"), source: "env", filePath: null };
  }

  const keychainValue = keychainDeps.getFromKeychain(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT);
  if (keychainValue) {
    return { key: decodeKey(keychainValue, "Keychain-stored encryption key"), source: "keychain", filePath: null };
  }

  const filePath = path.join(dataDir, KEY_FILE_NAME);

  if (fs.existsSync(filePath)) {
    const raw = fs.readFileSync(filePath, "utf-8").trim();
    return { key: decodeKey(raw, filePath), source: "existing-file", filePath };
  }

  return undefined;
}

export function resolveEncryptionKey(
  dataDir: string,
  keychainDeps: KeychainDeps = defaultKeychainDeps
): ResolvedEncryptionKey {
  const existing = findExistingEncryptionKey(dataDir, keychainDeps);
  if (existing) return existing;

  const filePath = path.join(dataDir, KEY_FILE_NAME);
  const generated = crypto.randomBytes(32).toString("hex");

  // Prefer persisting the newly-generated key to the keychain — only fall
  // back to a plain file if no keychain is reachable at all (headless
  // Linux/Docker) or the write itself fails for some other reason.
  if (keychainDeps.setInKeychain(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT, generated)) {
    return { key: decodeKey(generated, "generated key"), source: "generated-keychain", filePath: null };
  }

  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(filePath, generated, { mode: 0o600 });
  return { key: decodeKey(generated, "generated key"), source: "generated", filePath };
}
