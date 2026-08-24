// Opens a URL in the OS default browser. Each platform's launcher is a
// different program with no common flag set, hence the switch rather than
// one shared invocation. Never throws: opening a browser is a convenience
// for the standalone binary's interactive menu, not something worth taking
// the process down over on a headless box with no browser/xdg-open.
export async function openInBrowser(url: string): Promise<boolean> {
  const cmd =
    process.platform === "win32"
      ? ["cmd", "/c", "start", '""', url]
      : process.platform === "darwin"
        ? ["open", url]
        : ["xdg-open", url];

  try {
    const proc = Bun.spawn(cmd, { stdout: "ignore", stderr: "ignore" });
    await proc.exited;
    return proc.exitCode === 0;
  } catch {
    return false;
  }
}
