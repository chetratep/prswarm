---
paths:
  - "apps/api/src/db.ts"
  - "apps/api/src/repositories/**/*.ts"
  - "apps/api/src/routes/changesets.ts"
---

# Data model & migration conventions

## Migrations

`db.ts` runs idempotent migrations via a `dropColumnIfExists`-style guard pattern (works against either a fresh DB or an existing one, safe to re-run). "Safe" here means **won't crash or corrupt the DB** — it does not mean "preserves old data." A migration that drops columns to move their data onto a new child table does not backfill; rows created before that migration keep their parent row but lose the dropped columns' content. This is a deliberate, documented tradeoff, not an oversight — don't add backfill logic without checking whether it's actually wanted first.

## ChangeSet / RepoRun file split

`ChangeSet` doesn't carry file content directly — each file is a `ChangeSetFile` row (`change_set_files`: `id`, `changeSetId`, `orderIndex`, `filePath`, `mode`, `contentSource`, `content`, `templateVarsSchema`), ordered by `orderIndex`. Symmetrically, a `RepoRun`'s per-file diff/status/rendered content lives on `RepoRunFile` rows (`repo_run_files`, one per `(repoRun, changeSetFile)` pair).

`RepoRunFile.renderedContent` / `diffSummary` are computed **once, at preview time**, and reused verbatim by execute — never re-derived from the shared `ChangeSetFile.content` at execute time. This is what makes per-repo template values work at all (otherwise execute would write the same unsubstituted template everywhere) and is what guarantees preview and execute genuinely agree on what gets written. Don't introduce a second code path that re-renders content at execute time.

`POST /api/changesets` wraps the changeset-insert-plus-all-file-inserts sequence in a single transaction — a file insert throwing partway through must not leave a changeset with only some of its files persisted.

## Settings (DB-backed config)

Generic key/value `settings` table (`repositories/settingsRepository.ts`) for config that needs to survive without redeploying (e.g. the Slack webhook URL) — used because the standalone binary's `.env` resolves against the process's *current working directory*, not the binary's location, which is easy to get wrong when running from `PATH`. Matching env var (e.g. `SLACK_WEBHOOK_URL`) always wins over the persisted setting when set, same as every other env var in this app — surface that explicitly in any UI/CLI for a DB-backed setting rather than silently ignoring the field.
