// Builds a single standalone binary of the whole app: the frontend is baked
// in (via embed-assets.ts), no .env/public folder is required to run it.
// Usage: bun run compile  (from repo root)
import { $ } from "bun";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");
const stubPath = path.join(repoRoot, "apps/api/src/embeddedAssets.generated.ts");
const stub = await Bun.file(stubPath).text();

const outfile = path.join(repoRoot, "dist/prswarm");

try {
  console.log("Building frontend...");
  await $`bun run --filter '@prswarm/web' build`.cwd(repoRoot);

  console.log("Embedding frontend into the API bundle...");
  await $`bun run apps/api/scripts/embed-assets.ts`.cwd(repoRoot);

  console.log("Compiling standalone binary...");
  await $`bun build apps/api/src/index.ts --compile --outfile ${outfile}`.cwd(repoRoot);

  console.log(`\nDone: ${outfile}${process.platform === "win32" ? ".exe" : ""}`);
} finally {
  // Restore the committed stub so `git status` stays clean — the generated
  // (multi-MB, base64-heavy) version only ever exists transiently here.
  await Bun.write(stubPath, stub);
}
