---
title: Sunrise GitHub Dashboard Spec
kind: topic
created: 2026-04-28
updated: 2026-04-28
tags:
  - github
  - api
  - notifications
  - developer-experience
  - agent-experience
source_type: spec
---

# Sunrise GitHub Dashboard Spec

## Purpose

Build a short, actionable GitHub inbox that shows the things most likely to require action from me.

This is a **single-user product only**: it is designed for one GitHub user, their repos, their authored PRs/issues, their review requests, and their loop-closure debt. It is never intended to become a hosted multi-tenant SaaS.

Other users should be able to use it by deploying their own copy to Cloudflare or forking the code. The public homepage should sell that path clearly:

```txt
Public homepage → GitHub repo → Deploy your own version → own your data
```

For the owner of a deployed instance, the product should support GitHub sign-in and then route to a dashboard-style view of their GitHub experience.

This is not a full GitHub client. It is a prioritized action surface.

After reviewing recent commit history and current agentic-engineering practice, the spec should expand from a notification inbox into a **close-the-loop surface**: not just “who is waiting on me?” but “where is my agentic work unfinished, unverified, unexplained, or drifting?”

The product should help enforce the operating rule:

> No mergeable work without evidence that it ran, can be explained, and has a clear next action.

## Product name

The project is named **Sunrise**.

Working tagline:

> A self-hosted morning dashboard for the GitHub work that needs your attention.

Short description:

> Sunrise is a single-user GitHub action surface for replacing GitHub Notifications with a calmer daily dashboard of issues, PRs, reviews, alerts, repo health, and loop-closure work.

Use **GitHub Inbox** as category language when useful, not as the project name.

## Distribution model

Default distribution is self-hosted:

```txt
GitHub repo
  → Deploy to Cloudflare button
  → user configures GitHub OAuth app / app credentials for their own instance
  → D1 + Queues + Worker provisioned under user's Cloudflare account
  → user signs in with GitHub on their own instance
  → user owns data and rate limits
```

Principles:

- single-user only;
- no central hosted service;
- no shared multi-tenant database;
- no teams/org admin model beyond the user's GitHub permissions;
- least-privilege GitHub token or GitHub App credentials;
- all snapshots and evidence stored in the user's Cloudflare account;
- easy to fork, customize priority rules, and deploy independently;
- public docs should encourage people to deploy their own instance rather than send tokens to a hosted app.

Possible repo tagline:

> Forkable, self-hosted GitHub loop closure on Cloudflare.

## Single-user simplifications

Because this is **never** multi-tenant, the product can be dramatically simpler and more useful.

Aggressive simplification rule:

> If a feature exists only to support multiple users, multiple tenants, hosted onboarding, billing, or account administration, delete it from the design.

### Product simplifications

No need for:

- tenant model;
- organizations/workspaces inside the app;
- user invitations;
- team membership;
- billing;
- per-seat plans;
- admin console;
- cross-user sharing;
- shared notification routing;
- per-tenant feature flags;
- generic onboarding funnels;
- multi-user permissions UI.

Use instead:

```txt
one owner
one GitHub identity
one Cloudflare deployment
one config file / settings page
one D1 database
one queue set
one opinionated action ranking
```

### Data model simplifications

Most tables do **not** need `tenant_id`, `workspace_id`, or `user_id` columns. The deployment boundary is the tenant boundary.

Prefer:

```txt
settings
scan_runs
scan_jobs
action_items
repo_snapshots
repo_readiness_snapshots
rate_limit_snapshots
item_evidence
ignored_items
```

Over:

```txt
users
accounts
tenants
memberships
organizations
workspace_members
billing_customers
role_assignments
```

A `target_login` or `github_login` setting is still useful for clarity, but it should be configuration, not a tenancy dimension.

### Auth simplifications

No need for app-local multi-user accounts, but the owner should be able to sign in with GitHub.

Preferred v1:

```txt
public homepage
→ /login with GitHub OAuth
→ validate GitHub identity against OWNER_LOGIN
→ store one session in D1
→ dashboard reads the signed-in owner's GitHub data
```

This keeps the product approachable: visitors see a landing page and a “Deploy your own” path; the owner can sign in normally instead of relying on Cloudflare Access.

Still no:

```txt
users table
teams
workspaces
multi-account switching
organization admin
billing/account management
```

Session state should live in D1, alongside OAuth state and product data. Avoid KV in v1 unless a measured need appears.

Cloudflare Access remains a valid optional extra defense for private deployments, but it is no longer the primary product auth model.

### Queue simplifications

Queue messages do not need tenant routing.

Use:

```ts
type QueueMessage = {
  kind: string;
  runId: string;
  jobId: string;
  target: Record<string, unknown>;
};
```

No:

```ts
tenantId
workspaceId
userId
```

Rate-limit handling is also simpler: there is one GitHub credential / installation to respect, one rate-limit snapshot, and one queue pressure policy.

### Security simplifications

Security focuses on protecting one person's token and data, not isolating customers from each other.

Still needed:

- secret storage in Cloudflare;
- CSRF protection for mutation routes if cookie/session auth is used;
- no token exposure in client props;
- read-only GitHub scopes where possible;
- audit log for destructive local actions such as ignore/archive/replay;
- safe defaults for Deploy to Cloudflare docs.

Not needed:

- tenant isolation;
- row-level tenant authorization;
- per-tenant encryption keys;
- cross-tenant abuse controls;
- organization admin audit logs;
- enterprise SSO/SAML;
- billing/security compliance surfaces.

### UX simplifications

The app can be opinionated and personal:

- hard-code the priority model first;
- allow a small repo allowlist/ignore list;
- let the user edit thresholds in one settings file;
- show “my loops,” not generic dashboards;
- default to fewer than 20 items;
- prefer close/ignore/snooze decisions over collaboration features.

### Deploy simplifications

The public distribution path can be:

```txt
1. Visit public homepage.
2. Click “Deploy your own on GitHub.”
3. Fork or use template.
4. Create/configure a GitHub OAuth app or GitHub App for the deployed URL.
5. Click Deploy to Cloudflare.
6. Bind D1 + Queues.
7. Set GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET, OWNER_LOGIN, SESSION_SECRET.
8. Visit your deployed homepage.
9. Sign in with GitHub.
```

No hosted onboarding service is required. The homepage should point away to GitHub for deployment rather than collecting tokens.

## Lessons from Tasche GitHub authentication

Tasche is useful prior art because it is also a personal Cloudflare app with GitHub authentication. It implemented a full GitHub OAuth 3-leg flow in Python Workers:

