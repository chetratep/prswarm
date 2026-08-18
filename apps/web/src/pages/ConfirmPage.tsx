import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { ExecuteJobRequest, JobView } from "@bulk-github-update-tool/shared-types";
import { apiGet, apiPost } from "../api/client";
import {
  deriveDiffStatus,
  groupRepoRunFilesByRepoRunId,
  worstDiffStatus,
  type DiffStatus,
} from "../lib/repoRunStatus";

const STATUS_LABEL: Record<DiffStatus, string> = {
  error: "Error",
  new: "New file",
  unchanged: "Unchanged",
  modified: "Modified",
};

const CONFIRM_PHRASE = "RUN";

export function ConfirmPage() {
  const { jobId } = useParams<{ jobId: string }>();
  const navigate = useNavigate();
  const [confirmText, setConfirmText] = useState("");

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

  const { repoRuns, repoRunFiles } = jobQuery.data;
  const filesByRepoRunId = groupRepoRunFilesByRepoRunId(repoRunFiles);
  const counts: Record<DiffStatus, number> = { error: 0, new: 0, unchanged: 0, modified: 0 };
  repoRuns.forEach((run) => {
    const files = filesByRepoRunId.get(run.id) ?? [];
    const status = run.errorMessage
      ? "error"
      : worstDiffStatus(files.map((f) => deriveDiffStatus(f)));
    counts[status] += 1;
  });

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
          <span className="chip chip--modified">{STATUS_LABEL.modified}</span> {counts.modified}
        </li>
        <li>
          <span className="chip chip--new">{STATUS_LABEL.new}</span> {counts.new}
        </li>
        <li>
          <span className="chip chip--unchanged">{STATUS_LABEL.unchanged}</span>{" "}
          {counts.unchanged}
        </li>
        <li>
          <span className="chip chip--error">{STATUS_LABEL.error}</span> {counts.error}
        </li>
      </ul>

      {needsTypedConfirm && (
        <div className="confirm-gate">
          <p className="confirm-gate__warning">
            One or more repos will push directly to the default branch — no PR, no review. Type{" "}
            <strong>{CONFIRM_PHRASE}</strong> to confirm you want to run this.
          </p>
          <input
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

      <button
        type="button"
        className="button button--primary"
        disabled={!canRun || executeMutation.isPending}
        onClick={() => executeMutation.mutate()}
      >
        {executeMutation.isPending ? "Starting run…" : "Confirm & run"}
      </button>
    </div>
  );
}
