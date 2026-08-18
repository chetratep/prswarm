// Ensures at least one admin account exists before the app serves any
// authenticated request, and reassigns pre-multi-user data (a connection
// with no owner, jobs still stamped the literal "local") to that admin so
// existing local history isn't orphaned by this migration. No-ops entirely
// when AUTH_ENABLED is false — see auth/currentUser.ts's "local" sentinel
// for how that mode keeps working without any of this. Safe to call on
// every startup: only acts when `users` has zero rows.
import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import type { AppDatabase } from "../db.js";
import { countUsers, insertUser } from "../repositories/usersRepository.js";
import { reassignOrphanedConnections } from "../repositories/connectionsRepository.js";
import { reassignLegacyJobs } from "../repositories/jobsRepository.js";

const BCRYPT_ROUNDS = 10;

export interface BootstrapAuthOptions {
  authEnabled: boolean;
  authUsername: string | undefined;
  /** Already a bcrypt hash, same convention as the pre-multi-user
   * AUTH_PASSWORD_HASH env var — never re-hashed here. */
  authPasswordHash: string | undefined;
}

export function bootstrapAuth(db: AppDatabase, opts: BootstrapAuthOptions): void {
  if (!opts.authEnabled) return;
  if (countUsers(db) > 0) return;

  let username: string;
  let passwordHash: string;

  if (opts.authUsername && opts.authPasswordHash) {
    username = opts.authUsername;
    passwordHash = opts.authPasswordHash;
    console.log(`Bootstrapped admin account "${username}" from AUTH_USERNAME/AUTH_PASSWORD_HASH.`);
  } else {
    username = "admin";
    const generatedPassword = randomBytes(9).toString("base64url");
    passwordHash = bcrypt.hashSync(generatedPassword, BCRYPT_ROUNDS);
    console.log(
      `No existing users found — created bootstrap admin account "admin" with a generated ` +
        `password:\n\n    ${generatedPassword}\n\n` +
        `Log in and change this as soon as possible; it is only ever shown here, once.`
    );
  }

  const admin = insertUser(db, { username, passwordHash, role: "admin" });

  reassignOrphanedConnections(db, admin.id);
  reassignLegacyJobs(db, admin.id);
}
