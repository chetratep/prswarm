// Domain entities and API contract types shared between apps/api and apps/web.
// Field lists mirror the spec: https://claude.ai/code/artifact/89d010c4-46f9-4343-b51d-b15f9f57a494

export type ConnectionType = "PAT" | "GITHUB_APP";

export interface Connection {
  id: string;
  type: ConnectionType;
  login: string | null;
  appId: string | null;
  installationId: string | null;
  createdAt: string;
}

export type WriteMode = "CREATE_ONLY" | "OVERWRITE" | "UPSERT";
export type ContentSource = "STATIC" | "TEMPLATE";
export type BranchStrategy = "DEFAULT" | "NEW_BRANCH";
export type CommitStrategy = "DIRECT_COMMIT" | "PULL_REQUEST";

export interface ChangeSet {
  id: string;
  name: string;
  filePath: string;
  mode: WriteMode;
  contentSource: ContentSource;
  content: string;
  templateVarsSchema: Record<string, string> | null;
  branchStrategy: BranchStrategy;
  commitStrategy: CommitStrategy;
  commitMessage: string;
  prTitle: string | null;
  prBody: string | null;
  createdAt: string;
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
  diffSummary: string | null;
  beforeSha: string | null;
  afterSha: string | null;
  branchProtected: boolean | null;
  directToDefault: boolean;
  commitSha: string | null;
  prUrl: string | null;
  errorMessage: string | null;
  attemptCount: number;
  /** The exact content this repo's diff was computed against and (once
   * executed) written with — for STATIC changesets this is just
   * changeSet.content, for TEMPLATE it's that content with this repo's
   * {{variable}} values substituted in. Computed once at preview time and
   * reused verbatim at execute time, so what you review is guaranteed to be
   * what gets written — never recomputed from changeSet.content on the fly
   * (which is what let this drift from the diff for template changesets
   * before this field existed). Nullable only for rows created before this
   * field was added; executeRepoRun falls back to changeSet.content for those. */
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
  filePath: string;
  mode: WriteMode;
  content: string;
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
}

export interface ExecuteJobRequest {
  confirm: true;
}

// --- v1 API contract: connect (PAT) + org/repo discovery ---

export interface ConnectPatRequest {
  token: string;
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
}

export interface LoginRequest {
  username: string;
  password: string;
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
  | { type: "snapshot"; job: Job; repoRuns: RepoRun[] }
  | { type: "job_update"; job: Job }
  | { type: "repo_run_update"; repoRun: RepoRun };

export interface RetryJobRequest {
  confirm: true;
}