```txt
/api/auth/login
  → generate CSRF state
  → store state in KV with 10 min TTL
  → redirect to GitHub OAuth

/api/auth/callback
  → validate and delete CSRF state
  → exchange code for access token
  → fetch /user and /user/emails
  → enforce ALLOWED_EMAILS
  → upsert user in D1
  → create KV session
  → set HttpOnly Secure SameSite=Lax cookie
```

Good lessons to keep:

- **Setup checklist matters.** Tasche's UI tells the deployer exactly which bindings/secrets are missing and how to fix them.
- **Whitelist owner identity.** Tasche uses `ALLOWED_EMAILS`; this project can use simpler `OWNER_LOGIN` checks or no login at all behind Cloudflare Access.
- **CSRF state is mandatory if OAuth exists.** Store state with short TTL and delete after use.
- **Session cookies need sane defaults.** HttpOnly, Secure on HTTPS, SameSite=Lax, path `/`, finite TTL.
- **Revocation should be simple.** Tasche re-checks `ALLOWED_EMAILS` and deletes sessions on revocation.
- **Dev auth bypass must never work in production.** Tasche blocks `DISABLE_AUTH=true` in production.
- **Deploy-your-own copy should be explicit.** Tasche's `not_owner` screen tells unauthorized users that this is a personal instance and links to the repo.

What to adapt for Sunrise:

- Keep GitHub OAuth login/callback/logout/session.
- Keep short-lived OAuth state, but store it in D1 instead of KV for v1.
- Keep an opaque session ID cookie with session rows in D1.
- Keep owner whitelist: `OWNER_LOGIN`.
- Keep setup checklist for missing OAuth/D1/Queue/Cron config.
- Remove multi-user account growth: no teams, tenants, billing, or account settings.
- Avoid a D1 users table unless it is clearly simpler than storing the signed-in owner profile in D1 `settings` / `sessions`.
- Avoid app-local account pages beyond “signed in as <login>.”

The key design difference:

```txt
Tasche authenticates a human into a personal reading app.
Sunrise authenticates the single owner of a deployed GitHub action dashboard.
```

So the aggressive v1 should use **Tasche-style GitHub OAuth**, but keep it single-owner and deployment-local.

## Core question

> What do I need to know about my GitHub experience because it is likely to require action from me?

## Current implementation audit

The implementation has intentionally evolved in a few places since this spec was drafted: the primary owner view is now an **Inbox**, reverse-chronological ordering is preferred over visible P0/P1/P2/P3 sections, `/settings` exists for inbox page size, and freshness is compact header metadata rather than a right-column panel.

See `docs/spec-implementation-audit.md` for the current line-by-line implementation audit, intentional product decisions that supersede older v1 subtraction notes, and remaining gaps.

## Implementation stack candidate: Hono + Inertia on Cloudflare

The best current stack candidate for the product UI is:

```txt
Cloudflare Worker
  → public homepage route
  → Tasche-style GitHub OAuth owner login
  → Hono routes
  → @hono/inertia
  → React/Vue/Svelte pages
  → D1 snapshot/cache tables
  → D1 OAuth state and sessions
  → Queues for background GitHub enrichment
```

Why this fits the spec:

- The product is a **single-user action surface**, not a public API platform or hosted SaaS.
- Hono routes can remain the source of truth for each view.
- Inertia gives SPA-feeling navigation without a separate internal REST API and client-side data-fetching layer.
- The same route can return:
  - initial HTML for humans;
  - Inertia page JSON for in-app navigation;
  - props JSON for debugging or simple agent access when `Accept: application/json` is sent.
- Type-safe `c.render(page, props)` maps well to the spec's need for reliable action-item shapes.
- A coding agent has fewer moving parts to reason about: one route computes one page's prioritized action items.

Product pages:

```txt
/                   → public landing page, or redirect to /dashboard when signed in
/login              → GitHub OAuth redirect
/callback           → GitHub OAuth callback
/dashboard          → P0/P1/P2/P3 grouped action items + compact news/overview
/runs               → background scan runs, rate-limit state, queue/DLQ status
/logout             → logout mutation
```

Do not add `/items/:id`, `/settings`, `/repos`, or `/repos/:owner/:repo` in v1. Use inline expansion, setup checklists, and dashboard sections instead.

Do not let the UI choice expand the product into a full GitHub client or any multi-user product. The UI should stay focused on one user's loop closure.

## Cloudflare Best Practices lessons applied

Source capture: [[sources/cloudflare-best-practices-capture-2026-04-30|Cloudflare Best Practices Docs Capture - 2026-04-30]].

Cloudflare's published Best Practices docs change the spec in these ways:

1. **Generate binding types.** Add `wrangler types` to setup and verification; do not hand-write `Env` because it drifts from Wrangler config.
2. **Keep compatibility date current.** New project config should set a current `compatibility_date`; update deliberately.
3. **Use secrets correctly.** `GITHUB_CLIENT_SECRET`, `SESSION_SECRET`, and any token material must use Cloudflare secrets, not source or config.
4. **Use D1 indexes deliberately.** Index dashboard and processing predicates: `action_items(priority, updated_at)`, `action_items(kind, updated_at)`, `github_changes(processing_status, updated_at)`, `github_changes(canonical_subject_key)`, `scan_runs(started_at)`, `sessions(expires_at)`.
5. **Run `PRAGMA optimize` after creating indexes.** Include it in migration/maintenance docs.
6. **Use `EXPLAIN QUERY PLAN` for core dashboard queries.** The dashboard must not become slow because D1 scans everything.
7. **Retry transient D1 writes.** Cron and Queue consumers should retry retryable D1 write failures with exponential backoff and jitter.
8. **Keep queue processing idempotent.** Queue delivery can duplicate work; `process-github-change` must upsert by stable keys.
9. **Keep request paths shallow.** Workers Best Practices reinforce the existing design: request paths render snapshots; Cron/Queues do background work.
10. **Use structured logs and traces.** Log `scanRunId`, `changeId`, `source`, `repo`, `classification`, and errors as structured JSON.
11. **No request-scoped globals.** OAuth/session/current-owner data must flow via request context and D1, not module-level mutable variables.
12. **Await or `ctx.waitUntil()` every Promise.** No floating promises in scan, queue, OAuth, or dashboard code.
13. **Use Web Crypto.** Generate OAuth state and session IDs with `crypto.randomUUID()` / `crypto.getRandomValues()`, never `Math.random()`.
14. **Do not add Durable Objects without an atom of coordination.** Sunrise currently has no room/session/actor requiring serialized coordination, so D1 + Queues remains simpler.
15. **Separate raw evidence from normalized action items.** Mirroring Artifacts guidance, keep `github_changes` / raw evidence separate from `action_items` so classification can be re-run.

