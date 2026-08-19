// Canonical handling for `connection.host` (GitHub Enterprise Server
// hostname). This value has three consumers that each historically expected
// a different shape: Octokit's `baseUrl` (`https://<host>/api/v3`), the
// fetch-content SSRF allowlist (a bare hostname, compared via
// `url.hostname === allowedHost`), and the frontend's commit-link builder
// (also a bare hostname). No single raw-stored form satisfied all three.
//
// Resolution: the canonical STORED form is the bare hostname
// (`ghe.example.com`) — that's what the SSRF allowlist and the frontend link
// need directly, with zero derivation. `normalizeGheHost` is applied once,
// at the write boundary (routes/connections.ts), whatever form the user
// typed (bare host, `https://host/api/v3`, `host/api/v3`, with or without a
// trailing slash). `buildGheBaseUrl` derives Octokit's `baseUrl` from a
// stored (or not-yet-normalized) host on the read side — it re-applies the
// same stripping first, so it's correct whether it's given an already-bare
// host or legacy/raw data that predates this normalization.
export function normalizeGheHost(input: string | null | undefined): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  const bare = trimmed
    .replace(/^https?:\/\//i, "")
    .replace(/\/api\/v3\/?$/i, "")
    .replace(/\/+$/, "");
  return bare.length > 0 ? bare : null;
}

export function buildGheBaseUrl(input: string | null | undefined): string | undefined {
  const bareHost = normalizeGheHost(input);
  return bareHost ? `https://${bareHost}/api/v3` : undefined;
}
