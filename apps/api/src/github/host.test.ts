import { describe, expect, it } from "vitest";
import { buildGheBaseUrl, normalizeGheHost } from "./host.js";

describe("normalizeGheHost", () => {
  it("returns null for null/undefined/empty input", () => {
    expect(normalizeGheHost(null)).toBeNull();
    expect(normalizeGheHost(undefined)).toBeNull();
    expect(normalizeGheHost("")).toBeNull();
    expect(normalizeGheHost("   ")).toBeNull();
  });

  it("passes a bare hostname through unchanged", () => {
    expect(normalizeGheHost("ghe.example.com")).toBe("ghe.example.com");
  });

  it("strips a leading https:// scheme", () => {
    expect(normalizeGheHost("https://ghe.example.com")).toBe("ghe.example.com");
  });

  it("strips a leading http:// scheme", () => {
    expect(normalizeGheHost("http://ghe.example.com")).toBe("ghe.example.com");
  });

  it("strips a trailing /api/v3 suffix", () => {
    expect(normalizeGheHost("ghe.example.com/api/v3")).toBe("ghe.example.com");
  });

  it("strips both a scheme and a trailing /api/v3 suffix together", () => {
    expect(normalizeGheHost("https://ghe.example.com/api/v3")).toBe("ghe.example.com");
  });

  it("strips a trailing /api/v3/ (with trailing slash) suffix", () => {
    expect(normalizeGheHost("https://ghe.example.com/api/v3/")).toBe("ghe.example.com");
  });

  it("strips a bare trailing slash with no /api/v3 suffix", () => {
    expect(normalizeGheHost("ghe.example.com/")).toBe("ghe.example.com");
  });

  it("trims surrounding whitespace", () => {
    expect(normalizeGheHost("  ghe.example.com  ")).toBe("ghe.example.com");
  });
});

describe("buildGheBaseUrl", () => {
  it("returns undefined for null/undefined/empty input (github.com default)", () => {
    expect(buildGheBaseUrl(null)).toBeUndefined();
    expect(buildGheBaseUrl(undefined)).toBeUndefined();
    expect(buildGheBaseUrl("")).toBeUndefined();
  });

  it("builds the GHE API v3 base URL from a bare hostname", () => {
    expect(buildGheBaseUrl("ghe.example.com")).toBe("https://ghe.example.com/api/v3");
  });

  it("builds the same base URL regardless of the input form (bare, full URL, or path-only)", () => {
    const expected = "https://ghe.example.com/api/v3";
    expect(buildGheBaseUrl("ghe.example.com")).toBe(expected);
    expect(buildGheBaseUrl("https://ghe.example.com/api/v3")).toBe(expected);
    expect(buildGheBaseUrl("ghe.example.com/api/v3")).toBe(expected);
    expect(buildGheBaseUrl("https://ghe.example.com/api/v3/")).toBe(expected);
  });
});
