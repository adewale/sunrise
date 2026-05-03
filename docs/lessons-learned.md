# Lessons Learned

## 1. A panel is not a section

`panel` should only mean the visual surface: border, radius, background, and shadow.

Spacing and layout rhythm belong to `section`, `masthead`, `hero`, or another structural class.

Bad:

```html
<section class="panel">
  <p class="eyebrow">Table</p>
</section>
```

Good:

```html
<section class="section panel">
  <p class="eyebrow">Table</p>
</section>
```

Why: using `panel` alone caused content to sit against the card edge because it had no internal padding.

## 2. The design page must reuse real components

The public `/design` page exists to reveal drift. When possible, use shared render helpers or React components such as:

- metrics/stat components;
- inbox row components;
- setup checklist components.

Avoid hand-writing lookalike markup. If a sample must be custom, it should still use the same structural classes as the production UI.

## 3. Heading hierarchy matters in component samples

Use `h1` for page-level titles only. Component examples should usually use `h2` inside `.section-head`.

The design table sample originally used `h1`, making a small panel feel like a page hero.

## 4. Dark-mode affordance is a system problem

Buttons looking flat in dark mode was not only a button problem. It revealed inconsistent dark surfaces across:

- panels;
- cards;
- chips;
- setup blocks;
- tables;
- buttons.

The fix was to consolidate shared tokens and surface rules instead of adding one-off button styles.

## 5. Theme transitions should not flash

A bright day-to-night wash is painful in dark mode. Theme transitions should be subtle and directional:

- going dark: low-opacity navy dim;
- going light: very faint warm lift;
- always respect `prefers-reduced-motion`.

## 6. Keep visual primitives small

The design language became more consistent after shrinking to shared primitives:

- `--surface`, `--surface-2`, `--surface-3`;
- `--line`, `--line-strong`;
- `--accent`, `--accent-ink`;
- `--shadow`, `--button-shadow`;
- `--radius`, `--inner`.

More tokens and one-off overrides made the UI harder to reason about.

## 7. Fixed header needs reserved space

The fixed `Sunrise` header and theme toggle can overlap unless the header reserves right-side space and truncates safely.

Use:

- `right` offset on `.site-header`;
- `min-width: 0`;
- `overflow: hidden` only when clipping is acceptable;
- `text-overflow: ellipsis` only when clipping is acceptable.

Fraunces can be clipped by `overflow: hidden` and tight `line-height`. For wordmarks, prefer visible overflow, slight vertical padding, and a safer line height.

## 8. Strong grids prevent accidental collisions

Use grid layouts with `minmax(0, 1fr)` for panels, cards, item rows, and config rows. This prevents text and buttons from overlapping when content is long.

Tables should have a minimum width rather than crushing columns into unreadability.

## 9. Do not mix manual Cloudflare deploys with deploy-button dogfooding

We first deployed Sunrise manually with Wrangler. That created real account-level resources:

```txt
Worker: sunrise
D1: sunrise
Queue: sunrise-github
```

Then we tried to test the Deploy to Cloudflare path in the same Cloudflare account. The deploy-button fork tried to consume the same queue name and failed:

```txt
Queue 'sunrise-github' already has a consumer.
```

Cloudflare Queues can only have one consumer. OAuth/secrets named `sunrise-deploy` do not rename infrastructure. Queue/D1/Worker names come from `wrangler.jsonc` and the Deploy to Cloudflare setup page.

Correct dogfood path:

1. Start from the public template repo.
2. Click Deploy to Cloudflare.
3. In Cloudflare's setup page, choose deployment-specific resource names such as:
   - Worker: `sunrise-deploy`
   - D1: `sunrise-deploy`
   - Queue: `sunrise-deploy-github`
4. Let Cloudflare write those selected names/IDs into the fork it creates.
5. Do not edit the source template or local Wrangler config to fix a single deployment.

If a deploy-button project already exists, change that deployment's forked repo, not the source template repo.

## 10. Template repos must not contain local Cloudflare resource IDs

A template intended for Deploy to Cloudflare should keep generic/default resource names and placeholder IDs, for example:

```jsonc
"database_id": "<DATABASE_ID>"
```

Cloudflare's deploy flow provisions resources and updates the fork with concrete IDs. Committing a real D1 ID from a manual deployment makes the template account-specific and can send other deployments toward the wrong database.

## 11. `binding` is code API; resource names are deployment API

For Queues:

```jsonc
"producers": [{ "binding": "GITHUB_QUEUE", "queue": "sunrise-github" }]
```

- `binding` is the stable variable name code uses: `env.GITHUB_QUEUE`.
- `queue` is the Cloudflare resource name and should be deployment-specific when needed.

