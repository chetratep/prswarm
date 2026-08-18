// Changeset definition + diff-preview job creation.
//   POST /changesets           -> define one or more file changes (name +
//                                  files[] + branch/commit strategy).
//   POST /changesets/:id/jobs  -> resolve a target repo list into a job:
//                                  computes a real per-repo, per-file diff
//                                  against every targeted repo (sequentially,
//                                  no concurrency pool yet — matches the
//                                  existing MVP simplification) before
//                                  anything writes.
import type { FastifyInstance, FastifyReply } from "fastify";
import type { Octokit } from "@octokit/rest";
import { z } from "zod";
import {
  extractTemplateVariables,
  renderTemplate,
  type CreateChangeSetRequest,
  type CreateChangeSetResponse,
  type CreateJobRequest,
  type JobView,
} from "@bulk-github-update-tool/shared-types";
import type { AppDatabase } from "../db.js";
import { loadOctokitForCurrentConnection, NoConnectionError } from "../github/loadConnection.js";
import { computeRepoRunPreview } from "../github/repoDiff.js";
import {
  getChangeSetById,
  getChangeSetFilesByChangeSetId,
  insertChangeSet,
  insertChangeSetFile,
  insertTargetSelection,
} from "../repositories/changesetsRepository.js";
import { insertJob, updateJob } from "../repositories/jobsRepository.js";
import { getRepoRunFilesByJobId, insertRepoRunFile } from "../repositories/repoRunFilesRepository.js";
import { getRepoRunsByJobId, insertRepoRun } from "../repositories/repoRunsRepository.js";

export interface ChangesetsRouteOptions {
  db: AppDatabase;
}

async function getOctokitOr400(db: AppDatabase, reply: FastifyReply): Promise<Octokit | undefined> {
  try {
    return await loadOctokitForCurrentConnection(db);
  } catch (err) {
    if (err instanceof NoConnectionError) {
      reply.code(400).send({ error: err.message });
      return undefined;
    }
    throw err;
  }
}

const createChangeSetBodySchema = z.object({
  name: z.string().min(1),
  files: z
    .array(
      z.object({
        filePath: z.string().min(1),
        mode: z.enum(["CREATE_ONLY", "OVERWRITE", "UPSERT"]),
        content: z.string(),
      })
    )
    .min(1),
  branchStrategy: z.enum(["DEFAULT", "NEW_BRANCH"]),
  commitStrategy: z.enum(["DIRECT_COMMIT", "PULL_REQUEST"]),
  commitMessage: z.string().min(1),
  prTitle: z.string().nullable(),
  prBody: z.string().nullable(),
});

const createJobBodySchema = z.object({
  targetRepos: z.array(z.string().min(1)),
  templateValues: z.record(z.string(), z.record(z.string(), z.string())).optional(),
});

export async function registerChangesetsRoutes(
  app: FastifyInstance,
  opts: ChangesetsRouteOptions
): Promise<void> {
  const { db } = opts;

  app.post<{ Body: CreateChangeSetRequest }>("/changesets", async (request, reply) => {
    const parsed = createChangeSetBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.message });
    }

    // Wrapped in a transaction: the changeset row and all its file rows
    // must commit together or not at all. Without this, a throw partway
    // through the files loop (e.g. a transient SQLite error) would leave
    // a changeset with only some of its files persisted — a silent,
    // partial, inconsistent changeset with nothing to distinguish it from
    // a clean one.
    const changeSet = db.transaction(() => {
      const changeSet = insertChangeSet(db, {
        name: parsed.data.name,
        branchStrategy: parsed.data.branchStrategy,
        commitStrategy: parsed.data.commitStrategy,
        commitMessage: parsed.data.commitMessage,
        prTitle: parsed.data.prTitle,
        prBody: parsed.data.prBody,
      });

      // contentSource/templateVarsSchema are derived from each file's own
      // content, server-side, never from a client-supplied flag — same
      // extractTemplateVariables function the frontend uses, so the two
      // can never disagree about what counts as a template variable.
      parsed.data.files.forEach((file, index) => {
        const variables = extractTemplateVariables(file.content);
        const contentSource = variables.length > 0 ? "TEMPLATE" : "STATIC";
        const templateVarsSchema =
          contentSource === "TEMPLATE" ? Object.fromEntries(variables.map((v) => [v, ""])) : null;

        insertChangeSetFile(db, {
          changeSetId: changeSet.id,
          orderIndex: index,
          filePath: file.filePath,
          mode: file.mode,
          contentSource,
          content: file.content,
          templateVarsSchema,
        });
      });

      return changeSet;
    })();

    const response: CreateChangeSetResponse = { changeSet };
    return response;
  });

  app.post<{ Params: { id: string }; Body: CreateJobRequest }>(
    "/changesets/:id/jobs",
    async (request, reply) => {
      const changeSet = getChangeSetById(db, request.params.id);
      if (!changeSet) {
        return reply.code(404).send({ error: "Change set not found" });
      }
      const changeSetFiles = getChangeSetFilesByChangeSetId(db, changeSet.id);

      const parsed = createJobBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: parsed.error.message });
      }
      const { targetRepos, templateValues } = parsed.data;

      const octokit = await getOctokitOr400(db, reply);
      if (!octokit) return reply;

      const orgs = Array.from(new Set(targetRepos.map((full) => full.split("/")[0])));

      const { job } = db.transaction(() => {
        const targetSelection = insertTargetSelection(db, {
          changeSetId: changeSet.id,
          orgs,
          selectAllInOrg: false,
          filters: {},
          explicitRepoList: targetRepos,
          resolvedRepoCount: targetRepos.length,
        });

        const job = insertJob(db, {
          changeSetId: changeSet.id,
          targetSelectionId: targetSelection.id,
          status: "PREVIEWING",
          createdBy: "local",
        });

        return { job, targetSelection };
      })();

      // Sequential, not concurrent — matches the existing MVP
      // simplification. Each repo's failure is captured into its own row
      // by computeRepoRunPreview and must never abort the loop.
      for (const repoFullName of targetRepos) {
        // Render each file's content for this repo: schema defaults
        // first, then this repo's explicit overrides layered on top.
        // STATIC files pass their content through unchanged.
        const afterContentByFileId: Record<string, string> = {};
        for (const file of changeSetFiles) {
          afterContentByFileId[file.id] =
            file.contentSource === "TEMPLATE"
              ? renderTemplate(file.content, {
                  ...(file.templateVarsSchema ?? {}),
                  ...(templateValues?.[repoFullName] ?? {}),
                })
              : file.content;
        }

        const preview = await computeRepoRunPreview(
          octokit,
          changeSet,
          changeSetFiles,
          repoFullName,
          afterContentByFileId
        );
        const repoRun = insertRepoRun(db, { jobId: job.id, repoFullName, ...preview.repoRun });
        for (const filePreview of preview.files) {
          insertRepoRunFile(db, { repoRunId: repoRun.id, ...filePreview });
        }
      }

      const finalJob = updateJob(db, job.id, { status: "READY" });
      const repoRuns = getRepoRunsByJobId(db, job.id);
      const repoRunFiles = getRepoRunFilesByJobId(db, job.id);

      const response: JobView = { job: finalJob, repoRuns, repoRunFiles };
      return response;
    }
  );
}
