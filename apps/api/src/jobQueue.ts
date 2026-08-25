// Background execution engine for a job. Used to live inline in the
// POST /jobs/:id/execute route handler (routes/jobs.ts) as a sequential,
// awaited loop; now it's called fire-and-forget from that handler (and from
// POST /jobs/:id/retry) so the HTTP response can return almost immediately
// while the actual per-repo GitHub writes happen here, bounded to 5
// concurrent via p-limit and streamed out over jobEventBus for the SSE route
// to relay.
//
// Nothing awaits this function, so an unhandled rejection here would crash
// the whole process — every exit path must go through the outer try/catch.
import pLimit from "p-limit";
import type { Job, JobStatus, RepoRun, RepoRunStatus } from "@prswarm/shared-types";
import type { AppDatabase } from "./db.js";
import { loadOctokitForCurrentConnection } from "./github/loadConnection.js";
import { executeRepoRun } from "./github/repoExecute.js";
import { publishJobEvent } from "./jobEventBus.js";
import { notifySlack, resolveSlackWebhookUrl } from "./notifications/slack.js";
import { getChangeSetById, getChangeSetFilesByChangeSetId } from "./repositories/changesetsRepository.js";
import { getJobById, updateJob } from "./repositories/jobsRepository.js";
import { getRepoRunFilesByRepoRunId } from "./repositories/repoRunFilesRepository.js";
import { getRepoRunsByJobId, updateRepoRun } from "./repositories/repoRunsRepository.js";

const CONCURRENCY = 5;

/** COMPLETED if every repo_run (not just the ones touched this run) ended
 * SUCCESS/SKIPPED, PARTIAL_FAILURE if a mix of success and failure, FAILED
 * if every one of them failed. Same logic that used to live inline in
 * routes/jobs.ts's computeJobFinalStatus. */
function computeJobFinalStatus(repoRuns: RepoRun[]): JobStatus {
  if (repoRuns.length === 0) return "COMPLETED";
  const failedCount = repoRuns.filter((r) => r.status === "FAILED").length;
  const okCount = repoRuns.filter((r) => r.status === "SUCCESS" || r.status === "SKIPPED").length;
  if (failedCount === 0) return "COMPLETED";
  if (okCount === 0) return "FAILED";
  return "PARTIAL_FAILURE";
}

/** Marks the job FAILED and publishes that as a job_update. Best-effort:
 * used from the outer catch, where the DB or the rest of the world may
 * already be in a bad state, so a failure here is only logged, never
 * rethrown. */
function markJobFailed(db: AppDatabase, jobId: string): void {
  try {
    const failedJob = updateJob(db, jobId, {
      status: "FAILED",
      completedAt: new Date().toISOString(),
    });
    publishJobEvent(jobId, { type: "job_update", job: failedJob });
    void notifySlack(
      resolveSlackWebhookUrl(db).url,
      `Job ${jobId} failed unexpectedly (not a per-repo failure — see server logs).`
    );
  } catch (persistErr) {
    console.error(`jobQueue: failed to persist FAILED status for job ${jobId}:`, persistErr);
  }
}

export async function runJobExecution(
  db: AppDatabase,
  jobId: string,
  eligibleStatuses: RepoRunStatus[]
): Promise<void> {
  try {
    const job = getJobById(db, jobId);
    if (!job) {
      console.error(`jobQueue: job ${jobId} not found`);
      return;
    }

    const changeSet = getChangeSetById(db, job.changeSetId);
    if (!changeSet) {
      console.error(`jobQueue: change set ${job.changeSetId} not found for job ${jobId}`);
      markJobFailed(db, jobId);
      return;
    }

    const changeSetFiles = getChangeSetFilesByChangeSetId(db, changeSet.id);

    // Always the job's OWN creator's connection, never whoever triggered
    // this run (which could be a different user retrying, or an admin) —
    // the diff/preview this job's repo_runs hold was computed against that
    // specific credential's view of the repos; executing under a
    // different one could hit different actual permissions than what was
    // reviewed. See the design spec's "execution credential" section.
    const octokit = await loadOctokitForCurrentConnection(db, job.createdBy);

    // The route handler already persisted RUNNING (and startedAt) before
    // calling us. Publish it anyway: an SSE client that connects after the
    // route returned but before our first repo_run_update still needs to
    // see the RUNNING transition, in addition to whatever the snapshot the
    // SSE route sends on connect already told it.
    const runningJob: Job = { ...job, status: "RUNNING", startedAt: job.startedAt ?? new Date().toISOString() };
    publishJobEvent(jobId, { type: "job_update", job: runningJob });

    const allRepoRuns = getRepoRunsByJobId(db, jobId);
    const eligible = allRepoRuns.filter((r) => eligibleStatuses.includes(r.status));

    const limit = pLimit(CONCURRENCY);
    await Promise.all(
      eligible.map((repoRun) =>
        limit(async () => {
          const repoRunFiles = getRepoRunFilesByRepoRunId(db, repoRun.id);
          const update = await executeRepoRun(octokit, changeSet, changeSetFiles, repoRun, repoRunFiles);
          const updated = updateRepoRun(db, repoRun.id, update);
          publishJobEvent(jobId, { type: "repo_run_update", repoRun: updated, files: repoRunFiles });
        })
      )
    );

    const finalRepoRuns = getRepoRunsByJobId(db, jobId);
    const finalStatus = computeJobFinalStatus(finalRepoRuns);
    const finalJob = updateJob(db, jobId, {
      status: finalStatus,
      completedAt: new Date().toISOString(),
    });
    publishJobEvent(jobId, { type: "job_update", job: finalJob });

    // Best-effort — notifySlack no-ops if no webhook URL is configured, and
    // never throws, so this can't turn a completed job into a failed one.
    const succeeded = finalRepoRuns.filter((r) => r.status === "SUCCESS").length;
    const skipped = finalRepoRuns.filter((r) => r.status === "SKIPPED").length;
    const failed = finalRepoRuns.filter((r) => r.status === "FAILED").length;
    void notifySlack(
      resolveSlackWebhookUrl(db).url,
      `*${changeSet.name}* — ${finalStatus} (${succeeded} succeeded, ${skipped} skipped, ${failed} failed)`
    );
  } catch (err) {
    // Something went wrong in the loop itself (e.g. a DB error), not a
    // per-repo failure — executeRepoRun already contains those and always
    // resolves rather than throwing.
    console.error(`jobQueue: unexpected error running job ${jobId}:`, err);
    markJobFailed(db, jobId);
  }
}
