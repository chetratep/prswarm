// Builds a single standalone binary of the whole app: the frontend is baked
// in (via embed-assets.ts), no .env/public folder is required to run it.
//
// Usage:
//   bun run compile                                            (local, native platform, -> dist/prswarm[.exe])
//   bun run compile -- --target=bun-linux-arm64 --outfile=dist/prswarm-linux-arm64
//                                                               (CI release matrix — see .github/workflows/release.yml)
//
// If apps/web/dist already exists (e.g. restored from a prior CI job's
// artifact so every target in the release matrix doesn't rebuild the
// identical frontend), the frontend build step is skipped.
import { $ } from "bun";
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");
const stubPath = path.join(repoRoot, "apps/api/src/embeddedAssets.generated.ts");
const stub = await Bun.file(stubPath).text();

const args = new Map<string, string>();
for (const arg of process.argv.slice(2)) {
  const [key, value] = arg.replace(/^--/, "").split(/=(.*)/s);
  if (key) args.set(key, value ?? "");
}

const target = args.get("target"); // e.g. "bun-linux-arm64" — see https://bun.com/docs/bundler/executables
const isWindowsTarget = target ? target.includes("windows") : process.platform === "win32";
// Confirmed live in the release workflow (cross-compiling bun-windows-x64
// from an ubuntu-latest runner): Bun rejects --windows-icon/--windows-title
// with "only available when compiling on Windows" unless the *host* is
// actually Windows, regardless of --target. So a cross-compiled Windows
// binary ships without the custom icon/title — a real Bun limitation, not
// a bug here — while `bun run compile` run directly on Windows (this
// machine, today) still gets both.
const canSetWindowsMetadata = isWindowsTarget && process.platform === "win32";
const outfile = args.has("outfile")
  ? path.resolve(repoRoot, args.get("outfile")!)
  : path.join(repoRoot, "dist/prswarm");

const webDistIndex = path.join(repoRoot, "apps/web/dist/index.html");

try {
  if (fs.existsSync(webDistIndex)) {
    console.log("apps/web/dist already exists, skipping frontend build.");
  } else {
    console.log("Building frontend...");
    await $`bun run --filter '@prswarm/web' build`.cwd(repoRoot);
  }

  console.log("Embedding frontend into the API bundle...");
  await $`bun run apps/api/scripts/embed-assets.ts`.cwd(repoRoot);

  console.log(`Compiling standalone binary${target ? ` for ${target}` : ""}...`);
  const compileArgs = ["build", "apps/api/src/index.ts", "--compile"];
  if (target) compileArgs.push(`--target=${target}`);
  compileArgs.push("--outfile", outfile);
  if (canSetWindowsMetadata) {
    const iconPath = path.join(repoRoot, "apps/web/public/favicon.ico");
    if (fs.existsSync(iconPath)) compileArgs.push(`--windows-icon=${iconPath}`);
    compileArgs.push("--windows-title=PRSwarm");
  }
  await $`bun ${compileArgs}`.cwd(repoRoot);

  // Bun appends .exe to the outfile itself for Windows targets regardless
  // of what was passed — report whichever path actually landed rather than
  // assuming.
  const producedPath = fs.existsSync(`${outfile}.exe`) ? `${outfile}.exe` : outfile;
  console.log(`\nDone: ${producedPath}`);
} finally {
  // Restore the committed stub so `git status` stays clean — the generated
  // (multi-MB, base64-heavy) version only ever exists transiently here.
  await Bun.write(stubPath, stub);
}
