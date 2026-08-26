---
sidebar_position: 1
---

# Introduction

[![CI](https://github.com/chetratep/prswarm/actions/workflows/ci.yml/badge.svg)](https://github.com/chetratep/prswarm/actions/workflows/ci.yml)

PRSwarm pushes one file change — or a set of file changes — across a
chosen set of GitHub orgs and repos, with a real per-repo diff reviewed
before anything writes.

It exists for the recurring chore every org eventually hits: a workflow
file, a `.editorconfig`, a CI config, a license header, a dependency pin —
something that needs to land identically (or near-identically, via
per-repo template values) across dozens or hundreds of repos, and you want
to see exactly what's about to change in each one before it does.

## What it is

- **Self-hosted.** You run it — no hosted service, no third party ever
  sees your code, your repo list, or your credentials.
- **Single binary.** Download one file for your platform and run it. No
  runtime to install, no config file required to get started.
- **Open source, MIT licensed.**

## What it does

1. **Connect** a GitHub credential — a personal access token or a GitHub
   App installation.
2. **Select** the orgs and repos to target — by hand, by search, by
   filter (language/topic/archived), or "all repos in this org."
3. **Define** the file (or files) to change, how they land (direct push,
   new branch, or pull request), and optional per-repo template values.
4. **Preview** a real, computed diff for every targeted repo before
   anything is written.
5. **Confirm** — an explicit, typed confirmation gate for anything that
   pushes directly to a default branch, regardless of batch size.
6. **Execute** — writes run concurrently, with live per-repo status
   streamed as each one finishes.
7. **Results** — final per-repo outcome, with commit/PR links or error
   messages, and a one-click retry for anything that failed.

## Where to go next

- New to PRSwarm? Start with [Installation](./installation) and the
  [Quick Start](./quick-start).
- Want the full walkthrough of each step? See
  [The seven-step workflow](./guides/workflow).
- Running it as a background service? See the [CLI Reference](./cli-reference).
- Curious how credentials are stored? See
  [Security & Privacy](./security-and-privacy).