Do not change the binding to avoid collisions. Change the resource name in the deploy setup page or in that deployment's fork.

## 12. Deploy-button secrets are not infrastructure names

Values like these are application configuration:

```txt
GITHUB_CLIENT_ID
GITHUB_CLIENT_SECRET
OWNER_LOGIN
SESSION_SECRET
```

They do not affect Worker, D1, or Queue names. If a build error mentions a queue/database/consumer collision, changing OAuth secret values cannot fix it.

## 13. GitHub OAuth 404 usually means the wrong app/client ID

If GitHub sends the user to `/login/oauth/authorize?...` and GitHub returns 404, suspect the `client_id` first.

For Sunrise, `GITHUB_CLIENT_ID` must come from a GitHub **OAuth App**, not a GitHub App, not the app display name, and not a Cloudflare value.

The OAuth app should use:

```txt
Homepage URL: https://your-worker.workers.dev
Authorization callback URL: https://your-worker.workers.dev/callback
```

## 14. What to do after a successful deploy-button build

When the build succeeds and logs show bindings like:

```txt
env.GITHUB_QUEUE (sunrise-deploy-github)
env.DB (sunrise-deploy)
```

next steps are:

1. Visit the deployed Worker URL.
2. Confirm the homepage setup checklist renders.
3. Create or verify the GitHub OAuth App with the exact callback URL shown by Sunrise.
4. In Cloudflare dashboard, set/update secrets:
   - `GITHUB_CLIENT_ID`
   - `GITHUB_CLIENT_SECRET`
   - `OWNER_LOGIN`
   - `SESSION_SECRET`
5. Reload the Worker.
6. Click **Sign in with GitHub**.
7. If login succeeds, click **Manual refresh**.
8. Visit `/dashboard`, `/runs`, and `/design`.
9. If refresh fails, inspect `/runs` and Cloudflare Worker logs before changing infrastructure.

## 15. How Cloudflare Deploy Button docs could prevent this

Cloudflare's Deploy to Cloudflare docs are directionally right, but several points should be more explicit for apps with Queues and D1:

1. **Show a concrete before/after Wrangler example.**
   - Before template: placeholder D1 ID and default queue name.
   - After deploy fork: concrete D1 ID and user-selected queue name.
2. **Explain where edited setup values are written.**
3. **Warn that queue names are account-level and single-consumer.**
4. **Differentiate secrets from resources.**
5. **Add a dogfooding/testing recipe.**
6. **Document how to edit an already-created deploy-button project.**
7. **Clarify D1 placeholder expectations.**
8. **Surface queue consumer conflicts in the dashboard UI.**

## 16. An inbox should optimize skimming before categorization

For Sunrise, the primary user task is not reading a dashboard; it is scanning recent GitHub events and deciding what to open, ignore, or leave.

The better hierarchy is:

1. time, because recency is the scan axis;
2. type, because users need to distinguish review requests, authored PRs, issues, and discussion activity;
3. repo and source, because they explain context;
4. title/reason/action, because those support the decision.

A Tuftean layout works best when the date/time forms a quiet left rail. This lets the eye skim vertically without decoding chips or prose first. Reverse chronology is easier to trust than classifier-driven grouping.

## 17. Do not let page vocabulary drift

After the dashboard became an inbox, the visible header still said “Dashboard”. That was inconsistent with the product model and made the UI feel unresolved.

Rule: when a page changes conceptual model, update every visible label and test expectation at the same time:

- header title;
- empty state;
- tests;
- docs/screenshots;
- route names only if necessary.

The URL can remain `/dashboard` for compatibility, but the UI should say what the user is doing: “Inbox”.

## 18. Mobile sticky headers must preserve primary actions

On desktop, the fixed header can afford separated brand, status, theme toggle, and refresh action. On mobile, hiding **Manual refresh** made the most important recovery action disappear.

Better mobile rule:

- header spans the full viewport width;
- header is `position: sticky` rather than fixed overlay;
- reserve right padding for the theme toggle;
- keep the primary action visible, even if smaller;
- reduce metadata before removing actions.

If there is a trade-off between showing status text and showing the action that updates the data, keep the action.

## 19. Use visual audit tools, but classify false positives

Running the Impeccable audit on `src/app.ts` caught one useful issue and two false positives:

- useful: the dark-mode theme toggle used a colored glow, which reads as a generic AI/dark-glow tell;
- false positives: table cell `border-left` and `border-right` were flagged as “side-tab” accents, but they are neutral table borders, not card accents.

