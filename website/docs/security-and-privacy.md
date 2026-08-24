---
sidebar_position: 7
---

# Security & Privacy

## Your credentials never leave your machine

PRSwarm is self-hosted with no hosted/managed edition — there is no
external service in the loop. Whatever you connect (a personal access
token or a GitHub App private key) is used only to talk directly to
GitHub's API from your own instance. Nothing is sent anywhere else, and
there's no telemetry.

## Credentials are encrypted at rest

The stored token/key is encrypted with **AES-256-GCM** before it ever
touches disk, using a 32-byte key that's either:

- set explicitly via the `ENCRYPTION_KEY` environment variable, or
- generated automatically on first run and persisted to the app's data
  directory (see [Configuration](./configuration) for exactly where),
  written with restrictive file permissions.

Decryption happens only inside the GitHub integration layer, in-memory,
for the duration of an actual API call — the decrypted value is never
sent to the browser, logged, or echoed anywhere. What the frontend sees
after a connection is saved is metadata only (which account, which auth
method) — never the credential itself.

## Instance login is separate from GitHub credentials

If you enable `AUTH_ENABLED` (see
[Multi-user access & admin](./guides/multi-user-and-admin)), that
password is for logging into *this app* — a completely separate concern
from the GitHub credential a user connects once inside it. Instance
passwords are bcrypt-hashed; sessions are signed cookies, not a stored
session table.

## Discovery is scoped to what you can actually reach

Org and repo listing only ever calls GitHub's own "list what I have
access to" endpoints for the connected credential — never GitHub's global
search, which could otherwise surface repos you can see but not write to.

## Direct-to-default pushes get extra guardrails

Independent of encryption, the app itself is deliberately conservative
about the highest-risk action it can take: pushing straight to a
repo's default branch, no PR, no review. Branch protection is checked
at *preview* time (not discovered as a surprise at execute time), and
the confirmation gate before any such push is unconditional — typing
`RUN` is required regardless of batch size, with no threshold that skips
it.

## Fetching content from a URL is guarded against SSRF

Define's "load from URL" feature fetches server-side, not from the
browser — which is exactly the shape of request that needs care. The
target is restricted to `http(s)`, resolved and rejected if it points at
a loopback/link-local/private address (including cloud metadata
endpoints), with the same check re-applied on every redirect hop, a
5-redirect cap, a 5MB response limit, and a 10s timeout.

## Reporting a security issue

This is a self-hosted, single-maintainer open source project — please
open an issue on
[the GitHub repo](https://github.com/chetratep/prswarm/issues) for any
security concern.
