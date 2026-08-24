// Shared by the interactive wizard's prompt validation and --port argv
// parsing, so "what counts as a valid port" can't drift between the two.
export function isValidPort(port: number): boolean {
  return Number.isInteger(port) && port >= 1 && port <= 65535;
}
