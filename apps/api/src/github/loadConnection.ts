// Helper shared by every route that needs a ready-to-use Octokit for a
// specific user's connection: loads that user's connection row, decrypts
// its token, and hands back the client. Throws NoConnectionError if that
// user has no connection yet, which routes translate to a 400 response.
// Async because building a GitHub App connection's Octokit exchanges a
// fresh installation token over the network (see buildOctokitForConnection).
//
// Callers pass whichever userId is relevant to them — usually the current
// session's own user (discovery, connect-time actions), but job
// execute/retry deliberately pass the *job's creator's* userId instead of
// whoever is clicking the button, so a run always executes under the
// credential that actually previewed it (see routes/jobs.ts and
// jobQueue.ts).
import { Octokit } from "@octokit/rest";
import type { Connection } from "@prswarm/shared-types";
import { decrypt } from "../crypto.js";
import type { AppDatabase } from "../db.js";
import { getCurrentConnectionRow, listConnectionInstallations } from "../repositories/connectionsRepository.js";
import { buildOctokitForConnection } from "./client.js";
import { getInstallationOctokit } from "./appAuth.js";

export class NoConnectionError extends Error {
  constructor() {
    super("No GitHub connection configured. Connect a PAT first via POST /api/connections.");
    this.name = "NoConnectionError";
  }
}

export class OrgNotInstalledError extends Error {
  constructor(org: string) {
    super(`This GitHub App connection has no installation for "${org}".`);
    this.name = "OrgNotInstalledError";
  }
}

export async function loadOctokitForCurrentConnection(db: AppDatabase, userId: string): Promise<Octokit> {
  const row = getCurrentConnectionRow(db, userId);
  if (!row || !row.encrypted_token) {
    throw new NoConnectionError();
  }

  const connection: Connection = {
    id: row.id,
    type: row.type,
    login: row.login,
    host: row.host,
    appId: row.app_id,
    installationId: row.installation_id,
    // getCurrentConnectionRow only ever returns the active row for this
    // user (it filters WHERE is_active = 1), so this is always true here.
    active: true,
    createdAt: row.created_at,
  };

  const token = decrypt(row.encrypted_token);
  return buildOctokitForConnection(connection, token);
}

/** Resolves the right Octokit client for a specific org. PAT connections
 * see everything one token can reach, so org is irrelevant — delegates to
 * loadOctokitForCurrentConnection. GitHub App connections may be bound to
 * multiple installations (see connection_installations); this looks up
 * whichever installation owns `org` and mints a token for that one
 * specifically, throwing OrgNotInstalledError if none match. */
export async function loadOctokitForOrg(db: AppDatabase, userId: string, org: string): Promise<Octokit> {
  const row = getCurrentConnectionRow(db, userId);
  if (!row || !row.encrypted_token) {
    throw new NoConnectionError();
  }

  if (row.type === "PAT") {
    return loadOctokitForCurrentConnection(db, userId);
  }

  const installations = listConnectionInstallations(db, row.id);
  const match = installations.find((installation) => installation.accountLogin.toLowerCase() === org.toLowerCase());
  if (!match) {
    throw new OrgNotInstalledError(org);
  }

  const privateKeyPem = decrypt(row.encrypted_token);
  return getInstallationOctokit(row.app_id!, privateKeyPem, Number(match.installationId), row.host);
}

/** Wraps loadOctokitForOrg with an in-memory memo scoped to one caller's
 * lifetime (one HTTP request, one runJobExecution call) — never persisted
 * or shared across calls to this factory. Concurrent resolutions of the
 * same org share the same in-flight promise instead of each starting a
 * fresh installation-token exchange, which matters when many target repos
 * in one job/preview share an org. */
export function createOrgOctokitResolver(db: AppDatabase, userId: string): (org: string) => Promise<Octokit> {
  const cache = new Map<string, Promise<Octokit>>();
  return (org: string) => {
    const key = org.toLowerCase();
    let pending = cache.get(key);
    if (!pending) {
      pending = loadOctokitForOrg(db, userId, org);
      cache.set(key, pending);
    }
    return pending;
  };
}