Lesson: automated visual lint is valuable as a consistency pass, not as an unquestioned source of truth. Record which findings are real, fix the real pattern, and avoid contorting semantic table/card borders just to satisfy a regex.

## 20. GitHub notifications are not a complete inbox

The first scanner only queried `/notifications`. That missed several classes of relevant work:

- open PRs authored by the user;
- open issues authored by the user;
- items assigned to the user;
- PRs requesting the user's review;
- active threads involving the user.

A personal GitHub inbox needs both notification pagination and search-backed discovery:

```txt
/notifications?all=false&per_page=100 + Link pagination
/search/issues?q=is:pr is:open review-requested:OWNER
/search/issues?q=is:open assignee:OWNER
/search/issues?q=is:pr is:open author:OWNER
/search/issues?q=is:issue is:open author:OWNER
/search/issues?q=is:open involves:OWNER
```

Dedupe by canonical subject key after combining sources. The UI should then present one reverse-chronological inbox, not one panel per API endpoint.

## 21. Use the Hono/Inertia example as architecture, not just dependency proof

Starting with `@hono/inertia` installed is not the same as building an Inertia app. The useful pattern from `yusukebe/hono-inertia-example` is structural:

```txt
app/server.ts       → Hono routes call c.render(page, props)
app/root-view.tsx   → complete HTML shell
app/ssr.tsx         → render Inertia page with React SSR
app/client.tsx      → hydrateRoot/createInertiaApp
app/pages/*.tsx     → page components
app/pages.gen.ts    → generated page-name registry
vite.config.ts      → inertiaPages + SSR/client build plugins
```

Sunrise first built string-rendered HTML and later migrated. That preserved Cloudflare/product correctness early, but it created extraction debt: routes, shell, page bodies, styles, and tiny client navigation all lived together in `src/app.ts` for too long.

If starting over, begin with the example's file split even if the first pages are simple.

## 22. React pages must own visible page bodies

Placeholder page files satisfy type registration but do not reduce UI drift. The useful migration step is: each page component renders the visible body for that page.

Good interim state:

- Hono routes compute props.
- `rootView` renders header/root shell.
- React page components render page bodies.
- Shared page components render stats, items, setup checks, and operations rows.

Avoid passing a pre-rendered HTML blob through `dangerouslySetInnerHTML` except as a temporary bridge. It hides duplicated markup and prevents component tests from catching drift.

## 23. Queue broker metrics and app-state metrics are different

D1 can tell Sunrise how many `github_changes` are `pending`, `failed`, or `processed`. That is useful application state, but it is not Cloudflare Queue broker depth.

For `/runs`, label the source:

- `source: cloudflare` when Cloudflare API broker metrics are available;
- `source: d1` when falling back to persisted app state.

DLQ count needs Cloudflare API credentials or another explicit operational integration. Showing only a DLQ name is better than pretending to know its depth.

## 24. Check runs, statuses, and reviews are complementary

A PR can have legacy statuses, modern check runs, reviews, and mergeability. No single endpoint is enough.

For authored PR enrichment, combine:

```txt
pull_request.url                     → mergeable / head sha
pull_request.url + /reviews          → latest review state
/repos/{repo}/commits/{sha}/statuses → legacy status contexts
/repos/{repo}/commits/{sha}/check-runs → modern checks
```

Then classify failures conservatively:

- failing/timed out/cancelled/action required → broken authored work;
- pending/incomplete → waiting;

## 25. Least-privilege OAuth should be the default, not the demo path

The default OAuth scope should support public-data use and owner sign-in:

```txt
read:user user:email notifications
```

Private repository discovery is valuable but should be explicit opt-in:

```txt
read:user user:email notifications repo
```

Do not expose a broad `repo` prompt in Deploy to Cloudflare onboarding unless the user clearly asks for private repository coverage. Document endpoint-by-endpoint behavior under both scope sets.

## 26. Fixture capture is not the same as manual labeling

A capture script gives shape coverage; it does not prove classifier correctness. The spec's 50-candidate requirement needs human labels.

Keep three assets separate:

1. redacted raw endpoint payloads;
2. normalized candidate fixtures;
3. manual labels with `actionable`, `expectedPriority`, `expectedKind`, and notes.

A template with 50 rows is useful, but it is still a to-do until a real owner labels real candidates.

## 27. Query plans should be checked before performance hurts

The reverse-chronological inbox query initially produced:

```txt
SCAN action_items
USE TEMP B-TREE FOR ORDER BY
```

That was acceptable on tiny data but wrong as a default. Adding:

```sql
CREATE INDEX IF NOT EXISTS idx_action_items_updated_at
  ON action_items(updated_at DESC);
```

changed the live plan to:

