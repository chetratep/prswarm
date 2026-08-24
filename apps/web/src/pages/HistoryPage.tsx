import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import type { ListJobsResponse } from "@prswarm/shared-types";
import { apiGet } from "../api/client";
import { JOB_STATUS_ICON, JOB_STATUS_LABEL } from "../lib/repoRunStatus";
import { StatusChip } from "../components/StatusChip";
import { EmptyState } from "../components/EmptyState";
import { IconCheckCircle, IconHistory, IconMinusCircle, IconXCircle } from "../components/icons";
import { Button } from "@/components/ui/button";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";

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
            <Button asChild variant="outline">
              <Link to="/select">Go to Select</Link>
            </Button>
          }
        />
      )}

      {jobs.length > 0 && (
        <Table className="results-table history-table">
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Files</TableHead>
              <TableHead>Repos</TableHead>
              <TableHead>Orgs</TableHead>
              <TableHead>Outcome</TableHead>
              <TableHead>Created</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {jobs.map((entry) => (
              <TableRow
                key={entry.job.id}
                className="history-row cursor-pointer"
                onClick={() => navigate(`/results/${entry.job.id}`)}
              >
                <TableCell>
                  <Link to={`/results/${entry.job.id}`} className="history-row__name">
                    {entry.changeSetName}
                  </Link>
                </TableCell>
                <TableCell>
                  <StatusChip
                    className={`chip chip--job-${entry.job.status.toLowerCase()}`}
                    icon={JOB_STATUS_ICON[entry.job.status]}
                    label={JOB_STATUS_LABEL[entry.job.status] ?? entry.job.status}
                  />
                </TableCell>
                <TableCell>{entry.fileCount}</TableCell>
                <TableCell>{entry.repoCount}</TableCell>
                <TableCell>{entry.orgCount}</TableCell>
                <TableCell className="history-row__outcome">
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
                </TableCell>
                <TableCell className="history-row__created">{new Date(entry.job.createdAt).toLocaleString()}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
