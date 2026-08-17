// Data access for the `connections` table. Single-user tool: at most one row
// ever exists. Replacing a connection deletes the old row first, inside a
// transaction, so it's a real replace rather than accumulation.
import { randomUUID } from "node:crypto";
import type { Connection, ConnectionType } from "@bulk-github-update-tool/shared-types";
import type { AppDatabase } from "../db.js";

export interface ConnectionRow {
  id: string;
  type: ConnectionType;
  login: string | null;
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
    appId: row.app_id,
    installationId: row.installation_id,
    createdAt: row.created_at,
  };
}

/** Returns the raw row (including encrypted_token) for internal use by the
 * GitHub integration layer. Never expose this row directly over the API. */
export function getCurrentConnectionRow(db: AppDatabase): ConnectionRow | undefined {
  return db.prepare("SELECT * FROM connections LIMIT 1").get() as ConnectionRow | undefined;
}

export function getCurrentConnection(db: AppDatabase): Connection | null {
  const row = getCurrentConnectionRow(db);
  return row ? rowToConnection(row) : null;
}

export interface CreatePatConnectionInput {
  login: string;
  encryptedToken: string;
}

export function replaceWithPatConnection(db: AppDatabase, input: CreatePatConnectionInput): Connection {
  const id = randomUUID();
  const createdAt = new Date().toISOString();

  db.transaction(() => {
    db.prepare("DELETE FROM connections").run();
    db.prepare(
      `INSERT INTO connections (id, type, login, app_id, installation_id, encrypted_token, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(id, "PAT", input.login, null, null, input.encryptedToken, createdAt);
  })();

  return {
    id,
    type: "PAT",
    login: input.login,
    appId: null,
    installationId: null,
    createdAt,
  };
}

export interface CreateGithubAppConnectionInput {
  login: string;
  appId: string;
  installationId: number;
  encryptedPrivateKeyPem: string;
}

export function replaceWithGithubAppConnection(
  db: AppDatabase,
  input: CreateGithubAppConnectionInput
): Connection {
  const id = randomUUID();
  const createdAt = new Date().toISOString();
  const installationId = String(input.installationId);

  db.transaction(() => {
    db.prepare("DELETE FROM connections").run();
    db.prepare(
      `INSERT INTO connections (id, type, login, app_id, installation_id, encrypted_token, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(id, "GITHUB_APP", input.login, input.appId, installationId, input.encryptedPrivateKeyPem, createdAt);
  })();

  return {
    id,
    type: "GITHUB_APP",
    login: input.login,
    appId: input.appId,
    installationId,
    createdAt,
  };
}
