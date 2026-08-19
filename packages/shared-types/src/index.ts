// Domain entities and API contract types shared between apps/api and apps/web.
// Field lists mirror the spec: https://claude.ai/code/artifact/89d010c4-46f9-4343-b51d-b15f9f57a494

export type ConnectionType = "PAT" | "GITHUB_APP";

export interface Connection {
  id: string;
  type: ConnectionType;
  login: string | null;
  host: string | null;
  appId: string | null;
  installationId: string | null;
  createdAt: string;
}

export type UserRole = "admin" | "member";

export interface User {
  id: string;
  username: string;
  role: UserRole;
  createdAt: string;
}

export interface ListUsersResponse {
  users: User[];
}

export interface ResetPasswordRequest {
  newPassword: string;
}

export interface ChangeOwnPasswordRequest {
  currentPassword: string;
  newPassword: string;
}

export type WriteMode = "CREATE_ONLY" | "OVERWRITE" | "UPSERT";
export type ContentSource = "STATIC" | "TEMPLATE";
export type BranchStrategy = "DEFAULT" | "NEW_BRANCH";
export type CommitStrategy = "DIRECT_COMMIT" | "PULL_REQUEST";

export interface ChangeSet {
  id: string;
  name: string;
  branchStrategy: BranchStrategy;
  commitStrategy: CommitStrategy;
  commitMessage: string;
  prTitle: string | null;
  prBody: string | null;
  createdAt: string;
}

export interface ChangeSetFile {
  id: string;
  changeSetId: string;
  /** Display/apply order, 0-based — also the order files are laid onto the
   * commit tree in, though tree order has no functional effect (each file
   * is its own tree entry keyed by path). */
  orderIndex: number;
  filePath: string;
  mode: WriteMode;
  contentSource: ContentSource;
  content: string;
  templateVarsSchema: Record<string, string> | null;
}

export interface RepoFilter {
  topics?: string[];
  language?: string;
  visibility?: "public" | "private" | "internal";
  archived?: boolean;
}

export interface TargetSelection {
  id: string;
  changeSetId: string;
  orgs: string[];
  selectAllInOrg: boolean;
  filters: RepoFilter;
  explicitRepoList: string[];
  resolvedRepoCount: number;
}

export type JobStatus =
  | "DRAFT"
  | "PREVIEWING"
  | "READY"
  | "RUNNING"
  | "COMPLETED"
  | "PARTIAL_FAILURE"
  | "FAILED";

