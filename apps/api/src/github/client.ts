// Builds an Octokit instance for a stored Connection. Both PAT and GitHub
// App auth modes are implemented. `decryptedToken` is the decrypted
// `encrypted_token` column value — for PAT connections that's the token
// itself; for GitHub App connections the *same column* is reused to hold the
// encrypted App private key PEM instead (different semantic meaning per
// `connection.type`), since both are "the one secret this connection type
// needs decrypted before use."
import { Octokit } from "@octokit/rest";
import type { Connection } from "@bulk-github-update-tool/shared-types";
import { getInstallationOctokit } from "./appAuth.js";

export async function buildOctokitForConnection(
  connection: Connection,
  decryptedToken: string
): Promise<Octokit> {
  switch (connection.type) {
    case "PAT":
      return new Octokit({ auth: decryptedToken });
    case "GITHUB_APP":
      return getInstallationOctokit(connection.appId!, decryptedToken, Number(connection.installationId));
    default: {
      const exhaustiveCheck: never = connection.type;
      throw new Error(`Unknown connection type: ${String(exhaustiveCheck)}`);
    }
  }
}