## UI inventory and subtraction candidates

The UI has two modes:

```txt
public visitor → landing page → GitHub repo / deploy your own
signed-in owner → dashboard → actionable GitHub overview + news feed
```

The owner UI should show only things that help the owner decide what to do next. Every visible element should either answer “what needs action?”, “why?”, “what should I do?”, or “how fresh is this?”

### Public homepage: `/`

When signed out, `/` is a landing page, not the inbox.

Visible by default:

| UI element | Purpose | Keep? | Simplification note |
|---|---|---:|---|
| Product promise | Explain “GitHub action dashboard you host yourself.” | yes | One sentence. |
| “Deploy your own” GitHub CTA | Send visitors to source/deploy instructions. | yes | Primary CTA. |
| “Sign in with GitHub” | Owner login for this instance. | yes | Secondary if not configured; primary for owner. |
| Privacy/self-hosted note | Reassure: data stays in your Cloudflare account. | yes | Keep short. |
| Screenshot/mock dashboard | Shows value quickly. | maybe | Static image only; no marketing site sprawl. |
| Setup/config warning | If OAuth/D1/Queue/Cron missing. | yes | Tasche-style checklist. |

Do not build:

- pricing;
- docs CMS;
- hosted signup;
- email capture;
- team/workspace marketing;
- generic SaaS onboarding.

### Owner dashboard: `/dashboard`

After sign-in, the dashboard should be the primary app view.

It should feel like a practical overview of the owner's GitHub experience, roughly covering the intent of:

```txt
https://github.com/issues/created
https://github.com/issues/mentioned
https://github.com/issues/assigned
https://github.com/pulls
```

Visible by default:

| UI element | Purpose | Keep? | Simplification note |
|---|---|---:|---|
| Page title / product name | Orientation. | yes | Use working name only; naming should not block build. |
| Last successful scan time | Prevent stale data from masquerading as truth. | yes | Required because cron/queue based. |
| Scan status badge | Shows `fresh`, `running`, `failed`, or `stale`. | yes | One badge, not a full dashboard. |
| Rate-limit remaining/reset | Explains missing/stale results when GitHub limits bite. | yes | Small text; no charts. |
| Manual refresh button | Lets owner force the cron path now. | yes | Calls same discovery path as cron. |
| P0 section | Direct blockers and broken authored work. | yes | Always expanded. |
| P1 section | Direct mentions/conversations. | yes | Expanded if non-empty. |
| P2 section | Maintenance / loop-closure debt. | yes | Collapsed or compact if noisy. |
| News/feed section | Small recent activity feed for the owner. | yes | Keep small: 5–10 items, no infinite scroll. |
| P3 section | FYI/noise. | yes | Collapsed by default, but included so the owner does not need GitHub Notifications. |
| Item title | What is this? | yes | Link to GitHub canonical URL. |
| Repository | Context. | yes | `owner/repo`, small text. |
| Priority/kind badge | Why surfaced. | yes | Keep a small fixed vocabulary. |
| Reason sentence | Explains classification. | yes | More useful than raw GitHub state. |
| Suggested action | The point of the app. | yes | One sentence: “Fix failing checks,” “Review PR,” etc. |
| Evidence summary | Minimal proof: checks, review state, conflict, assigned, etc. | yes | 1–3 chips max. |
| Updated age | Recency/staleness. | yes | Relative time is enough. |
| Ignore action | Remove false positives. | yes | Keep only `ignore`; no snooze in v1. |

Dashboard should not show:

- charts;
- analytics;
- historical trends;
- avatars except maybe tiny GitHub-provided avatar if free;
- team/workspace switchers;
- repository explorer;
- full notification feed;
- full issue/PR body;
- comments timeline;
- GitHub clone UI.

### Runs page: `/runs`

Because the product is cron/queue based, a minimal runs page is useful. But it should be operational, not analytical.

Visible:

| UI element | Purpose | Keep? | Simplification note |
|---|---|---:|---|
| Last 10 scan runs | See whether daily cron works. | yes | Table only. |
| Run trigger | `cron` or `manual`. | yes | Helps debug. |
| Run status | `running/succeeded/failed`. | yes | Required. |
| Candidate count | Discovery volume. | yes | One number. |
| Processed/action item count | Queue result. | yes | One number. |
| Error summary | Why stale/failing. | yes | First error only. |
| Rate-limit snapshot | API health. | yes | Small text. |
| Queue backlog/DLQ count | Processing health. | yes | Show a count/status only; no queue dashboard. |

### Debug / JSON routes

These should exist for reality verification but not be prominent UI:

```txt
GET /?json
GET /__debug/fixtures
POST /__debug/run-daily-scan
POST /__debug/reprocess/:changeId
```

Guard debug routes behind Cloudflare Access and/or a dev flag.

## Actionable GitHub surfaces

The dashboard should start from GitHub's own personal work views and add prioritization.

### Baseline personal views to mirror

| GitHub surface | Product interpretation | Priority |
|---|---|---:|
| `/issues/created` | Issues I opened that now need closure, response, or archiving. | P1/P2 |
| `/issues/mentioned` | Threads where someone mentioned me. | P1 |
| `/issues/assigned` | Issues/PRs assigned to me. | P0/P1 |
| `/pulls` | PRs involving me: authored, review-requested, assigned, or recently updated. | P0/P1/P2 |

### Other actionable GitHub items

These are all in product scope. The product goal is that the owner should not need to look at GitHub Notifications again.

