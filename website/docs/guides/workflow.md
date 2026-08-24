---
sidebar_position: 1
---

# The seven-step workflow

Every run goes through the same seven steps, in order. A stepper at the
top of the app tracks where you are — Execute and Results only become
clickable once a job has actually started running, so you can't jump
ahead to a step that doesn't have anything behind it yet.

## 1. Connect

One credential at a time — either a personal access token or a GitHub
App installation (see [Authentication](./authentication)). You can switch
credentials any time via **Use different credentials** on the Connect
page; the previous connection is replaced, not stacked.

## 2. Select

Browse by org, check repos, switch orgs and keep checking — selections
carry across orgs into the same run. A selection summary panel (grouped
by owner, removable per-repo) stays visible regardless of which org's
repo list is currently showing, so cross-org picks never look like they
silently reset.

Discovery only ever lists repos your connected credential can actually
reach — never GitHub's global search, which could surface repos you can
see but can't write to.

## 3. Define

- One or more files, each with its own path, write mode, and content.
- **How it lands** — direct push, new branch, or pull request. All three
  are equal, first-class choices; none is pre-selected.
- Content can include `{{variableName}}` placeholders — see
  [Multi-file changesets & template variables](./multi-file-and-templates).

Going back to Define from Preview or Confirm keeps everything you
typed — it's not a fresh form each time.

## 4. Preview

For every targeted repo, a real diff is computed server-side: fetches the
current file content, diffs it against what you're proposing, and checks
branch protection if you're going direct-to-default. Status is one of:

- **New file** — doesn't exist yet in that repo.
- **Modified** — exists and differs.
- **Unchanged** — exists and is already identical (this repo gets
  skipped at execute time — no-op commits aren't created).
- **Error** — couldn't compute a diff (e.g. no read access).

A repo targeting direct-to-default gets a **protected — will likely
fail** warning here if branch protection is detected, before you've
committed to anything.

## 5. Confirm

Shows the worst-status-per-repo counts (not a raw per-file count) and,
for any repo going direct-to-default, an unconditional gate: type `RUN`
to proceed. This never has a "just this once" bypass, regardless of how
many or how few repos are in the batch.

## 6. Execute

Confirming returns almost immediately — the job flips to `RUNNING` and
the actual per-repo writes happen concurrently in the background (5x
parallel). The Execute page opens a live connection and renders each
repo's status as it updates, so you're watching real progress, not a
generic spinner.

One repo's failure never stops the others — failures are isolated per
repo.

## 7. Results

Final per-repo outcome: a commit URL, a PR URL, or the actual error
message. Failed repos can be retried individually or as a batch — retry
only re-runs what actually failed, not the whole job.
