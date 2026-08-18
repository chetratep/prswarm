// Builds an Octokit instance for a stored Connection. Both PAT and GitHub
// App auth modes are implemented. `decryptedToken` is the decrypted
// `encrypted_token` column value — for PAT connections that's the token
// itself; for GitHub App connections the *same column* is reused to hold the
// encrypted App private key PEM instead (different semantic meaning per
// `connection.type`), since both are "the one secret this connection type
// needs decrypted before use."
//
// `connection.host` — when set, points every request at a GitHub
// Enterprise Server instance instead of github.com, via Octokit's baseUrl
// option (expected format: "https://<ghe-hostname>/api/v3"). When null,
// baseUrl is omitted entirely so Octokit falls back to its own
// github.com default — no special-casing needed.
import { Octokit } from "@octokit/rest";
import type { Connection } from "@bulk-github-update-tool/shared-types";
import { getInstallationOctokit } from "./appAuth.js";

export async function buildOctokitForConnection(
  connection: Connection,
  decryptedToken: string
): Promise<Octokit> {
  switch (connection.type) {
    case "PAT":
      return new Octokit({ auth: decryptedToken, baseUrl: connection.host || undefined });
    case "GITHUB_APP":
      return getInstallationOctokit(
        connection.appId!,
        decryptedToken,
        Number(connection.installationId),
        connection.host
      );
    default: {
      const exhaustiveCheck: never = connection.type;
      throw new Error(`Unknown connection type: ${String(exhaustiveCheck)}`);
    }
  }
}