| Surface | Why actionable | Default priority | Scope |
|---|---|---:|---:|
| Review requests on PRs | Someone is waiting for my review. | P0/P1 | core |
| Assigned issues | Explicitly assigned to me. | P0/P1 | core |
| Assigned PRs | Explicitly assigned to me, often ownership signal. | P0/P1 | core |
| Mentions | Someone pulled me into a thread. | P1 | core |
| Authored PRs with failing checks | My work is blocked/broken. | P0 | core |
| Authored PRs with merge conflicts | My work cannot merge. | P0 | core |
| Authored PRs with requested changes | I owe a response/fix. | P0 | core |
| Authored PRs with pending review | My work is waiting; may need nudge/close. | P2 | core |
| Authored PRs green but unmerged | Loop closure debt. | P1/P2 | core |
| Created issues with recent comments | I opened the loop; may need response/closure. | P1/P2 | core |
| Participating threads with new activity | I am already involved. | P1/P2 | core |
| Repository invitations | Requires accept/decline. | P0 | core |
| Organization invitations/memberships | Requires accept/confirm. | P0 | core |
| Dependabot alerts | Security/update action may be needed. | P0/P1 | core |
| Code scanning alerts | Security/correctness action may be needed. | P0/P1 | core |
| Secret scanning alerts | Urgent security action. | P0 | core |
| Failed workflow runs on owned/active repos | Build/deploy broken. | P0/P1 | core |
| Discussions mentioning me | Social/support follow-up. | P1/P2 | core |
| Releases waiting on draft/publish | Ship loop may be open. | P2 | core |
| Stale branches / open draft PRs | Cleanup/closure debt. | P2/P3 | core |
| Repos missing agent instructions | Agentic readiness gap. | P2 | core |
| Repos missing verify command | Verification gap. | P2 | core |
| Recent high-velocity repos | WIP/context-switch warning. | P2 | core |
| Sponsorship/funding notifications | Possibly actionable. | P3 | core/collapsed |
| Stars/follows/forks | Usually weakly actionable, but useful ambient news. | P3 | collapsed |

### Small news/feed section

The dashboard can include a compact “news for me” feed, but it should not become a full notifications clone.

Include at most 5–10 items such as:

```txt
new mention
new review request
new comment on authored issue/PR
check failed on authored PR
assigned item changed
created issue received response
```

Subtraction rule:

> If a feed item has no plausible next action, hide it or collapse it.

## Page subtraction decision

No deferred surfaces in the product spec. Sunrise has these product pages only:

```txt
Sunrise page map

PUBLIC / SIGNED OUT
┌─────────────────────────────────────────────────────────────┐
│ GET /                                                       │
│ Landing page: promise, deploy-your-own CTA, GitHub sign-in, │
│ self-hosted/privacy note, setup checklist if misconfigured. │
└─────────────────────────────────────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────────────────────────┐
│ GET /login                                                  │
│ Redirect route: create OAuth state in D1, redirect GitHub.   │
└─────────────────────────────────────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────────────────────────┐
│ GET /callback                                               │
│ OAuth callback: validate state, validate owner, create D1    │
│ session, set opaque HttpOnly cookie, redirect /dashboard.    │
└─────────────────────────────────────────────────────────────┘
             │
             ▼
SIGNED-IN OWNER
┌─────────────────────────────────────────────────────────────┐
│ GET /dashboard                                              │
│ Main product: overview counts, P0/P1/P2/P3 action sections, │
│ compact news feed, freshness, rate limit, refresh, ignore.   │
└─────────────────────────────────────────────────────────────┘
             │
             ├──────────────┐
             ▼              ▼
┌──────────────────────┐  ┌──────────────────────────────────┐
│ POST /refresh        │  │ GET /runs                        │
│ Same path as cron:   │  │ Operational view: last scan runs,│
│ discover + enqueue.  │  │ counts, queue status, last error.│
└──────────────────────┘  └──────────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────────────────────────┐
│ POST /logout                                                │
│ Delete D1 session, clear cookie, redirect /.                 │
└─────────────────────────────────────────────────────────────┘
```

No v1 pages:

```txt
/items/:id
/repos
/repos/:owner/:repo
/settings
```

Simplification should come from presentation, batching, collapsing, and progressive processing, not from ignoring important GitHub signal categories.

Cuts/simplifications that remain:

1. **No dedicated item details page** — use inline expansion on `/dashboard` if needed.
2. **No dedicated repo pages** — repo signals appear as action items or overview counts.
3. **No settings page** — show setup/config status on `/` and `/dashboard`.
4. **No snooze in v1** — use ignore only.
5. **No charts/trends** — not an analytics product.
6. **No full comments/PR body rendering** — link to GitHub instead.
7. **No granular queue dashboard** — `/runs` shows freshness, counts, status, last error.
8. **Keep P3 data collapsed** — ingest it, but do not let it dominate the dashboard.
9. **Progressive enrichment** — discover everything daily, then enrich expensive/permission-heavy signals incrementally.
10. **No KV binding** — D1 stores OAuth state, sessions, scan state, and product data.

## Simplest useful v1 UI

The absolute simplest useful UI is:

```txt
/
  signed-out landing page:
    product promise
    deploy your own on GitHub CTA
    sign in with GitHub
    self-hosted/privacy note
    setup checklist if misconfigured

/dashboard
  header:
    Sunrise
    signed in as <github_login>
    last scan: <time>
    status: fresh|stale|failed
    refresh button

  overview counts:
    assigned
    mentioned
    created issues needing response
    authored/open PRs
    review requests

  P0 Waiting on me / broken authored work
    item rows with title, repo, reason, action, evidence chips, GitHub link, ignore

  P1 Direct conversations
    same row shape

  P2 Loop-closure debt
    same row shape, collapsed if > N

  News for me
    5–10 recent actionable updates
```

That is enough to validate the product.

## Action categories

### P0 — Directly blocking me or waiting on me

Show first.

- PRs where my review is requested
- issues/PRs assigned to me
- PRs I authored with failing checks
- PRs I authored with merge conflicts
- PRs I authored with requested changes
- PRs I authored with successful checks but no verification evidence / no human-review summary on active repos
- PRs I authored from agent branches with no clear explanation of what changed and how it was verified
- stale green PRs in active repos that should be merged or closed
- repository invitations / org invitations
- security alerts assigned to or visible to me, if API access allows

### P1 — Direct mention / direct conversation

Show next.

- unread notifications where reason is `mention`
- unread notifications where reason is `team_mention`
- unread notifications where reason is `review_requested`
- unread notifications where reason is `assign`
- threads I am participating in with new activity

### P2 — My open work needs maintenance

Show as maintenance backlog.

- open PRs authored by me
- open issues authored by me with recent activity
- stale PRs authored by me
- PRs authored by me pending review for a long time
- PRs authored by me with pending checks
- active repos with recent high commit velocity but no recent release, deploy, or merged PR
- active repos missing repo-local agent instructions such as `AGENTS.md`, `CLAUDE.md`, `.cursorrules`, `.windsurfrules`, `.pi/skills/*`, or equivalent
- active repos missing an obvious verification command in README/package scripts/CI
- repos with repeated recent `fix`, `stabilize`, `guard`, `schema drift`, or `harden` commits suggesting reality was discovered late

### P3 — FYI / subscribed noise

Show collapsed by default.

- subscribed threads
- repository-wide notifications
- state changes without direct involvement
- comments on threads I am only watching

## Required API inputs

### Auth

Use GitHub OAuth for owner sign-in and API access.

