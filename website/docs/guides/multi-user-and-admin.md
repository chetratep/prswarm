---
sidebar_position: 4
---

# Multi-user access & admin

Instance login is optional and off by default (`AUTH_ENABLED`, see
[Configuration](../configuration)) — for a single person running PRSwarm
purely on localhost, it can stay off entirely. Turn it on if the instance
is ever reachable past localhost.

## Accounts and roles

When enabled, there are two roles:

- **member** — can connect GitHub credentials, run jobs, and see their
  own run history.
- **admin** — everything a member can do, plus the admin Users page
  (list every account, promote a member to admin, reset another user's
  password).

Signup is open — anyone who can reach the login screen can create a
`member` account via **Need an account? Sign up**. There's no
invite/approval step. If that's not what you want for your deployment,
put the instance behind your own access control (a reverse proxy with
its own auth, a VPN, network-level restriction) rather than relying on
this as the only gate.

## First run

The very first time the app starts with `AUTH_ENABLED=true` and no
accounts exist yet, it bootstraps one **admin** account automatically:

- If `AUTH_USERNAME` and `AUTH_PASSWORD_HASH` are both set, that becomes
  the admin account.
- Otherwise, it creates a default `admin` account with a **randomly
  generated password, printed to the console exactly once** at that
  startup. Log in and change it immediately — there's no way to retrieve
  it again afterward except resetting it directly in the database.

## Everyone gets their own connection

GitHub connections are scoped per user — your PAT or GitHub App
connection isn't visible to or usable by anyone else's account. Job/run
history is scoped the same way: members see their own runs, admins see
everyone's.

## Self-service

Every logged-in user (member or admin) can change their own password
from the account menu in the header — no admin step required for that.
