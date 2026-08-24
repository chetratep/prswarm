import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import type { JobView, RepoRunFile } from "@prswarm/shared-types";
import { apiGet } from "../api/client";
import { Button } from "@/components/ui/button";
import {
  deriveDiffStatus,
  DIFF_STATUS_ICON,
  DIFF_STATUS_LABEL,
  groupByOrg,
  groupRepoRunFilesByRepoRunId,
  worstDiffStatus,
} from "../lib/repoRunStatus";
import type { RepoRun } from "@prswarm/shared-types";
import { StatusChip } from "../components/StatusChip";
import { OrgBadge } from "../components/OrgBadge";
import { EmptyState } from "../components/EmptyState";
import { IconAlertTriangle, IconChevronDown, IconChevronUp } from "../components/icons";

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

function FileRow({ file, isOpen, onToggle }: { file: RepoRunFile; isOpen: boolean; onToggle: () => void }) {
  const status = deriveDiffStatus(file);
  return (
    <li className="repo-run-file">
      <button type="button" className="repo-run-file__header" onClick={onToggle} aria-expanded={isOpen}>
        <span className="repo-run-file__path">{file.filePath}</span>
        <StatusChip className={`chip chip--${status}`} icon={DIFF_STATUS_ICON[status]} label={DIFF_STATUS_LABEL[status]} />
        <span className="repo-run__toggle">{isOpen ? <IconChevronUp size={14} /> : <IconChevronDown size={14} />}</span>
      </button>
      {isOpen && (
        <div className="repo-run-file__body">
          {status === "error" ? (
            <p className="form__error" role="alert">
              {file.errorMessage}
            </p>
          ) : (
            <DiffView diff={file.diffSummary} />
          )}
        </div>
      )}
    </li>
  );
}

export function PreviewPage() {
  const { jobId } = useParams<{ jobId: string }>();
  const [expandedRepos, setExpandedRepos] = useState<Set<string>>(new Set());
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());

  const jobQuery = useQuery({
    queryKey: ["job", jobId],
    // One-time snapshot for MVP — execution isn't live yet, so no polling.
    queryFn: () => apiGet<JobView>(`/api/jobs/${jobId}`),
    enabled: !!jobId,
  });

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

  function toggleFile(fileId: string) {
    setExpandedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(fileId)) {
        next.delete(fileId);
      } else {
        next.add(fileId);
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

  const { repoRuns, repoRunFiles } = jobQuery.data;
  const filesByRepoRunId = groupRepoRunFilesByRepoRunId(repoRunFiles);
  const orgGroups = groupByOrg(repoRuns);
  const spansMultipleOrgs = orgGroups.size > 1;

  function renderRun(run: RepoRun) {
    const files = filesByRepoRunId.get(run.id) ?? [];
    const status = run.errorMessage ? "error" : worstDiffStatus(files.map((f) => deriveDiffStatus(f)));
    const isOpen = expandedRepos.has(run.id);
    const protectedWarning = run.directToDefault && run.branchProtected === true;
    return (
      <li key={run.id} className="repo-run">
        <button
          type="button"
          className="repo-run__header"
          onClick={() => toggleRepo(run.id)}
          aria-expanded={isOpen}
        >
          <span className="repo-run__name">{run.repoFullName}</span>
          <StatusChip className={`chip chip--${status}`} icon={DIFF_STATUS_ICON[status]} label={DIFF_STATUS_LABEL[status]} />
          {protectedWarning && (
            <span className="chip chip--warning">
              <IconAlertTriangle size={13} />
              protected — will likely fail
            </span>
          )}
          <span className="repo-run__toggle">{isOpen ? <IconChevronUp size={14} /> : <IconChevronDown size={14} />}</span>
        </button>
        {isOpen && (
          <div className="repo-run__body">
            {run.status === "FAILED" && run.errorMessage && files.length === 0 ? (
              <p className="form__error" role="alert">
                {run.errorMessage}
              </p>
            ) : (
              <ul className="repo-run-file-list">
                {files.map((file) => (
                  <FileRow
                    key={file.id}
                    file={file}
                    isOpen={expandedFiles.has(file.id)}
                    onToggle={() => toggleFile(file.id)}
                  />
                ))}
              </ul>
            )}
          </div>
        )}
      </li>
    );
  }

  return (
    <div className="page">
      <h2>Preview</h2>
      <p className="page__intro">
        {repoRuns.length} repo{repoRuns.length === 1 ? "" : "s"} targeted. Expand a row to see its
        files, and a file to see its diff, before continuing.
      </p>

      {repoRuns.length === 0 && <EmptyState message="No repos in this job." />}

      {repoRuns.length > 0 && !spansMultipleOrgs && (
        <ul className="repo-run-list">{repoRuns.map(renderRun)}</ul>
      )}

      {repoRuns.length > 0 &&
        spansMultipleOrgs &&
        Array.from(orgGroups.entries()).map(([org, runs]) => (
          <div key={org} className="org-group">
            <h3 className="org-group__heading">
              <OrgBadge login={org} size={18} />
              {org} <span className="badge badge--muted">{runs.length}</span>
            </h3>
            <ul className="repo-run-list">{runs.map(renderRun)}</ul>
          </div>
        ))}

      <Button asChild>
        <Link to={`/confirm/${jobId}`}>Continue to confirm</Link>
      </Button>
    </div>
  );
}
