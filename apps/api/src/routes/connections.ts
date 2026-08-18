// POST /api/connections verifies a PAT actually works before storing it
// (encrypted) and never returns raw or encrypted token material. The
// GitHub App routes below follow the same shape: verify against real GitHub
// before ever writing to the DB, and never return raw/encrypted secret
// material in a response.
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
} from "@bulk-github-update-tool/shared-types";
import { encrypt } from "../crypto.js";
import type { AppDatabase } from "../db.js";
import { listAppInstallations } from "../github/appAuth.js";
import {
  deleteCurrentConnection,
  getCurrentConnection,
  replaceWithGithubAppConnection,
  replaceWithPatConnection,
} from "../repositories/connectionsRepository.js";

const connectPatBodySchema = z.object({
  token: z.string().min(1),
});

const listGithubAppInstallationsBodySchema = z.object({
  appId: z.string().min(1),
  privateKeyPem: z.string().min(1),
});

const connectGithubAppBodySchema = z.object({
  appId: z.string().min(1),
  privateKeyPem: z.string().min(1),
  installationId: z.number(),
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
    const { token } = parsed.data;

    const octokit = new Octokit({ auth: token });

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
    const connection = replaceWithPatConnection(db, { login, encryptedToken });

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
      const { appId, privateKeyPem } = parsed.data;

      let installations;
      try {
        installations = await listAppInstallations(appId, privateKeyPem);
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
      return reply.code(400).send({ error: "appId, privateKeyPem, and installationId are required" });
    }
    const { appId, privateKeyPem, installationId } = parsed.data;

    let installations;
    try {
      installations = await listAppInstallations(appId, privateKeyPem);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return reply.code(400).send({
        error: `Could not verify installations for this GitHub App. Check the App ID and private key. (${message})`,
      });
    }

    // Never trust a client-supplied login — derive it server-side from the
    // App's own installation list so the connection is always bound to an
    // installation this App ID + private key actually has access to.
    const match = installations.find((inst) => inst.installationId === installationId);
    if (!match) {
      return reply.code(400).send({
        error: `Installation ${installationId} was not found among this GitHub App's installations.`,
      });
    }

    const encryptedPrivateKeyPem = encrypt(privateKeyPem);
    const connection = replaceWithGithubAppConnection(db, {
      login: match.accountLogin,
      appId,
      installationId,
      encryptedPrivateKeyPem,
    });

    const response: ConnectGithubAppResponse = { connection };
    return response;
  });

  app.get("/connections/current", async (request, reply) => {
    const connection: Connection | null = getCurrentConnection(db);
    if (!connection) {
      return reply.code(404).send({ error: "No connection configured yet" });
    }
    return connection;
  });

  // Deliberately not "disconnect and stop" — this only forgets the stored
  // credential locally. It never revokes the PAT/App key on GitHub's side
  // (this app was never in a position to do that for a PAT, and doesn't
  // attempt it for a GitHub App installation either) — reconnecting the
  // same credential afterward still works.
  app.delete("/connections/current", async (request, reply) => {
    deleteCurrentConnection(db);
    return reply.code(204).send();
  });
}
