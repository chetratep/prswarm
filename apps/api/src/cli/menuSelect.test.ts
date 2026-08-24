import { describe, expect, it, vi } from "vitest";
import { PassThrough } from "node:stream";
import { createInterface } from "node:readline/promises";
import { selectMenuOption, type MenuOption } from "./menuSelect.js";

const OPTIONS: MenuOption[] = [
  { key: "o", label: "Open in browser", value: "open" },
  { key: "p", label: "Change port", value: "port" },
  { key: "c", label: "Clear app data", value: "clear" },
  { key: "x", label: "Exit", value: "exit", aliases: ["q", "quit"] },
];

function makeOutput() {
  const output = new PassThrough();
  output.on("data", () => {}); // drain
  return output;
}

async function tick(ms = 20): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

describe("selectMenuOption — fallback (no raw mode)", () => {
  function fallbackInput(): NodeJS.ReadableStream {
    // A plain PassThrough has no setRawMode, so selectMenuOption must fall
    // back to the askQuestion-based prompt — this is also exactly what the
    // rest of the interactiveCli test suite's fake input looks like.
    return new PassThrough();
  }

  it("resolves via a matching key letter", async () => {
    const askQuestion = vi.fn().mockResolvedValue("c");
    const result = await selectMenuOption(fallbackInput(), makeOutput(), OPTIONS, askQuestion);
    expect(result).toBe("clear");
    expect(askQuestion).toHaveBeenCalledTimes(1);
  });

  it("resolves via the full value word", async () => {
    const askQuestion = vi.fn().mockResolvedValue("open");
    const result = await selectMenuOption(fallbackInput(), makeOutput(), OPTIONS, askQuestion);
    expect(result).toBe("open");
  });

  it("resolves via an alias", async () => {
    const askQuestion = vi.fn().mockResolvedValue("quit");
    const result = await selectMenuOption(fallbackInput(), makeOutput(), OPTIONS, askQuestion);
    expect(result).toBe("exit");
  });

  it("re-prompts on an unrecognized answer instead of resolving", async () => {
    const askQuestion = vi.fn().mockResolvedValueOnce("banana").mockResolvedValueOnce("x");
    const result = await selectMenuOption(fallbackInput(), makeOutput(), OPTIONS, askQuestion);
    expect(result).toBe("exit");
    expect(askQuestion).toHaveBeenCalledTimes(2);
  });

  it("is case-insensitive and trims whitespace", async () => {
    const askQuestion = vi.fn().mockResolvedValue("  O  ");
    const result = await selectMenuOption(fallbackInput(), makeOutput(), OPTIONS, askQuestion);
    expect(result).toBe("open");
  });
});

describe("selectMenuOption — arrow keys (raw mode)", () => {
  function rawModeInput(): PassThrough & { setRawMode: (mode: boolean) => void } {
    const input = new PassThrough() as PassThrough & { setRawMode: (mode: boolean) => void };
    input.setRawMode = () => {};
    return input;
  }

  it("Enter on first render selects the first option, never calling askQuestion", async () => {
    const input = rawModeInput();
    const askQuestion = vi.fn().mockRejectedValue(new Error("should not be called in raw mode"));
    const resultPromise = selectMenuOption(input, makeOutput(), OPTIONS, askQuestion);
    await tick();
    input.write("\r");
    expect(await resultPromise).toBe("open");
    expect(askQuestion).not.toHaveBeenCalled();
  });

  it("Down then Enter selects the second option", async () => {
    const input = rawModeInput();
    const resultPromise = selectMenuOption(input, makeOutput(), OPTIONS, vi.fn());
    await tick();
    input.write("\x1b[B"); // down
    await tick();
    input.write("\r");
    expect(await resultPromise).toBe("port");
  });

  it("Up from the first option wraps around to the last", async () => {
    const input = rawModeInput();
    const resultPromise = selectMenuOption(input, makeOutput(), OPTIONS, vi.fn());
    await tick();
    input.write("\x1b[A"); // up, wraps from index 0 to the last option
    await tick();
    input.write("\r");
    expect(await resultPromise).toBe("exit");
  });

  it("typing a key letter selects it immediately regardless of cursor position", async () => {
    const input = rawModeInput();
    const resultPromise = selectMenuOption(input, makeOutput(), OPTIONS, vi.fn());
    await tick();
    input.write("\x1b[B"); // move to "port" first, to prove the letter jump overrides it
    await tick();
    input.write("c");
    expect(await resultPromise).toBe("clear");
  });

  it("Ctrl+C resolves as exit (so the caller runs its normal graceful shutdown)", async () => {
    const input = rawModeInput();
    const resultPromise = selectMenuOption(input, makeOutput(), OPTIONS, vi.fn());
    await tick();
    input.write("\x03"); // Ctrl+C
    expect(await resultPromise).toBe("exit");
  });

  it("still receives keypresses after a prior readline.Interface on the same stream was closed", async () => {
    // Regression test: interactiveCli.ts's askQuestion() (the port prompt,
    // "New port", the DELETE confirmation) runs a readline.Interface and
    // closes it right after — and Interface#close() explicitly pauses the
    // stream. Node doesn't auto-resume an explicitly-paused stream just
    // because a new listener gets attached, so without menuSelect.ts's
    // input.resume() call, every keypress here would silently vanish and
    // the menu would look completely frozen (reproduced and confirmed
    // live before adding the fix, not a guess).
    const input = rawModeInput();
    const output = makeOutput();
    const rl = createInterface({ input, output });
    const questionPromise = rl.question("port? ");
    input.write("3000\n");
    await questionPromise;
    rl.close();
    expect(input.readableFlowing).toBe(false);

    const resultPromise = selectMenuOption(input, output, OPTIONS, vi.fn());
    await tick();
    input.write("\r");
    expect(await resultPromise).toBe("open");
  });

  it("restores cooked mode (setRawMode(false)) after resolving", async () => {
    const input = rawModeInput();
    const setRawModeSpy = vi.spyOn(input, "setRawMode");
    const resultPromise = selectMenuOption(input, makeOutput(), OPTIONS, vi.fn());
    await tick();
    input.write("\r");
    await resultPromise;
    expect(setRawModeSpy).toHaveBeenNthCalledWith(1, true);
    expect(setRawModeSpy).toHaveBeenNthCalledWith(2, false);
  });
});
