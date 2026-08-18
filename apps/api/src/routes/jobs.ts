// Job read + execute/retry + live progress.
//   GET  /jobs/:id          -> current job + repo_run state.
//   POST /jobs/:id/execute  -> kick off the write (direct commit / new
//                               branch / PR) for every repo_run still
//                               DIFF_COMPUTED. Persists the job as RUNNING
//                               and returns immediately — the actual writes
//                               happen in the background (jobQueue.ts),
//                               bounded-concurrency, per-repo failure
//                               isolated. Safely re-callable: rows already
//                               SUCCESS/SKIPPED/FAILED are left untouched.
//   POST /jobs/:id/retry    -> same shape as execute, but only re-runs
//                               repo_runs currently FAILED.
//   GET  /jobs/:id/events   -> SSE stream of JobEvent: one `snapshot` on
//                               connect, then live `job_update` /
//                               `repo_run_update` as the background run
//                               progresses. Closes itself once the job
//                               reaches a terminal status.
import type { FastifyInstance, FastifyReply } from "fastify";
import type { Octokit } from "@octokit/rest";
import { z } from "zod";
import type {
  ExecuteJobRequest,
  JobEvent,
  JobHistoryEntry,
  JobStatus,
  JobView,
  ListJobsResponse,
  RetryJobRequest,
} from "@bulk-github-update-tool/shared-types";
import type { AppDatabase } from "../db.js";
import { resolveCurrentUser } from "../auth/currentUser.js";
import { loadOctokitForCurrentConnection, NoConnectionError } from "../github/loadConnection.js";
import { runJobExecution } from "../jobQueue.js";
import { subscribeToJob } from "../jobEventBus.js";
import { getChangeSetById, getChangeSetFilesByChangeSetId } from "../repositories/changesetsRepository.js";
import { getAllJobsOrderedByCreatedAtDesc, getJobById, updateJob } from "../repositories/jobsRepository.js";
import { getRepoRunFilesByJobId } from "../repositories/repoRunFilesRepository.js";
import { getRepoRunsByJobId } from "../repositories/repoRunsRepository.js";

export interface JobsRouteOptions {
  db: AppDatabase;
}

async function getOctokitOr400(
  db: AppDatabase,
  userId: string,
  reply: FastifyReply
): Promise<Octokit | undefined> {
  try {
    return await loadOctokitForCurrentConnection(db, userId);
  } catch (err) {
    if (err instanceof NoConnectionError) {
      reply.code(400).send({ error: err.message });
      return undefined;
    }
    throw err;
  }
}

const TERMINAL_JOB_STATUSES: JobStatus[] = ["COMPLETED", "PARTIAL_FAILURE", "FAILED"];

function isTerminalJobStatus(status: JobStatus): boolean {
  return TERMINAL_JOB_STATUSES.includes(status);
}

const executeJobBodySchema = z.object({
  confirm: z.literal(true),
});

const retryJobBodySchema = z.object({
  confirm: z.literal(true),
});

