// Minimal ANSI color helper for the interactive CLI — no dependency (see
// CLAUDE.md: conservative about adding dependencies), just the handful of
// codes actually used. Colors are opt-out by construction: disabled
// whenever stdout isn't a real terminal (piped/redirected output should
// stay clean of escape codes) or NO_COLOR is set (https://no-color.org),
// checked once per call rather than cached — color.ts has no init step, so
// nothing needs to happen "before" a stdout redirect could change this.
const CODE = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  underline: "\x1b[4m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m",
} as const;

function colorEnabled(): boolean {
  return Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;
}

function wrap(code: string) {
  return (text: string) => (colorEnabled() ? `${code}${text}${CODE.reset}` : text);
}

export const color = {
  bold: wrap(CODE.bold),
  dim: wrap(CODE.dim),
  underline: wrap(CODE.underline),
  red: wrap(CODE.red),
  green: wrap(CODE.green),
  yellow: wrap(CODE.yellow),
  cyan: wrap(CODE.cyan),
  gray: wrap(CODE.gray),
};
