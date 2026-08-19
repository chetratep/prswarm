import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
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
import { IconAlertTriangle, IconPlusCircle } from "../components/icons";
import { EmptyState } from "../components/EmptyState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";

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
  const { selectedRepos, setSelectedRepos } = useSelection();

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
      // This selection has now been spent into a real job — SelectionContext
      // lives above the router (App.tsx) so it otherwise survives
      // navigating all the way to Results and back. Without clearing it
      // here, starting a *new* run by going back to /select would silently
      // carry the previous run's repos along as pre-checked, spanning
      // whatever orgs that old run happened to target.
      setSelectedRepos(new Set());
      navigate(`/preview/${jobView.job.id}`);
    },
  });

  // Nothing was chosen on /select — don't let someone land here directly
  // with no targets. A silent <Navigate> here used to just bounce back to
  // /select with no explanation, which felt broken when reached from
  // History's or the stepper's "Define" link on an old job: SelectionContext
  // (see state/SelectionContext.tsx) is in-memory, per-session state with no
  // idea that job's targets — a visible message beats a redirect no one
  // asked for.
  if (selectedRepos.size === 0) {
    return (
      <div className="page">
        <h2>Define change</h2>
        <EmptyState
          message="No repos selected for this session yet."
          action={
            <Button asChild>
              <Link to="/select">Go to Select</Link>
            </Button>
          }
        />
      </div>
    );
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
          <Input
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

        <Button type="button" variant="outline" onClick={addFile}>
          <IconPlusCircle size={15} />
          Add another file
        </Button>

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
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Repo</TableHead>
                  {templateVariables.map((varName) => (
                    <TableHead key={varName}>
                      <code>{`{{${varName}}}`}</code>
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {targetRepoList.map((repo) => (
                  <TableRow key={repo}>
                    <TableCell className="template-vars-table__repo">{repo}</TableCell>
                    {templateVariables.map((varName) => (
                      <TableCell key={varName}>
                        <Input
                          type="text"
                          value={templateValues[repo]?.[varName] ?? ""}
                          onChange={(event) => setTemplateValue(repo, varName, event.target.value)}
                          required
                        />
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        <label className="form__field">
          <span>
            Commit message <span className="required-mark" aria-hidden="true">*</span>
          </span>
          <Input
            type="text"
            value={commitMessage}
            onChange={(event) => setCommitMessage(event.target.value)}
            placeholder="Add PR review workflow"
            required
          />
        </label>

        <fieldset>
          <legend className="text-sm font-medium mb-2">
            How it lands <span className="required-mark" aria-hidden="true">*</span>
          </legend>

          <RadioGroup value={landing ?? undefined} onValueChange={(v) => setLanding(v as Landing)}>
            <div className="flex items-start gap-2">
              <RadioGroupItem value="DIRECT_DEFAULT" id="landing-direct" className="mt-0.5" />
              <Label htmlFor="landing-direct" className="font-normal cursor-pointer">
                Push directly to the default branch — no PR, no review
              </Label>
            </div>
            {landing === "DIRECT_DEFAULT" && (
              <p className="radio-option__warning">
                <IconAlertTriangle size={14} /> No review step. Every push here needs typed
                confirmation before it runs, regardless of how many repos are targeted.
              </p>
            )}

            <div className="flex items-start gap-2">
              <RadioGroupItem value="NEW_BRANCH" id="landing-new-branch" className="mt-0.5" />
              <Label htmlFor="landing-new-branch" className="font-normal cursor-pointer">
                Push to a new branch (no PR)
              </Label>
            </div>

            <div className="flex items-start gap-2">
              <RadioGroupItem value="PR" id="landing-pr" className="mt-0.5" />
              <Label htmlFor="landing-pr" className="font-normal cursor-pointer">
                Open a pull request
              </Label>
            </div>
          </RadioGroup>
        </fieldset>

        {landing === "PR" && (
          <>
            <label className="form__field">
              <span>
                PR title <span className="required-mark" aria-hidden="true">*</span>
              </span>
              <Input
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
              <Textarea
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

        <Button type="submit" disabled={!canSubmit}>
          {createMutation.isPending ? "Creating…" : "Create and preview"}
        </Button>
        {!canSubmit && !createMutation.isPending && missingFields.length > 0 && (
          <p className="form__hint">Complete these to continue: {missingFields.join(", ")}</p>
        )}
      </form>
    </div>
  );
}
