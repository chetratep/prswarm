import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { Job, JobEvent, RepoRun, RepoRunStatus } from "@bulk-github-update-tool/shared-types";
import {
  JOB_STATUS_ICON,
  JOB_STATUS_LABEL,
  repoRunChipClass,
  REPO_RUN_STATUS_ICON,
  REPO_RUN_STATUS_LABEL,
  TERMINAL_JOB_STATUSES,
} from "../lib/repoRunStatus";
import { StatusChip } from "../components/StatusChip";
import { EmptyState } from "../components/EmptyState";

// Statuses that mean "this repo is no longer in flight" for the live count.
const DONE_REPO_RUN_STATUSES: RepoRunStatus[] = ["SUCCESS", "FAILED", "SKIPPED"];

export function ExecutePage() {
  const { jobId } = useParams<{ jobId: string }>();
  const [job, setJob] = useState<Job | null>(null);
  const [repoRuns, setRepoRuns] = useState<RepoRun[]>([]);
  const [connectionError, setConnectionError] = useState<string | null>(null);

  useEffect(() => {
    if (!jobId) return;

    setJob(null);
    setRepoRuns([]);
    setConnectionError(null);

    const source = new EventSource(`/api/jobs/${jobId}/events`);
    // Set once we deliberately close the stream ourselves (terminal status),
    // so the resulting error/close from that doesn't get mistaken for a
    // dropped connection in onerror below.
    let closedByUs = false;

    source.onmessage = (event) => {
      const data: JobEvent = JSON.parse(event.data);
      if (data.type === "snapshot") {
        setJob(data.job);
        setRepoRuns(data.repoRuns);
      } else if (data.type === "job_update") {
        setJob(data.job);
        if (TERMINAL_JOB_STATUSES.includes(data.job.status)) {
          // Belt-and-suspenders: the backend closes the stream itself on a
          // terminal job_update, but we close from our end too rather than
          // relying solely on that.
          closedByUs = true;
          source.close();
        }
      } else if (data.type === "repo_run_update") {
        setRepoRuns((prev) => {
          const index = prev.findIndex((run) => run.id === data.repoRun.id);
          if (index === -1) return [...prev, data.repoRun];
          const next = [...prev];
          next[index] = data.repoRun;
          return next;
        });
      }
    };

    source.onerror = () => {
      if (closedByUs) return;
      // EventSource retries transient network errors on its own; a CLOSED
      // readyState here means the browser gave up (or the server closed the
      // connection without a terminal job_update reaching us first).
      if (source.readyState === EventSource.CLOSED) {
        setConnectionError("Lost connection to the server. Refresh the page to reconnect.");
      }
    };

    return () => {
      closedByUs = true;
      source.close();
    };
  }, [jobId]);

  if (!jobId) {
    return (
      <div className="page">
        <h2>Execute</h2>
        <p>
          No job selected yet. <Link to="/select">Start by selecting repos</Link>.
        </p>
      </div>
    );
  }

  if (!job) {
    return (
      <div className="page">
        <h2>Execute</h2>
        <p className="page__intro">
          {connectionError ?? "Connecting to live progress…"}
        </p>
      </div>
    );
  }

  const isTerminal = TERMINAL_JOB_STATUSES.includes(job.status);
  const doneCount = repoRuns.filter((run) => DONE_REPO_RUN_STATUSES.includes(run.status)).length;
  const JobStatusIcon = JOB_STATUS_ICON[job.status];

  return (
    <div className="page">
      <h2>Execute</h2>

      <div className={`results-banner results-banner--${job.status.toLowerCase()}`}>
        <strong>
          <JobStatusIcon size={16} />
          {JOB_STATUS_LABEL[job.status] ?? job.status}
        </strong>
        <span>
          {doneCount} of {repoRuns.length} done
        </span>
      </div>

      {connectionError && (
        <p className="form__error" role="alert">
          {connectionError}
        </p>
      )}

      <ul className="repo-run-list">
        {repoRuns.map((run) => (
          <li key={run.id} className="repo-run">
            <div className="repo-run__header repo-run__header--static">
              <span className="repo-run__name">{run.repoFullName}</span>
              <StatusChip
                className={repoRunChipClass(run.status)}
                icon={REPO_RUN_STATUS_ICON[run.status]}
                label={REPO_RUN_STATUS_LABEL[run.status]}
              />
            </div>
            {run.status === "FAILED" && run.errorMessage && (
              <div className="repo-run__body">
                <p className="form__error" role="alert">
                  {run.errorMessage}
                </p>
              </div>
            )}
            {run.status === "SKIPPED" && (
              <div className="repo-run__body">
                <p className="page__intro repo-run__note">
                  Skipped — the diff was a no-op for this repo, so nothing was written.
                </p>
              </div>
            )}
          </li>
        ))}
        {repoRuns.length === 0 && (
          <li>
            <EmptyState message="No repos in this job." />
          </li>
        )}
      </ul>

      {isTerminal && (
        <Link to={`/results/${jobId}`} className="button button--primary">
          View results
        </Link>
      )}
    </div>
  );
}
