import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { openDatabase, type AppDatabase } from "../db.js";
import { registerConnectionsRoutes } from "./connections.js";
import { replaceWithGithubAppConnection, replaceWithPatConnection } from "../repositories/connectionsRepository.js";

let dbPath: string;
let db: AppDatabase | undefined;

afterEach(() => {
  if (db) {
    db.close();
    db = undefined;
  }
  if (dbPath && fs.existsSync(dbPath)) {
    try {
      fs.rmSync(dbPath);
    } catch {
      // File may still be locked by Bun's sqlite; ignore cleanup errors
    }
  }
});

async function buildTestApp(database: AppDatabase): Promise<FastifyInstance> {
  const app = Fastify();
  app.decorateRequest("currentUser", undefined);
  app.addHook("onRequest", async (request) => {
    request.currentUser = { userId: request.headers["x-test-user"] as string, role: "member" };
  });
  await app.register((instance) => registerConnectionsRoutes(instance, { db: database }));
  await app.ready();
  return app;
}

function freshDb(): AppDatabase {
  dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "bulk-tool-connections-route-test-")), "test.db");
  db = openDatabase(dbPath);
  return db;
}

function injectAs(
  app: FastifyInstance,
  userId: string,
  opts: { method: "GET" | "POST" | "DELETE"; url: string }
) {
  return app.inject({
    method: opts.method,
    url: opts.url,
    headers: { "x-test-user": userId },
  });
}

describe("GET /connections", () => {
  it("lists every saved connection for the current user, each with its active flag", async () => {
    const database = freshDb();
    const pat = replaceWithPatConnection(database, "user-a", { login: "octocat", host: null, encryptedToken: "enc" });
    const app = await buildTestApp(database);

    const response = await injectAs(app, "user-a", { method: "GET", url: "/connections" });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toHaveLength(1);
    expect(body[0].id).toBe(pat.id);
    expect(body[0].active).toBe(true);
  });

  it("never returns another user's connections", async () => {
    const database = freshDb();
    replaceWithPatConnection(database, "user-b", { login: "someone-else", host: null, encryptedToken: "enc" });
    const app = await buildTestApp(database);

    const response = await injectAs(app, "user-a", { method: "GET", url: "/connections" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([]);
  });
});

describe("POST /connections/:id/activate", () => {
  it("switches which connection is active", async () => {
    const database = freshDb();
    const pat = replaceWithPatConnection(database, "user-a", { login: "octocat", host: null, encryptedToken: "enc" });
    replaceWithGithubAppConnection(database, "user-a", {
      login: "my-org",
      host: null,
      appId: "app-1",
      installationId: 99,
      encryptedPrivateKeyPem: "enc-pem",
    });
    const app = await buildTestApp(database);

    const response = await injectAs(app, "user-a", { method: "POST", url: `/connections/${pat.id}/activate` });

    expect(response.statusCode).toBe(200);
    expect(response.json().id).toBe(pat.id);
    expect(response.json().active).toBe(true);
  });

  it("404s when activating another user's connection", async () => {
    const database = freshDb();
    const pat = replaceWithPatConnection(database, "user-b", { login: "someone-else", host: null, encryptedToken: "enc" });
    const app = await buildTestApp(database);

    const response = await injectAs(app, "user-a", { method: "POST", url: `/connections/${pat.id}/activate` });

    expect(response.statusCode).toBe(404);
  });
});

describe("DELETE /connections/:id", () => {
  it("deletes that specific connection and returns 204", async () => {
    const database = freshDb();
    const pat = replaceWithPatConnection(database, "user-a", { login: "octocat", host: null, encryptedToken: "enc" });
    const app = await buildTestApp(database);

    const response = await injectAs(app, "user-a", { method: "DELETE", url: `/connections/${pat.id}` });

    expect(response.statusCode).toBe(204);
    const listResponse = await injectAs(app, "user-a", { method: "GET", url: "/connections" });
    expect(listResponse.json()).toEqual([]);
  });

  it("is a no-op (still 204) when deleting another user's connection id", async () => {
    const database = freshDb();
    const pat = replaceWithPatConnection(database, "user-b", { login: "someone-else", host: null, encryptedToken: "enc" });
    const app = await buildTestApp(database);

    const response = await injectAs(app, "user-a", { method: "DELETE", url: `/connections/${pat.id}` });

    expect(response.statusCode).toBe(204);
    // user-b's connection must survive — user-a had no such id to delete.
    const listResponse = await injectAs(app, "user-b", { method: "GET", url: "/connections" });
    expect(listResponse.json()).toHaveLength(1);
  });
});
