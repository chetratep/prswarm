import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import type { FastifyInstance } from "fastify";
import type { AppDatabase } from "../db.js";
import { readLastUsedPort } from "./cliConfig.js";
import { runInteractiveCli } from "./interactiveCli.js";

let tempDir: string;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "prswarm-interactive-cli-test-"));
});

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

// readline needs distinct Readable/Writable streams per test; a shared
// PassThrough would let one test's leftover input bleed into the next.
function makeIo() {
  const input = new PassThrough();
  const output = new PassThrough();
  output.on("data", () => {}); // drain so writes never back up
  return { input, output };
}

// readline only registers the *next* question's callback once whatever
// precedes it (the previous question's promise, or an awaited `listen()`
// call for e.g. the initialPort path) actually resolves — which happens on
// a later microtask/timer tick, not synchronously. Writing immediately
// after starting/answering the previous prompt can land before that
// registration, so the line is silently dropped (readline was "listening"
// from interface creation, just with no question callback attached yet) and
// the next rl.question() hangs forever. Waiting *before* every write, not
// just between them, gives that registration time to happen first —
// including before the very first write in a test.
async function type(input: PassThrough, line: string): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 20));
  input.write(`${line}\n`);
}

function fakeApp(): FastifyInstance {
  return { close: vi.fn().mockResolvedValue(undefined) } as unknown as FastifyInstance;
}

function fakeDb(): AppDatabase {
  return { close: vi.fn() } as unknown as AppDatabase;
}

/** exit() is typed `never` and must actually stop execution like the real
 * process.exit does, or the code after it in interactiveCli.ts would keep
 * running against a torn-down app/db. Throwing a recognizable sentinel and
 * catching it in the test reproduces that without killing the test worker. */
class ExitSignal extends Error {
  constructor(public code: number) {
    super(`exit(${code})`);
  }
}

function fakeExit(): { exit: (code: number) => never; calls: number[] } {
  const calls: number[] = [];
  const exit = (code: number): never => {
    calls.push(code);
    throw new ExitSignal(code);
  };
  return { exit, calls };
}

async function expectExit(promise: Promise<void>, code: number): Promise<void> {
  await expect(promise).rejects.toThrow(ExitSignal);
  await promise.catch((err) => {
    expect((err as ExitSignal).code).toBe(code);
  });
}

/** runInteractiveCli's returned promise rejects (via the injected exit()
 * throwing ExitSignal) partway through the `type()` calls that follow it in
 * every test below — well before expectExit gets to attach its own
 * handler. Node/Bun both flag a promise as an unhandled rejection the
 * moment it settles with no handler attached yet, so without this the test
 * runner reports a spurious failure even though expectExit goes on to
 * handle it correctly. Attaching a no-op catch immediately (a promise can
 * have more than one) marks it handled right away without affecting the
 * real assertion in expectExit later. */
function start(options: Parameters<typeof runInteractiveCli>[0]): Promise<void> {
  const run = runInteractiveCli(options);
  run.catch(() => {});
  return run;
}

