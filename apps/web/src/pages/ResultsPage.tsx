import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { JobStatus, JobView, RetryJobRequest } from "@bulk-github-update-tool/shared-types";
import { apiGet, apiPost } from "../api/client";

const STATUS_LABEL: Record<JobStatus, string> = {
  DRAFT: "Draft",
  PREVIEWING: "Previewing",
  READY: "Ready",
  RUNNING: "Running",
  COMPLETED: "Completed",
  PARTIAL_FAILURE: "Partial failure",
  FAILED: "Failed",
};

export function ResultsPage() {
  const { jobId } = useParams<{ jobId: string }>();
  const navigate = useNavigate();

  const jobQuery = useQuery({
    queryKey: ["job", jobId],
    queryFn: () => apiGet<JobView>(`/api/jobs/${jobId}`),
    enabled: !!jobId,
  });

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

  const { job, repoRuns } = jobQuery.data;
  const succeeded = repoRuns.filter((run) => run.status === "SUCCESS").length;
  const skipped = repoRuns.filter((run) => run.status === "SKIPPED").length;
  const failed = repoRuns.filter((run) => run.status === "FAILED").length;

  const canRetry =
    (job.status === "PARTIAL_FAILURE" || job.status === "FAILED") && failed > 0;

  return (
    <div className="page">
      <h2>Results</h2>

      <div className={`results-banner results-banner--${job.status.toLowerCase()}`}>
        <strong>{STATUS_LABEL[job.status] ?? job.status}</strong>
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
          {repoRuns.map((run) => (
            <tr key={run.id}>
              <td className="results-table__repo">{run.repoFullName}</td>
              <td>{run.status}</td>
              <td>
                {run.status === "FAILED" && run.errorMessage && (
                  <span className="form__error-inline">{run.errorMessage}</span>
                )}
                {run.commitSha && (
                  <a
                    href={`https://github.com/${run.repoFullName}/commit/${run.commitSha}`}
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
          ))}
          {repoRuns.length === 0 && (
            <tr>
              <td colSpan={3}>No repos in this job.</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
