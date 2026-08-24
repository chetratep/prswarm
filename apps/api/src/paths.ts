// Cross-platform default data directory for this app's persisted state
// (SQLite DB, auto-generated encryption key) when no explicit path is
// configured via env vars. Hand-rolled rather than a dependency — this is
// well-known OS convention in ~15 lines, not worth a package.
import os from "node:os";
import path from "node:path";

const APP_NAME = "prdispatch";

export function defaultDataDir(): string {
  if (process.platform === "win32") {
    const appData = process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming");
    return path.join(appData, APP_NAME);
  }

  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", APP_NAME);
  }

  const xdgDataHome = process.env.XDG_DATA_HOME ?? path.join(os.homedir(), ".local", "share");
  return path.join(xdgDataHome, APP_NAME);
}
