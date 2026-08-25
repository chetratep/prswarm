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

## The whole database is encrypted at rest

Not just the credential — the entire database file. PRSwarm keeps its
working database in memory and only ever writes it to disk as an
**AES-256-GCM**-encrypted blob. Open `app.db` in a hex editor or point
`sqlite3` at it and you get ciphertext, not a SQLite header: usernames,
password hashes, changeset contents and run history are all inside that
envelope rather than sitting in a readable database file.

Writes are flushed shortly after they happen (and on shutdown), each
flush written to a temp file and then renamed into place — so an
interrupted write leaves the previous complete file intact rather than a
half-written one.

The stored GitHub token/key is *additionally* encrypted as its own
column value, so it stays encrypted even in memory and even if the
whole-file boundary were ever bypassed. Decryption happens only inside
the GitHub integration layer, for the duration of an actual API call —
the decrypted value is never sent to the browser, logged, or echoed
anywhere. What the frontend sees after a connection is saved is metadata
only (which account, which auth method) — never the credential itself.

### Where the key lives

One 32-byte key covers both. In precedence order:

1. **`ENCRYPTION_KEY`** environment variable, if set — always wins.
2. **Your OS keychain** — Windows Credential Manager, macOS Keychain, or
   the Linux Secret Service (`secret-tool`, present only on a desktop
   session with GNOME Keyring/KWallet running). This is the default on a
   desktop install, and no key file is written at all.
3. A **key file** in the app's data directory, if one exists from an
   earlier run.
4. Otherwise a new key is generated and stored by the best method
   available — keychain if reachable, a `0600` file in the data directory
   if not.

The keychain protects the key against a stolen disk or a copied backup:
on modern hardware (Windows DPAPI/TPM, macOS Secure Enclave-backed items)
the key can't be exfiltrated as raw bytes by copying files, only used in
place through an OS call. It does **not** protect against malware running
as the same logged-in user — closing that gap needs code-signed release
binaries so the keychain entry can be scoped to this exact binary, which
this project doesn't do today.

### On headless servers and in Docker

There is no keychain to use. In that mode the key falls back to a
generated file sitting in the same directory as the database it
protects — which is worth being blunt about: anyone who can read the
database file can read the key next to it. That's the same trust boundary
most self-hosted server software accepts (the host or container *is* the
boundary), but if you want real protection against a compromised host,
supply `ENCRYPTION_KEY` yourself through your platform's own secret
mechanism — a Docker secret, a Kubernetes secret, a cloud secrets
manager — instead of letting one auto-generate on disk. The app prints
this warning at startup when it takes that path.

### Losing the key means losing the data

:::danger

There is no recovery path and no backdoor. If `ENCRYPTION_KEY` changes,
or the keychain entry or key file is lost, the database cannot be
decrypted by anyone, including you. The app fails fast at startup rather
than silently starting empty, and refuses to generate a replacement key
when an encrypted database is already present — but it cannot undo a key
that's actually gone.

Back up the key together with the database. A database backup alone is
worthless without it.

:::

### Upgrading from a pre-encryption version

The first startup after upgrading converts the existing plaintext
database in place, logs `Encrypted existing database at rest for the
first time.`, and deletes the leftover plaintext `app.db-wal`/`app.db-shm`
files that older versions wrote alongside it. From that boot onward, your
encryption key matters permanently — see the warning above.

### One instance per database

PRSwarm expects a single process per database file. Because each instance
holds its own in-memory copy and each flush rewrites the whole file, two
instances pointed at the same `DATABASE_PATH` will overwrite each other's
data wholesale. Run one.

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