export async function registerJobsRoutes(app: FastifyInstance, opts: JobsRouteOptions): Promise<void> {
  const { db } = opts;

  // GET /jobs — run history, newest first. Each entry carries summary counts
  // (files, repos, orgs, success/skipped/failed) rather than the full
  // JobView every row would need for a table — that's what GET /jobs/:id
  // (via the Results page) is for once a run is picked.
  app.get("/jobs", async (request): Promise<ListJobsResponse> => {
    const currentUser = resolveCurrentUser(request);
    const allJobs = getAllJobsOrderedByCreatedAtDesc(db);
    const jobs = currentUser.role === "admin" ? allJobs : allJobs.filter((job) => job.createdBy === currentUser.userId);

    const entries: JobHistoryEntry[] = jobs.map((job) => {
      const changeSet = getChangeSetById(db, job.changeSetId);
      const fileCount = changeSet ? getChangeSetFilesByChangeSetId(db, changeSet.id).length : 0;
      const repoRuns = getRepoRunsByJobId(db, job.id);
      const orgCount = new Set(repoRuns.map((run) => run.repoFullName.split("/")[0])).size;

      return {
        job,
        changeSetName: changeSet?.name ?? "(deleted changeset)",
        fileCount,
        repoCount: repoRuns.length,
        orgCount,
        successCount: repoRuns.filter((run) => run.status === "SUCCESS").length,
        skippedCount: repoRuns.filter((run) => run.status === "SKIPPED").length,
        failedCount: repoRuns.filter((run) => run.status === "FAILED").length,
      };
    });

    return { jobs: entries };
  });

  app.get<{ Params: { id: string } }>("/jobs/:id", async (request, reply) => {
    const job = getJobById(db, request.params.id);
    if (!job) {
      return reply.code(404).send({ error: "Job not found" });
    }
    const currentUser = resolveCurrentUser(request);
    if (currentUser.role !== "admin" && job.createdBy !== currentUser.userId) {
      return reply.code(403).send({ error: "You don't have access to this job" });
    }
    const repoRuns = getRepoRunsByJobId(db, job.id);
    const repoRunFiles = getRepoRunFilesByJobId(db, job.id);
    const response: JobView = { job, repoRuns, repoRunFiles };
    return response;
  });

  // POST /jobs/:id/execute — same up-front validation as before (confirm ===
  // true, job/changeset must exist, a connection must be loadable), but the
  // actual per-repo writes no longer happen inline: the job is flipped to
  // RUNNING and persisted here, then runJobExecution takes over in the
  // background (jobQueue.ts) and this handler returns immediately with that
  // RUNNING JobView. Live progress after that point is on GET /jobs/:id/events.
  app.post<{ Params: { id: string }; Body: ExecuteJobRequest }>(
    "/jobs/:id/execute",
    async (request, reply) => {
      const parsed = executeJobBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "confirm must be true" });
      }

      const job = getJobById(db, request.params.id);
      if (!job) {
        return reply.code(404).send({ error: "Job not found" });
      }

      const changeSet = getChangeSetById(db, job.changeSetId);
      if (!changeSet) {
        return reply.code(404).send({ error: "Change set not found for this job" });
      }

      const currentUser = resolveCurrentUser(request);
      if (currentUser.role !== "admin" && job.createdBy !== currentUser.userId) {
        return reply.code(403).send({ error: "You don't have access to this job" });
      }

      // Nothing left to do if every repo_run has already moved past
      // DIFF_COMPUTED (the only status runJobExecution(..., ["DIFF_COMPUTED"])
      // below picks up). Without this guard, re-clicking "Confirm & run" on a
      // job the UI shouldn't have let you revisit (see ConfirmPage's own
      // terminal-status guard) still flips status to RUNNING and back,
      // corrupting completedAt and firing a spurious duplicate Slack
      // notification, even though no repo is actually re-executed.
      const eligibleCount = getRepoRunsByJobId(db, job.id).filter(
        (run) => run.status === "DIFF_COMPUTED"
      ).length;
      if (eligibleCount === 0) {
        return reply.code(409).send({
          error: "This job has already run — nothing left to execute. Use retry for failed repos instead.",
        });
      }

      const octokit = await getOctokitOr400(db, job.createdBy, reply);
      if (!octokit) return reply;

      const nowStart = new Date().toISOString();
      const runningJob = updateJob(db, job.id, {
        status: "RUNNING",
        startedAt: job.startedAt ?? nowStart,
      });

      // Fire-and-forget: the background loop persists its own progress and
      // publishes JobEvents as it goes. It never throws — everything is
      // caught internally so an unhandled rejection can't crash the process
      // — but `void` + a defensive .catch makes the "don't await this"
      // intent explicit and guards against that regardless.
      void runJobExecution(db, job.id, ["DIFF_COMPUTED"]).catch((err: unknown) => {
        app.log.error({ err, jobId: job.id }, "runJobExecution rejected unexpectedly");
      });

      const repoRuns = getRepoRunsByJobId(db, job.id);
      const repoRunFiles = getRepoRunFilesByJobId(db, job.id);
      const response: JobView = { job: runningJob, repoRuns, repoRunFiles };
      return response;
    }
  );

  // POST /jobs/:id/retry — identical shape to execute, but only repo_runs
  // currently FAILED are eligible. Zero FAILED repo_runs is not an error:
  // runJobExecution just finds nothing to do, recomputes the job's status
  // from its existing repo_runs, and flips straight back to a terminal
  // status; the route still returns 200 with the (briefly RUNNING) JobView.
  app.post<{ Params: { id: string }; Body: RetryJobRequest }>(
    "/jobs/:id/retry",
    async (request, reply) => {
      const parsed = retryJobBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "confirm must be true" });
      }

      const job = getJobById(db, request.params.id);
      if (!job) {
        return reply.code(404).send({ error: "Job not found" });
      }

      const changeSet = getChangeSetById(db, job.changeSetId);
      if (!changeSet) {
        return reply.code(404).send({ error: "Change set not found for this job" });
      }

      const currentUser = resolveCurrentUser(request);
      if (currentUser.role !== "admin" && job.createdBy !== currentUser.userId) {
        return reply.code(403).send({ error: "You don't have access to this job" });
      }

      const octokit = await getOctokitOr400(db, job.createdBy, reply);
      if (!octokit) return reply;

      const nowStart = new Date().toISOString();
      const runningJob = updateJob(db, job.id, {
        status: "RUNNING",
        startedAt: job.startedAt ?? nowStart,
      });

      void runJobExecution(db, job.id, ["FAILED"]).catch((err: unknown) => {
        app.log.error({ err, jobId: job.id }, "runJobExecution rejected unexpectedly");
      });

      const repoRuns = getRepoRunsByJobId(db, job.id);
      const repoRunFiles = getRepoRunFilesByJobId(db, job.id);
      const response: JobView = { job: runningJob, repoRuns, repoRunFiles };
      return response;
    }
  );

  // GET /jobs/:id/events — SSE. Fastify has no built-in SSE support, so we
  // hijack the raw Node response and drive it by hand.
  app.get<{ Params: { id: string } }>("/jobs/:id/events", async (request, reply) => {
    const job = getJobById(db, request.params.id);
    if (!job) {
      return reply.code(404).send({ error: "Job not found" });
    }

    const currentUser = resolveCurrentUser(request);
    if (currentUser.role !== "admin" && job.createdBy !== currentUser.userId) {
      return reply.code(403).send({ error: "You don't have access to this job" });
    }

    reply.hijack();
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    const writeEvent = (event: JobEvent): void => {
      reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    // Send full current state first: a client connecting after some
    // progress already happened (e.g. a page refresh mid-run) must not be
    // stuck showing nothing until the next live event arrives.
    const repoRuns = getRepoRunsByJobId(db, job.id);
    const repoRunFiles = getRepoRunFilesByJobId(db, job.id);
    writeEvent({ type: "snapshot", job, repoRuns, repoRunFiles });

    let unsubscribed = false;
    const unsubscribe = subscribeToJob(job.id, (event) => {
      writeEvent(event);
      if (event.type === "job_update" && isTerminalJobStatus(event.job.status)) {
        // The job is done — no more events are coming. Close the stream
        // rather than leaving the connection open forever.
        if (!unsubscribed) {
          unsubscribed = true;
          unsubscribe();
        }
        reply.raw.end();
      }
    });

    request.raw.on("close", () => {
      if (!unsubscribed) {
        unsubscribed = true;
        unsubscribe();
      }
    });

    return reply;
  });
}
