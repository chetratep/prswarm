// Regression test for the core security invariant this whole branch exists
// to establish: job execution/retry always resolves GitHub credentials via
// job.createdBy (never the requester's own connection), which in turn
// depends on loadOctokitForCurrentConnection resolving the credential keyed
// correctly per user — one user's connection must never be handed back for
// another user's id. Previously only verified live via curl/browser
// transcripts (see the plan's Task 12); this captures it as an automated
// test (final whole-branch review finding I4).
import { beforeAll, afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDatabase, type AppDatabase } from "../db.js";
import { encrypt } from "../crypto.js";
import { replaceWithPatConnection } from "../repositories/connectionsRepository.js";
import { loadOctokitForCurrentConnection, NoConnectionError } from "./loadConnection.js";

beforeAll(() => {
  // crypto.ts's encrypt/decrypt need a resolvable 32-byte AES key
  // (secrets.ts's precedence: ENCRYPTION_KEY env > an existing key file >
  // generate-and-persist a new one into the real OS data dir). Fixing it
  // via env here keeps this test from ever touching real machine state.
  process.env.ENCRYPTION_KEY = "a".repeat(64); // 64 hex chars = 32 bytes
});

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

function freshDb(): AppDatabase {
  dbPath = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "bulk-tool-loadconnection-test-")),
    "test.db"
  );
  db = openDatabase(dbPath);
  return db;
}

async function resolvedToken(octokit: Awaited<ReturnType<typeof loadOctokitForCurrentConnection>>) {
  const authResult = (await octokit.auth()) as { token?: string };
  return authResult.token;
}

describe("loadOctokitForCurrentConnection", () => {
  it("resolves each user's own connection — never another user's, even with both present", async () => {
    const database = freshDb();

    replaceWithPatConnection(database, "user-a", {
      login: "alice-gh",
      host: null,
      encryptedToken: encrypt("token-for-alice"),
    });
    replaceWithPatConnection(database, "user-b", {
      login: "bob-gh",
      host: "ghe.example.com",
      encryptedToken: encrypt("token-for-bob"),
    });

    const octokitA = await loadOctokitForCurrentConnection(database, "user-a");
    const octokitB = await loadOctokitForCurrentConnection(database, "user-b");

    const tokenA = await resolvedToken(octokitA);
    const tokenB = await resolvedToken(octokitB);

    expect(tokenA).toBe("token-for-alice");
    expect(tokenB).toBe("token-for-bob");
    expect(tokenA).not.toBe(tokenB);

    // The GHE host is also resolved per-connection, not shared/leaked
    // across users — user-a is on github.com, user-b on a GHE host.
    expect(octokitA.request.endpoint.DEFAULTS.baseUrl).toBe("https://api.github.com");
    expect(octokitB.request.endpoint.DEFAULTS.baseUrl).toBe("https://ghe.example.com/api/v3");
  });

  it("still resolves user-a's connection correctly after user-b reconnects with a new token", async () => {
    // Guards against a shared-cache or last-write-wins bug: reconnecting
    // one user's credential must never bleed into another user's already-
    // resolved connection.
    const database = freshDb();

    replaceWithPatConnection(database, "user-a", {
      login: "alice-gh",
      host: null,
      encryptedToken: encrypt("token-for-alice"),
    });
    replaceWithPatConnection(database, "user-b", {
      login: "bob-gh",
      host: null,
      encryptedToken: encrypt("token-for-bob-old"),
    });
    replaceWithPatConnection(database, "user-b", {
      login: "bob-gh",
      host: null,
      encryptedToken: encrypt("token-for-bob-new"),
    });

    const octokitA = await loadOctokitForCurrentConnection(database, "user-a");
    expect(await resolvedToken(octokitA)).toBe("token-for-alice");

    const octokitB = await loadOctokitForCurrentConnection(database, "user-b");
    expect(await resolvedToken(octokitB)).toBe("token-for-bob-new");
  });

  it("throws NoConnectionError for a user with no connection, even when other users have one", async () => {
    const database = freshDb();
    replaceWithPatConnection(database, "user-a", {
      login: "alice-gh",
      host: null,
      encryptedToken: encrypt("token-for-alice"),
    });

    await expect(loadOctokitForCurrentConnection(database, "user-with-no-connection")).rejects.toThrow(
      NoConnectionError
    );
  });
});
