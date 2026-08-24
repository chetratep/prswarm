---
sidebar_position: 3
---

# Quick Start

This walks through pushing your first change to a couple of test repos.

## 1. Start it

```bash
./prswarm
```

Running at a real terminal, you'll be prompted for a port (press Enter to
accept the default). Once it's listening, open the URL it prints — by
default `http://localhost:3000`.

## 2. Connect a GitHub credential

On the **Connect** page, choose either:

- **Personal access token** — needs `repo` scope (and `workflow` too, if
  you're touching `.github/workflows/*` files — see
  [Authentication](./guides/authentication) for the exact scopes and a
  couple of gotchas that are easy to lose an hour to).
- **GitHub App** — App ID + private key. If the App is installed on
  several accounts, you'll pick which one this connection targets.

## 3. Select targets

Pick an org, then check the repos you want. Selections persist as you
switch between orgs, so you can build up a cross-org batch before moving
on. "Select all visible" and filter-by-language/topic/archived are there
for large orgs.

## 4. Define the change

- **File path** — e.g. `.github/CODEOWNERS`.
- **Mode** — Upsert (create or overwrite), Create only (skip repos that
  already have the file), or Overwrite.
- **Content** — type it, paste it, or fetch it from a raw URL. Add more
  files with **+ Add another file** — they all land in one atomic commit
  per repo.
- **How it lands** — direct push to default, a new branch, or a pull
  request. None of these is pre-selected; you choose every time.

## 5. Preview

Every targeted repo gets a real computed diff: **New file**, **Modified**,
**Unchanged**, or **Error**. Expand a repo, then a file, to see the actual
diff. Not happy with something? **Back to edit** returns to Define with
everything you typed still there.

## 6. Confirm

If any repo is going direct-to-default, you'll need to type `RUN` to
proceed — no threshold skips this, even for a single repo.

## 7. Execute → Results

Writes happen concurrently in the background; the Execute page shows live
per-repo status as each one finishes. Results gives you the final outcome
per repo — commit/PR link, or the error if it failed, with a one-click
retry for anything that didn't make it.

---

That's the whole loop. For the details behind each step, see
[The seven-step workflow](./guides/workflow).
