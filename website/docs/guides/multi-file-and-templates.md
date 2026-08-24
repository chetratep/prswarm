---
sidebar_position: 2
---

# Multi-file changesets & template variables

## Multiple files, one commit

A single changeset can define more than one file — click **+ Add another
file** on Define to add a row, each with its own path, write mode, and
content. All non-skipped files in a changeset land in **one atomic
commit** per repo: PRSwarm builds the tree, blobs, and commit via the Git
Data API rather than calling the file-update endpoint once per file, so a
repo either gets the whole set of changes together or none of them.

Per-file skip logic still applies independently — a repo can write some
files and skip others (e.g. one file is new, another is already
identical) within that same commit. A repo where every file is a no-op
skips straight to **Skipped** with zero GitHub calls.

Reorder files with the up/down arrows on each row; remove any file down
to a minimum of one.

## Template variables

Any file's content can include `{{variableName}}` placeholders. Once
PRSwarm detects one, Define shows a per-repo × per-variable input grid —
fill in a different value for every targeted repo before you can move on
to Preview.

```yaml
# .github/CODEOWNERS
* @{{teamOwner}}
```

Each repo's rendered content is computed once, at preview time, and
reused verbatim at execute time — so what you saw in Preview is
guaranteed to be exactly what gets committed, never re-derived from the
shared template at the last second.

A variable used in more than one file within the same changeset is
still just one variable with one value per repo — not one per file.
