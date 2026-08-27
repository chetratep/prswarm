// Org/repo discovery routes. Both require a connection to already exist
// (400 if not — see loadOctokitForCurrentConnection).
import type { FastifyInstance, FastifyReply } from "fastify";
import type { GitHubOrgSummary, GitHubRepoSummary } from "@prswarm/shared-types";
import type { AppDatabase } from "../db.js";
import { loadOctokitForCurrentConnection, loadOctokitForOrg, NoConnectionError, OrgNotInstalledError } from "../github/loadConnection.js";
import { getCurrentConnectionRow, listConnectionInstallations, type ConnectionRow } from "../repositories/connectionsRepository.js";
import { resolveCurrentUser } from "../auth/currentUser.js";
import type { Octokit } from "@octokit/rest";

export interface GithubRouteOptions {
  db: AppDatabase;
}

// Both routes below call the GitHub API on every request — /orgs/:org/repos
// paginates through every page of a potentially large org, an expensive
// operation an authenticated user could otherwise trigger without limit,
// exhausting either this server or the connection's own GitHub API rate
// limit. @fastify/rate-limit is registered globally with `global: false`
// (see index.ts) so it only applies where a route opts in via this config,
// keyed per-user via the same keyGenerator for both.
export const RATE_LIMIT_CONFIG = { rateLimit: { max: 30, timeWindow: "1 minute" } };

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

  app.get("/orgs", { config: RATE_LIMIT_CONFIG }, async (request, reply) => {
    const currentUser = resolveCurrentUser(request);
    const connectionRow = getCurrentConnectionRow(db, currentUser.userId);
    if (!connectionRow) {
      return reply.code(400).send({ error: new NoConnectionError().message });
    }

    // GitHub App: every installation this connection is bound to, straight
    // from the DB — captured at connect time, no GitHub API call needed.
    // A GitHub App can be installed on many orgs/accounts at once (unlike
    // the old one-installation-per-connection model this replaced).
    if (connectionRow.type === "GITHUB_APP") {
      const installations = listConnectionInstallations(db, connectionRow.id);
      const orgs: GitHubOrgSummary[] = installations.map((installation) => ({
        login: installation.accountLogin,
        id: Number(installation.installationId),
        avatarUrl: installation.accountAvatarUrl,
        type: installation.accountType,
      }));
      return orgs;
    }

    const octokit = await getOctokitOr400(db, currentUser.userId, reply);
    if (!octokit) return reply;

    const self = await resolveSelf(connectionRow, octokit);

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
  }>("/orgs/:org/repos", { config: RATE_LIMIT_CONFIG }, async (request, reply) => {
    const currentUser = resolveCurrentUser(request);
    const { org } = request.params;
    const q = request.query.q?.trim().toLowerCase();
    const language = request.query.language?.trim().toLowerCase();
    const topic = request.query.topic?.trim().toLowerCase();
    const archived = request.query.archived;

    const connectionRow = getCurrentConnectionRow(db, currentUser.userId);
    if (!connectionRow) {
      return reply.code(400).send({ error: new NoConnectionError().message });
    }

    // Follow every page — orgs (and users) can have hundreds of repos and
    // "select all" depends on seeing the full list, not just page 1.
    let allRepos;
    if (connectionRow.type === "GITHUB_APP") {
      // repos.listForOrg / listForAuthenticatedUser are "for the
      // authenticated user" endpoints an installation token can't reliably
      // use (same restriction that breaks GET /user), and even where they
      // do work they can list more than the installation was actually
      // granted (an install can be scoped to "selected repositories"). The
      // dedicated installation-repos endpoint is the only one guaranteed to
      // match what this connection can actually read/write. This
      // connection may be bound to multiple installations now, so resolve
      // the one that actually owns :org rather than a connection-wide
      // client.
      let octokit;
      try {
        octokit = await loadOctokitForOrg(db, currentUser.userId, org);
      } catch (err) {
        if (err instanceof OrgNotInstalledError) {
          return reply.code(404).send({ error: err.message });
        }
        throw err;
      }
      allRepos = await octokit.paginate(octokit.rest.apps.listReposAccessibleToInstallation, {
        per_page: 100,
      });
    } else {
      // A repo path can't tell you whether ":org" is a real org or the
      // authenticated user's own login — GitHub has separate endpoints for
      // each and 404s if you call the wrong one. Ask once, cheaply.
      const octokit = await getOctokitOr400(db, currentUser.userId, reply);
      if (!octokit) return reply;
      const self = await resolveSelf(connectionRow, octokit);
      if (org === self.login) {
        allRepos = await octokit.paginate(octokit.rest.repos.listForAuthenticatedUser, {
          affiliation: "owner",
          per_page: 100,
        });
      } else {
        // This tool exists to push changes — a repo the connected
        // credential can't push to would just fail at execute time if
        // selected, so "repos in this org" always means "repos in this org
        // I can push to", never every repo that merely exists there.
        // GET /user/repos is scoped to repos this token actually has some
        // relationship with, across every org and personal account it can
        // see — for an org where you're a collaborator on a handful of
        // repos out of hundreds, this returns a small, already-relevant
        // set instead of paginating the whole org just to throw most of it
        // away. GitHub has no "repos in org X I'm affiliated with" endpoint
        // directly, so filter this smaller set by owner afterward instead.
        const affiliated = await octokit.paginate(octokit.rest.repos.listForAuthenticatedUser, {
          affiliation: "collaborator,organization_member",
          per_page: 100,
        });
        allRepos = affiliated.filter(
          (repo) => repo.owner?.login?.toLowerCase() === org.toLowerCase() && repo.permissions?.push
        );
      }
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
