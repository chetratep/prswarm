import { describe, expect, it } from "vitest";
import { assertUrlIsFetchable, UnfetchableUrlError } from "./fetchContent.js";

describe("assertUrlIsFetchable", () => {
  it("rejects a private-range host when no host is allowlisted", async () => {
    await expect(assertUrlIsFetchable(new URL("http://10.0.0.5/x"), null)).rejects.toThrow(
      UnfetchableUrlError
    );
  });

  it("allows a private-range host that exactly matches the allowlisted host", async () => {
    await expect(
      assertUrlIsFetchable(new URL("http://10.0.0.5/x"), "10.0.0.5")
    ).resolves.toBeUndefined();
  });

  it("still rejects a different private-range host even when one host is allowlisted", async () => {
    await expect(
      assertUrlIsFetchable(new URL("http://10.0.0.9/x"), "10.0.0.5")
    ).rejects.toThrow(UnfetchableUrlError);
  });

  it("still rejects non-http(s) protocols regardless of the allowlist", async () => {
    await expect(assertUrlIsFetchable(new URL("file:///etc/passwd"), null)).rejects.toThrow(
      UnfetchableUrlError
    );
  });
});
