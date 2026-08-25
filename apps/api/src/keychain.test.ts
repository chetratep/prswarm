import { describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import { deleteFromKeychain, getFromKeychain, setInKeychain } from "./keychain.js";

function fakeSpawnResult(exitCode: number, stdout = ""): ReturnType<typeof Bun.spawnSync> {
  return {
    exitCode,
    stdout: Buffer.from(stdout),
    stderr: Buffer.from(""),
    success: exitCode === 0,
  } as unknown as ReturnType<typeof Bun.spawnSync>;
}

describe("getFromKeychain", () => {
  it("returns the stored value on macOS (security CLI)", () => {
    const spawn = vi.fn().mockReturnValue(fakeSpawnResult(0, "deadbeef\n"));
    const result = getFromKeychain("prswarm", "encryption-key", spawn, "darwin");
    expect(result).toBe("deadbeef");
    expect(spawn).toHaveBeenCalledWith(
      ["security", "find-generic-password", "-a", "encryption-key", "-s", "prswarm", "-w"]
    );
  });

  it("returns the stored value on Windows (Credential Manager via PowerShell)", () => {
    const spawn = vi.fn().mockReturnValue(fakeSpawnResult(0, "deadbeef\n"));
    const result = getFromKeychain("prswarm", "encryption-key", spawn, "win32");
    expect(result).toBe("deadbeef");
    const calledCmd = (spawn.mock.calls[0] as [string[]])[0];
    expect(calledCmd[0]).toBe("powershell");
    expect(calledCmd).toContain("-Action");
    expect(calledCmd).toContain("read");
    expect(calledCmd).toContain("prswarm/encryption-key");
  });

  it("bypasses the PowerShell execution policy, which is Restricted by default on Windows clients", () => {
    // Without this the -File invocation is refused outright on a
    // default-policy or GPO-managed (AllSigned) machine — and since every
    // failure here degrades to undefined by contract, that refusal is
    // indistinguishable from "no entry stored", silently downgrading the
    // install to a plaintext key file with no indication to the user.
    const spawn = vi.fn().mockReturnValue(fakeSpawnResult(0, "deadbeef\n"));
    getFromKeychain("prswarm", "encryption-key", spawn, "win32");
    const calledCmd = (spawn.mock.calls[0] as [string[]])[0];
    expect(calledCmd).toContain("-ExecutionPolicy");
    expect(calledCmd[calledCmd.indexOf("-ExecutionPolicy") + 1]).toBe("Bypass");
    // ...and it has to come before -File: PowerShell stops parsing its own
    // options once -File is seen, treating everything after as script args.
    expect(calledCmd.indexOf("-ExecutionPolicy")).toBeLessThan(calledCmd.indexOf("-File"));
  });

  it("returns the stored value on Linux (secret-tool)", () => {
    const spawn = vi.fn().mockReturnValue(fakeSpawnResult(0, "deadbeef\n"));
    const result = getFromKeychain("prswarm", "encryption-key", spawn, "linux");
    expect(result).toBe("deadbeef");
    expect(spawn).toHaveBeenCalledWith(
      ["secret-tool", "lookup", "service", "prswarm", "account", "encryption-key"]
    );
  });

  it("returns undefined when the platform tool exits non-zero (entry not found)", () => {
    const spawn = vi.fn().mockReturnValue(fakeSpawnResult(1));
    expect(getFromKeychain("prswarm", "encryption-key", spawn, "darwin")).toBeUndefined();
  });

  it("returns undefined, not throws, when the platform tool isn't installed at all", () => {
    const spawn = vi.fn(() => {
      throw new Error("ENOENT: command not found");
    }) as unknown as typeof Bun.spawnSync;
    expect(() => getFromKeychain("prswarm", "encryption-key", spawn, "linux")).not.toThrow();
    expect(getFromKeychain("prswarm", "encryption-key", spawn, "linux")).toBeUndefined();
  });

  it("returns undefined, not throws, when writing the Windows helper script fails (disk full, permissions, AV lock)", () => {
    const writeSpy = vi.spyOn(fs, "writeFileSync").mockImplementation(() => {
      throw new Error("EACCES: permission denied");
    });
    const spawn = vi.fn();
    try {
      expect(() => getFromKeychain("prswarm", "encryption-key", spawn, "win32")).not.toThrow();
      expect(getFromKeychain("prswarm", "encryption-key", spawn, "win32")).toBeUndefined();
      // The spawn call must never happen once the script write itself failed.
      expect(spawn).not.toHaveBeenCalled();
    } finally {
      writeSpy.mockRestore();
    }
  });
});

describe("setInKeychain", () => {
  it("returns true on macOS when the security CLI succeeds", () => {
    const spawn = vi.fn().mockReturnValue(fakeSpawnResult(0));
    expect(setInKeychain("prswarm", "encryption-key", "deadbeef", spawn, "darwin")).toBe(true);
    expect(spawn).toHaveBeenCalledWith(
      ["security", "add-generic-password", "-a", "encryption-key", "-s", "prswarm", "-w", "deadbeef", "-U"]
    );
  });

  it("returns true on Windows when the PowerShell CredWrite call succeeds", () => {
    const spawn = vi.fn().mockReturnValue(fakeSpawnResult(0));
    expect(setInKeychain("prswarm", "encryption-key", "deadbeef", spawn, "win32")).toBe(true);
    const calledCmd = (spawn.mock.calls[0] as [string[]])[0];
    expect(calledCmd).toContain("write");
    expect(calledCmd).toContain("deadbeef");
  });

  it("returns true on Linux and pipes the value via stdin, not argv (secret-tool's own contract)", () => {
    const spawn = vi.fn().mockReturnValue(fakeSpawnResult(0));
    expect(setInKeychain("prswarm", "encryption-key", "deadbeef", spawn, "linux")).toBe(true);
    const [calledCmd, calledOptions] = spawn.mock.calls[0] as [string[], { stdin?: Buffer }];
    expect(calledCmd.join(" ")).not.toContain("deadbeef"); // must not leak the secret into argv/process listings
    expect(calledOptions?.stdin?.toString("utf8")).toBe("deadbeef");
  });

  it("returns false, not throws, on failure", () => {
    const spawn = vi.fn().mockReturnValue(fakeSpawnResult(1));
    expect(setInKeychain("prswarm", "encryption-key", "deadbeef", spawn, "darwin")).toBe(false);
  });

  it("returns false, not throws, when writing the Windows helper script fails (disk full, permissions, AV lock)", () => {
    const writeSpy = vi.spyOn(fs, "writeFileSync").mockImplementation(() => {
      throw new Error("ENOSPC: no space left on device");
    });
    const spawn = vi.fn();
    try {
      expect(() => setInKeychain("prswarm", "encryption-key", "deadbeef", spawn, "win32")).not.toThrow();
      expect(setInKeychain("prswarm", "encryption-key", "deadbeef", spawn, "win32")).toBe(false);
      // The spawn call must never happen once the script write itself failed.
      expect(spawn).not.toHaveBeenCalled();
    } finally {
      writeSpy.mockRestore();
    }
  });
});

describe("deleteFromKeychain", () => {
  it("returns true on macOS when the security CLI succeeds", () => {
    const spawn = vi.fn().mockReturnValue(fakeSpawnResult(0));
    expect(deleteFromKeychain("prswarm", "encryption-key", spawn, "darwin")).toBe(true);
    expect(spawn).toHaveBeenCalledWith([
      "security",
      "delete-generic-password",
      "-a",
      "encryption-key",
      "-s",
      "prswarm",
    ]);
  });

  it("returns true on Windows when the PowerShell CredDelete call succeeds", () => {
    const spawn = vi.fn().mockReturnValue(fakeSpawnResult(0));
    expect(deleteFromKeychain("prswarm", "encryption-key", spawn, "win32")).toBe(true);
    const calledCmd = (spawn.mock.calls[0] as [string[]])[0];
    expect(calledCmd[0]).toBe("powershell");
    expect(calledCmd).toContain("-ExecutionPolicy");
    expect(calledCmd).toContain("-Action");
    expect(calledCmd).toContain("delete");
    expect(calledCmd).toContain("prswarm/encryption-key");
  });

  it("returns true on Linux (secret-tool clear)", () => {
    const spawn = vi.fn().mockReturnValue(fakeSpawnResult(0));
    expect(deleteFromKeychain("prswarm", "encryption-key", spawn, "linux")).toBe(true);
    expect(spawn).toHaveBeenCalledWith([
      "secret-tool",
      "clear",
      "service",
      "prswarm",
      "account",
      "encryption-key",
    ]);
  });

  it("returns false when there was nothing stored to delete", () => {
    const spawn = vi.fn().mockReturnValue(fakeSpawnResult(1));
    expect(deleteFromKeychain("prswarm", "encryption-key", spawn, "darwin")).toBe(false);
  });

  it("returns false, not throws, when the platform tool isn't installed at all", () => {
    const spawn = vi.fn(() => {
      throw new Error("ENOENT: command not found");
    }) as unknown as typeof Bun.spawnSync;
    expect(() => deleteFromKeychain("prswarm", "encryption-key", spawn, "linux")).not.toThrow();
    expect(deleteFromKeychain("prswarm", "encryption-key", spawn, "linux")).toBe(false);
  });

  it("returns false, not throws, when writing the Windows helper script fails", () => {
    const writeSpy = vi.spyOn(fs, "writeFileSync").mockImplementation(() => {
      throw new Error("EACCES: permission denied");
    });
    const spawn = vi.fn();
    try {
      expect(() => deleteFromKeychain("prswarm", "encryption-key", spawn, "win32")).not.toThrow();
      expect(deleteFromKeychain("prswarm", "encryption-key", spawn, "win32")).toBe(false);
      expect(spawn).not.toHaveBeenCalled();
    } finally {
      writeSpy.mockRestore();
    }
  });
});
