// Server-side fetch for the Define page's "load from URL" button (e.g. a
// GitHub raw file link). Deliberately not a thin passthrough: an endpoint
// that fetches an arbitrary user-supplied URL from the server is a classic
// SSRF vector — someone could point it at http://169.254.169.254 (cloud
// metadata), an internal admin panel, or a redirect chain that lands on one
// even if the first hop looks external. This is a single-user local tool,
// not a multi-tenant proxy, so a best-effort layered guard is proportionate:
// http(s) only, reject loopback/link-local/private-range hosts (checked
// again on every redirect hop, not just the first URL), a bounded redirect
// count, a response size cap, and a fetch timeout.
import dns from "node:dns/promises";
import net from "node:net";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { FetchContentRequest, FetchContentResponse } from "@bulk-github-update-tool/shared-types";
import type { AppDatabase } from "../db.js";
import { resolveCurrentUser } from "../auth/currentUser.js";
import { getCurrentConnection } from "../repositories/connectionsRepository.js";

const MAX_CONTENT_BYTES = 5 * 1024 * 1024; // 5MB
const FETCH_TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 5;

const fetchContentBodySchema = z.object({
  url: z.string().url(),
});

function isPrivateOrLoopbackIp(address: string, family: number): boolean {
  if (family === 4) {
    if (address === "0.0.0.0" || address.startsWith("127.")) return true;
    if (address.startsWith("169.254.")) return true; // link-local, incl. cloud metadata
    if (address.startsWith("10.")) return true;
    if (address.startsWith("192.168.")) return true;
    const m = address.match(/^172\.(\d{1,3})\./);
    if (m && Number(m[1]) >= 16 && Number(m[1]) <= 31) return true;
    return false;
  }
  // IPv6
  const lower = address.toLowerCase();
  if (lower === "::1") return true; // loopback
  if (lower.startsWith("fe80:")) return true; // link-local
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // unique local
  if (lower.startsWith("::ffff:")) {
    // IPv4-mapped IPv6 — check the embedded v4 address too.
    return isPrivateOrLoopbackIp(lower.slice(7), 4);
  }
  return false;
}

export class UnfetchableUrlError extends Error {}

/** `allowedHost` — when set, this one exact hostname is exempted from the
 * private/loopback-range rejection below. Used to let "load from URL"
 * reach the requesting user's own configured GitHub Enterprise Server host
 * (often a private-range address) without reopening the guard to arbitrary
 * internal infrastructure: every other private-range host, and every
 * *other* redirect hop, is still rejected exactly as before. */
export async function assertUrlIsFetchable(url: URL, allowedHost: string | null): Promise<void> {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new UnfetchableUrlError("Only http(s) URLs are supported");
  }
  if (allowedHost && url.hostname === allowedHost) {
    return;
  }
  let resolved: { address: string; family: number };
  try {
    resolved = await dns.lookup(url.hostname);
  } catch {
    throw new UnfetchableUrlError("Could not resolve that host");
  }
  if (net.isIP(resolved.address) === 0 || isPrivateOrLoopbackIp(resolved.address, resolved.family)) {
    throw new UnfetchableUrlError("That host is not reachable from here");
  }
}

/** Follows redirects manually (not via fetch's own redirect:"follow") so
 * every hop is re-validated — a public first URL that 302s to an internal
 * address is exactly the bypass a naive SSRF guard misses. A redirect away
 * from the allowlisted host to something else is still re-checked on every
 * hop, so it's still blocked unless the new host also happens to match. */
async function fetchWithGuardedRedirects(
  initialUrl: URL,
  signal: AbortSignal,
  allowedHost: string | null
): Promise<Response> {
  let current = initialUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertUrlIsFetchable(current, allowedHost);
    const res = await fetch(current, { signal, redirect: "manual" });
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location) return res;
      current = new URL(location, current);
      continue;
    }
    return res;
  }
  throw new UnfetchableUrlError("Too many redirects");
}

export interface FetchContentRouteOptions {
  db: AppDatabase;
}

export async function registerFetchContentRoutes(
  app: FastifyInstance,
  opts: FetchContentRouteOptions
): Promise<void> {
  const { db } = opts;

  app.post<{ Body: FetchContentRequest }>("/fetch-content", async (request, reply) => {
    const parsed = fetchContentBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "A valid url is required" });
    }

    let target: URL;
    try {
      target = new URL(parsed.data.url);
    } catch {
      return reply.code(400).send({ error: "Invalid URL" });
    }

    const currentUser = resolveCurrentUser(request);
    const allowedHost = getCurrentConnection(db, currentUser.userId)?.host ?? null;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    try {
      const res = await fetchWithGuardedRedirects(target, controller.signal, allowedHost);

      if (!res.ok) {
        return reply.code(502).send({ error: `Fetch failed: ${res.status} ${res.statusText}` });
      }

      const reader = res.body?.getReader();
      if (!reader) {
        return reply.code(502).send({ error: "Empty response body" });
      }

      const chunks: Uint8Array[] = [];
      let total = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > MAX_CONTENT_BYTES) {
          await reader.cancel();
          return reply.code(413).send({ error: "File is too large (over 5MB)" });
        }
        chunks.push(value);
      }

      const content = Buffer.concat(chunks).toString("utf-8");
      const response: FetchContentResponse = { content };
      return response;
    } catch (err) {
      if (err instanceof UnfetchableUrlError) {
        return reply.code(400).send({ error: err.message });
      }
      if (err instanceof Error && err.name === "AbortError") {
        return reply.code(504).send({ error: "Fetch timed out" });
      }
      return reply.code(502).send({ error: err instanceof Error ? err.message : "Fetch failed" });
    } finally {
      clearTimeout(timeout);
    }
  });
}
