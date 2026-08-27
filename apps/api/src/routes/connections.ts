// POST /api/connections verifies a PAT actually works before storing it
// (encrypted) and never returns raw or encrypted token material. The
// GitHub App routes below follow the same shape: verify against real GitHub
// before ever writing to the DB, and never return raw/encrypted secret
// material in a response. Every route here acts on the CURRENT SESSION
// USER's own connection (resolveCurrentUser) — connections are per-user,
// not instance-wide, as of the multi-user access control work.
import { Octokit } from "@octokit/rest";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type {
  Connection,
  ConnectGithubAppRequest,
  ConnectGithubAppResponse,
  ConnectPatRequest,
  ConnectPatResponse,
  ListGithubAppInstallationsRequest,
  ListGithubAppInstallationsResponse,
} from "@prswarm/shared-types";
import { encrypt } from "../crypto.js";
import type { AppDatabase } from "../db.js";
import { resolveCurrentUser } from "../auth/currentUser.js";
import { listAppInstallations } from "../github/appAuth.js";
import { buildGheBaseUrl, normalizeGheHost } from "../github/host.js";
import {
  activateConnection,
  ConnectionNotFoundError,
  deleteConnection,
  getCurrentConnection,
  listConnections,
  replaceWithGithubAppConnection,
  replaceWithPatConnection,
} from "../repositories/connectionsRepository.js";

const connectPatBodySchema = z.object({
  token: z.string().min(1),
  host: z.string().min(1).optional(),
});

const listGithubAppInstallationsBodySchema = z.object({
  appId: z.string().min(1),
  privateKeyPem: z.string().min(1),
  host: z.string().min(1).optional(),
});

const connectGithubAppBodySchema = z.object({
  appId: z.string().min(1),
  privateKeyPem: z.string().min(1),
  installationIds: z.array(z.number()).min(1),
  host: z.string().min(1).optional(),
});

export interface ConnectionsRouteOptions {
  db: AppDatabase;
}

export async function registerConnectionsRoutes(
  app: FastifyInstance,
  opts: ConnectionsRouteOptions
): Promise<void> {
  const { db } = opts;

  app.post<{ Body: ConnectPatRequest }>("/connections", async (request, reply) => {
    const parsed = connectPatBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "token is required" });
    }
    const { token, host } = parsed.data;
    const currentUser = resolveCurrentUser(request);

    // Whatever form the user typed (bare host, "https://host/api/v3",
    // "host/api/v3", ...), normalize once here — this is the single write
    // boundary for connection.host (see host.ts). Verification below uses
    // the same normalized value (buildGheBaseUrl re-derives the full
    // Octokit baseUrl from it), so what gets verified and what gets stored
    // are guaranteed to agree.
    const normalizedHost = normalizeGheHost(host);

    const octokit = new Octokit({ auth: token, baseUrl: buildGheBaseUrl(normalizedHost) });

    let login: string;
    try {
      const { data } = await octokit.rest.users.getAuthenticated();
      login = data.login;
    } catch {
      return reply.code(400).send({
        error:
          "Could not authenticate with GitHub using the provided token. " +
          "Check that it is valid and has not expired.",
      });
    }

    const encryptedToken = encrypt(token);
    const connection = replaceWithPatConnection(db, currentUser.userId, {
      login,
      host: normalizedHost,
      encryptedToken,
    });

    const response: ConnectPatResponse = { connection };
    return response;
  });

  app.post<{ Body: ListGithubAppInstallationsRequest }>(
    "/connections/github-app/installations",
    async (request, reply) => {
      const parsed = listGithubAppInstallationsBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "appId and privateKeyPem are required" });
      }
      const { appId, privateKeyPem, host } = parsed.data;
      const normalizedHost = normalizeGheHost(host);

      let installations;
      try {
        installations = await listAppInstallations(appId, privateKeyPem, normalizedHost);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        return reply.code(400).send({
          error: `Could not list installations for this GitHub App. Check the App ID and private key. (${message})`,
        });
      }

      const response: ListGithubAppInstallationsResponse = { installations };
      return response;
    }
  );

  app.post<{ Body: ConnectGithubAppRequest }>("/connections/github-app", async (request, reply) => {
    const parsed = connectGithubAppBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "appId, privateKeyPem, and installationIds are required" });
    }
    const { appId, privateKeyPem, installationIds, host } = parsed.data;
    const currentUser = resolveCurrentUser(request);
    const normalizedHost = normalizeGheHost(host);

    let installations;
    try {
      installations = await listAppInstallations(appId, privateKeyPem, normalizedHost);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return reply.code(400).send({
        error: `Could not verify installations for this GitHub App. Check the App ID and private key. (${message})`,
      });
    }

    // Never trust client-supplied installation details — derive them
    // server-side from the App's own installation list, so a connection is
    // always bound only to installations this App ID + private key
    // actually has access to. Any requested id not found there is a 400
    // naming which one, not a silent partial connect.
    const matched: typeof installations = [];
    for (const installationId of installationIds) {
      const match = installations.find((inst) => inst.installationId === installationId);
      if (!match) {
        return reply.code(400).send({
          error: `Installation ${installationId} was not found among this GitHub App's installations.`,
        });
      }
      matched.push(match);
    }

    const encryptedPrivateKeyPem = encrypt(privateKeyPem);
    const connection = replaceWithGithubAppConnection(db, currentUser.userId, {
      host: normalizedHost,
      appId,
      installations: matched.map((inst) => ({
        installationId: inst.installationId,
        accountLogin: inst.accountLogin,
        accountType: inst.accountType,
        accountAvatarUrl: inst.accountAvatarUrl,
      })),
      encryptedPrivateKeyPem,
    });

    const response: ConnectGithubAppResponse = { connection };
    return response;
  });

  app.get("/connections", async (request) => {
    const currentUser = resolveCurrentUser(request);
    return listConnections(db, currentUser.userId);
  });

  app.get("/connections/current", async (request, reply) => {
    const currentUser = resolveCurrentUser(request);
    const connection: Connection | null = getCurrentConnection(db, currentUser.userId);
    if (!connection) {
      return reply.code(404).send({ error: "No connection configured yet" });
    }
    return connection;
  });

  app.post<{ Params: { id: string } }>("/connections/:id/activate", async (request, reply) => {
    const currentUser = resolveCurrentUser(request);
    try {
      return activateConnection(db, currentUser.userId, request.params.id);
    } catch (err) {
      if (err instanceof ConnectionNotFoundError) {
        return reply.code(404).send({ error: err.message });
      }
      throw err;
    }
  });

  // Deliberately not "disconnect and stop" — this only forgets the stored
  // credential locally. It never revokes the PAT/App key on GitHub's side —
  // reconnecting the same credential afterward still works.
  app.delete<{ Params: { id: string } }>("/connections/:id", async (request, reply) => {
    const currentUser = resolveCurrentUser(request);
    deleteConnection(db, currentUser.userId, request.params.id);
    return reply.code(204).send();
  });
}
