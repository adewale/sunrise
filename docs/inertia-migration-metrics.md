# Inertia migration metrics

Date: 2026-05-01

## Scope

Migrated the main rendered pages from direct `html(...)` responses to Hono's Inertia renderer:

- `/`
- `/design`
- `/setup`
- `/dashboard`
- `/settings`
- `/runs`

The initial page HTML remains server-rendered to preserve the current visual behavior. Each Inertia page also embeds the page object in `<script data-page="app" type="application/json">...` and supports the `X-Inertia` page-object response protocol.

## Before / after implementation metrics

| Metric | Before | After |
|---|---:|---:|
| `src/app.ts` lines | 524 | 569 |
| `src/app.ts` bytes | 59,267 | 60,961 |
| `package.json` lines | 45 | 46 |
| `package-lock.json` lines | 2,816 | 2,864 |
| Vitest tests | 20 | 21 |
| Test files | 3 | 3 |
| `npm run verify` wall time | 2.50s | 2.37s |
| Vitest reported duration | 467ms | 443ms |

Notes:

- `playwright` was added as a dev dependency for visual verification.
- The source got slightly larger because this migration preserved the old server renderer and added Inertia protocol wiring rather than doing a larger component extraction.

## Playwright visual verification

Captured the dashboard fixture before migration from git `HEAD` at `6e36569` and after migration from the working tree.

Artifacts written under `/tmp/sunrise-visual` during verification:

- `desktop-before.png`
- `desktop-after.png`
- `mobile-before.png`
- `mobile-after.png`
- `summary.json`

Viewport checks:

| Viewport | Visible text | Header box | Main box | Inbox row boxes |
|---|---|---|---|---|
| Desktop 1280×900 | identical | identical | identical | identical |
| Mobile 390×844 | identical | identical | identical | identical |

Desktop geometry:

- Header: `x=0 y=0 w=1280 h=78` before and after.
- Main: `x=80 y=96 w=1120 h=460` before and after.
- Rows: `91,107,781,139`; `91,256,781,139`; `91,406,781,139` before and after.

Mobile geometry:

- Header: `x=0 y=0 w=390 h=145` before and after.
- Main: `x=10 y=157 w=370 h=1000` before and after.
- Rows: `21,545,348,169`; `21,724,348,191`; `21,925,348,221` before and after.

Result: the migration is visually identical for the dashboard fixture at desktop and mobile viewports.

## Verification commands run

```sh
npm run verify
node ./compare-sunrise-visual.mjs
```

The Playwright script was temporary and removed after recording the artifacts/summary.
