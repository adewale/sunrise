# Sunrise spec implementation audit

Date: 2026-05-01

This audit compares `specs/sunrise-github-dashboard-spec.md` with the current implementation after the Inertia, operations, queue, discovery, OAuth-scope, fixture, and landing-page follow-up work.

## Aligned with spec

- Self-hosted, single-user Cloudflare Worker distribution model.
- Public landing page for visitors and deploy-your-own path.
- Landing page now shows a product screenshot from the repository assets.
- GitHub OAuth owner sign-in with D1-backed OAuth state and sessions.
- Default OAuth scope is now least-privilege for public data: `read:user user:email notifications`; `GITHUB_OAUTH_SCOPES` can opt into broader scopes such as `repo` for private repository discovery.
- `OWNER_LOGIN` owner allow-listing; no app-local users table.
- D1 is the primary persistence layer for settings, sessions, OAuth state, scan runs, raw GitHub changes, action items, evidence, rate-limit snapshots, and ignored items.
- Cloudflare Queues and Cron are used for background discovery/processing.
- Queue consumer now awaits processing directly instead of scheduling per-message floating work.
- Discovery uses `sendBatch()` when the Queue binding supports it, falling back to `send()`.
- Queue consumer config now includes explicit batch size, batch timeout, retry count, and DLQ name.
- Queue processing increments `scan_runs.processed_count` for processed/ignored changes.
- Hono routes are the app surface.
- `@hono/inertia` is wired into page rendering for landing, setup, design, dashboard, settings, and runs pages.
- An Inertia client source exists (`src/client.tsx`) with React page placeholders and a served progressive navigation bundle at `/assets/sunrise-inertia-client.js`.
- `@hono/inertia/vite` configuration and `app/pages.gen.ts` constrain page names for `c.render(...)`.
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
- Fixture capture and manual-labeling scaffolding now exists under `scripts/` and `fixtures/`.
- Rate-limit count is visible in the dashboard header when a snapshot exists.
- `/runs` now shows freshness, rate-limit snapshot, queue backlog approximation, failed count, DLQ name, and formatted timestamps.

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

- The served client bundle is progressive and preserves current server-rendered HTML; full React hydration of the visible UI is not complete yet.
- React page files now render the visible page bodies with JSX. Header/root shell rendering and some legacy helper renderers still live in `src/app.ts`; these should be removed once the header/root shell are also componentized.
- Vite can build `src/client.tsx`, but Worker asset serving is still handled by the explicit `/assets/sunrise-inertia-client.js` route rather than Cloudflare static assets.

### Runs / operations

- `/runs` queue backlog is an approximation based on D1 `github_changes` processing status, not Cloudflare Queue's true broker depth.
- DLQ status shows configured DLQ name, but not actual DLQ item count because the Worker binding does not expose that directly.

### Queue robustness

- DLQ config exists in `wrangler.jsonc`, but each deployment still needs the DLQ queue resource to exist/be provisioned correctly.
- Retry/backoff coverage exists for many D1 writes but is not comprehensive for every write path.

### GitHub discovery/enrichment

Implemented or partially implemented: notifications, review-requested search, assigned search, authored PRs, authored issues, PRs in owned repos, involved search, discussions mentions, repository invitations, organization memberships, PR review/status enrichment for a bounded authored-PR subset, merge-conflict evidence from PR metadata, failed workflow runs, Dependabot alerts, code scanning alerts, secret scanning alerts, rate-limit snapshots, and repo-readiness probes for AGENTS.md/package.json/reality.manifest.md.

Still missing or incomplete from the larger spec:

- PR check-run enrichment uses statuses/reviews today; full Check Runs API coverage is still incomplete.
- Workflow/security/repo-readiness discovery is intentionally bounded to recently pushed owned repos and may miss older or org-owned repositories.
- Created issues with recent comments are discovered but not deeply enriched for “needs owner response” semantics.
- Recent repo activity / high-velocity unfinished-loop detection is not fully implemented.
- Repo-local verification command detection only checks for `package.json` existence, not script semantics yet.
- Manual labeling of 50 real candidates and classifier comparison has scaffolding but not a completed labeled corpus.

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

### Auth/token model

- The default OAuth scope is least-privilege for public data, but private repository discovery requires documenting when to opt into `repo` via `GITHUB_OAUTH_SCOPES`.
- The spec keeps open whether v1 should use OAuth user tokens, a single-user GitHub App installation token, or both; current app uses OAuth user tokens only.
- Exact endpoint-by-endpoint failures under minimal scopes still need a recorded reality check.

### Deployment/onboarding

- Deploy to Cloudflare works, but Queue names are account-level and may collide for repeated test deployments unless the fork config uses unique names.
- Docs mention this, but the source template still necessarily contains default names.
- DLQ queue provisioning should be verified for deploy-button forks.

### Reality verification fixtures

- Capture script and manual-label template exist, but the repository does not yet contain a completed, redacted, manually labeled 50-candidate corpus.
- Local dry-run CLI like `npm run render:inbox -- --json` is still absent.

## Recommended next order

1. Finish moving the header/root shell and remaining legacy render helpers out of `src/app.ts`.
2. Verify deploy-button provisioning with the new DLQ config.
3. Capture `EXPLAIN QUERY PLAN` evidence for dashboard queries.
4. Run the fixture capture script against a real account, redact payloads, and label 50 candidates.
5. Add full Check Runs API coverage and semantic verification-command detection.
6. Document endpoint-by-endpoint behavior under default scopes vs `repo` scopes.
