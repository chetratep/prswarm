import { useMemo, useState, type FormEvent } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import CodeMirror from "@uiw/react-codemirror";
import type {
  BranchStrategy,
  CommitStrategy,
  CreateChangeSetRequest,
  CreateChangeSetResponse,
  CreateJobRequest,
  FetchContentRequest,
  FetchContentResponse,
  JobView,
  WriteMode,
} from "@bulk-github-update-tool/shared-types";
import { extractTemplateVariables } from "@bulk-github-update-tool/shared-types";
import { apiPost } from "../api/client";
import { languageExtensionsForPath } from "../lib/contentLanguage";
import { useSelection } from "../state/SelectionContext";

// The three real "how it lands" choices, collapsed onto one control rather
// than two independent commitStrategy/branchStrategy dropdowns (see the v2
// contract comment in shared-types — PULL_REQUEST always implies a new
// branch, so a free combination of the two enums would let you pick a
// nonsensical pair).
type Landing = "DIRECT_DEFAULT" | "NEW_BRANCH" | "PR";

const LANDING_STRATEGIES: Record<
  Landing,
  { commitStrategy: CommitStrategy; branchStrategy: BranchStrategy }
> = {
  DIRECT_DEFAULT: { commitStrategy: "DIRECT_COMMIT", branchStrategy: "DEFAULT" },
  NEW_BRANCH: { commitStrategy: "DIRECT_COMMIT", branchStrategy: "NEW_BRANCH" },
  PR: { commitStrategy: "PULL_REQUEST", branchStrategy: "NEW_BRANCH" },
};

