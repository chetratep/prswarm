import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import type { JobView } from "@bulk-github-update-tool/shared-types";
import { apiGet } from "../api/client";
import { deriveDiffStatus, type DiffStatus } from "../lib/repoRunStatus";

const STATUS_LABEL: Record<DiffStatus, string> = {
  error: "Error",
  new: "New file",
  unchanged: "Unchanged",
  modified: "Modified",
};

function diffLineClassName(line: string): string {
  if (line.startsWith("+") && !line.startsWith("+++")) return "diff-line diff-line--add";
  if (line.startsWith("-") && !line.startsWith("---")) return "diff-line diff-line--del";
  return "diff-line";
}

function DiffView({ diff }: { diff: string | null }) {
  if (!diff) {
    return <p className="page__intro">No diff available.</p>;
  }
  const lines = diff.split("\n");
  return (
    <pre className="diff-view">
      {lines.map((line, index) => (
        <span key={index} className={diffLineClassName(line)}>
          {line}
          {"\n"}
        </span>
      ))}
    </pre>
  );
}

export function PreviewPage() {
  const { jobId } = useParams<{ jobId: string }>();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const jobQuery = useQuery({
    queryKey: ["job", jobId],
    // One-time snapshot for MVP — execution isn't live yet, so no polling.
    queryFn: () => apiGet<JobView>(`/api/jobs/${jobId}`),
    enabled: !!jobId,
  });

  function toggle(runId: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(runId)) {
        next.delete(runId);
      } else {
        next.add(runId);
      }
      return next;
    });
  }

  if (!jobId) {
    return (
      <div className="page">
        <h2>Preview</h2>
        <p>
          No job selected yet. <Link to="/select">Start by selecting repos</Link>.
        </p>
      </div>
    );
  }

  if (jobQuery.isLoading) {
    return (
      <div className="page">
        <h2>Preview</h2>
        <p>Loading diffs…</p>
      </div>
    );
  }

  if (jobQuery.isError || !jobQuery.data) {
    return (
      <div className="page">
        <h2>Preview</h2>
        <p className="form__error" role="alert">
          {jobQuery.error instanceof Error ? jobQuery.error.message : "Failed to load job."}
        </p>
      </div>
    );
  }

  const { repoRuns } = jobQuery.data;

  return (
    <div className="page">
      <h2>Preview</h2>
      <p className="page__intro">
        {repoRuns.length} repo{repoRuns.length === 1 ? "" : "s"} targeted. Expand a row to see its
        diff before continuing.
      </p>

      <ul className="repo-run-list">
        {repoRuns.map((run) => {
          const status = deriveDiffStatus(run);
          const isOpen = expanded.has(run.id);
          const protectedWarning = run.directToDefault && run.branchProtected === true;
          return (
            <li key={run.id} className="repo-run">
              <button
                type="button"
                className="repo-run__header"
                onClick={() => toggle(run.id)}
                aria-expanded={isOpen}
              >
                <span className="repo-run__name">{run.repoFullName}</span>
                <span className={`chip chip--${status}`}>{STATUS_LABEL[status]}</span>
                {protectedWarning && (
                  <span className="chip chip--warning">protected — will likely fail</span>
                )}
                <span className="repo-run__toggle">{isOpen ? "▲" : "▼"}</span>
              </button>
              {isOpen && (
                <div className="repo-run__body">
                  {status === "error" ? (
                    <p className="form__error" role="alert">
                      {run.errorMessage}
                    </p>
                  ) : (
                    <DiffView diff={run.diffSummary} />
                  )}
                </div>
              )}
            </li>
          );
        })}
        {repoRuns.length === 0 && <li className="repo-list__empty">No repos in this job.</li>}
      </ul>

      <Link to={`/confirm/${jobId}`} className="button button--primary">
        Continue to confirm
      </Link>
    </div>
  );
}
