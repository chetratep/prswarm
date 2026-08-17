// SQLite setup: opens the database file (creating its parent directory if
// needed) and runs idempotent CREATE TABLE IF NOT EXISTS migrations for the
// full schema.
//
// Uses bun:sqlite rather than better-sqlite3: this repo's whole stack pitch
// is "no native toolchain to stand up" (see CLAUDE.md), and better-sqlite3
// needs a working Python + C++ build chain to compile from source whenever
// no prebuilt binary matches. bun:sqlite ships in the Bun binary itself, so
// there's nothing to compile at all — and unlike node:sqlite (used before
// this migration), it has a native `.transaction()` method, so callers no
// longer need a hand-rolled BEGIN/COMMIT/ROLLBACK wrapper.
import { Database } from "bun:sqlite";
import fs from "node:fs";
import path from "node:path";

export type AppDatabase = Database;

export function openDatabase(databasePath: string): AppDatabase {
  const dir = path.dirname(databasePath);
  fs.mkdirSync(dir, { recursive: true });

  const db = new Database(databasePath);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");

  runMigrations(db);

  return db;
}

function runMigrations(db: AppDatabase): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS connections (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      login TEXT,
      app_id TEXT,
      installation_id TEXT,
      encrypted_token TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS change_sets (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      file_path TEXT NOT NULL,
      mode TEXT NOT NULL,
      content_source TEXT NOT NULL,
      content TEXT NOT NULL,
      template_vars_schema TEXT,
      branch_strategy TEXT NOT NULL,
      commit_strategy TEXT NOT NULL,
      commit_message TEXT NOT NULL,
      pr_title TEXT,
      pr_body TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS target_selections (
      id TEXT PRIMARY KEY,
      change_set_id TEXT NOT NULL,
      orgs TEXT NOT NULL,
      select_all_in_org INTEGER NOT NULL,
      filters TEXT NOT NULL,
      explicit_repo_list TEXT NOT NULL,
      resolved_repo_count INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      change_set_id TEXT NOT NULL,
      target_selection_id TEXT NOT NULL,
      status TEXT NOT NULL,
      created_by TEXT NOT NULL,
      started_at TEXT,
      completed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS repo_runs (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL,
      repo_full_name TEXT NOT NULL,
      status TEXT NOT NULL,
      diff_summary TEXT,
      before_sha TEXT,
      after_sha TEXT,
      branch_protected INTEGER,
      direct_to_default INTEGER NOT NULL,
      commit_sha TEXT,
      pr_url TEXT,
      error_message TEXT,
      attempt_count INTEGER NOT NULL DEFAULT 0
    );
  `);

  const repoRunsColumns = db.prepare(`PRAGMA table_info(repo_runs)`).all() as Array<{
    name: string;
  }>;
  const hasRenderedContent = repoRunsColumns.some((col) => col.name === "rendered_content");
  if (!hasRenderedContent) {
    db.exec(`ALTER TABLE repo_runs ADD COLUMN rendered_content TEXT`);
  }
}
