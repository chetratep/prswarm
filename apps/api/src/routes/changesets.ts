// Changeset definition + diff-preview job creation.
//   POST /changesets           -> define a file change (name/path/mode/
//                                  content/branch+commit strategy).
//   POST /changesets/:id/jobs  -> resolve a target repo list into a job:
//                                  computes a real per-repo diff against
//                                  every targeted repo (sequentially, no
//                                  concurrency pool yet — that's Phase 2)
//                                  before anything writes.
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
  insertChangeSet,
  insertTargetSelection,
} from "../repositories/changesetsRepository.js";
import { insertJob, updateJob } from "../repositories/jobsRepository.js";
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
  filePath: z.string().min(1),
  mode: z.enum(["CREATE_ONLY", "OVERWRITE", "UPSERT"]),
  content: z.string(),
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

    // contentSource/templateVarsSchema are derived from the content itself,
    // server-side, never from a client-supplied flag — the request body has
    // no contentSource field and never will. Scanning with the same
    // extractTemplateVariables the frontend uses keeps the two in agreement
    // about what counts as a template variable.
    const variables = extractTemplateVariables(parsed.data.content);
    const contentSource = variables.length > 0 ? "TEMPLATE" : "STATIC";
    const templateVarsSchema =
      contentSource === "TEMPLATE"
        ? Object.fromEntries(variables.map((v) => [v, ""]))
        : null;

    const changeSet = insertChangeSet(db, { ...parsed.data, contentSource, templateVarsSchema });
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

      const parsed = createJobBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: parsed.error.message });
      }
      const { targetRepos, templateValues } = parsed.data;

      const octokit = await getOctokitOr400(db, reply);
      if (!octokit) return reply;

      // orgs = unique set of "owner" prefixes from targetRepos. Not
      // precisely tracked beyond this in the MVP pass — the Select page
      // already resolved the full repo list client-side, so selectAllInOrg
      // isn't load-bearing here.
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

      // Sequential, not concurrent (no pool yet — Phase 2). Each repo's
      // failure is captured into its own row by computeRepoRunPreview and
      // must never abort the loop.
      for (const repoFullName of targetRepos) {
        // For TEMPLATE changesets, render this repo's content: schema
        // defaults first, then this repo's explicit overrides layered on
        // top (a repo with no explicit value for a variable falls back to
        // the schema default — currently always "" since there's no
        // default-value UI yet, but the ordering is correct and
        // future-proof for when there is one). STATIC changesets pass
        // the shared content through unchanged.
        const afterContent =
          changeSet.contentSource === "TEMPLATE"
            ? renderTemplate(changeSet.content, {
                ...(changeSet.templateVarsSchema ?? {}),
                ...(templateValues?.[repoFullName] ?? {}),
              })
            : changeSet.content;

        const preview = await computeRepoRunPreview(octokit, changeSet, repoFullName, afterContent);
        insertRepoRun(db, { jobId: job.id, repoFullName, ...preview });
      }

      const finalJob = updateJob(db, job.id, { status: "READY" });
      const repoRuns = getRepoRunsByJobId(db, job.id);

      const response: JobView = { job: finalJob, repoRuns };
      return response;
    }
  );
}
