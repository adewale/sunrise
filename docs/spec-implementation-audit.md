# Sunrise spec implementation audit

Date: 2026-05-01

This audit compares `specs/sunrise-github-dashboard-spec.md` with the current implementation after the Hono/Inertia migration.

## Aligned with spec

- Self-hosted, single-user Cloudflare Worker distribution model.
- Public landing page for visitors and deploy-your-own path.
- GitHub OAuth owner sign-in with D1-backed OAuth state and sessions.
- `OWNER_LOGIN` owner allow-listing; no app-local users table.
- D1 is the primary persistence layer for settings, sessions, OAuth state, scan runs, raw GitHub changes, action items, evidence, rate-limit snapshots, and ignored items.
- Cloudflare Queues and Cron are used for background discovery/processing.
- Hono routes are the app surface.
- `@hono/inertia` is now wired into page rendering for landing, setup, design, dashboard, settings, and runs pages.
- Routes still provide JSON/props views for debugging/agent inspection (`?json` or `Accept: application/json` where applicable).
- D1 indexes exist for the main dashboard/action-item, scan-run, session-expiry, ignored-item, and GitHub-change predicates.
- `wrangler types` is part of verification.
- Web Crypto is used for OAuth state/session identifiers.
- No Durable Objects or KV in v1.
- Setup diagnostics are visible and check D1, Queue, owner login, OAuth secrets, callback URL, and last OAuth failure.
- Deploy to Cloudflare path is documented and exercised.
- GitHub discovery deduplicates notifications and search results by canonical subject.
- Manual refresh uses the same discovery path as scheduled scans.
- Fixture mode is development-only and warns/fails in setup when enabled.
- Rate-limit count is visible in the dashboard header when a snapshot exists.

## Intentional product decisions that supersede older spec text

These are not treated as bugs; the spec should be read with these product decisions in mind.

- The primary owner view is an **Inbox**, not a generic dashboard.
- The inbox is reverse-chronological rather than grouped visually by P0/P1/P2/P3.
- Priority still exists in the classifier/data model as evidence, but it is not the main visual organizing principle.
- The right column is Tuftean marginalia for counts, not a second dashboard surface.
- The separate right-side freshness panel was removed; freshness is compact header metadata.
- `/settings` exists despite an earlier v1 subtraction note, because page-size control became useful and low-risk.
- Visible ignore buttons were removed from the inbox to keep row scanning calm; the backend ignore route/table still exist.
- Counts are derived from all loaded action items, not only the current visible page.
- Pull-request counts distinguish PRs, issues, my PRs in my repos, my PRs elsewhere, and PRs to my repos.
- Header includes the Sunrise favicon mark as a logo and a standard gear icon for settings.

## Remaining gaps between spec and implementation

### UI / Inertia

- Inertia is now used server-side through `c.render(...)` and the Inertia protocol, but there is no React/Vue/Svelte client app yet.
- There is no client-side Inertia navigation/hydration bundle; initial HTML is server-rendered by the existing render functions and an Inertia page object is embedded for protocol compatibility.
- Type-safe generated Inertia page names via the `@hono/inertia/vite` plugin are not configured.
- The large inline string renderer in `src/app.ts` remains and should eventually be split into page/component modules.

### Runs / operations

- `/runs` exists but is minimal.
- Missing from `/runs`: queue backlog count, DLQ status/count, rate-limit snapshot, explicit freshness summary, and nicer timestamp formatting.
- `scan_runs.processed_count` is not reliably updated by the queue consumer.

### Queue robustness

- Queue consumer still schedules per-message work with `ctx.waitUntil(...)`; the spec prefers no questionable floating promises and a clearer awaited consumer flow.
- No explicit `sendBatch()` usage.
- No configured `max_batch_size` / `max_batch_timeout`.
- No DLQ configuration.
- Retry/backoff coverage exists for many D1 writes but is not comprehensive for every write path.

### GitHub discovery/enrichment

Implemented: notifications, review-requested search, assigned search, authored PRs, authored issues, PRs in owned repos, involved search.

Still missing or incomplete from the larger spec:

- PR check-run/status enrichment.
- PR review-state enrichment.
- Merge-conflict detection.
- Authored PRs with failing checks/requested changes/conflicts as reliable P0s.
- Failed workflow runs on owned/active repos.
- Repository invitations.
- Organization invitations/memberships.
- Dependabot alerts.
- Code scanning alerts.
- Secret scanning alerts.
- Discussions mentions.
- Recent repo activity / high-velocity unfinished-loop detection.
- Repo-local agentic-readiness checks such as `reality.manifest.md`, verification command detection, release/deploy instruction detection.
- Manual labeling of 50 real candidates and classifier comparison.

### Priority/ranking

- The classifier still calculates P0/P1/P2/P3, but the UI no longer presents priority sections.
- `renderDesignLanguage()` still includes a P0 sample badge/priority styling, so design docs retain older dashboard language.
- Priority should be reframed in the spec as internal severity metadata unless visual grouping returns.

### Debug/security policy

- `/dashboard?json` and `/setup?json` are intentionally useful, but the spec says debug routes should be guarded by Cloudflare Access and/or a dev flag.
- Explicit policy for which JSON views are owner-only, public, or dev-only should be documented.
- Debug mutation routes are gated by `TEST_GITHUB_FIXTURES=true`, which is safe for production when the secret is absent.

### Cloudflare/D1 best-practice evidence

- Core indexes exist, but `EXPLAIN QUERY PLAN` evidence for the dashboard query is not captured in docs.
- Compatibility-date freshness should be periodically reviewed.
- Queue retry/DLQ/batch configuration remains incomplete.

### Auth/token model

- OAuth scopes currently include broad `repo` access.
- The spec asks for a least-privilege permissions reality check; exact minimal scopes/permissions and endpoint failure modes are not documented.
- The spec keeps open whether v1 should use OAuth user tokens, a single-user GitHub App installation token, or both; current app uses OAuth user tokens only.

### Deployment/onboarding

- Deploy to Cloudflare works, but Queue names are account-level and may collide for repeated test deployments unless the fork config uses unique names.
- Docs mention this, but the source template still necessarily contains default names.

### Landing/product communication

- Landing page is intentionally compact.
- It does not yet show a live/static product screenshot despite the spec marking a screenshot/mock dashboard as useful.
- README has screenshots, but the live landing page does not use them.

### Reality verification fixtures

- There are tests and fixture mode, but the spec's full fixture-capture plan is incomplete:
  - redacted saved payloads for all v1 endpoints;
  - check-run payloads;
  - review payloads;
  - workflow-run payloads;
  - manually labeled candidate set;
  - local dry-run CLI like `npm run render:inbox -- --json`.

## Recommended next order

1. Split Inertia rendering into page modules while preserving current visual output.
2. Add client-side Inertia only if SPA navigation is still desirable after the server-side migration.
3. Improve `/runs` and queue robustness: awaited consumer, processed counts, queue config, DLQ, and operational status.
4. Capture `EXPLAIN QUERY PLAN` evidence for dashboard queries.
5. Add PR checks/reviews/workflow enrichment before expanding to security/org/repo-readiness sources.
6. Document OAuth least-privilege reality checks.
