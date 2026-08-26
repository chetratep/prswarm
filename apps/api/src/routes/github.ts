// Org/repo discovery routes. Both require a connection to already exist
// (400 if not — see loadOctokitForCurrentConnection).
import type { FastifyInstance, FastifyReply } from "fastify";
import type { GitHubOrgSummary, GitHubRepoSummary } from "@prswarm/shared-types";
import type { AppDatabase } from "../db.js";
import { loadOctokitForCurrentConnection, NoConnectionError } from "../github/loadConnection.js";
import { getCurrentConnectionRow, type ConnectionRow } from "../repositories/connectionsRepository.js";
import { resolveCurrentUser } from "../auth/currentUser.js";
import type { Octokit } from "@octokit/rest";

export interface GithubRouteOptions {
  db: AppDatabase;
}

const MAX_REQUESTS_PER_WINDOW = 30;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;

interface RequestWindow {
  count: number;
  windowStart: number;
}

// Both routes below call the GitHub API on every request — /orgs/:org/repos
// paginates through every page of a potentially large org, an expensive
// operation an authenticated user could otherwise trigger without limit,
// exhausting either this server or the connection's own GitHub API rate
// limit. Single-process, in-memory, keyed by user rather than IP (these
// routes already require auth) — same reasoning and shape as the login
// rate limiter in auth.ts, kept separate since that one is failed-attempts
// -only and IP-keyed, a different threat model.
const requestsByUser = new Map<string, RequestWindow>();

export function isOverRateLimit(userId: string): boolean {
  const now = Date.now();
  const record = requestsByUser.get(userId);

  if (!record || now - record.windowStart > RATE_LIMIT_WINDOW_MS) {
    requestsByUser.set(userId, { count: 1, windowStart: now });
    return false;
  }

  record.count += 1;
  return record.count > MAX_REQUESTS_PER_WINDOW;
}

/** Test-only: clears in-memory rate-limit state between test cases. */
export function __resetRateLimitForTests(): void {
  requestsByUser.clear();
}

async function getOctokitOr400(
  db: AppDatabase,
  userId: string,
  reply: FastifyReply
): Promise<Octokit | undefined> {
  try {
    return await loadOctokitForCurrentConnection(db, userId);
  } catch (err) {
    if (err instanceof NoConnectionError) {
      reply.code(400).send({ error: err.message });
      return undefined;
    }
    throw err;
  }
}

interface SelfAccount {
  login: string;
  id: number;
  avatarUrl: string;
  type: "User" | "Organization";
}

/** Figures out which account this connection acts as. `GET /user` (the
 * obvious choice) only works for a PAT/OAuth user token — a GitHub App
 * installation token has no user to represent and GitHub rejects it with
 * "Resource not accessible by integration". A GitHub App connection is
 * already bound to exactly one account at connect time (see
 * routes/connections.ts, which derives `login` server-side from the
 * installation), so for that case this looks that account's public profile
 * up by username instead of asking "who am I" — a plain public read that
 * works under any token type. */
async function resolveSelf(connectionRow: ConnectionRow | undefined, octokit: Octokit): Promise<SelfAccount> {
  const { data } =
    connectionRow?.type === "GITHUB_APP" && connectionRow.login
      ? await octokit.rest.users.getByUsername({ username: connectionRow.login })
      : await octokit.rest.users.getAuthenticated();

  return {
    login: data.login,
    id: data.id,
    avatarUrl: data.avatar_url,
    type: "type" in data && data.type === "Organization" ? "Organization" : "User",
  };
}

