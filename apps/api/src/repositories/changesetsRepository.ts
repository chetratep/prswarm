// Data access for the `change_sets`, `change_set_files`, and
// `target_selections` tables. Follows the row<->domain-object mapping
// pattern established in connectionsRepository.ts: snake_case columns <->
// camelCase domain fields, JSON-stringify/parse for structured columns,
// INTEGER<->boolean for flags.
import { randomUUID } from "node:crypto";
import type {
  ChangeSet,
  ChangeSetFile,
  RepoFilter,
  TargetSelection,
} from "@bulk-github-update-tool/shared-types";
import type { AppDatabase } from "../db.js";

export interface ChangeSetRow {
  id: string;
  name: string;
  branch_strategy: ChangeSet["branchStrategy"];
  commit_strategy: ChangeSet["commitStrategy"];
  commit_message: string;
  pr_title: string | null;
  pr_body: string | null;
  created_at: string;
}

function rowToChangeSet(row: ChangeSetRow): ChangeSet {
  return {
    id: row.id,
    name: row.name,
    branchStrategy: row.branch_strategy,
    commitStrategy: row.commit_strategy,
    commitMessage: row.commit_message,
    prTitle: row.pr_title,
    prBody: row.pr_body,
    createdAt: row.created_at,
  };
}

export interface InsertChangeSetInput {
  name: string;
  branchStrategy: ChangeSet["branchStrategy"];
  commitStrategy: ChangeSet["commitStrategy"];
  commitMessage: string;
  prTitle: string | null;
  prBody: string | null;
}

export function insertChangeSet(db: AppDatabase, input: InsertChangeSetInput): ChangeSet {
  const id = randomUUID();
  const createdAt = new Date().toISOString();

  db.prepare(
    `INSERT INTO change_sets
      (id, name, branch_strategy, commit_strategy, commit_message, pr_title, pr_body, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.name,
    input.branchStrategy,
    input.commitStrategy,
    input.commitMessage,
    input.prTitle,
    input.prBody,
    createdAt
  );

  return {
    id,
    name: input.name,
    branchStrategy: input.branchStrategy,
    commitStrategy: input.commitStrategy,
    commitMessage: input.commitMessage,
    prTitle: input.prTitle,
    prBody: input.prBody,
    createdAt,
  };
}

export function getChangeSetById(db: AppDatabase, id: string): ChangeSet | null {
  const row = db.prepare("SELECT * FROM change_sets WHERE id = ?").get(id) as ChangeSetRow | undefined;
  return row ? rowToChangeSet(row) : null;
}

export interface ChangeSetFileRow {
  id: string;
  change_set_id: string;
  order_index: number;
  file_path: string;
  mode: ChangeSetFile["mode"];
  content_source: ChangeSetFile["contentSource"];
  content: string;
  template_vars_schema: string | null;
}

function rowToChangeSetFile(row: ChangeSetFileRow): ChangeSetFile {
  return {
    id: row.id,
    changeSetId: row.change_set_id,
    orderIndex: row.order_index,
    filePath: row.file_path,
    mode: row.mode,
    contentSource: row.content_source,
    content: row.content,
    templateVarsSchema: row.template_vars_schema ? JSON.parse(row.template_vars_schema) : null,
  };
}

/** contentSource and templateVarsSchema aren't part of the request body —
 * the client never gets to assert "this is a template" itself. The caller
 * (routes/changesets.ts) derives both server-side per file from that
 * file's own content via extractTemplateVariables. */
export interface InsertChangeSetFileInput {
  changeSetId: string;
  orderIndex: number;
  filePath: string;
  mode: ChangeSetFile["mode"];
  contentSource: ChangeSetFile["contentSource"];
  content: string;
  templateVarsSchema: ChangeSetFile["templateVarsSchema"];
}

export function insertChangeSetFile(db: AppDatabase, input: InsertChangeSetFileInput): ChangeSetFile {
  const id = randomUUID();

  db.prepare(
    `INSERT INTO change_set_files
      (id, change_set_id, order_index, file_path, mode, content_source, content, template_vars_schema)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.changeSetId,
    input.orderIndex,
    input.filePath,
    input.mode,
    input.contentSource,
    input.content,
    input.templateVarsSchema === null ? null : JSON.stringify(input.templateVarsSchema)
  );

  return {
    id,
    changeSetId: input.changeSetId,
    orderIndex: input.orderIndex,
    filePath: input.filePath,
    mode: input.mode,
    contentSource: input.contentSource,
    content: input.content,
    templateVarsSchema: input.templateVarsSchema,
  };
}

/** Ordered by order_index so callers get files back in the same order the
 * user arranged them on the Define page. */
export function getChangeSetFilesByChangeSetId(db: AppDatabase, changeSetId: string): ChangeSetFile[] {
  const rows = db
    .prepare("SELECT * FROM change_set_files WHERE change_set_id = ? ORDER BY order_index ASC")
    .all(changeSetId) as unknown as ChangeSetFileRow[];
  return rows.map(rowToChangeSetFile);
}

// --- target_selections: unchanged by this migration ---

export interface TargetSelectionRow {
  id: string;
  change_set_id: string;
  orgs: string;
  select_all_in_org: number;
  filters: string;
  explicit_repo_list: string;
  resolved_repo_count: number;
}

function rowToTargetSelection(row: TargetSelectionRow): TargetSelection {
  return {
    id: row.id,
    changeSetId: row.change_set_id,
    orgs: JSON.parse(row.orgs),
    selectAllInOrg: Boolean(row.select_all_in_org),
    filters: JSON.parse(row.filters),
    explicitRepoList: JSON.parse(row.explicit_repo_list),
    resolvedRepoCount: row.resolved_repo_count,
  };
}

export interface InsertTargetSelectionInput {
  changeSetId: string;
  orgs: string[];
  selectAllInOrg: boolean;
  filters: RepoFilter;
  explicitRepoList: string[];
  resolvedRepoCount: number;
}

export function insertTargetSelection(
  db: AppDatabase,
  input: InsertTargetSelectionInput
): TargetSelection {
  const id = randomUUID();

  db.prepare(
    `INSERT INTO target_selections
      (id, change_set_id, orgs, select_all_in_org, filters, explicit_repo_list, resolved_repo_count)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.changeSetId,
    JSON.stringify(input.orgs),
    input.selectAllInOrg ? 1 : 0,
    JSON.stringify(input.filters),
    JSON.stringify(input.explicitRepoList),
    input.resolvedRepoCount
  );

  return {
    id,
    changeSetId: input.changeSetId,
    orgs: input.orgs,
    selectAllInOrg: input.selectAllInOrg,
    filters: input.filters,
    explicitRepoList: input.explicitRepoList,
    resolvedRepoCount: input.resolvedRepoCount,
  };
}

export function getTargetSelectionById(db: AppDatabase, id: string): TargetSelection | null {
  const row = db.prepare("SELECT * FROM target_selections WHERE id = ?").get(id) as
    | TargetSelectionRow
    | undefined;
  return row ? rowToTargetSelection(row) : null;
}
