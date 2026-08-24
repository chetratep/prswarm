import { afterEach, describe, expect, it } from "vitest";
import { color } from "./color.js";

const originalIsTTY = process.stdout.isTTY;
const originalNoColor = process.env.NO_COLOR;

function setTTY(value: boolean | undefined): void {
  Object.defineProperty(process.stdout, "isTTY", { value, configurable: true });
}

afterEach(() => {
  setTTY(originalIsTTY);
  if (originalNoColor === undefined) delete process.env.NO_COLOR;
  else process.env.NO_COLOR = originalNoColor;
});

describe("color", () => {
  it("wraps text in the right ANSI codes when stdout is a TTY", () => {
    setTTY(true);
    delete process.env.NO_COLOR;
    expect(color.bold("x")).toBe("\x1b[1mx\x1b[0m");
    expect(color.dim("x")).toBe("\x1b[2mx\x1b[0m");
    expect(color.underline("x")).toBe("\x1b[4mx\x1b[0m");
    expect(color.red("x")).toBe("\x1b[31mx\x1b[0m");
    expect(color.green("x")).toBe("\x1b[32mx\x1b[0m");
    expect(color.yellow("x")).toBe("\x1b[33mx\x1b[0m");
    expect(color.cyan("x")).toBe("\x1b[36mx\x1b[0m");
    expect(color.gray("x")).toBe("\x1b[90mx\x1b[0m");
  });

  it("nests correctly (each layer's own reset doesn't erase the outer style)", () => {
    setTTY(true);
    delete process.env.NO_COLOR;
    const nested = color.bold(color.cyan("x"));
    expect(nested.startsWith("\x1b[1m\x1b[36m")).toBe(true);
    expect(nested.endsWith("x\x1b[0m\x1b[0m")).toBe(true);
  });

  it("returns plain text when stdout is not a TTY", () => {
    setTTY(false);
    delete process.env.NO_COLOR;
    expect(color.bold("x")).toBe("x");
    expect(color.red("x")).toBe("x");
  });

  it("returns plain text when NO_COLOR is set, even on a TTY", () => {
    setTTY(true);
    process.env.NO_COLOR = "1";
    expect(color.cyan("x")).toBe("x");
  });
});