```txt
GITHUB_CLIENT_ID      → OAuth app/client configured for this deployment
GITHUB_CLIENT_SECRET  → server-side secret
OWNER_LOGIN           → expected GitHub login
SESSION_SECRET        → signs/verifies local session cookie
```

Because the distribution model is self-hosted and single-user only, OAuth credentials and session state live in the deployer's Cloudflare account, not in a shared service. No app-local multi-user auth model is required.

OAuth state and sessions should be stored in D1 for v1. KV is unnecessary unless later measurements show D1 is the wrong storage surface.

Likely OAuth scopes / token permissions:

- notifications read access
- repo read access for private repos if needed
- pull request read access
- issues read access
- checks/status read access
- security events / Dependabot / code scanning permissions where available
- discussions / repository metadata permissions where available

## Primary API endpoints

### 1. Notifications

Endpoint:

```http
GET /notifications
```

Useful query params:

```txt
all=false
participating=false
since=<ISO timestamp>
before=<ISO timestamp>
per_page=50
page=1
```

Fields to keep:

- `id`
- `unread`
- `reason`
- `updated_at`
- `last_read_at`
- `subject.title`
- `subject.type`
- `subject.url`
- `repository.full_name`
- `repository.private`
- `url`

Action mapping:

```txt
reason=review_requested → P0/P1
reason=assign → P0/P1
reason=mention → P1
reason=team_mention → P1
reason=security_alert → P0 if actionable
reason=ci_activity → P0 if my PR/check failed, else P2/P3
reason=author → P2 if my authored thread changed
reason=comment → P1 if participating, else P3
reason=subscribed → P3
reason=state_change → P2/P3 depending on authored/assigned status
```

### 2. Assigned issues and PRs

Endpoint:

```http
GET /user/issues?filter=assigned&state=open
```

Fields:

- `title`
- `html_url`
- `repository_url`
- `pull_request` presence
- `updated_at`
- `labels`
- `assignees`

Action mapping:

```txt
assigned open issue → P0
assigned open PR → P0
```

### 3. Search: review requests

Endpoint:

```http
GET /search/issues?q=is:open+is:pr+review-requested:@me
```

If `@me` is not supported by the caller/client, resolve authenticated username first and use:

```http
GET /user
GET /search/issues?q=is:open+is:pr+review-requested:<username>
```

Action mapping:

```txt
review requested from me → P0
```

### 4. Search: authored open PRs

Endpoint:

```http
GET /search/issues?q=is:open+is:pr+author:<username>
```

Action mapping:

```txt
authored open PR with failing checks/requested changes/conflict → P0
authored open PR pending review/stale → P2
```

For each result, fetch PR details if needed:

```http
GET /repos/{owner}/{repo}/pulls/{pull_number}
```

Fields:

- `mergeable`
- `mergeable_state`
- `draft`
- `head.sha`
- `base.ref`
- `requested_reviewers`
- `requested_teams`
- `review_comments`
- `comments`

### 5. PR checks and statuses

For each authored PR, use the head SHA.

Endpoints:

```http
GET /repos/{owner}/{repo}/commits/{ref}/check-runs
GET /repos/{owner}/{repo}/commits/{ref}/status
```

Action mapping:

```txt
conclusion=failure|timed_out|cancelled|action_required → P0
status=pending for long duration → P2
all success but no review → P2
```

### 6. PR reviews

Endpoint:

```http
GET /repos/{owner}/{repo}/pulls/{pull_number}/reviews
```

Action mapping:

```txt
latest review state=CHANGES_REQUESTED on my PR → P0
latest review state=APPROVED but checks failing → P0
latest review state=COMMENTED → P1/P2 depending directness
```

### 7. Mentions and involvement search

Useful searches:

```http
GET /search/issues?q=is:open+mentions:<username>
GET /search/issues?q=is:open+involves:<username>
GET /search/issues?q=is:open+commenter:<username>
```

Action mapping:

```txt
mentions me recently → P1
involves me but not direct → P2/P3
```

### 8. Recent commit/repo activity for agentic work debt

Use this to identify unfinished loops, not to build an analytics dashboard.

Endpoints:

```http
GET /users/{username}/events/public
GET /repos/{owner}/{repo}/commits?since=<ISO timestamp>
GET /repos/{owner}/{repo}/branches
GET /repos/{owner}/{repo}/releases
GET /repos/{owner}/{repo}/actions/runs?per_page=20
```

Derived signals:

```txt
many commits across many repos in short window → context-switch/WIP warning
many fix/stabilize/harden commits after feature commits → verification likely late
recent commits but no open/merged PR → direct-to-main work; check verification evidence
recent active repo but no release/deploy marker → possible unfinished loop
agent-looking branch names, e.g. claude/*, codex/*, cursor/* → require explanation + verification summary
```

Action mapping:

```txt
active repo with high velocity + failing CI → P0/P1
active repo with high velocity + no verification surface → P1/P2
active repo with high velocity + no recent release/merge/deploy → P2
many simultaneous active repos above configured WIP limit → P2 operating-system warning
```

### 9. Repo-local agentic engineering readiness

For repos on the active/high-priority allowlist, inspect a small set of files.

Endpoints:

```http
GET /repos/{owner}/{repo}/contents/AGENTS.md
GET /repos/{owner}/{repo}/contents/CLAUDE.md
GET /repos/{owner}/{repo}/contents/package.json
GET /repos/{owner}/{repo}/contents/pyproject.toml
GET /repos/{owner}/{repo}/contents/README.md
GET /repos/{owner}/{repo}/contents/.github/workflows
GET /repos/{owner}/{repo}/contents/reality.manifest.md
GET /repos/{owner}/{repo}/contents/productized-learning.md
```

Derived signals:

```txt
missing agent instructions in active repo → P2
missing obvious verify/test command → P1/P2 depending repo importance
missing CI workflow in active repo → P2
pipeline/search/sync repo missing reality.manifest.md → P2
production-candidate repo missing release/deploy instructions → P2
```

Action mapping:

```txt
repo lacks AGENTS.md/CLAUDE.md → "Add repo-local agent instructions"
repo lacks verify command → "Add a single verification command agents can run"
repo lacks reality manifest for pipeline/search/sync project → "Capture real inputs, outputs, limits, repair path"
```

### 10. Cron + Queues: daily discovery, queued processing

The core ingestion model is:

```txt
Cloudflare Cron Trigger (daily)
  → GitHub discovery scan via API
  → persist raw candidate changes / cursors in D1
  → enqueue candidate changes for processing
  → queue consumer classifies, enriches, and upserts action_items
  → Hono/Inertia UI reads current D1 action_items snapshot
```

