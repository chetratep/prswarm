// Data access for the `connections` table. Each user may save up to two
// connections — one PAT, one GitHub App (enforced by the
// idx_connections_user_type unique index from db.ts's migration) — with
// exactly one marked active at a time (idx_connections_one_active).
// Connecting a new credential replaces only its own type's row and makes
// it active; the other type's saved row, if any, is untouched but
// deactivated. See docs/superpowers/specs/2026-08-27-non-destructive-
// connection-switching-design.md for the full rationale.
import { randomUUID } from "node:crypto";
import type { Connection, ConnectionType } from "@prswarm/shared-types";
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
  is_active: number;
  created_at: string;
}

export class ConnectionNotFoundError extends Error {
  constructor() {
    super("Connection not found.");
    this.name = "ConnectionNotFoundError";
  }
}

function rowToConnection(row: ConnectionRow): Connection {
  return {
    id: row.id,
    type: row.type,
    login: row.login,
    host: row.host,
    appId: row.app_id,
    installationId: row.installation_id,
    active: row.is_active === 1,
    createdAt: row.created_at,
  };
}

/** Returns the raw row (including encrypted_token) for internal use by the
 * GitHub integration layer. Never expose this row directly over the API. */
export function getCurrentConnectionRow(db: AppDatabase, userId: string): ConnectionRow | undefined {
  return db.prepare("SELECT * FROM connections WHERE user_id = ? AND is_active = 1 LIMIT 1").get(userId) as
    | ConnectionRow
    | undefined;
}

export function getCurrentConnection(db: AppDatabase, userId: string): Connection | null {
  const row = getCurrentConnectionRow(db, userId);
  return row ? rowToConnection(row) : null;
}

/** All of a user's saved connections (0, 1, or 2 — at most one per type). */
export function listConnections(db: AppDatabase, userId: string): Connection[] {
  const rows = db
    .prepare("SELECT * FROM connections WHERE user_id = ? ORDER BY type")
    .all(userId) as ConnectionRow[];
  return rows.map(rowToConnection);
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
    // Only this user's PAT slot — the GitHub App slot (if any) is untouched.
    db.prepare("DELETE FROM connections WHERE user_id = ? AND type = 'PAT'").run(userId);
    // Deactivate whatever's left for this user (the other type's row, if
    // present) before inserting the new active PAT row below.
    db.prepare("UPDATE connections SET is_active = 0 WHERE user_id = ?").run(userId);
    db.prepare(
      `INSERT INTO connections (id, user_id, type, login, host, app_id, installation_id, encrypted_token, is_active, created_at)
       VALUES (?, ?, 'PAT', ?, ?, ?, ?, ?, 1, ?)`
    ).run(id, userId, input.login, input.host, null, null, input.encryptedToken, createdAt);
  })();

  return {
    id,
    type: "PAT",
    login: input.login,
    host: input.host,
    appId: null,
    installationId: null,
    active: true,
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
    db.prepare("DELETE FROM connections WHERE user_id = ? AND type = 'GITHUB_APP'").run(userId);
    db.prepare("UPDATE connections SET is_active = 0 WHERE user_id = ?").run(userId);
    db.prepare(
      `INSERT INTO connections (id, user_id, type, login, host, app_id, installation_id, encrypted_token, is_active, created_at)
       VALUES (?, ?, 'GITHUB_APP', ?, ?, ?, ?, ?, 1, ?)`
    ).run(
      id,
      userId,
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
    active: true,
    createdAt,
  };
}

/** Instant, local switch — no re-verification against GitHub, no credential
 * re-entry. Throws ConnectionNotFoundError if `id` isn't one of this user's
 * own connections, so one user can never activate another's row. */
export function activateConnection(db: AppDatabase, userId: string, id: string): Connection {
  const row = db.prepare("SELECT * FROM connections WHERE id = ? AND user_id = ?").get(id, userId) as
    | ConnectionRow
    | undefined;
  if (!row) {
    throw new ConnectionNotFoundError();
  }

  db.transaction(() => {
    db.prepare("UPDATE connections SET is_active = 0 WHERE user_id = ?").run(userId);
    db.prepare("UPDATE connections SET is_active = 1 WHERE id = ?").run(id);
  })();

  return rowToConnection({ ...row, is_active: 1 });
}

/** Deletes one specific saved connection. If it was the active one and
 * another slot remains, that slot becomes active automatically — a user is
 * never left "connected but nothing active" when there's an obvious
 * candidate. A no-op if `id` doesn't exist for this user. */
export function deleteConnection(db: AppDatabase, userId: string, id: string): void {
  db.transaction(() => {
    const target = db.prepare("SELECT is_active FROM connections WHERE id = ? AND user_id = ?").get(id, userId) as
      | { is_active: number }
      | undefined;
    if (!target) return;

    db.prepare("DELETE FROM connections WHERE id = ? AND user_id = ?").run(id, userId);

    if (target.is_active === 1) {
      const remaining = db.prepare("SELECT id FROM connections WHERE user_id = ?").get(userId) as
        | { id: string }
        | undefined;
      if (remaining) {
        db.prepare("UPDATE connections SET is_active = 1 WHERE id = ?").run(remaining.id);
      }
    }
  })();
}

/** One-time backfill: a connection row with no real owner yet — either
 * user_id IS NULL (a genuinely pre-migration row; db.ts's own migration
 * already backfills these to 'local' unconditionally on every boot, so in
 * practice this arm rarely fires here, but it's kept as a defensive
 * belt-and-braces match) or user_id = 'local' (the sentinel used for every
 * request whenever AUTH_ENABLED is off — a connection created in that mode
 * and never previously reassigned). Both cases get assigned to the
 * bootstrap admin here, mirroring reassignLegacyJobs's 'local' handling in
 * jobsRepository.ts, so turning auth ON after using the app in single-user
 * mode doesn't leave the existing connection orphaned either. Idempotent —
 * nothing left to update once it's run once. Called from auth/bootstrap.ts,
 * not automatically from db.ts's migrations (which don't know which user
 * should own pre-migration rows). */
export function reassignOrphanedConnections(db: AppDatabase, adminUserId: string): void {
  db.prepare("UPDATE connections SET user_id = ? WHERE user_id IS NULL OR user_id = 'local'").run(
    adminUserId
  );
}