export function DefinePage() {
  const navigate = useNavigate();
  const { selectedRepos } = useSelection();

  const [name, setName] = useState("");
  const [filePath, setFilePath] = useState("");
  const [mode, setMode] = useState<WriteMode>("UPSERT");
  const [content, setContent] = useState("");
  const [commitMessage, setCommitMessage] = useState("");
  // Deliberately no default — direct-commit and PR are equal first-class
  // choices per CLAUDE.md, so this must never be pre-selected.
  const [landing, setLanding] = useState<Landing | null>(null);
  const [prTitle, setPrTitle] = useState("");
  const [prBody, setPrBody] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  // Memoized so CodeMirror's `extensions` prop keeps a stable identity across
  // re-renders that don't change the file extension — without this, every
  // keystroke (which re-renders DefinePage) would hand CodeMirror a brand new
  // array, forcing it to tear down and reconfigure its EditorState each time.
  const contentExtensions = useMemo(() => languageExtensionsForPath(filePath), [filePath]);
  // Per-repo values for {{variable}} placeholders found in `content`, keyed
  // by repoFullName then variable name. Only rendered/relevant once
  // extractTemplateVariables(content) finds something — a changeset with no
  // placeholders never touches this. Recomputed from `content` on every
  // render (cheap regex scan) rather than memoized, so the grid always
  // matches exactly what's currently typed.
  const [templateValues, setTemplateValues] = useState<Record<string, Record<string, string>>>({});

  function setTemplateValue(repoFullName: string, varName: string, value: string) {
    setTemplateValues((prev) => ({
      ...prev,
      [repoFullName]: { ...prev[repoFullName], [varName]: value },
    }));
  }

  const fetchContentMutation = useMutation({
    mutationFn: () =>
      apiPost<FetchContentResponse>("/api/fetch-content", { url: sourceUrl } satisfies FetchContentRequest),
    onSuccess: (res) => setContent(res.content),
  });

  function handleFetchContent() {
    if (sourceUrl.trim() === "" || fetchContentMutation.isPending) return;
    fetchContentMutation.mutate();
  }

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!landing) {
        throw new Error("Choose how the change lands before submitting.");
      }
      const strategies = LANDING_STRATEGIES[landing];
      const changeSetPayload: CreateChangeSetRequest = {
        name,
        filePath,
        mode,
        content,
        branchStrategy: strategies.branchStrategy,
        commitStrategy: strategies.commitStrategy,
        commitMessage,
        prTitle: landing === "PR" ? prTitle : null,
        prBody: landing === "PR" ? prBody : null,
      };
      const changeSetRes = await apiPost<CreateChangeSetResponse>(
        "/api/changesets",
        changeSetPayload,
      );

      const jobPayload: CreateJobRequest = {
        targetRepos: Array.from(selectedRepos),
        ...(extractTemplateVariables(content).length > 0 ? { templateValues } : {}),
      };
      const jobRes = await apiPost<JobView>(
        `/api/changesets/${changeSetRes.changeSet.id}/jobs`,
        jobPayload,
      );
      return jobRes;
    },
    onSuccess: (jobView) => {
      navigate(`/preview/${jobView.job.id}`);
    },
  });

  // Nothing was chosen on /select — don't let someone land here directly
  // with no targets.
  if (selectedRepos.size === 0) {
    return <Navigate to="/select" replace />;
  }

  // Whether the content has any {{variable}} placeholders — derived fresh
  // from `content` on every render (same regex the backend uses to decide
  // STATIC vs TEMPLATE), never a separate mode toggle.
  const templateVariables = extractTemplateVariables(content);
  const targetRepoList = Array.from(selectedRepos);
  const hasMissingTemplateValue =
    templateVariables.length > 0 &&
    targetRepoList.some((repo) =>
      templateVariables.some((varName) => (templateValues[repo]?.[varName] ?? "").trim() === ""),
    );

  // Listed in form order so the hint below the submit button reads as a
  // checklist, not a jumble — and so canSubmit and the hint can never
  // silently disagree with each other (canSubmit is just "no items").
  const missingFields: string[] = [];
  if (name.trim() === "") missingFields.push("Name");
  if (filePath.trim() === "") missingFields.push("File path");
  if (content === "") missingFields.push("Content");
  if (commitMessage.trim() === "") missingFields.push("Commit message");
  if (landing === null) missingFields.push("How it lands");
  if (landing === "PR" && prTitle.trim() === "") missingFields.push("PR title");
  // One summarizing entry rather than one per (repo, variable) cell — could
  // get long with many repos x variables. Purely a display simplification:
  // canSubmit still requires every cell filled via hasMissingTemplateValue.
  if (hasMissingTemplateValue) missingFields.push("Template variable values");

  const canSubmit = missingFields.length === 0 && !createMutation.isPending;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;
    createMutation.mutate();
  }

  return (
    <div className="page">
      <h2>Define change</h2>
      <p className="page__intro">
        {selectedRepos.size} repo{selectedRepos.size === 1 ? "" : "s"} targeted. This defines the
        single file change that will be applied to each of them.
      </p>

      <form className="form form--wide" onSubmit={handleSubmit}>
        <p className="form__legend">
          <span className="required-mark" aria-hidden="true">*</span> required
        </p>

        <label className="form__field">
          <span>
            Name <span className="required-mark" aria-hidden="true">*</span>
          </span>
          <input
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Add PR review workflow"
            required
          />
        </label>

        <label className="form__field">
          <span>
            File path <span className="required-mark" aria-hidden="true">*</span>
          </span>
          <input
            type="text"
            value={filePath}
            onChange={(event) => setFilePath(event.target.value)}
            placeholder=".github/workflows/pr-review.yml"
            required
          />
        </label>

        <label className="form__field">
          <span>
            Mode <span className="optional-mark">(optional — defaults to Upsert)</span>
          </span>
          <select value={mode} onChange={(event) => setMode(event.target.value as WriteMode)}>
            <option value="CREATE_ONLY">Create only</option>
            <option value="OVERWRITE">Overwrite</option>
            <option value="UPSERT">Upsert</option>
          </select>
        </label>

        <div className="form__field">
          <span>
            Content <span className="required-mark" aria-hidden="true">*</span>
          </span>

          <div className="content-fetch-row">
            <input
              type="url"
              value={sourceUrl}
              onChange={(event) => setSourceUrl(event.target.value)}
              placeholder="Or paste a raw file URL to fetch it — e.g. a GitHub raw link"
              className="content-fetch-row__input"
            />
            <button
              type="button"
              className="button button--secondary"
              onClick={handleFetchContent}
              disabled={sourceUrl.trim() === "" || fetchContentMutation.isPending}
            >
              {fetchContentMutation.isPending ? "Fetching…" : "Fetch"}
            </button>
          </div>
          {fetchContentMutation.isError && (
            <p className="form__error" role="alert">
              {fetchContentMutation.error instanceof Error
                ? fetchContentMutation.error.message
                : "Failed to fetch that URL."}
            </p>
          )}

          <CodeMirror
            value={content}
            onChange={(value) => setContent(value)}
            extensions={contentExtensions}
            height="360px"
            placeholder={"name: PR review\non:\n  pull_request:\n    types: [opened, synchronize]\n"}
            className="content-editor"
          />
        </div>

        {templateVariables.length > 0 && (
          <div className="template-vars-section">
            <h3 className="template-vars-section__heading">
              Template variables <span className="required-mark" aria-hidden="true">*</span>
            </h3>
            <p className="template-vars-section__hint">
              This content has {templateVariables.length} placeholder
              {templateVariables.length === 1 ? "" : "s"} — provide a value for each in every
              targeted repo before this can be previewed.
            </p>
            <div className="template-vars-table-wrap">
              <table className="template-vars-table">
                <thead>
                  <tr>
                    <th>Repo</th>
                    {templateVariables.map((varName) => (
                      <th key={varName}>
                        <code>{`{{${varName}}}`}</code>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {targetRepoList.map((repo) => (
                    <tr key={repo}>
                      <td className="template-vars-table__repo">{repo}</td>
                      {templateVariables.map((varName) => (
                        <td key={varName}>
                          <input
                            type="text"
                            value={templateValues[repo]?.[varName] ?? ""}
                            onChange={(event) => setTemplateValue(repo, varName, event.target.value)}
                            required
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <label className="form__field">
          <span>
            Commit message <span className="required-mark" aria-hidden="true">*</span>
          </span>
          <input
            type="text"
            value={commitMessage}
            onChange={(event) => setCommitMessage(event.target.value)}
            placeholder="Add PR review workflow"
            required
          />
        </label>

        <fieldset className="radio-group">
          <legend>
            How it lands <span className="required-mark" aria-hidden="true">*</span>
          </legend>

          <label className="radio-option">
            <input
              type="radio"
              name="landing"
              checked={landing === "DIRECT_DEFAULT"}
              onChange={() => setLanding("DIRECT_DEFAULT")}
            />
            <span>Push directly to the default branch — no PR, no review</span>
          </label>
          {landing === "DIRECT_DEFAULT" && (
            <p className="radio-option__warning">
              No review step. Every push here needs typed confirmation before it runs, regardless
              of how many repos are targeted.
            </p>
          )}

          <label className="radio-option">
            <input
              type="radio"
              name="landing"
              checked={landing === "NEW_BRANCH"}
              onChange={() => setLanding("NEW_BRANCH")}
            />
            <span>Push to a new branch (no PR)</span>
          </label>

          <label className="radio-option">
            <input
              type="radio"
              name="landing"
              checked={landing === "PR"}
              onChange={() => setLanding("PR")}
            />
            <span>Open a pull request</span>
          </label>
        </fieldset>

        {landing === "PR" && (
          <>
            <label className="form__field">
              <span>
                PR title <span className="required-mark" aria-hidden="true">*</span>
              </span>
              <input
                type="text"
                value={prTitle}
                onChange={(event) => setPrTitle(event.target.value)}
                required
              />
            </label>
            <label className="form__field">
              <span>
                PR body <span className="optional-mark">(optional)</span>
              </span>
              <textarea
                className="form__textarea"
                value={prBody}
                onChange={(event) => setPrBody(event.target.value)}
                rows={6}
              />
            </label>
          </>
        )}

        {createMutation.isError && (
          <p className="form__error" role="alert">
            {createMutation.error instanceof Error
              ? createMutation.error.message
              : "Failed to create changeset."}
          </p>
        )}

        <button type="submit" className="button button--primary" disabled={!canSubmit}>
          {createMutation.isPending ? "Creating…" : "Create and preview"}
        </button>
        {!canSubmit && !createMutation.isPending && missingFields.length > 0 && (
          <p className="form__hint">Complete these to continue: {missingFields.join(", ")}</p>
        )}
      </form>
    </div>
  );
}
