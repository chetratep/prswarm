---
sidebar_position: 3
---

# Authentication

PRSwarm supports two credential types, selectable per connection. Only
one connection is active at a time.

## Personal access token (PAT)

A classic or fine-grained token works. Whichever kind, it needs write
access to the repos you're targeting.

**Classic PAT:** the `repo` scope. If you're writing to
`.github/workflows/*` files specifically, you also need the `workflow`
scope — it's checked separately from general repo write access. Without
it, GitHub returns a plain 404 on the write, not an obviously
scope-related error, so this is the first thing worth checking if writes
to workflow files fail mysteriously.

**Fine-grained PAT:** "Contents: Read and write" at minimum. For workflow
files, also grant "Workflows: Read and write".

## GitHub App

Two-step connection, since one App can be installed on several
accounts/orgs but a connection here still targets exactly one at a time:

1. Enter the App ID and private key (`.pem` contents). PRSwarm discovers
   which accounts the App is installed on.
2. Pick one of those installations to bind the connection to.

**The App's permissions matter more than they might look like.** Every
write — regardless of which file path, workflow or not — goes through the
Git Data API, which needs the App's **Contents** repository permission
set to **Read and write**. Missing it fails every repo in the job
identically with a 403. This is a distinct permission from "Workflows:
Read and write" (an easy mix-up — they're adjacent checkboxes and both
have "workflow" in the name people associate with the error) — the fix
here specifically needs **Contents**, not **Workflows**.

If you change an App's permissions after installing it, GitHub may
require the installation owner to explicitly accept the updated
permission set (a banner on the installation's settings page) before it
actually takes effect on new tokens.

## GitHub Enterprise Server

Both credential types support pointing at a GHES instance instead of
github.com — enter the hostname (e.g. `github.example.com`) when
connecting. Requests route through Octokit's `baseUrl`, and the connected
host is allowlisted for the "fetch content from URL" feature on Define,
so pasting a raw-file link from your own GHES instance works the same way
it does for github.com.

## Switching credentials

**Use different credentials** on the Connect page replaces the current
connection — it doesn't stack multiple connections. Reconnecting doesn't
touch any in-progress or historical job; those keep executing under
whichever connection they were created with.