The request path should not be responsible for discovering the world. The UI shows the latest processed snapshot and scan freshness.

Important distinction:

```txt
Cron discovers candidate changes.
Queue processes candidate changes into action items.
UI displays action items.
```

#### Daily discovery scan

The daily scheduled job should call the GitHub APIs for changes the single owner might care about:

```txt
notifications updated since last cursor
assigned issues/PRs
review requests
open authored PRs
recently updated authored issues
recent activity for allowlisted active repos
```

The cron handler should be a planner, not the full processor. Its job is to:

1. create a `scan_run`;
2. load the last successful cursors / timestamps;
3. call the smallest set of GitHub endpoints needed for discovery;
4. store raw candidate records or compact evidence in `github_changes`;
5. enqueue one message per candidate change or bounded group;
6. record GitHub rate-limit state;
7. mark discovery complete or failed.

#### Queue messages

Start with one processing message shape, not many specialized worker types:

```ts
type QueueMessage = {
  kind: "process-github-change";
  runId: string;
  changeId: string;
};
```

The D1 `github_changes` row contains the details:

```txt
change id
canonical_subject_key
source endpoint
repo
subject type
subject URL / API URL
updated_at
raw GitHub payload or compact payload
first_seen_at
last_seen_at
processing_status
attempt_count
last_error
```

This keeps queue messages small and makes D1 the source of truth.

#### Consumer job

The queue consumer turns raw changes into action items:

```txt
process-github-change
  → load github_changes row
  → fetch extra PR/check/review details only if needed
  → classify priority P0/P1/P2/P3
  → upsert action_items
  → write item_evidence
  → mark change processed/ignored/failed
```

This means discovery and classification can evolve independently. If the priority model changes, old `github_changes` can be reprocessed.

#### Minimal D1 tables

Use:

```txt
settings
oauth_states
sessions
scan_runs
github_changes
action_items
item_evidence
rate_limit_snapshots
ignored_items
```

Initial indexes, based on D1 best-practice guidance to index frequent predicates:

```sql
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at
  ON sessions(expires_at);

CREATE UNIQUE INDEX IF NOT EXISTS idx_oauth_states_state
  ON oauth_states(state);

CREATE INDEX IF NOT EXISTS idx_scan_runs_started_at
  ON scan_runs(started_at DESC);

CREATE INDEX IF NOT EXISTS idx_github_changes_status_updated
  ON github_changes(processing_status, updated_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_github_changes_canonical_subject
  ON github_changes(canonical_subject_key, source_endpoint, updated_at);

CREATE INDEX IF NOT EXISTS idx_action_items_priority_updated
  ON action_items(priority, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_action_items_kind_updated
  ON action_items(kind, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_item_evidence_action_item
  ON item_evidence(action_item_id);

CREATE INDEX IF NOT EXISTS idx_ignored_items_subject
  ON ignored_items(canonical_subject_key);
```

After creating indexes, run:

```sql
PRAGMA optimize;
```

Use `EXPLAIN QUERY PLAN` for the main `/dashboard` query before treating the schema as accepted.

Do not add:

```txt
tenant_id
workspace_id
app-local user_id
```

The Cloudflare deployment is the isolation boundary.

#### Manual refresh

Manual refresh should use the same path as cron:

```txt
POST /refresh
  → create scan_run(trigger="manual")
  → run discovery or enqueue discovery
  → enqueue process-github-change messages
```

No separate manual-only logic.

#### What not to do

Do not create a complex queue graph up front:

```ts
// Not v1
type QueueMessage =
  | { kind: "scan-authored-pr"; ... }
  | { kind: "scan-repo-readiness"; ... }
  | { kind: "scan-checks"; ... }
  | { kind: "scan-commit-velocity"; ... };
```

Split into specialized message types only after measured pain:

- one source dominates runtime;
- one kind needs different retry/delay behavior;
- one kind hits GitHub rate limits differently;
- operator clarity demands separate job status.

Queue design rule:

> Cron discovers changes. Queues process changes. D1 stores truth. Split message types only when reality proves the single change-processing path is too blunt.

## Optional API endpoints

### Repository invitations

```http
GET /user/repository_invitations
```

Action mapping:

```txt
pending repo invitation → P0
```

### Organization memberships / invitations

Depending on token permissions and API availability:

```http
GET /user/memberships/orgs
```

Action mapping:

```txt
pending org membership/invitation → P0
```

### Dependabot / code scanning / secret scanning alerts

Repository-scoped and permission-dependent. Only include if token has access.

Examples:

```http
GET /repos/{owner}/{repo}/dependabot/alerts
GET /repos/{owner}/{repo}/code-scanning/alerts
GET /repos/{owner}/{repo}/secret-scanning/alerts
```

Action mapping:

```txt
open high/critical alert in repo I own/maintain → P0/P1
```

## Output model

Normalize every item into one shape:

```ts
type GitHubActionItem = {
  id: string;
  priority: "P0" | "P1" | "P2" | "P3";
  kind:
    | "review_requested"
    | "assigned"
    | "mention"
    | "authored_pr_failing"
    | "authored_pr_changes_requested"
    | "authored_pr_conflict"
    | "authored_pr_pending"
    | "authored_pr_unverified"
    | "stale_green_pr"
    | "repo_missing_agent_instructions"
    | "repo_missing_verify_command"
    | "repo_missing_reality_manifest"
    | "high_wip_warning"
    | "commit_velocity_warning"
    | "invitation"
    | "security_alert"
    | "notification"
    | "maintenance";
  title: string;
  repo: string;
  url: string;
  updatedAt: string;
  reason: string;
  suggestedAction: string;
  evidence?: {
    checks?: "success" | "failure" | "pending" | "missing";
    mergeable?: "mergeable" | "conflicting" | "unknown";
    hasVerificationSummary?: boolean;
    hasAgentInstructions?: boolean;
    hasVerifyCommand?: boolean;
    hasRealityManifest?: boolean;
    recentCommitCount?: number;
    recentFixCommitCount?: number;
    activeRepoCount?: number;
  };
  source:
    | "notifications"
    | "search"
    | "pulls"
    | "checks"
    | "reviews"
    | "issues"
    | "security"
    | "commits"
    | "contents"
    | "actions";
};
```

## Ranking rules

Sort by:

1. priority P0 → P3
2. directness:
   - assigned/review requested
   - authored PR broken
   - authored PR mergeable but unverified
   - direct mention
   - participating
   - subscribed
