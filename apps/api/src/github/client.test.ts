import { describe, expect, it } from "vitest";
import type { Connection } from "@prdispatch/shared-types";
import { buildOctokitForConnection } from "./client.js";

function baseConnection(overrides: Partial<Connection> = {}): Connection {
  return {
    id: "conn-1",
    type: "PAT",
    login: "octocat",
    host: null,
    appId: null,
    installationId: null,
    createdAt: "2020-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("buildOctokitForConnection", () => {
  it("uses github.com's default baseUrl when host is null", async () => {
    const octokit = await buildOctokitForConnection(baseConnection({ host: null }), "token");
    expect(octokit.request.endpoint.DEFAULTS.baseUrl).toBe("https://api.github.com");
  });

  it("derives the GHE Server API base from a stored bare hostname", async () => {
    const octokit = await buildOctokitForConnection(
      baseConnection({ host: "ghe.example.com" }),
      "token"
    );
    expect(octokit.request.endpoint.DEFAULTS.baseUrl).toBe("https://ghe.example.com/api/v3");
  });

  it("still derives the correct base when given a legacy (pre-normalization) host value", async () => {
    // connection.host is normalized to a bare hostname at write time now
    // (routes/connections.ts), but this function must stay correct for any
    // rows written before that normalization existed.
    const octokit = await buildOctokitForConnection(
      baseConnection({ host: "https://ghe.example.com/api/v3" }),
      "token"
    );
    expect(octokit.request.endpoint.DEFAULTS.baseUrl).toBe("https://ghe.example.com/api/v3");
  });
});
