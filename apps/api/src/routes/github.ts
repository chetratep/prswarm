// Org/repo discovery routes. Both require a connection to already exist
// (400 if not — see loadOctokitForCurrentConnection).
import type { FastifyInstance, FastifyReply } from "fastify";
import type { GitHubOrgSummary, GitHubRepoSummary } from "@bulk-github-update-tool/shared-types";
import type { AppDatabase } from "../db.js";
import { loadOctokitForCurrentConnection, NoConnectionError } from "../github/loadConnection.js";
import type { Octokit } from "@octokit/rest";

export interface GithubRouteOptions {
  db: AppDatabase;
}

async function getOctokitOr400(db: AppDatabase, reply: FastifyReply): Promise<Octokit | undefined> {
  try {
    return await loadOctokitForCurrentConnection(db);
  } catch (err) {
    if (err instanceof NoConnectionError) {
      reply.code(400).send({ error: err.message });
      return undefined;
    }
    throw err;
  }
}

export async function registerGithubRoutes(app: FastifyInstance, opts: GithubRouteOptions): Promise<void> {
  const { db } = opts;

  app.get("/orgs", async (request, reply) => {
    const octokit = await getOctokitOr400(db, reply);
    if (!octokit) return reply;

    // The authenticated account's own namespace isn't an "org" from GitHub's
    // API point of view, but repos owned directly by you (not under any
    // org) are exactly as valid a target as an org's repos — list it first,
    // as a pseudo-org the frontend treats like any other entry.
    const { data: self } = await octokit.rest.users.getAuthenticated();
    const { data: orgsData } = await octokit.rest.orgs.listForAuthenticatedUser({ per_page: 100 });

    const orgs: GitHubOrgSummary[] = [
      { login: self.login, id: self.id, avatarUrl: self.avatar_url, type: "User" },
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
    const octokit = await getOctokitOr400(db, reply);
    if (!octokit) return reply;

    const { org } = request.params;
    const q = request.query.q?.trim().toLowerCase();
    const language = request.query.language?.trim().toLowerCase();
    const topic = request.query.topic?.trim().toLowerCase();
    const archived = request.query.archived;

    // A repo path can't tell you whether ":org" is a real org or the
    // authenticated user's own login — GitHub has separate endpoints for
    // each and 404s if you call the wrong one. Ask once, cheaply.
    const { data: self } = await octokit.rest.users.getAuthenticated();

    // Follow every page — orgs (and users) can have hundreds of repos and
    // "select all" depends on seeing the full list, not just page 1.
    const allRepos =
      org === self.login
        ? await octokit.paginate(octokit.rest.repos.listForAuthenticatedUser, {
            affiliation: "owner",
            per_page: 100,
          })
        : await octokit.paginate(octokit.rest.repos.listForOrg, {
            org,
            per_page: 100,
          });

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