```txt
SCAN action_items USING INDEX idx_action_items_updated_at
```

Record query plans in docs while the schema is still small. It makes future regressions obvious.

## 28. Deploy-fork upgrades need a contract, not magic

Deploy to Cloudflare gives users their own fork and their own Cloudflare resources. That is the correct ownership model, but it also means upstream changes do not automatically reach deployed instances.

Do not solve this by phoning home, tracking installs, or trying to mutate user forks from the Worker. The safer pattern is an agent-readable upgrade contract:

```txt
docs/agent-upgrade-contract.md
sunrise.version.json
CHANGELOG.md
/changelog
/settings version card
```

The contract should tell a coding agent how to:

1. inspect the current fork;
2. add/fetch upstream;
3. merge a release or `upstream/main`;
4. preserve deployment-specific `wrangler.jsonc` values;
5. run verification;
6. apply D1 migrations;
7. deploy;
8. report what changed.

This works with the grain of user-owned forks and coding-agent workflows.

## 29. Update visibility can be local and privacy-preserving

A self-hosted app can explain its current version without registering the deployment. Sunrise's update surfaces are local:

- `sunrise.version.json` gives agents machine-readable metadata.
- `CHANGELOG.md` gives humans and agents release notes.
- `/settings` shows the local version card.
- `/changelog` shows bundled release notes.
- D1 stores `last_seen_sunrise_version` in the deployer's own database.

Viewing the changelog should not send Worker URLs, account IDs, install IDs, OAuth tokens, or GitHub inbox data upstream. If public release checks are added later, make them pull-only against GitHub release metadata and clearly document what is fetched.

## 30. Changelogs should be product surfaces, not only repository files

Pi's changelog flow is a useful model: parse versioned changelog entries, remember what version a user last saw, show a quiet “what changed” notice after updates, and keep a command/page for details.

For Sunrise, the equivalent is `/changelog` plus a `/settings` version card. The key lesson is cadence: do not interrupt normal inbox work, but make changes discoverable at the moment a user or their coding agent is thinking about upgrades.

Changelog entries should include an explicit agent block:

```md
### Agent upgrade notes

- Preserve deployment-specific Cloudflare config.
- Apply migrations: ...
- Run: npm run verify
- Deploy: npx wrangler deploy
```

That makes releases safer for deploy-button forks.

## 31. GitHub notification reasons explain social distance

GitHub `/notifications` includes a `reason` field such as `mention`, `review_requested`, `assign`, or `subscribed`. That field is crucial provenance.

A notification with `reason=subscribed` means “you watch this repo/thread,” not “you were directly addressed.” Treating all notification rows equally makes the inbox feel noisy and mysterious.

Default rule:

- keep direct reasons in the inbox;
- hide watched-repository `subscribed` notifications by default;
- offer a setting to include them;
- preserve the reason in evidence so the UI can explain why the card exists.

## 32. Cards need subtle provenance, not just classification

Social inboxes and feeds work best when they answer “why am I seeing this?” without making every row verbose.

For Sunrise, good provenance hints are short relationship chips:

```txt
Mentioned you
Assigned to you
Review requested
Created by me
Other person’s PR · my repo
Watched repo
```

Avoid long explanations in the main scan path. Put fuller details on a card page or tooltip:

```txt
Source: GitHub notifications
Reason: subscribed
First seen: ...
```

This mirrors social-feed design: lightweight reason labels in the feed, deeper provenance on demand.

## 33. Timestamps can be durable card handles

A timestamp is already the user's scan anchor. Making it a link gives the row a quiet permalink without adding another button.

For Sunrise, timestamp links to `/items/:id` let users:

- open multiple cards in tabs as a temporary TODO list;
- share or reference a specific Sunrise card;
- inspect provenance/details without leaving the inbox;
- keep the title link dedicated to GitHub.

The rule is: title links go to GitHub; timestamp links go to the local card.

## 34. GitHub API URLs must never leak into human navigation

GitHub API payloads often contain URLs like:

```txt
https://api.github.com/repos/owner/repo/issues/35
```

Those are useful canonical subjects for machines but bad links for humans. Convert notification `subject.url` and `latest_comment_url` into browser URLs before persisting action items:

```txt
https://github.com/owner/repo/issues/35
https://github.com/owner/repo/pull/35
```

Regression tests should assert card URLs are human-facing. Existing stale rows may still need reconciliation or one-time cleanup.

## 35. Repo chips should be links

Repository names are context and navigation. If a card shows `owner/repo`, users expect it to open that repository.

Make repo chips links to GitHub and keep them visually chip-like. This improves skimming and avoids forcing users to infer or copy repository URLs.
