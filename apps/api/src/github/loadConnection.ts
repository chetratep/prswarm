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
import { getCurrentConnectionRow } from "../repositories/connectionsRepository.js";
import { buildOctokitForConnection } from "./client.js";

export class NoConnectionError extends Error {
  constructor() {
    super("No GitHub connection configured. Connect a PAT first via POST /api/connections.");
    this.name = "NoConnectionError";
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
