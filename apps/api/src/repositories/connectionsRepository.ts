// Data access for the `connections` table. Each user may save up to two
// connections — one PAT, one GitHub App (enforced by the
// idx_connections_user_type unique index from db.ts's migration) — with
// exactly one marked active at a time (idx_connections_one_active).
// Connecting a new credential replaces only its own type's row and makes
// it active; the other type's saved row, if any, is untouched but
// deactivated. See docs/superpowers/specs/2026-08-27-non-destructive-
// connection-switching-design.md for the full rationale.
import { randomUUID } from "node:crypto";
import type { Connection, ConnectionInstallationSummary, ConnectionType } from "@prswarm/shared-types";
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

export interface ConnectionInstallationRow {
  id: string;
  connection_id: string;
  installation_id: string;
  account_login: string;
  account_type: "User" | "Organization";
  account_avatar_url: string;
}

export class ConnectionNotFoundError extends Error {
  constructor() {
    super("Connection not found.");
    this.name = "ConnectionNotFoundError";
  }
}

function rowToConnection(row: ConnectionRow, installations?: ConnectionInstallationSummary[]): Connection {
  return {
    id: row.id,
    type: row.type,
    login: row.login,
    host: row.host,
    appId: row.app_id,
    installationId: row.installation_id,
    active: row.is_active === 1,
    installations: row.type === "GITHUB_APP" ? (installations ?? []) : undefined,
    createdAt: row.created_at,
  };
}

function rowToInstallation(row: ConnectionInstallationRow): ConnectionInstallationSummary {
  return {
    installationId: row.installation_id,
    accountLogin: row.account_login,
    accountType: row.account_type,
    accountAvatarUrl: row.account_avatar_url,
  };
}

/** Every installation bound to one GitHub App connection. Empty for a
 * connection that doesn't exist or isn't GITHUB_APP. */
export function listConnectionInstallations(db: AppDatabase, connectionId: string): ConnectionInstallationSummary[] {
  const rows = db
    .prepare("SELECT * FROM connection_installations WHERE connection_id = ? ORDER BY account_login")
    .all(connectionId) as ConnectionInstallationRow[];
  return rows.map(rowToInstallation);
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
  if (!row) return null;
  const installations = row.type === "GITHUB_APP" ? listConnectionInstallations(db, row.id) : undefined;
  return rowToConnection(row, installations);
}

/** All of a user's saved connections (0, 1, or 2 — at most one per type). */
export function listConnections(db: AppDatabase, userId: string): Connection[] {
  const rows = db
    .prepare("SELECT * FROM connections WHERE user_id = ? ORDER BY type")
    .all(userId) as ConnectionRow[];
  return rows.map((row) =>
    rowToConnection(row, row.type === "GITHUB_APP" ? listConnectionInstallations(db, row.id) : undefined)
  );
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
  host: string | null;
  appId: string;
  installations: {
    installationId: number;
    accountLogin: string;
    accountType: "User" | "Organization";
    accountAvatarUrl: string;
  }[];
  encryptedPrivateKeyPem: string;
}

export function replaceWithGithubAppConnection(
  db: AppDatabase,
  userId: string,
  input: CreateGithubAppConnectionInput
): Connection {
  if (input.installations.length === 0) {
    throw new Error("replaceWithGithubAppConnection requires at least one installation.");
  }

  const id = randomUUID();
  const createdAt = new Date().toISOString();
  // The first selected installation is stored on the parent row too, for
  // backward-compat display (Connection.login/installationId always have a
  // single value) — the child table is authoritative for actual auth
  // resolution once more than one installation is present.
  const primary = input.installations[0]!;
  const primaryInstallationId = String(primary.installationId);

  db.transaction(() => {
    const existing = db
      .prepare("SELECT id FROM connections WHERE user_id = ? AND type = 'GITHUB_APP'")
      .get(userId) as { id: string } | undefined;
    if (existing) {
      db.prepare("DELETE FROM connection_installations WHERE connection_id = ?").run(existing.id);
    }
    db.prepare("DELETE FROM connections WHERE user_id = ? AND type = 'GITHUB_APP'").run(userId);
    db.prepare("UPDATE connections SET is_active = 0 WHERE user_id = ?").run(userId);
    db.prepare(
      `INSERT INTO connections (id, user_id, type, login, host, app_id, installation_id, encrypted_token, is_active, created_at)
       VALUES (?, ?, 'GITHUB_APP', ?, ?, ?, ?, ?, 1, ?)`
    ).run(
      id,
      userId,
      primary.accountLogin,
      input.host,
      input.appId,
      primaryInstallationId,
      input.encryptedPrivateKeyPem,
      createdAt
    );

    for (const installation of input.installations) {
      db.prepare(
        `INSERT INTO connection_installations (id, connection_id, installation_id, account_login, account_type, account_avatar_url)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run(
        randomUUID(),
        id,
        String(installation.installationId),
        installation.accountLogin,
        installation.accountType,
        installation.accountAvatarUrl
      );
    }
  })();

  return {
    id,
    type: "GITHUB_APP",
    login: primary.accountLogin,
    host: input.host,
    appId: input.appId,
    installationId: primaryInstallationId,
    active: true,
    installations: input.installations.map((installation) => ({
      installationId: String(installation.installationId),
      accountLogin: installation.accountLogin,
      accountType: installation.accountType,
      accountAvatarUrl: installation.accountAvatarUrl,
    })),
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

    db.prepare("DELETE FROM connection_installations WHERE connection_id = ?").run(id);
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
