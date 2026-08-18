import { useState, type FormEvent } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import type {
  BranchStrategy,
  CommitStrategy,
  CreateChangeSetRequest,
  CreateChangeSetResponse,
  CreateJobRequest,
  JobView,
} from "@bulk-github-update-tool/shared-types";
import { extractTemplateVariables } from "@bulk-github-update-tool/shared-types";
import { apiPost } from "../api/client";
import { FileEntryEditor, type FileEntryValue } from "../components/FileEntryEditor";
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

function emptyFile(): FileEntryValue {
  return { filePath: "", mode: "UPSERT", content: "" };
}

export function DefinePage() {
  const navigate = useNavigate();
  const { selectedRepos } = useSelection();

  const [name, setName] = useState("");
  const [files, setFiles] = useState<FileEntryValue[]>([emptyFile()]);
  const [commitMessage, setCommitMessage] = useState("");
  // Deliberately no default — direct-commit and PR are equal first-class
  // choices per CLAUDE.md, so this must never be pre-selected.
  const [landing, setLanding] = useState<Landing | null>(null);
  const [prTitle, setPrTitle] = useState("");
  const [prBody, setPrBody] = useState("");
  // Per-repo values for {{variable}} placeholders found across every
  // file's content, keyed by repoFullName then variable name. Recomputed
  // from `files` on every render (cheap regex scan) rather than memoized,
  // so the grid always matches exactly what's currently typed.
  const [templateValues, setTemplateValues] = useState<Record<string, Record<string, string>>>({});

  function setTemplateValue(repoFullName: string, varName: string, value: string) {
    setTemplateValues((prev) => ({
      ...prev,
      [repoFullName]: { ...prev[repoFullName], [varName]: value },
    }));
  }

  function updateFile(index: number, value: FileEntryValue) {
    setFiles((prev) => prev.map((f, i) => (i === index ? value : f)));
  }

  function addFile() {
    setFiles((prev) => [...prev, emptyFile()]);
  }

  function removeFile(index: number) {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  }

  function moveFileUp(index: number) {
    if (index === 0) return;
    setFiles((prev) => {
      const next = [...prev];
      [next[index - 1], next[index]] = [next[index], next[index - 1]];
      return next;
    });
  }

  function moveFileDown(index: number) {
    setFiles((prev) => {
      if (index === prev.length - 1) return prev;
      const next = [...prev];
      [next[index], next[index + 1]] = [next[index + 1], next[index]];
      return next;
    });
  }

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!landing) {
        throw new Error("Choose how the change lands before submitting.");
      }
      const strategies = LANDING_STRATEGIES[landing];
      const changeSetPayload: CreateChangeSetRequest = {
        name,
        files: files.map((f) => ({ filePath: f.filePath, mode: f.mode, content: f.content })),
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

      const anyTemplateVariables = files.some((f) => extractTemplateVariables(f.content).length > 0);
      const jobPayload: CreateJobRequest = {
        targetRepos: Array.from(selectedRepos),
        ...(anyTemplateVariables ? { templateValues } : {}),
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

  // Union of every file's {{variable}} placeholders, deduped — a variable
  // used in two files is one variable with one value per repo, not two.
  const templateVariables = Array.from(
    new Set(files.flatMap((f) => extractTemplateVariables(f.content))),
  );
  const targetRepoList = Array.from(selectedRepos);
  const hasMissingTemplateValue =
    templateVariables.length > 0 &&
    targetRepoList.some((repo) =>
      templateVariables.some((varName) => (templateValues[repo]?.[varName] ?? "").trim() === ""),
    );

  const missingFields: string[] = [];
  if (name.trim() === "") missingFields.push("Name");
  if (files.length === 0) missingFields.push("At least one file");
  if (files.some((f) => f.filePath.trim() === "")) missingFields.push("File path");
  if (files.some((f) => f.content === "")) missingFields.push("Content");
  if (commitMessage.trim() === "") missingFields.push("Commit message");
  if (landing === null) missingFields.push("How it lands");
  if (landing === "PR" && prTitle.trim() === "") missingFields.push("PR title");
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
        file change{files.length === 1 ? "" : "s"} that will be applied to each of them, all in one
        commit.
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

        <div className="file-entry-list">
          {files.map((file, index) => (
            <FileEntryEditor
              key={index}
              index={index}
              value={file}
              canRemove={files.length > 1}
              canMoveUp={index > 0}
              canMoveDown={index < files.length - 1}
              onChange={updateFile}
              onRemove={removeFile}
              onMoveUp={moveFileUp}
              onMoveDown={moveFileDown}
            />
          ))}
        </div>

        <button type="button" className="button button--secondary" onClick={addFile}>
          + Add another file
        </button>

        {templateVariables.length > 0 && (
          <div className="template-vars-section">
            <h3 className="template-vars-section__heading">
              Template variables <span className="required-mark" aria-hidden="true">*</span>
            </h3>
            <p className="template-vars-section__hint">
              These files have {templateVariables.length} placeholder
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
