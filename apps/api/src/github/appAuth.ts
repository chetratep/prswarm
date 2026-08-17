// GitHub App authentication: discovering installations for an App ID +
// private key, and building an Octokit authenticated as one specific
// installation. Uses @octokit/auth-app for JWT signing (App-level auth) and
// installation-token exchange rather than hand-rolling either.
import { createAppAuth } from "@octokit/auth-app";
import { Octokit } from "@octokit/rest";
import type { GithubAppInstallationSummary } from "@bulk-github-update-tool/shared-types";

/** Lists every installation the given App ID + private key can see. Lets
 * GitHub's own errors (bad App ID, malformed PEM, nonexistent App) propagate
 * — the route layer is responsible for turning those into 400s. */
export async function listAppInstallations(
  appId: string,
  privateKeyPem: string
): Promise<GithubAppInstallationSummary[]> {
  const octokit = new Octokit({
    authStrategy: createAppAuth,
    auth: { appId, privateKey: privateKeyPem },
  });

  const { data } = await octokit.rest.apps.listInstallations();

  return data.map((inst) => {
    // `account` is a union in Octokit's types — a GitHub App can technically
    // be installed at the Enterprise level too, which has no `login` /
    // `avatar_url` / `type` the same way a User/Organization account does.
    // Fall back gracefully instead of crashing on that shape.
    const account = inst.account;
    const accountType: "User" | "Organization" =
      account && "type" in account && account.type === "Organization" ? "Organization" : "User";

    return {
      installationId: inst.id,
      accountLogin: account && "login" in account ? (account.login ?? "unknown") : "unknown",
      accountAvatarUrl: account && "avatar_url" in account ? (account.avatar_url ?? "") : "",
      accountType,
    };
  });
}

/** Builds an Octokit authenticated as one specific installation. Exchanges a
 * fresh installation token on first use every time this is called — there is
 * no cross-call caching in this pass. Installation tokens last ~1hr, so
 * re-exchanging per request is correct but wasteful; caching by
 * (appId, installationId) with expiry-aware reuse is a known, documented
 * future optimization, not built here. */
export async function getInstallationOctokit(
  appId: string,
  privateKeyPem: string,
  installationId: number
): Promise<Octokit> {
  return new Octokit({
    authStrategy: createAppAuth,
    auth: { appId, privateKey: privateKeyPem, installationId },
  });
}
