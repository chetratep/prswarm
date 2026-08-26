import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetRateLimitForTests, isOverRateLimit } from "./github.js";

describe("isOverRateLimit", () => {
  beforeEach(() => {
    __resetRateLimitForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("allows requests up to the per-window limit", () => {
    for (let i = 0; i < 30; i++) {
      expect(isOverRateLimit("user-1")).toBe(false);
    }
  });

  it("blocks the request once the per-window limit is exceeded", () => {
    for (let i = 0; i < 30; i++) {
      isOverRateLimit("user-1");
    }
    expect(isOverRateLimit("user-1")).toBe(true);
  });

  it("tracks each user independently", () => {
    for (let i = 0; i < 30; i++) {
      isOverRateLimit("user-1");
    }
    expect(isOverRateLimit("user-1")).toBe(true);
    expect(isOverRateLimit("user-2")).toBe(false);
  });

  it("resets once the window elapses", () => {
    vi.useFakeTimers();
    for (let i = 0; i < 30; i++) {
      isOverRateLimit("user-1");
    }
    expect(isOverRateLimit("user-1")).toBe(true);

    vi.advanceTimersByTime(60 * 1000 + 1);

    expect(isOverRateLimit("user-1")).toBe(false);
  });
});
