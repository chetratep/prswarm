import { describe, expect, it } from "vitest";
import { parseCliArgs } from "./args.js";

describe("parseCliArgs", () => {
  it("defaults to no flags", () => {
    expect(parseCliArgs([])).toEqual({ daemon: false, port: null, help: false });
  });

  it("parses --daemon", () => {
    expect(parseCliArgs(["--daemon"]).daemon).toBe(true);
    expect(parseCliArgs(["-d"]).daemon).toBe(true);
  });

  it("parses --help", () => {
    expect(parseCliArgs(["--help"]).help).toBe(true);
    expect(parseCliArgs(["-h"]).help).toBe(true);
  });

  it("parses --port as a separate argument", () => {
    expect(parseCliArgs(["--port", "4200"]).port).toBe(4200);
    expect(parseCliArgs(["-p", "4200"]).port).toBe(4200);
  });

  it("parses --port=N", () => {
    expect(parseCliArgs(["--port=4200"]).port).toBe(4200);
  });

  it("yields NaN, not null, when --port is given a non-numeric value", () => {
    expect(Number.isNaN(parseCliArgs(["--port", "banana"]).port)).toBe(true);
    expect(parseCliArgs(["--port", "banana"]).port).not.toBeNull();
  });

  it("combines flags in any order", () => {
    expect(parseCliArgs(["--daemon", "--port", "5050"])).toEqual({
      daemon: true,
      port: 5050,
      help: false,
    });
    expect(parseCliArgs(["--port=5050", "--daemon"])).toEqual({
      daemon: true,
      port: 5050,
      help: false,
    });
  });

  it("ignores unrecognized flags rather than throwing", () => {
    expect(parseCliArgs(["--wat", "--daemon"]).daemon).toBe(true);
  });
});
