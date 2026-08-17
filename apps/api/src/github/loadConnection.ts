// Helper shared by the /api/orgs and /api/orgs/:org/repos routes: loads the
// current connection, decrypts its token, and hands back a ready-to-use
// Octokit client. Throws NoConnectionError if no connection has been created
// yet, which routes translate to a 400 response. Async because building a
// GitHub App connection's Octokit exchanges a fresh installation token over
// the network (see buildOctokitForConnection).
import { Octokit } from "@octokit/rest";
import type { Connection } from "@bulk-github-update-tool/shared-types";
import { decrypt } from "../crypto.js";
import type { AppDatabase } from "../db.js";
import { getCurrentConnectionRow } from "../repositories/connectionsRepository.js";
import { buildOctokitForConnection } from "./client.js";

export class NoConnectionError extends Error {
  constructor() {
    super("No GitHub connection configured. Connect a PAT first via POST /api/connections.");
    this.name = "NoConnectionError";
  }
}

export async function loadOctokitForCurrentConnection(db: AppDatabase): Promise<Octokit> {
  const row = getCurrentConnectionRow(db);
  if (!row || !row.encrypted_token) {
    throw new NoConnectionError();
  }

  const connection: Connection = {
    id: row.id,
    type: row.type,
    login: row.login,
    appId: row.app_id,
    installationId: row.installation_id,
    createdAt: row.created_at,
  };

  const token = decrypt(row.encrypted_token);
  return buildOctokitForConnection(connection, token);
}
