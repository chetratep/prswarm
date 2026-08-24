// Builds an Octokit instance for a stored Connection. Both PAT and GitHub
// App auth modes are implemented. `decryptedToken` is the decrypted
// `encrypted_token` column value — for PAT connections that's the token
// itself; for GitHub App connections the *same column* is reused to hold the
// encrypted App private key PEM instead (different semantic meaning per
// `connection.type`), since both are "the one secret this connection type
// needs decrypted before use."
//
// `connection.host` — when set, points every request at a GitHub
// Enterprise Server instance instead of github.com. The stored form is
// always a bare hostname (e.g. "ghe.example.com" — see host.ts for why and
// where that's normalized); `buildGheBaseUrl` derives Octokit's `baseUrl`
// option ("https://<ghe-hostname>/api/v3") from it here. When null, baseUrl
// is omitted entirely so Octokit falls back to its own github.com default —
// no special-casing needed.
import { Octokit } from "@octokit/rest";
import type { Connection } from "@prdispatch/shared-types";
import { getInstallationOctokit } from "./appAuth.js";
import { buildGheBaseUrl } from "./host.js";

export async function buildOctokitForConnection(
  connection: Connection,
  decryptedToken: string
): Promise<Octokit> {
  switch (connection.type) {
    case "PAT":
      return new Octokit({ auth: decryptedToken, baseUrl: buildGheBaseUrl(connection.host) });
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