3. loop-closure risk:
   - failing/conflicting PRs
   - stale green PRs
   - high-velocity active repo with no clear release/deploy/merge closure
   - repeated fix/stabilize commits indicating verification debt
4. recency
5. repository importance allowlist, if configured
6. age/staleness for authored PRs
7. WIP-limit pressure across active repos

## Suggested action text

Examples:

```txt
review_requested → "Review this PR"
assigned issue → "Respond or unassign yourself"
authored_pr_failing → "Fix failing checks"
authored_pr_changes_requested → "Address requested changes"
authored_pr_conflict → "Rebase or resolve conflicts"
mention → "Reply to mention"
pending_review → "Nudge reviewers or update PR"
authored_pr_unverified → "Add verification summary or run the declared verify command"
stale_green_pr → "Merge or close this green PR"
repo_missing_agent_instructions → "Add AGENTS.md/CLAUDE.md with verification commands and project constraints"
repo_missing_verify_command → "Add one obvious verify command for agents and humans"
repo_missing_reality_manifest → "Capture real inputs, outputs, limits, failure modes, and repair path"
high_wip_warning → "Choose active repos and archive/defer the rest"
commit_velocity_warning → "Stop and characterize before more feature work"
security_alert → "Triage security alert"
invitation → "Accept or decline invitation"
```

## Minimal first slice

Aggressively small v1, but with the correct ingestion shape:

```txt
Public homepage at /
Owner signs in with GitHub OAuth
Cron runs once per day
Cron calls GitHub discovery APIs
Cron stores github_changes rows in D1
Cron enqueues process-github-change messages
Queue consumer creates action_items
Hono/Inertia dashboard reads D1 snapshot
No users table
No multi-account switching
All signal categories are in scope
Expensive/permission-heavy signals can be discovered first and deeply enriched later
No multi-page dashboard beyond homepage/dashboard/runs if needed
```

Daily discovery starts with all personal-action sources, but processes them in priority order:

1. `GET /notifications?all=false`
2. `GET /user/issues?filter=assigned&state=open`
3. `GET /search/issues?q=is:open+is:pr+review-requested:<username>`
4. `GET /search/issues?q=is:open+is:pr+author:<username>`
5. `GET /search/issues?q=is:open+author:<username>` for created issues
6. mentions / involves searches
7. repository and organization invitations
8. authored PR details, reviews, mergeability, and check rollups
9. failed workflow runs for owned/active repos
10. Dependabot/code/secret scanning alerts where permissions allow
11. discussions mentions where permissions/API shape allow
12. releases, draft PRs, stale branches, repo-readiness, and WIP signals
13. low-priority ambient notifications such as stars/forks/follows/sponsorship events

Processing may be shallow on the first pass. The important rule is: discover all potentially relevant GitHub changes daily so the owner does not need GitHub Notifications as a backstop.

Render from D1 snapshot:

```txt
P0: Waiting on me / broken authored work
P1: Direct conversations / active verification gaps
P2: My open work / loop-closure debt
P3: FYI
```

Do not over-design separate UI pages for repo/security/checks/commit-readiness integration. Capture those signals, but collapse them until the classifier proves they deserve attention.

Thin UI slice with Hono + Inertia:

```txt
GET /           → public landing page or redirect to /dashboard if signed in
GET /login      → GitHub OAuth redirect
GET /callback   → validate owner, create D1 session
POST /logout    → delete D1 session
GET /dashboard  → reads action_items from D1 and renders Dashboard/Index
POST /refresh   → triggers the same discovery+enqueue path as cron
GET /dashboard?json → same dashboard props JSON for debugging/agent inspection
GET /runs       → scan freshness, queue counts, last error
```

Use one queue message shape:

```ts
type QueueMessage = {
  kind: "process-github-change";
  runId: string;
  changeId: string;
};
```

Add granular queue jobs only after this single change-processing path proves too blunt.

## Second slice: agentic loop closure

For an allowlist of active repos, add:

1. recent commit count and recent fix/harden/stabilize count
2. stale green PR detection
3. repo-local instruction detection
4. verify-command detection
5. optional `reality.manifest.md` detection for pipeline/search/sync repos

Render a separate compact section:

```txt
Loop closure:
- PRs to merge/close
- PRs to verify/explain
- Active repos missing agent instructions
- Active repos missing verify commands
- WIP limit warning
```

Implementation shift in this slice:

```txt
Manual refresh / cron → planner → queue messages → D1 snapshots → Hono/Inertia UI
```

The UI should show scan freshness and queue health so stale data does not masquerade as truth.

## Acceptance criteria

- Single-user only; no multi-tenant account model now or later.
- No app-local users table in v1.
- GitHub OAuth owner sign-in exists in v1.
- OAuth state and sessions are stored in D1, not KV.
- Cloudflare Access is optional extra protection, not required product auth.
- Includes a documented Deploy to Cloudflare path for other users to run their own copy.
- Stores GitHub tokens/credentials only in the deployer's own Cloudflare environment.
- Shows no more than 20 default items.
- Every item has a suggested action.
- Collapses P3 by default.
- Deduplicates notifications and search results pointing to the same issue/PR.
- Does not require broad write scopes.
- Can run read-only.
- Makes API rate-limit usage visible.
- Identifies authored PRs that are broken, conflicted, stale-green, or missing verification evidence.
- Identifies active repos missing agent instructions or a clear verify command.
- Surfaces WIP pressure when recent activity spans more active repos than the configured limit.
- Separates human/social action items from engineering loop-closure items.
- Hono/Inertia route can render the default inbox without a separate internal API endpoint.
- JSON/debug output is available for the same action-item props used by the UI.
- Background enrichment writes durable scan/job/change state before the UI depends on it.
- `wrangler types` is part of verification and generated binding types are used instead of hand-written `Env` drift.
- Core D1 dashboard queries have indexes and have been checked with `EXPLAIN QUERY PLAN`.
- D1 write retries use exponential backoff/jitter for retryable transient errors.

## Open issues in the spec

These are the decisions that still need reality, not taste.

### 1. Discovery scope

Open issue: which GitHub endpoints produce the best signal with the least noise?

All signal categories are in product scope, but the open issue is endpoint shape, permission coverage, and noise control.

Source groups:

```txt
notifications
assigned issues/PRs
review-requested PRs
authored open PRs
created issues
mentions/involves searches
participating threads
repository/org invitations
security alerts
failed workflow runs
repo-local readiness
recent commit velocity / WIP
ambient news: stars/forks/follows/sponsorship
```

Reality check: run each endpoint/source group against the real account, count candidates, and manually label whether each candidate is useful, noisy-but-worth-collapsing, or useless.

