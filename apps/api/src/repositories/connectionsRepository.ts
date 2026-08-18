// Data access for the `connections` table. Single-user tool no longer
// applies: at most one row exists PER USER now (multi-user access
// control) — replacing a connection deletes only that user's old row,
// inside a transaction, so it's a real per-user replace, never a global one.
import { randomUUID } from "node:crypto";
import type { Connection, ConnectionType } from "@bulk-github-update-tool/shared-types";
import type { AppDatabase } from "../db.js";

export interface ConnectionRow {
  id: string;
  user_id: string | null;
  type: ConnectionType;
  login: string | null;
  host: string | null;
  app_id: string | null;
  installation_id: string | null;
  encrypted_token: string | null;
  created_at: string;
}

function rowToConnection(row: ConnectionRow): Connection {
  return {
    id: row.id,
    type: row.type,
    login: row.login,
    host: row.host,
    appId: row.app_id,
    installationId: row.installation_id,
    createdAt: row.created_at,
  };
}

/** Returns the raw row (including encrypted_token) for internal use by the
 * GitHub integration layer. Never expose this row directly over the API. */
export function getCurrentConnectionRow(db: AppDatabase, userId: string): ConnectionRow | undefined {
  return db.prepare("SELECT * FROM connections WHERE user_id = ? LIMIT 1").get(userId) as
    | ConnectionRow
    | undefined;
}

export function getCurrentConnection(db: AppDatabase, userId: string): Connection | null {
  const row = getCurrentConnectionRow(db, userId);
  return row ? rowToConnection(row) : null;
}

export interface CreatePatConnectionInput {
  login: string;
  host: string | null;
  encryptedToken: string;
}

export function replaceWithPatConnection(
  db: AppDatabase,
  userId: string,
  input: CreatePatConnectionInput
): Connection {
  const id = randomUUID();
  const createdAt = new Date().toISOString();

  db.transaction(() => {
    // Scoped to this user only — deleting every row (the old single-user
    // behavior) would wipe out every other user's connection the moment
    // any one of them reconnects. See connectionsRepository.test.ts's
    // "never touches another user's connection" regression test.
    db.prepare("DELETE FROM connections WHERE user_id = ?").run(userId);
    db.prepare(
      `INSERT INTO connections (id, user_id, type, login, host, app_id, installation_id, encrypted_token, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(id, userId, "PAT", input.login, input.host, null, null, input.encryptedToken, createdAt);
  })();

  return {
    id,
    type: "PAT",
    login: input.login,
    host: input.host,
    appId: null,
    installationId: null,
    createdAt,
  };
}

export interface CreateGithubAppConnectionInput {
  login: string;
  host: string | null;
  appId: string;
  installationId: number;
  encryptedPrivateKeyPem: string;
}

export function replaceWithGithubAppConnection(
  db: AppDatabase,
  userId: string,
  input: CreateGithubAppConnectionInput
): Connection {
  const id = randomUUID();
  const createdAt = new Date().toISOString();
  const installationId = String(input.installationId);

  db.transaction(() => {
    db.prepare("DELETE FROM connections WHERE user_id = ?").run(userId);
    db.prepare(
      `INSERT INTO connections (id, user_id, type, login, host, app_id, installation_id, encrypted_token, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      userId,
      "GITHUB_APP",
      input.login,
      input.host,
      input.appId,
      installationId,
      input.encryptedPrivateKeyPem,
      createdAt
    );
  })();

  return {
    id,
    type: "GITHUB_APP",
    login: input.login,
    host: input.host,
    appId: input.appId,
    installationId,
    createdAt,
  };
}

export function deleteCurrentConnection(db: AppDatabase, userId: string): void {
  db.prepare("DELETE FROM connections WHERE user_id = ?").run(userId);
}

/** One-time backfill: a connection row from before per-user connections
 * existed has user_id NULL. Assigns any such rows to the bootstrap admin.
 * Idempotent — nothing left to update once it's run once. Called from
 * auth/bootstrap.ts, not automatically from db.ts's migrations (which
 * don't know which user should own pre-migration rows). */
export function reassignOrphanedConnections(db: AppDatabase, adminUserId: string): void {
  db.prepare("UPDATE connections SET user_id = ? WHERE user_id IS NULL").run(adminUserId);
}
