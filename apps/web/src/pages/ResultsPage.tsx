import { Fragment, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { Connection, JobView, RetryJobRequest } from "@bulk-github-update-tool/shared-types";
import { apiGet, apiGetOrNull, apiPost } from "../api/client";
import {
  deriveDiffStatus,
  DIFF_STATUS_ICON,
  DIFF_STATUS_LABEL,
  groupRepoRunFilesByRepoRunId,
  JOB_STATUS_ICON,
  JOB_STATUS_LABEL,
  repoRunChipClass,
  REPO_RUN_STATUS_ICON,
  REPO_RUN_STATUS_LABEL,
} from "../lib/repoRunStatus";
import { StatusChip } from "../components/StatusChip";
import { EmptyState } from "../components/EmptyState";
import { IconChevronDown, IconChevronUp } from "../components/icons";

export function ResultsPage() {
  const { jobId } = useParams<{ jobId: string }>();
  const navigate = useNavigate();
  const [expandedRepos, setExpandedRepos] = useState<Set<string>>(new Set());

  function toggleRepo(runId: string) {
    setExpandedRepos((prev) => {
      const next = new Set(prev);
      if (next.has(runId)) {
        next.delete(runId);
      } else {
        next.add(runId);
      }
      return next;
    });
  }

  const jobQuery = useQuery({
    queryKey: ["job", jobId],
    queryFn: () => apiGet<JobView>(`/api/jobs/${jobId}`),
    enabled: !!jobId,
  });

  const connectionQuery = useQuery({
    queryKey: ["connection", "current"],
    queryFn: () => apiGetOrNull<Connection>("/api/connections/current"),
  });
  const githubHost = (connectionQuery.data?.host || "github.com").replace(/\/api\/v3\/?$/, "");

  const retryMutation = useMutation({
    mutationFn: () => {
      const payload: RetryJobRequest = { confirm: true };
      return apiPost(`/api/jobs/${jobId}/retry`, payload);
    },
    onSuccess: () => {
      // Same "returns fast, watch via SSE" shape as execute — Execute page
      // handles any eligible-status subset generically, retry included.
      navigate(`/execute/${jobId}`);
    },
  });

  if (!jobId) {
    return (
      <div className="page">
        <h2>Results</h2>
        <p>
          No job selected yet. <Link to="/select">Start by selecting repos</Link>.
        </p>
      </div>
    );
  }

  if (jobQuery.isLoading) {
    return (
      <div className="page">
        <h2>Results</h2>
        <p>Loading results…</p>
      </div>
    );
  }

  if (jobQuery.isError || !jobQuery.data) {
    return (
      <div className="page">
        <h2>Results</h2>
        <p className="form__error" role="alert">
          {jobQuery.error instanceof Error ? jobQuery.error.message : "Failed to load job."}
        </p>
      </div>
    );
  }

  const { job, repoRuns, repoRunFiles } = jobQuery.data;
  const filesByRepoRunId = groupRepoRunFilesByRepoRunId(repoRunFiles);
  const succeeded = repoRuns.filter((run) => run.status === "SUCCESS").length;
  const skipped = repoRuns.filter((run) => run.status === "SKIPPED").length;
  const failed = repoRuns.filter((run) => run.status === "FAILED").length;

  const canRetry =
    (job.status === "PARTIAL_FAILURE" || job.status === "FAILED") && failed > 0;
  const JobStatusIcon = JOB_STATUS_ICON[job.status];

  return (
    <div className="page">
      <h2>Results</h2>

      <div className={`results-banner results-banner--${job.status.toLowerCase()}`}>
        <strong>
          <JobStatusIcon size={16} />
          {JOB_STATUS_LABEL[job.status] ?? job.status}
        </strong>
        <span>
          {succeeded} succeeded · {skipped} skipped · {failed} failed
        </span>
      </div>

      {canRetry && (
        <div className="page__footer-actions page__footer-actions--top">
          {retryMutation.isError && (
            <p className="form__error" role="alert">
              {retryMutation.error instanceof Error
                ? retryMutation.error.message
                : "Retry failed to start."}
            </p>
          )}
          <button
            type="button"
            className="button button--secondary"
            disabled={retryMutation.isPending}
            onClick={() => retryMutation.mutate()}
          >
            {retryMutation.isPending ? "Starting retry…" : "Retry failed"}
          </button>
        </div>
      )}

      <table className="results-table">
        <thead>
          <tr>
            <th>Repo</th>
            <th>Status</th>
            <th>Outcome</th>
          </tr>
        </thead>
        <tbody>
          {repoRuns.map((run) => {
            const files = filesByRepoRunId.get(run.id) ?? [];
            const isOpen = expandedRepos.has(run.id);
            return (
              <Fragment key={run.id}>
                <tr>
                  <td className="results-table__repo">
                    <button
                      type="button"
                      className="repo-run__header"
                      onClick={() => toggleRepo(run.id)}
                      aria-expanded={isOpen}
                      disabled={files.length === 0}
                    >
                      <span className="repo-run__name">{run.repoFullName}</span>
                      {files.length > 0 && (
                        <span className="repo-run__toggle">
                          {isOpen ? <IconChevronUp size={14} /> : <IconChevronDown size={14} />}
                        </span>
                      )}
                    </button>
                  </td>
                  <td>
                    <StatusChip
                      className={repoRunChipClass(run.status)}
                      icon={REPO_RUN_STATUS_ICON[run.status]}
                      label={REPO_RUN_STATUS_LABEL[run.status]}
                    />
                  </td>
                  <td>
                    {run.status === "FAILED" && run.errorMessage && (
                      <span className="form__error-inline">{run.errorMessage}</span>
                    )}
                    {run.commitSha && (
                      <a
                        href={`https://${githubHost}/${run.repoFullName}/commit/${run.commitSha}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {run.commitSha.slice(0, 7)}
                      </a>
                    )}
                    {run.prUrl && (
                      <a href={run.prUrl} target="_blank" rel="noreferrer">
                        View PR
                      </a>
                    )}
                  </td>
                </tr>
                {isOpen && files.length > 0 && (
                  <tr>
                    <td colSpan={3}>
                      {/* Preview-time diff status per file — not whether this
                          specific file was actually written at execute time.
                          repo_run_files rows are write-once at preview, so
                          per-file execute outcomes aren't persisted anywhere;
                          this shows what was part of the changeset and what
                          kind of change it represented, not the final
                          per-file write result. */}
                      <ul className="repo-run-file-list">
                        {files.map((file) => {
                          const status = deriveDiffStatus(file);
                          return (
                            <li key={file.id} className="repo-run-file">
                              <span className="repo-run-file__header">
                                <span className="repo-run-file__path">{file.filePath}</span>
                                <StatusChip
                                  className={`chip chip--${status}`}
                                  icon={DIFF_STATUS_ICON[status]}
                                  label={DIFF_STATUS_LABEL[status]}
                                />
                              </span>
                            </li>
                          );
                        })}
                      </ul>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
          {repoRuns.length === 0 && (
            <tr>
              <td colSpan={3}>
                <EmptyState message="No repos in this job." />
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
