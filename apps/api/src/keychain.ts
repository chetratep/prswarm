// OS-native secret storage, no third-party dependency: keytar (the obvious
// npm package for this) is a native addon, and native addons are exactly
// what this project's bun:sqlite choice deliberately avoided (see
// .claude/rules/data-model.md and the Runtime migration history) — bundling
// one into `bun build --compile`'s single-file cross-platform binary is
// unreliable. Shells out to each OS's own tool instead, same pattern as
// cli/openBrowser.ts.
//
// Only reachable on a desktop session: macOS always has `security`; Windows
// Credential Manager works even headless; Linux's `secret-tool` needs a
// running desktop keyring (GNOME Keyring/KWallet) and is simply absent on a
// headless server or inside Docker — every function here degrades to
// undefined/false in that case rather than throwing, so callers (secrets.ts)
// can fall through to the existing file/env key storage unconditionally.
//
// The Windows branch invokes PowerShell with `-File <path>` rather than
// `-Command <script text>`. This was verified the hard way: `-Command` does
// NOT bind trailing `-Action write -Target ... -Value ...` arguments to the
// script's `param()` block the way `-File` does — PowerShell instead tries
// to execute `-Action` itself as a command and fails with
// "CommandNotFoundException". `-File` binds them correctly, so the script
// text is written to a temp file once per call and invoked from there.

import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const WINDOWS_CRED_SCRIPT = String.raw`
param([string]$Action, [string]$Target, [string]$Value)
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class CredManager {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct CREDENTIAL {
    public int Flags; public int Type; public string TargetName; public string Comment;
    public long LastWritten; public int CredentialBlobSize; public IntPtr CredentialBlob;
    public int Persist; public int AttributeCount; public IntPtr Attributes;
    public string TargetAlias; public string UserName;
  }
  [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  public static extern bool CredWrite([In] ref CREDENTIAL credential, uint flags);
  [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  public static extern bool CredRead(string target, int type, int flags, out IntPtr credentialPtr);
  [DllImport("advapi32.dll")]
  public static extern void CredFree(IntPtr credentialPtr);
}
"@
if ($Action -eq "write") {
  $bytes = [System.Text.Encoding]::Unicode.GetBytes($Value)
  $blob = [Runtime.InteropServices.Marshal]::AllocHGlobal($bytes.Length)
  [Runtime.InteropServices.Marshal]::Copy($bytes, 0, $blob, $bytes.Length)
  $cred = New-Object CredManager+CREDENTIAL
  $cred.Type = 1; $cred.TargetName = $Target; $cred.CredentialBlobSize = $bytes.Length
  $cred.CredentialBlob = $blob; $cred.Persist = 2; $cred.UserName = "prswarm"
  $ok = [CredManager]::CredWrite([ref]$cred, 0)
  [Runtime.InteropServices.Marshal]::FreeHGlobal($blob)
  if (-not $ok) { exit 1 }
} else {
  $ptr = [IntPtr]::Zero
  $ok = [CredManager]::CredRead($Target, 1, 0, [ref]$ptr)
  if (-not $ok) { exit 1 }
  $cred = [Runtime.InteropServices.Marshal]::PtrToStructure($ptr, [type][CredManager+CREDENTIAL])
  $value = [Runtime.InteropServices.Marshal]::PtrToStringUni($cred.CredentialBlob, $cred.CredentialBlobSize / 2)
  [CredManager]::CredFree($ptr)
  Write-Output $value
}
`;

// Writes the credential-manager helper script to a temp file and returns its
// path, ready to pass to `powershell -File`. Written fresh on every call
// (the script is tiny) rather than cached, so it can never go stale relative
// to the constant above and there's no first-run/race-condition bookkeeping.
function writeWindowsCredScript(): string {
  const scriptPath = join(tmpdir(), "prswarm-credmanager-helper.ps1");
  writeFileSync(scriptPath, WINDOWS_CRED_SCRIPT, "utf8");
  return scriptPath;
}

function runSpawn(
  spawnSyncImpl: typeof Bun.spawnSync,
  cmd: string[],
  stdin?: string
): { exitCode: number; stdout: string } {
  try {
    const result = stdin !== undefined ? spawnSyncImpl(cmd, { stdin: Buffer.from(stdin) }) : spawnSyncImpl(cmd);
    return { exitCode: result.exitCode ?? 1, stdout: result.stdout?.toString("utf8").trim() ?? "" };
  } catch {
    // Tool not installed (ENOENT) or any other spawn failure — treat exactly
    // like "not found", never throw. This is what lets a headless Linux box
    // with no secret-tool fall straight through to the file/env key source.
    return { exitCode: 1, stdout: "" };
  }
}

// Windows-only: writes the helper script to a temp file, then spawns
// PowerShell against it. The script write happens outside `runSpawn`'s own
// try/catch (it's a filesystem call, not a spawn call), so it needs its own
// failure boundary here — a write failure (permissions, disk full, an AV
// lock on the temp file) must degrade to the same "not found" result as a
// missing `security`/`secret-tool` binary does on the other platforms, per
// this file's own contract that every exported function here never throws.
function runWindowsCredCommand(
  spawnSyncImpl: typeof Bun.spawnSync,
  action: "read" | "write",
  target: string,
  value?: string
): { exitCode: number; stdout: string } {
  let scriptPath: string;
  try {
    scriptPath = writeWindowsCredScript();
  } catch {
    return { exitCode: 1, stdout: "" };
  }

  const cmd = ["powershell", "-NoProfile", "-NonInteractive", "-File", scriptPath, "-Action", action, "-Target", target];
  if (value !== undefined) cmd.push("-Value", value);

  return runSpawn(spawnSyncImpl, cmd);
}

export function getFromKeychain(
  service: string,
  account: string,
  spawnSyncImpl: typeof Bun.spawnSync = Bun.spawnSync,
  platform: NodeJS.Platform = process.platform
): string | undefined {
  const target = `${service}/${account}`;

  if (platform === "win32") {
    const { exitCode, stdout } = runWindowsCredCommand(spawnSyncImpl, "read", target);
    return exitCode === 0 && stdout.length > 0 ? stdout : undefined;
  }

  const cmd =
    platform === "darwin"
      ? ["security", "find-generic-password", "-a", account, "-s", service, "-w"]
      : ["secret-tool", "lookup", "service", service, "account", account];

  const { exitCode, stdout } = runSpawn(spawnSyncImpl, cmd);
  return exitCode === 0 && stdout.length > 0 ? stdout : undefined;
}

export function setInKeychain(
  service: string,
  account: string,
  value: string,
  spawnSyncImpl: typeof Bun.spawnSync = Bun.spawnSync,
  platform: NodeJS.Platform = process.platform
): boolean {
  const target = `${service}/${account}`;

  if (platform === "darwin") {
    const { exitCode } = runSpawn(spawnSyncImpl, [
      "security",
      "add-generic-password",
      "-a",
      account,
      "-s",
      service,
      "-w",
      value,
      "-U",
    ]);
    return exitCode === 0;
  }

  if (platform === "win32") {
    const { exitCode } = runWindowsCredCommand(spawnSyncImpl, "write", target, value);
    return exitCode === 0;
  }

  // secret-tool's own contract: `store` reads the secret from stdin, not
  // argv — passing it as a command-line argument would leak it into process
  // listings (`ps`) on any multi-user Linux box, which defeats the point of
  // using a keychain in the first place.
  const { exitCode } = runSpawn(
    spawnSyncImpl,
    ["secret-tool", "store", "--label", service, "service", service, "account", account],
    value
  );
  return exitCode === 0;
}
