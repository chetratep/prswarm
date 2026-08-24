// Persists the port picked in the standalone binary's startup wizard (see
// index.ts's runInteractiveWizard) so the *next* launch defaults to the same
// one instead of asking again from scratch. Lives in defaultDataDir()
// alongside the DB and encryption key — same reasoning as those (see
// paths.ts): a real per-OS "app data" location, not the repo/cwd. Deleted by
// the wizard's "clear app data" action along with everything else there,
// which is deliberate — that's a full reset, and re-prompting for a port on
// the next launch after a factory reset is the expected behavior, not a bug.
import fs from "node:fs";
import path from "node:path";

const CONFIG_FILE_NAME = "cli-config.json";

interface CliConfig {
  port?: number;
}

function configPath(dataDir: string): string {
  return path.join(dataDir, CONFIG_FILE_NAME);
}

export function readLastUsedPort(dataDir: string): number | null {
  try {
    const raw = fs.readFileSync(configPath(dataDir), "utf-8");
    const parsed: CliConfig = JSON.parse(raw);
    return typeof parsed.port === "number" && Number.isInteger(parsed.port) ? parsed.port : null;
  } catch {
    return null;
  }
}

export function saveLastUsedPort(dataDir: string, port: number): void {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(configPath(dataDir), JSON.stringify({ port } satisfies CliConfig, null, 2));
}