describe("runInteractiveCli", () => {
  it("accepts the default port on empty input and persists it", async () => {
    const { input, output } = makeIo();
    const app = fakeApp();
    const db = fakeDb();
    const listen = vi.fn().mockResolvedValue(app);
    const { exit } = fakeExit();

    const run = start({ dataDir: tempDir, db, listen, input, output, exit });
    await type(input, ""); // accept default port 3000
    await type(input, "x"); // exit

    await expectExit(run, 0);
    expect(listen).toHaveBeenCalledWith(3000);
    expect(readLastUsedPort(tempDir)).toBe(3000);
    expect(app.close).toHaveBeenCalled();
    expect(db.close).toHaveBeenCalled();
  });

  it("uses the last-used port as the new default", async () => {
    const { input, output } = makeIo();
    const listen = vi.fn().mockResolvedValue(fakeApp());
    const { exit } = fakeExit();
    fs.mkdirSync(tempDir, { recursive: true });
    fs.writeFileSync(path.join(tempDir, "cli-config.json"), JSON.stringify({ port: 9999 }));

    const run = start({ dataDir: tempDir, db: fakeDb(), listen, input, output, exit });
    await type(input, "");
    await type(input, "x");

    await expectExit(run, 0);
    expect(listen).toHaveBeenCalledWith(9999);
  });

  it("re-prompts on invalid port input instead of accepting it", async () => {
    const { input, output } = makeIo();
    const listen = vi.fn().mockResolvedValue(fakeApp());
    const { exit } = fakeExit();

    const run = start({ dataDir: tempDir, db: fakeDb(), listen, input, output, exit });
    await type(input, "not-a-port");
    await type(input, "99999"); // out of range
    await type(input, "4200");
    await type(input, "x");

    await expectExit(run, 0);
    expect(listen).toHaveBeenCalledTimes(1);
    expect(listen).toHaveBeenCalledWith(4200);
  });

  it("re-prompts when the chosen port is already in use", async () => {
    const { input, output } = makeIo();
    const app = fakeApp();
    const eaddrinuse = Object.assign(new Error("in use"), { code: "EADDRINUSE" });
    const listen = vi.fn().mockRejectedValueOnce(eaddrinuse).mockResolvedValueOnce(app);
    const { exit } = fakeExit();

    const run = start({ dataDir: tempDir, db: fakeDb(), listen, input, output, exit });
    await type(input, "3000");
    await type(input, "3001");
    await type(input, "x");

    await expectExit(run, 0);
    expect(listen).toHaveBeenNthCalledWith(1, 3000);
    expect(listen).toHaveBeenNthCalledWith(2, 3001);
    expect(readLastUsedPort(tempDir)).toBe(3001);
  });

  it("skips the prompt when initialPort is given, but still shows the menu", async () => {
    const { input, output } = makeIo();
    const listen = vi.fn().mockResolvedValue(fakeApp());
    const { exit } = fakeExit();

    const run = start({
      dataDir: tempDir,
      db: fakeDb(),
      listen,
      initialPort: 5050,
      input,
      output,
      exit,
    });
    await type(input, "x");

    await expectExit(run, 0);
    expect(listen).toHaveBeenCalledWith(5050);
    expect(readLastUsedPort(tempDir)).toBe(5050);
  });

  it("falls back to the prompt if initialPort is already in use", async () => {
    const { input, output } = makeIo();
    const eaddrinuse = Object.assign(new Error("in use"), { code: "EADDRINUSE" });
    const listen = vi.fn().mockRejectedValueOnce(eaddrinuse).mockResolvedValueOnce(fakeApp());
    const { exit } = fakeExit();

    const run = start({
      dataDir: tempDir,
      db: fakeDb(),
      listen,
      initialPort: 3000,
      input,
      output,
      exit,
    });
    await type(input, "3005");
    await type(input, "x");

    await expectExit(run, 0);
    expect(listen).toHaveBeenNthCalledWith(1, 3000);
    expect(listen).toHaveBeenNthCalledWith(2, 3005);
  });

  it("opens the browser via the injected opener and keeps running", async () => {
    const { input, output } = makeIo();
    const listen = vi.fn().mockResolvedValue(fakeApp());
    const openBrowser = vi.fn().mockResolvedValue(true);
    const { exit } = fakeExit();

    const run = start({
      dataDir: tempDir,
      db: fakeDb(),
      listen,
      input,
      output,
      openBrowser,
      exit,
    });
    await type(input, "3000");
    await type(input, "o");
    await type(input, "x");

    await expectExit(run, 0);
    expect(openBrowser).toHaveBeenCalledWith("http://localhost:3000");
  });

  it("changing port closes the current app/db and hands off via spawnRestart", async () => {
    const { input, output } = makeIo();
    const app = fakeApp();
    const db = fakeDb();
    const listen = vi.fn().mockResolvedValue(app);
    const spawnRestart = vi.fn();
    const { exit } = fakeExit();

    const run = start({
      dataDir: tempDir,
      db,
      listen,
      input,
      output,
      spawnRestart,
      exit,
    });
    await type(input, "3000");
    await type(input, "p");
    await type(input, "4000");

    await expectExit(run, 0);
    expect(app.close).toHaveBeenCalled();
    expect(db.close).toHaveBeenCalled();
    expect(spawnRestart).toHaveBeenCalledWith(4000);
  });

  it("does nothing when asked to change port to the port already running", async () => {
    const { input, output } = makeIo();
    const spawnRestart = vi.fn();
    const listen = vi.fn().mockResolvedValue(fakeApp());
    const { exit } = fakeExit();

    const run = start({
      dataDir: tempDir,
      db: fakeDb(),
      listen,
      input,
      output,
      spawnRestart,
      exit,
    });
    await type(input, "3000");
    await type(input, "p");
    await type(input, "3000");
    await type(input, "x");

    await expectExit(run, 0);
    expect(spawnRestart).not.toHaveBeenCalled();
  });

  it("clearing app data requires typing DELETE exactly, and does nothing otherwise", async () => {
    const { input, output } = makeIo();
    const rmDataDir = vi.fn();
    const listen = vi.fn().mockResolvedValue(fakeApp());
    const { exit } = fakeExit();

    const run = start({
      dataDir: tempDir,
      db: fakeDb(),
      listen,
      input,
      output,
      rmDataDir,
      exit,
    });
    await type(input, "3000");
    await type(input, "c");
    await type(input, "yes"); // wrong confirmation phrase
    await type(input, "x");

    await expectExit(run, 0);
    expect(rmDataDir).not.toHaveBeenCalled();
  });

  it("clearing app data with DELETE closes app/db and wipes the data dir", async () => {
    const { input, output } = makeIo();
    const app = fakeApp();
    const db = fakeDb();
    const rmDataDir = vi.fn();
    const listen = vi.fn().mockResolvedValue(app);
    const { exit } = fakeExit();

    const run = start({
      dataDir: tempDir,
      db,
      listen,
      input,
      output,
      rmDataDir,
      exit,
    });
    await type(input, "3000");
    await type(input, "c");
    await type(input, "DELETE");

    await expectExit(run, 0);
    expect(app.close).toHaveBeenCalled();
    expect(db.close).toHaveBeenCalled();
    expect(rmDataDir).toHaveBeenCalledWith(tempDir);
  });

  it("ignores an unrecognized menu choice and keeps prompting", async () => {
    const { input, output } = makeIo();
    const listen = vi.fn().mockResolvedValue(fakeApp());
    const { exit } = fakeExit();

    const run = start({ dataDir: tempDir, db: fakeDb(), listen, input, output, exit });
    await type(input, "3000");
    await type(input, "banana");
    await type(input, "x");

    await expectExit(run, 0);
  });

  it("configuring Slack saves a valid https:// URL", async () => {
    const { input, output } = makeIo();
    const listen = vi.fn().mockResolvedValue(fakeApp());
    const getSlackWebhookStatus = vi.fn().mockReturnValue({ url: null, source: null });
    const setSlackWebhookUrl = vi.fn();
    const { exit } = fakeExit();

    const run = start({
      dataDir: tempDir,
      db: fakeDb(),
      listen,
      input,
      output,
      getSlackWebhookStatus,
      setSlackWebhookUrl,
      exit,
    });
    await type(input, "3000");
    await type(input, "s");
    await type(input, "https://hooks.slack.com/services/x");
    await type(input, "x");

    await expectExit(run, 0);
    expect(setSlackWebhookUrl).toHaveBeenCalledWith("https://hooks.slack.com/services/x");
  });

  it("configuring Slack rejects a value that doesn't look like a URL", async () => {
    const { input, output } = makeIo();
    const listen = vi.fn().mockResolvedValue(fakeApp());
    const getSlackWebhookStatus = vi.fn().mockReturnValue({ url: null, source: null });
    const setSlackWebhookUrl = vi.fn();
    const { exit } = fakeExit();

    const run = start({
      dataDir: tempDir,
      db: fakeDb(),
      listen,
      input,
      output,
      getSlackWebhookStatus,
      setSlackWebhookUrl,
      exit,
    });
    await type(input, "3000");
    await type(input, "s");
    await type(input, "not-a-url");
    await type(input, "x");

    await expectExit(run, 0);
    expect(setSlackWebhookUrl).not.toHaveBeenCalled();
  });

  it('configuring Slack with "clear" removes the configured URL', async () => {
    const { input, output } = makeIo();
    const listen = vi.fn().mockResolvedValue(fakeApp());
    const getSlackWebhookStatus = vi.fn().mockReturnValue({
      url: "https://hooks.slack.com/services/existing",
      source: "db",
    });
    const clearSlackWebhookUrl = vi.fn();
    const { exit } = fakeExit();

    const run = start({
      dataDir: tempDir,
      db: fakeDb(),
      listen,
      input,
      output,
      getSlackWebhookStatus,
      clearSlackWebhookUrl,
      exit,
    });
    await type(input, "3000");
    await type(input, "s");
    await type(input, "clear");
    await type(input, "x");

    await expectExit(run, 0);
    expect(clearSlackWebhookUrl).toHaveBeenCalled();
  });

  it("configuring Slack with a blank answer leaves the existing value unchanged", async () => {
    const { input, output } = makeIo();
    const listen = vi.fn().mockResolvedValue(fakeApp());
    const getSlackWebhookStatus = vi.fn().mockReturnValue({
      url: "https://hooks.slack.com/services/existing",
      source: "db",
    });
    const setSlackWebhookUrl = vi.fn();
    const clearSlackWebhookUrl = vi.fn();
    const { exit } = fakeExit();

    const run = start({
      dataDir: tempDir,
      db: fakeDb(),
      listen,
      input,
      output,
      getSlackWebhookStatus,
      setSlackWebhookUrl,
      clearSlackWebhookUrl,
      exit,
    });
    await type(input, "3000");
    await type(input, "s");
    await type(input, "");
    await type(input, "x");

    await expectExit(run, 0);
    expect(setSlackWebhookUrl).not.toHaveBeenCalled();
    expect(clearSlackWebhookUrl).not.toHaveBeenCalled();
  });

  it("when SLACK_WEBHOOK_URL is env-sourced, skips prompting entirely and returns to the menu", async () => {
    const { input, output } = makeIo();
    const listen = vi.fn().mockResolvedValue(fakeApp());
    const getSlackWebhookStatus = vi.fn().mockReturnValue({
      url: "https://hooks.slack.com/services/from-env",
      source: "env",
    });
    const setSlackWebhookUrl = vi.fn();
    const { exit } = fakeExit();

    const run = start({
      dataDir: tempDir,
      db: fakeDb(),
      listen,
      input,
      output,
      getSlackWebhookStatus,
      setSlackWebhookUrl,
      exit,
    });
    await type(input, "3000");
    await type(input, "s");
    // No further input needed — env-sourced short-circuits straight back to
    // the menu without a prompt. If it *did* prompt, this "x" would answer
    // that prompt instead of the menu and the test would hang/mismatch.
    await type(input, "x");

    await expectExit(run, 0);
    expect(setSlackWebhookUrl).not.toHaveBeenCalled();
  });
});
