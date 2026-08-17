// Shared "did anything change" rule for a computed unified diff — used
// identically at preview time (informational) and execute time (to decide
// whether to skip a no-op write). `createTwoFilesPatch` always emits header
// lines even when before/after content is identical, so the only reliable
// signal that content actually differs is the presence of at least one hunk
// header ("@@ ... @@"). This is also the exact rule the frontend uses to
// decide whether to render a diff as "unchanged" — keep this the single
// source of truth and do not invent a second "unchanged" flag anywhere else.
export function diffHasChanges(diffSummary: string): boolean {
  return diffSummary.split("\n").some((line) => line.startsWith("@@"));
}
