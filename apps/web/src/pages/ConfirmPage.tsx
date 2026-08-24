import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { ExecuteJobRequest, JobView, RepoRun } from "@prswarm/shared-types";
import { apiGet, apiPost } from "../api/client";
import { useSelection } from "../state/SelectionContext";
import { useDefineForm } from "../state/DefineFormContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  deriveDiffStatus,
  DIFF_STATUS_ICON,
  DIFF_STATUS_LABEL,
  groupByOrg,
  groupRepoRunFilesByRepoRunId,
  isTerminalJobStatus,
  JOB_STATUS_ICON,
  JOB_STATUS_LABEL,
  worstDiffStatus,
  type DiffStatus,
} from "../lib/repoRunStatus";
import { StatusChip } from "../components/StatusChip";
import { OrgBadge } from "../components/OrgBadge";
import { IconAlertTriangle } from "../components/icons";

const CONFIRM_PHRASE = "RUN";

export function ConfirmPage() {
  const { jobId } = useParams<{ jobId: string }>();
  const navigate = useNavigate();
  const [confirmText, setConfirmText] = useState("");
  const { setSelectedRepos } = useSelection();
  const { resetDefineForm } = useDefineForm();

  const jobQuery = useQuery({
    queryKey: ["job", jobId],
    queryFn: () => apiGet<JobView>(`/api/jobs/${jobId}`),
    enabled: !!jobId,
  });

  const executeMutation = useMutation({
    mutationFn: () => {
      const payload: ExecuteJobRequest = { confirm: true };
      return apiPost(`/api/jobs/${jobId}/execute`, payload);
    },
    onSuccess: () => {
      // This is the actual point of no return for the in-progress edit
      // session — past this, Define/Preview's "go back and tweak" no longer
      // applies to this job (it's executing), so clear both here rather
      // than earlier (see DefinePage's onSuccess comment): a *new* run
      // starting fresh from /select won't carry these targets/content along
      // as pre-filled, but going back and forth within Define/Preview/
      // Confirm before this point never loses anything.
      setSelectedRepos(new Set());
      resetDefineForm();
      // execute now returns almost immediately with the job flipped to
      // RUNNING — the actual per-repo writes happen in the background, so
      // hand off to the Execute page to watch progress live over SSE
      // rather than waiting here for a final result.
      navigate(`/execute/${jobId}`);
    },
  });

  if (!jobId) {
    return (
      <div className="page">
        <h2>Confirm</h2>
        <p>
          No job selected yet. <Link to="/select">Start by selecting repos</Link>.
        </p>
      </div>
    );
  }

  if (jobQuery.isLoading) {
    return (
      <div className="page">
        <h2>Confirm</h2>
        <p>Loading job…</p>
      </div>
    );
  }

  if (jobQuery.isError || !jobQuery.data) {
    return (
      <div className="page">
        <h2>Confirm</h2>
        <p className="form__error" role="alert">
          {jobQuery.error instanceof Error ? jobQuery.error.message : "Failed to load job."}
        </p>
      </div>
    );
  }

  const { job, repoRuns, repoRunFiles } = jobQuery.data;

  // Reached via History, a stepper link, or a stale tab — this job already
  // ran (or is running right now). Re-showing a live "Confirm & run" button
  // here would let you fire POST /execute again for no effect (the backend
  // now rejects it once nothing's left in DIFF_COMPUTED, but the UI
  // shouldn't invite the click in the first place — see the History bug
  // report this closes).
  if (job.status === "RUNNING") {
    return (
      <div className="page">
        <h2>Confirm</h2>
        <p className="page__intro">This job is already running.</p>
        <Button asChild>
          <Link to={`/execute/${jobId}`}>Watch live progress</Link>
        </Button>
      </div>
    );
  }
  if (isTerminalJobStatus(job.status)) {
    const JobIcon = JOB_STATUS_ICON[job.status];
    return (
      <div className="page">
        <h2>Confirm</h2>
        <p className="page__intro">
          <JobIcon size={16} /> This job already ran — status:{" "}
          <strong>{JOB_STATUS_LABEL[job.status]}</strong>. Failed repos can be retried from
          Results.
        </p>
        <Button asChild>
          <Link to={`/results/${jobId}`}>View results</Link>
        </Button>
      </div>
    );
  }

  const filesByRepoRunId = groupRepoRunFilesByRepoRunId(repoRunFiles);
  const counts: Record<DiffStatus, number> = { error: 0, new: 0, unchanged: 0, modified: 0 };
  const statusByRunId = new Map<string, DiffStatus>();
  repoRuns.forEach((run) => {
    const files = filesByRepoRunId.get(run.id) ?? [];
    const status = run.errorMessage
      ? "error"
      : worstDiffStatus(files.map((f) => deriveDiffStatus(f)));
    counts[status] += 1;
    statusByRunId.set(run.id, status);
  });
  const orgGroups = groupByOrg(repoRuns);
  const spansMultipleOrgs = orgGroups.size > 1;

  function renderRun(run: RepoRun) {
    const status = statusByRunId.get(run.id) ?? "unchanged";
    return (
      <li key={run.id} className="repo-run">
        <div className="repo-run__header repo-run__header--static">
          <span className="repo-run__name">{run.repoFullName}</span>
          <StatusChip className={`chip chip--${status}`} icon={DIFF_STATUS_ICON[status]} label={DIFF_STATUS_LABEL[status]} />
          {run.directToDefault && run.branchProtected === true && (
            <span className="chip chip--warning">
              <IconAlertTriangle size={13} />
              protected — will likely fail
            </span>
          )}
        </div>
      </li>
    );
  }

  // Unconditional whenever any row is direct-to-default, regardless of
  // batch size — no threshold lets you skip it (CLAUDE.md).
  const needsTypedConfirm = repoRuns.some((run) => run.directToDefault === true);
  const canRun = needsTypedConfirm ? confirmText === CONFIRM_PHRASE : true;

  return (
    <div className="page">
      <h2>Confirm</h2>
      <p className="page__intro">
        {repoRuns.length} repo{repoRuns.length === 1 ? "" : "s"} total.
      </p>

      <ul className="confirm-summary">
        <li>
          <StatusChip className="chip chip--modified" icon={DIFF_STATUS_ICON.modified} label={DIFF_STATUS_LABEL.modified} />{" "}
          {counts.modified}
        </li>
        <li>
          <StatusChip className="chip chip--new" icon={DIFF_STATUS_ICON.new} label={DIFF_STATUS_LABEL.new} /> {counts.new}
        </li>
        <li>
          <StatusChip
            className="chip chip--unchanged"
            icon={DIFF_STATUS_ICON.unchanged}
            label={DIFF_STATUS_LABEL.unchanged}
          />{" "}
          {counts.unchanged}
        </li>
        <li>
          <StatusChip className="chip chip--error" icon={DIFF_STATUS_ICON.error} label={DIFF_STATUS_LABEL.error} /> {counts.error}
        </li>
      </ul>

      {!spansMultipleOrgs && <ul className="repo-run-list">{repoRuns.map(renderRun)}</ul>}

      {spansMultipleOrgs &&
        Array.from(orgGroups.entries()).map(([org, runs]) => (
          <div key={org} className="org-group">
            <h3 className="org-group__heading">
              <OrgBadge login={org} size={18} />
              {org} <span className="badge badge--muted">{runs.length}</span>
            </h3>
            <ul className="repo-run-list">{runs.map(renderRun)}</ul>
          </div>
        ))}

      {needsTypedConfirm && (
        <div className="confirm-gate">
          <p className="confirm-gate__warning">
            <IconAlertTriangle size={16} />
            <span>
              One or more repos will push directly to the default branch — no PR, no review. Type{" "}
              <strong>{CONFIRM_PHRASE}</strong> to confirm you want to run this.
            </span>
          </p>
          <Input
            type="text"
            value={confirmText}
            onChange={(event) => setConfirmText(event.target.value)}
            placeholder={CONFIRM_PHRASE}
            className="confirm-gate__input"
            aria-label={`Type ${CONFIRM_PHRASE} to confirm`}
          />
        </div>
      )}

      {executeMutation.isError && (
        <p className="form__error" role="alert">
          {executeMutation.error instanceof Error ? executeMutation.error.message : "Run failed."}
        </p>
      )}

      <div className="flex gap-2">
        <Button asChild variant="outline">
          <Link to={`/preview/${jobId}`}>Back to preview</Link>
        </Button>
        <Button
          type="button"
          disabled={!canRun || executeMutation.isPending}
          onClick={() => executeMutation.mutate()}
        >
          {executeMutation.isPending ? "Starting run…" : "Confirm & run"}
        </Button>
      </div>
    </div>
  );
}
