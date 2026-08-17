import { useQuery } from "@tanstack/react-query";
import type { SessionStatus } from "@bulk-github-update-tool/shared-types";
import { queryClient } from "./queryClient";

export const SESSION_QUERY_KEY = ["session"] as const;

/**
 * Any 401 means "not logged in" (only possible when AUTH_ENABLED is on).
 * Rather than plumb a redirect through every call site, we just poke the
 * cached session status directly — App's auth gate reads that same query key
 * and will swap to the login form on its next render.
 */
function noteUnauthorized() {
  queryClient.setQueryData<SessionStatus>(SESSION_QUERY_KEY, (old) => ({
    authRequired: old?.authRequired ?? true,
    authenticated: false,
  }));
}

async function extractErrorMessage(res: Response): Promise<string> {
  try {
    const body = await res.clone().json();
    if (body && typeof body.message === "string") return body.message;
    if (body && typeof body.error === "string") return body.error;
  } catch {
    // Response wasn't JSON (or was empty) — fall back below.
  }
  return res.statusText || `Request failed with status ${res.status}`;
}

async function handleResponse<T>(res: Response): Promise<T> {
  if (res.status === 401) {
    noteUnauthorized();
  }
  if (!res.ok) {
    throw new Error(await extractErrorMessage(res));
  }
  // Some endpoints (e.g. logout) may return an empty 204 body.
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(path, {
    method: "GET",
    headers: { Accept: "application/json" },
  });
  return handleResponse<T>(res);
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
  });
  return handleResponse<T>(res);
}

/**
 * Like apiGet, but treats a 404 as "resource doesn't exist yet" rather than
 * an error — used for GET /api/connections/current, which 404s until a
 * connection has been created.
 */
export async function apiGetOrNull<T>(path: string): Promise<T | null> {
  const res = await fetch(path, {
    method: "GET",
    headers: { Accept: "application/json" },
  });
  if (res.status === 404) {
    return null;
  }
  return handleResponse<T>(res);
}

export function useSession() {
  return useQuery({
    queryKey: SESSION_QUERY_KEY,
    queryFn: () => apiGet<SessionStatus>("/api/session"),
    // Session status rarely changes on its own; App's 401 handling and the
    // login mutation both update the cache directly when it does.
    staleTime: 60_000,
  });
}