### 2. Candidate identity and deduplication

Open issue: what is the stable key for a `github_changes` row?

Candidate key:

```txt
source + repository + subject_type + subject_api_url + updated_at
```

But notifications, search results, and PR APIs may point to the same underlying PR/issue with different URLs.

Reality check: capture raw payloads from all v1 endpoints and build a dedupe table showing which fields overlap.

### 3. Priority classification

Open issue: how reliably can raw GitHub state map to P0/P1/P2/P3?

Known tricky cases:

- authored PR has green checks but is intentionally parked;
- authored PR is old and should be archived/noise;
- review request is stale or already handled;
- notification reason is noisy;
- checks are pending because a workflow is optional or flaky;
- mergeable state may be delayed/unknown from GitHub API.

Reality check: manually label 50 real candidates as “actionable / not actionable” and compare the classifier.

### 4. Verification evidence

Open issue: what counts as “verified”?

Possible signals:

- successful GitHub checks;
- PR body contains a verification section;
- recent comment includes test/deploy evidence;
- deploy URL present;
- release or merge marker exists;
- screenshot/manual review note exists.

Reality check: sample real authored PRs and label which ones you would personally trust as verified.

### 5. GitHub token model and permissions

Open issue: classic/fine-grained PAT vs single-user GitHub App installation token.

Reality check: create the least-privilege token that can read the v1 endpoints. Record exact required permissions and failures.

### 6. Cron cadence and cursors

Open issue: daily is the intended default, but what cursors prevent missed or duplicated changes?

Candidate cursors:

```txt
last_successful_scan_started_at
last_successful_notification_updated_at
per-source ETag / Last-Modified if useful
per-source last_seen_updated_at
```

Reality check: run two scans against saved fixtures and live API; confirm duplicates are deduped and no updated item is missed.

### 7. Queue granularity

Open issue: one `process-github-change` message per candidate change vs bounded groups.

Reality check: measure candidate count and processing duration for one daily scan. If candidate count is small, one-per-change is fine. If there are hundreds, consider grouping by repo/source.

### 8. UI stack finality

Open issue: Hono + Inertia is the current best candidate, but the first proof should validate that it stays simpler than API + SPA.

Reality check: build one route/page (`/`) and one JSON/debug path from the same props.

### 9. Name

Resolved: the project name is **Sunrise**.

Reality check: use `sunrise` as the repo/code name unless the slug is unavailable or too collision-prone.

## Ground truth and reality verification plan

Build ground truth before broad implementation.

### Fixture capture

Create a local fixture command:

```bash
npm run capture:github-fixtures
```

It should call v1 endpoints and save redacted JSON:

```txt
fixtures/github/YYYY-MM-DD/notifications.json
fixtures/github/YYYY-MM-DD/assigned.json
fixtures/github/YYYY-MM-DD/review-requests.json
fixtures/github/YYYY-MM-DD/authored-prs.json
fixtures/github/YYYY-MM-DD/check-runs/*.json
fixtures/github/YYYY-MM-DD/rate-limit.json
```

Redact tokens and private sensitive fields before committing fixtures.

### Manual labeling set

Create:

```txt
fixtures/github/YYYY-MM-DD/labels.json
```

Each candidate gets:

```json
{
  "candidateId": "...",
  "isActionable": true,
  "expectedPriority": "P0",
  "expectedKind": "authored_pr_failing",
  "reason": "Authored PR has failing required check",
  "suggestedAction": "Fix failing checks"
}
```

This is the ground truth for classifier tests.

### Classifier characterization tests

Add tests that run:

```txt
raw fixtures → github_changes → action_items
```

Assertions:

- expected P0 items appear;
- obvious noise is absent or P3;
- duplicate PRs from notifications/search collapse into one item;
- suggested action matches label;
- missing/unknown mergeable state is represented honestly.

### End-to-end local dry run

A local dry run should exercise the real shape without Cloudflare first:

```bash
npm run scan:github -- --fixtures fixtures/github/YYYY-MM-DD
npm run process:changes -- --fixtures fixtures/github/YYYY-MM-DD
npm run render:inbox -- --json
```

Then Cloudflare local:

```bash
wrangler dev
curl /__debug/run-daily-scan
curl /?json
```

### Live verification checks

For a live scan, compare the app against GitHub itself:

- GitHub notifications page;
- PRs authored by the user;
- review-requested search;
- assigned issues/PRs;
- checks shown on GitHub PR pages.

Record mismatches in a `scan_run` note:

```txt
false positives
false negatives
duplicates
wrong priority
wrong suggested action
missing evidence
GitHub API limitation
```

### Queue verification

Use a tiny queue fixture:

```txt
3 github_changes rows
3 process-github-change messages
1 duplicate delivery
1 simulated GitHub API failure
1 ignored item
```

Acceptance:

- duplicate delivery is idempotent;
- failed processing records error and can retry;
- ignored item stays ignored on reprocessing;
- action item upsert is stable;
- scan freshness is visible in UI.

### Deployment reality check

Before adding features, prove the deploy path:

1. create D1;
2. create Queue;
3. set `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `OWNER_LOGIN`, and `SESSION_SECRET` secrets;
4. configure Cron Trigger;
5. sign in with GitHub as the configured owner;
6. run manual scan;
7. confirm next daily cron updates `scan_runs`.

## Open questions

- Which repos/orgs should be considered high priority?
- What is the active repo WIP limit? Default candidate: 3.
- Should archived repos be ignored?
- Should bots be collapsed or hidden?
- Should old authored PRs be treated as action items or archive?
- What counts as verification evidence: check success, PR body checklist, comment, release, deploy URL, screenshot, or all of these?
- How should the API distinguish healthy rapid iteration from repeated fix-forward churn?
- Should repo-local readiness checks be allowlist-only to avoid noisy scans?
- Should notifications be marked read by the tool, or remain read-only?
- Which security-alert APIs are accessible with the chosen owner OAuth/GitHub App permissions?
- Should the UI use Hono + Inertia as the default implementation stack, or remain API-first with a separate frontend?
- Which discovery sources can run inside the daily cron handler, and which should immediately create bounded queue messages because of rate limits or latency?
- Which minimal GitHub OAuth/GitHub App permissions cover all signal categories?
- Should v1 use OAuth user tokens, a single-user GitHub App installation token, or both?
- Should Cloudflare Access be documented as an optional additional protection layer for private instances?
- Should the repo slug be `sunrise`, `sunrise-github`, `sunrise-inbox`, or `sunrise-dashboard`?