export interface Job {
  id: string;
  changeSetId: string;
  targetSelectionId: string;
  status: JobStatus;
  createdBy: string;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

export type RepoRunStatus =
  | "PENDING"
  | "DIFF_COMPUTED"
  | "QUEUED"
  | "RUNNING"
  | "SUCCESS"
  | "FAILED"
  | "SKIPPED";

export interface RepoRun {
  id: string;
  jobId: string;
  repoFullName: string;
  status: RepoRunStatus;
  /** A property of the branch, not any one file — checked once per repo at
   * preview time, only meaningful when directToDefault is true. */
  branchProtected: boolean | null;
  directToDefault: boolean;
  commitSha: string | null;
  prUrl: string | null;
  errorMessage: string | null;
  attemptCount: number;
}

export interface RepoRunFile {
  id: string;
  repoRunId: string;
  changeSetFileId: string;
  /** Denormalized copy of the changeset file's path at preview time, so
   * this row still reads correctly if the changeset is ever edited later
   * (changesets aren't editable today, but this shouldn't silently break
   * if that changes). */
  filePath: string;
  diffSummary: string | null;
  beforeSha: string | null;
  afterSha: string | null;
  /** Set when THIS file's preview fetch failed (e.g. its path is a
   * directory) while other files in the same repo run succeeded. */
  errorMessage: string | null;
  /** The exact content this file's diff was computed against and (once
   * executed) written with — computed once at preview time and reused
   * verbatim at execute time, never re-derived, so what's reviewed is
   * guaranteed to be what gets written. This row is never updated after
   * being inserted at preview time. */
  renderedContent: string | null;
}

// --- v2 API contract: changeset -> job (diff preview) -> execute ---
// Builds on the v1 slice (connect + discovery) below. MVP simplifications,
// deliberate and documented in CLAUDE.md's roadmap:
//   - content is always STATIC (no template variables — that's Phase 3)
//   - target repo resolution happens client-side: the Select page already
//     fetches the FULL repo list per org (server-side pagination, see
//     GET /api/orgs/:org/repos), so "select all in this org" is already
//     just "every fullName currently in that list" — no separate
//     select-all-in-org server resolution logic is needed for MVP.
//   - PULL_REQUEST commitStrategy always implies a new branch is created,
//     regardless of the stored branchStrategy value (you can't PR a branch
//     against itself) — the Define form should reflect this by tying the
//     three real choices (direct-to-default / new branch / PR) to one
//     control, not two independent dropdowns whose combinations don't all
//     make sense.

export interface CreateChangeSetRequest {
  name: string;
  files: Array<{
    filePath: string;
    mode: WriteMode;
    content: string;
  }>;
  branchStrategy: BranchStrategy;
  commitStrategy: CommitStrategy;
  commitMessage: string;
  prTitle: string | null;
  prBody: string | null;
}

export interface CreateChangeSetResponse {
  changeSet: ChangeSet;
}

export interface CreateJobRequest {
  /** Resolved "owner/repo" full names — whatever the Select page's checkbox
   * state ended up with, select-all-in-org included. */
  targetRepos: string[];
  /** Per-repo values for the changeset's {{variable}} placeholders, keyed by
   * full name then variable name. Only meaningful when the changeset's
   * contentSource is TEMPLATE (see extractTemplateVariables below) — ignored
   * otherwise. A variable missing here falls back to templateVarsSchema's
   * default, then to "" if that's missing too. */
  templateValues?: Record<string, Record<string, string>>;
}

// --- Template variables ---
// A changeset's content can contain {{variableName}} placeholders. Whether
// it's STATIC or TEMPLATE is derived server-side from the content itself
// (see apps/api/src/routes/changesets.ts) — never a client-supplied flag —
// by scanning for these placeholders with the exact same function the
// frontend uses to know which inputs to show, so the two can never disagree
// about what counts as a variable.

const TEMPLATE_VARIABLE_PATTERN = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g;

/** Every distinct {{variableName}} found in `content`, in first-seen order. */
export function extractTemplateVariables(content: string): string[] {
  const seen = new Set<string>();
  for (const match of content.matchAll(TEMPLATE_VARIABLE_PATTERN)) {
    seen.add(match[1]);
  }
  return Array.from(seen);
}

/** Substitutes every {{variableName}} in `content` with `values[variableName]`
 * (falling back to "" for any variable with no provided value — never left
 * as a literal, unrendered {{...}} in what actually gets written). */
export function renderTemplate(content: string, values: Record<string, string>): string {
  return content.replace(TEMPLATE_VARIABLE_PATTERN, (_match, varName: string) => values[varName] ?? "");
}

export interface JobView {
  job: Job;
  repoRuns: RepoRun[];
  /** Flat across every repo_run in the job — pages group by repoRunId
   * themselves (see apps/web/src/lib/repoRunStatus.ts's
   * groupRepoRunFilesByRepoRunId). */
  repoRunFiles: RepoRunFile[];
}

/** One row of the run-history list — a job plus the summary counts the
 * History page shows without fetching every job's full JobView. */
export interface JobHistoryEntry {
  job: Job;
  changeSetName: string;
  fileCount: number;
  repoCount: number;
  orgCount: number;
  successCount: number;
  skippedCount: number;
  failedCount: number;
}

export interface ListJobsResponse {
  jobs: JobHistoryEntry[];
}

export interface ExecuteJobRequest {
  confirm: true;
}

// --- v1 API contract: connect (PAT) + org/repo discovery ---

export interface ConnectPatRequest {
  token: string;
  host?: string;
}

export interface ConnectPatResponse {
  connection: Connection;
}

export interface GitHubOrgSummary {
  login: string;
  id: number;
  avatarUrl: string;
  /** "User" is the authenticated account's own personal namespace — repos
   * owned directly by you, not under any org. Always listed first. */
  type: "User" | "Organization";
}

export interface GitHubRepoSummary {
  fullName: string;
  defaultBranch: string;
  private: boolean;
  archived: boolean;
  language: string | null;
  topics: string[];
}

export interface SessionStatus {
  authRequired: boolean;
  authenticated: boolean;
  /** The instance-login username — the "system user" this session is
   * signed in as, distinct from whichever GitHub account a connection
   * happens to use. Null when instance auth is off (single implicit local
   * user) or not yet authenticated. */
  username: string | null;
  role: UserRole | null;
}

export interface LoginRequest {
  username: string;
  password: string;
}

export interface SignupRequest {
  username: string;
  password: string;
}

export interface SignupResponse {
  user: User;
}

export interface HealthResponse {
  status: "ok";
}

// --- Fetch-content: populate the Define page's editor from a remote URL
// (e.g. a GitHub raw file link) instead of pasting. Server-side fetch, not a
// client-side one, so it can be guarded against SSRF (see routes/fetchContent.ts).

export interface FetchContentRequest {
  url: string;
}

export interface FetchContentResponse {
  content: string;
}

// --- v3 API contract: Phase 2 — GitHub App auth, filtered targeting,
// async execution with live progress + retry-failed-only.

// GitHub App auth. Two-step because a single App can be installed on
// several orgs/accounts, but this is a single-connection tool (same as
// PAT) — you pick one installation to bind the connection to, same as a
// PAT connects to "whichever account the token belongs to". Reconnect to
// switch installations later, matching the existing PAT reconnect flow.

export interface ListGithubAppInstallationsRequest {
  appId: string;
  privateKeyPem: string;
  host?: string;
}

export interface GithubAppInstallationSummary {
  installationId: number;
  accountLogin: string;
  accountAvatarUrl: string;
  accountType: "User" | "Organization";
}

export interface ListGithubAppInstallationsResponse {
  installations: GithubAppInstallationSummary[];
}

export interface ConnectGithubAppRequest {
  appId: string;
  privateKeyPem: string;
  installationId: number;
  host?: string;
}

export interface ConnectGithubAppResponse {
  connection: Connection;
}

// Filtered targeting — extends the existing GET /api/orgs/:org/repos query
// string (still ?q= for the name search already built) with three more
// optional params, applied server-side against the same fully-paginated
// repo list (GitHub already returns topics/language/archived on the
// standard list-repos response, so this needs no extra GitHub API calls):
// &language=<string, case-insensitive exact match>
// &topic=<string, must be present in the repo's topics[]>
// &archived=true|false

// Async execution + live progress. POST /api/jobs/:id/execute now returns
// immediately with the job flipped to RUNNING rather than blocking until
// every repo is done — the actual writes happen in a bounded-concurrency
// background queue (see apps/api/src/jobQueue.ts). Progress streams over
// SSE rather than polling.

export type JobEvent =
  | { type: "snapshot"; job: Job; repoRuns: RepoRun[]; repoRunFiles: RepoRunFile[] }
  | { type: "job_update"; job: Job }
  | { type: "repo_run_update"; repoRun: RepoRun; files: RepoRunFile[] };

export interface RetryJobRequest {
  confirm: true;
}
