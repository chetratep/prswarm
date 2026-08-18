import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import type { ListJobsResponse } from "@bulk-github-update-tool/shared-types";
import { apiGet } from "../api/client";
import { JOB_STATUS_ICON, JOB_STATUS_LABEL } from "../lib/repoRunStatus";
import { StatusChip } from "../components/StatusChip";
import { EmptyState } from "../components/EmptyState";
import { IconCheckCircle, IconHistory, IconMinusCircle, IconXCircle } from "../components/icons";

export function HistoryPage() {
  const navigate = useNavigate();

  const jobsQuery = useQuery({
    queryKey: ["jobs", "history"],
    queryFn: () => apiGet<ListJobsResponse>("/api/jobs"),
  });

  if (jobsQuery.isLoading) {
    return (
      <div className="page">
        <h2>Run history</h2>
        <p className="page__loading">Loading runs…</p>
      </div>
    );
  }

  if (jobsQuery.isError) {
    return (
      <div className="page">
        <h2>Run history</h2>
        <p className="form__error" role="alert">
          {jobsQuery.error instanceof Error ? jobsQuery.error.message : "Failed to load run history."}
        </p>
      </div>
    );
  }

  const jobs = jobsQuery.data?.jobs ?? [];

  return (
    <div className="page">
      <h2>Run history</h2>
      <p className="page__intro">
        Every changeset run against this connection, newest first. Click a row for its full
        per-repo results.
      </p>

      {jobs.length === 0 && (
        <EmptyState
          icon={<IconHistory size={22} />}
          message="No runs yet — start one from Select."
          action={
            <Link to="/select" className="button button--secondary">
              Go to Select
            </Link>
          }
        />
      )}

      {jobs.length > 0 && (
        <table className="results-table history-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Status</th>
              <th>Files</th>
              <th>Repos</th>
              <th>Orgs</th>
              <th>Outcome</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((entry) => (
              <tr
                key={entry.job.id}
                className="history-row"
                onClick={() => navigate(`/results/${entry.job.id}`)}
              >
                <td>
                  <Link to={`/results/${entry.job.id}`} className="history-row__name">
                    {entry.changeSetName}
                  </Link>
                </td>
                <td>
                  <StatusChip
                    className={`chip chip--job-${entry.job.status.toLowerCase()}`}
                    icon={JOB_STATUS_ICON[entry.job.status]}
                    label={JOB_STATUS_LABEL[entry.job.status] ?? entry.job.status}
                  />
                </td>
                <td>{entry.fileCount}</td>
                <td>{entry.repoCount}</td>
                <td>{entry.orgCount}</td>
                <td className="history-row__outcome">
                  {entry.successCount > 0 && (
                    <StatusChip className="chip chip--new" icon={IconCheckCircle} label={`${entry.successCount} ok`} />
                  )}
                  {entry.skippedCount > 0 && (
                    <StatusChip
                      className="chip chip--unchanged"
                      icon={IconMinusCircle}
                      label={`${entry.skippedCount} skipped`}
                    />
                  )}
                  {entry.failedCount > 0 && (
                    <StatusChip className="chip chip--error" icon={IconXCircle} label={`${entry.failedCount} failed`} />
                  )}
                </td>
                <td className="history-row__created">{new Date(entry.job.createdAt).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
