// Arrow-key driven menu selector for a real terminal, with a plain
// type-the-letter-then-Enter fallback for anything that isn't (piped input,
// the test suite's fake streams, a terminal that doesn't support raw mode).
//
// Deliberately never coexists with a readline.Interface on the same input
// stream — mixing cooked-mode line editing (what `askQuestion` in
// interactiveCli.ts uses for text prompts) and raw-mode keypress listening
// on one stream at the same time is a well-known source of stray/duplicated
// input, since both attach their own listeners to the same underlying
// bytes. interactiveCli.ts avoids this by opening and closing a fresh
// readline.Interface per question rather than holding one open for its
// whole run — so by the time this module engages raw mode, nothing else is
// listening to `input`.
import readline from "node:readline";
import { color } from "./color.js";

export interface MenuOption {
  key: string;
  label: string;
  value: string;
  /** Extra full-word synonyms recognized by the text-prompt fallback (e.g.
   * "quit" for the exit option) — the arrow-mode path never needs these,
   * typed characters there match `key` directly. */
  aliases?: string[];
}

interface KeyEvent {
  name?: string;
  ctrl?: boolean;
}

type RawModeStream = NodeJS.ReadableStream & {
  setRawMode: (mode: boolean) => void;
  on(event: "keypress", listener: (str: string, key: KeyEvent) => void): unknown;
  removeListener(event: "keypress", listener: (str: string, key: KeyEvent) => void): unknown;
};

function supportsRawMode(input: NodeJS.ReadableStream): input is RawModeStream {
  return typeof (input as { setRawMode?: unknown }).setRawMode === "function";
}

const DIVIDER = color.dim("─".repeat(44));

function renderOption(opt: MenuOption, isSelected: boolean): string {
  const pointer = isSelected ? color.cyan("❯") : " ";
  const key = color.bold(color.cyan(opt.key));
  const label = isSelected ? color.bold(opt.label) : opt.label;
  return ` ${pointer} ${key}  ${label}`;
}

function menuLines(options: MenuOption[], selected: number): string[] {
  return [DIVIDER, ...options.map((opt, i) => renderOption(opt, i === selected)), DIVIDER];
}

/** Static render for the fallback path — no highlight, since there's no
 * live arrow-key selection to highlight without raw mode. */
function printMenuFallback(output: NodeJS.WritableStream, options: MenuOption[]): void {
  output.write(`${menuLines(options, -1).join("\n")}\n`);
}

async function selectViaArrowKeys(
  input: RawModeStream,
  output: NodeJS.WritableStream,
  options: MenuOption[]
): Promise<string> {
  return new Promise((resolve) => {
    let selected = 0;

    function draw(firstRender: boolean): void {
      if (!firstRender) {
        readline.moveCursor(output as NodeJS.WriteStream, 0, -(options.length + 2));
        readline.clearScreenDown(output as NodeJS.WriteStream);
      }
      output.write(`${menuLines(options, selected).join("\n")}\n`);
    }

    function cleanup(): void {
      input.removeListener("keypress", onKeypress);
      input.setRawMode(false);
    }

    function onKeypress(str: string, key: KeyEvent): void {
      // Ctrl+C behaves exactly like picking Exit — resolving normally lets
      // the caller run its usual graceful app/db shutdown, rather than a
      // raw process.exit() here that would skip it.
      if (key?.ctrl && key.name === "c") {
        cleanup();
        resolve("exit");
        return;
      }
      if (key?.name === "up" || key?.name === "k") {
        selected = (selected - 1 + options.length) % options.length;
        draw(false);
        return;
      }
      if (key?.name === "down" || key?.name === "j") {
        selected = (selected + 1) % options.length;
        draw(false);
        return;
      }
      if (key?.name === "return" || key?.name === "space") {
        cleanup();
        resolve(options[selected].value);
        return;
      }
      const typed = (str ?? "").toLowerCase();
      const match = options.find((opt) => opt.key === typed);
      if (match) {
        cleanup();
        resolve(match.value);
      }
    }

    readline.emitKeypressEvents(input);
    input.setRawMode(true);
    input.on("keypress", onKeypress);
    // Every question before this one (the port prompt, "New port", the
    // DELETE confirmation) ran through a readline.Interface that got
    // .close()'d right after — and Interface#close() explicitly pauses the
    // stream. Once a stream has been explicitly paused, merely attaching
    // another listener does NOT auto-resume it (that auto-flow behavior
    // only applies from a stream's initial, never-paused state) — without
    // this, no keypress ever arrives and the whole menu looks frozen.
    // Confirmed empirically: readableFlowing stays false post-close even
    // after emitKeypressEvents + the 'keypress' listener are attached.
    input.resume();
    draw(true);
  });
}

async function selectViaPrompt(
  output: NodeJS.WritableStream,
  options: MenuOption[],
  askQuestion: (prompt: string) => Promise<string>
): Promise<string> {
  printMenuFallback(output, options);
  for (;;) {
    const answer = (await askQuestion(`${color.cyan("❯")} `)).trim().toLowerCase();
    const match = options.find(
      (opt) => opt.key === answer || opt.value === answer || opt.aliases?.includes(answer)
    );
    if (match) return match.value;
    output.write(`${color.yellow("⚠")} Unrecognized option: "${answer}"\n`);
    printMenuFallback(output, options);
  }
}

/** Resolves to one of `options[].value` — same shape regardless of which
 * path ran, so callers don't need to care whether arrow keys were actually
 * available. `askQuestion` is only used by the fallback path. */
export async function selectMenuOption(
  input: NodeJS.ReadableStream,
  output: NodeJS.WritableStream,
  options: MenuOption[],
  askQuestion: (prompt: string) => Promise<string>
): Promise<string> {
  if (supportsRawMode(input)) {
    return selectViaArrowKeys(input, output, options);
  }
  return selectViaPrompt(output, options, askQuestion);
}