export async function registerGithubRoutes(app: FastifyInstance, opts: GithubRouteOptions): Promise<void> {
  const { db } = opts;

  app.get("/orgs", async (request, reply) => {
    const currentUser = resolveCurrentUser(request);
    if (isOverRateLimit(currentUser.userId)) {
      return reply.code(429).send({ error: "Too many requests. Try again shortly." });
    }
    const octokit = await getOctokitOr400(db, currentUser.userId, reply);
    if (!octokit) return reply;

    const connectionRow = getCurrentConnectionRow(db, currentUser.userId);
    const self = await resolveSelf(connectionRow, octokit);

    // A GitHub App connection is already bound to exactly one account (the
    // installation it was connected to) — there's no "list every org I
    // belong to" the way a PAT can see (that's GET /user/orgs, also a
    // user-token-only endpoint an installation token can't call). That one
    // account IS the only entry.
    if (connectionRow?.type === "GITHUB_APP") {
      return [self satisfies GitHubOrgSummary];
    }

    // The authenticated account's own namespace isn't an "org" from GitHub's
    // API point of view, but repos owned directly by you (not under any
    // org) are exactly as valid a target as an org's repos — list it first,
    // as a pseudo-org the frontend treats like any other entry.
    const { data: orgsData } = await octokit.rest.orgs.listForAuthenticatedUser({ per_page: 100 });

    const orgs: GitHubOrgSummary[] = [
      self,
      ...orgsData.map((org) => ({
        login: org.login,
        id: org.id,
        avatarUrl: org.avatar_url,
        type: "Organization" as const,
      })),
    ];

    return orgs;
  });

  app.get<{
    Params: { org: string };
    Querystring: { q?: string; language?: string; topic?: string; archived?: "true" | "false" };
  }>("/orgs/:org/repos", async (request, reply) => {
    const currentUser = resolveCurrentUser(request);
    if (isOverRateLimit(currentUser.userId)) {
      return reply.code(429).send({ error: "Too many requests. Try again shortly." });
    }
    const octokit = await getOctokitOr400(db, currentUser.userId, reply);
    if (!octokit) return reply;

    const { org } = request.params;
    const q = request.query.q?.trim().toLowerCase();
    const language = request.query.language?.trim().toLowerCase();
    const topic = request.query.topic?.trim().toLowerCase();
    const archived = request.query.archived;

    const connectionRow = getCurrentConnectionRow(db, currentUser.userId);

    // Follow every page — orgs (and users) can have hundreds of repos and
    // "select all" depends on seeing the full list, not just page 1.
    let allRepos;
    if (connectionRow?.type === "GITHUB_APP") {
      // repos.listForOrg / listForAuthenticatedUser are "for the
      // authenticated user" endpoints an installation token can't reliably
      // use (same restriction that breaks GET /user), and even where they
      // do work they can list more than the installation was actually
      // granted (an install can be scoped to "selected repositories"). The
      // dedicated installation-repos endpoint is the only one guaranteed to
      // match what this connection can actually read/write — :org is
      // unused here since a GitHub App connection is already bound to
      // exactly one account.
      allRepos = await octokit.paginate(octokit.rest.apps.listReposAccessibleToInstallation, {
        per_page: 100,
      });
    } else {
      // A repo path can't tell you whether ":org" is a real org or the
      // authenticated user's own login — GitHub has separate endpoints for
      // each and 404s if you call the wrong one. Ask once, cheaply.
      const self = await resolveSelf(connectionRow, octokit);
      allRepos =
        org === self.login
          ? await octokit.paginate(octokit.rest.repos.listForAuthenticatedUser, {
              affiliation: "owner",
              per_page: 100,
            })
          : await octokit.paginate(octokit.rest.repos.listForOrg, {
              org,
              per_page: 100,
            });
    }

    let repos: GitHubRepoSummary[] = allRepos.map((repo) => ({
      fullName: repo.full_name,
      defaultBranch: repo.default_branch ?? "main",
      private: repo.private,
      archived: repo.archived ?? false,
      language: repo.language ?? null,
      topics: repo.topics ?? [],
    }));

    if (q) {
      repos = repos.filter((repo) => repo.fullName.toLowerCase().includes(q));
    }

    if (language) {
      repos = repos.filter((repo) => repo.language?.toLowerCase() === language);
    }

    if (topic) {
      repos = repos.filter((repo) => repo.topics.some((t) => t.toLowerCase() === topic));
    }

    if (archived === "true" || archived === "false") {
      const archivedBool = archived === "true";
      repos = repos.filter((repo) => repo.archived === archivedBool);
    }

    return repos;
  });
}
