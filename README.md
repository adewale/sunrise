# Sunrise

A self-hosted morning dashboard for the GitHub work that needs your attention.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/adewale/sunrise&paid=true)

Public homepage → GitHub repo → Deploy your own version → own your data.

## Project map

```txt
adewale/sunrise
  canonical source, deploy-button template, public project

adewale/sunrise-deploy
  maintainer's personal fork/instance only

sunrise.adewale-883.workers.dev
  public landing website

sunrise-deploy.adewale-883.workers.dev
  maintainer's personal app instance
```

The **Deploy to Cloudflare** button uses `adewale/sunrise` as the template. Cloudflare creates **your own GitHub fork** and deploys a Worker from that fork into your Cloudflare account. Your fork owns its Cloudflare resource names, D1 database ID, queues, secrets, OAuth settings, and future deploys.

Future changes to `adewale/sunrise` do not automatically update your fork. To update, sync or merge from the upstream Sunrise repo, run verification, apply any D1 migrations, and deploy your Worker again.

## Screenshots

![Sunrise inbox](docs/assets/screenshots/dashboard.png)

| Landing | Mobile inbox |
| --- | --- |
| ![Sunrise landing page](docs/assets/screenshots/landing.png) | ![Sunrise mobile inbox](docs/assets/screenshots/dashboard-mobile.png) |

More screenshots are in [`docs/assets/screenshots`](docs/assets/screenshots).

To refresh the committed screenshots:

```bash
# Public pages only:
npm run screenshots:capture

# Include authenticated dashboard screenshots:
SUNRISE_SESSION=<sunrise_session_cookie_value> npm run screenshots:capture
```

Override targets with `SUNRISE_LANDING_URL`, `SUNRISE_APP_URL`, or `SUNRISE_SCREENSHOT_DIR`.

## Deploy

1. Click **Deploy to Cloudflare** above. Cloudflare forks the repo and provisions D1 + Queues from `wrangler.jsonc`.
2. Once deployed, note your Worker URL, for example `https://sunrise-abc.workers.dev`.
3. Create a **GitHub OAuth App** at <https://github.com/settings/developers>:
   - **Homepage URL:** your Worker URL
   - **Authorization callback URL:** `<your-worker-url>/callback`
4. In Cloudflare, open **Workers & Pages → sunrise → Settings → Variables and Secrets** and set:
   - `GITHUB_CLIENT_ID` — GitHub OAuth App Client ID
   - `GITHUB_CLIENT_SECRET` — GitHub OAuth App Client secret
   - `OWNER_LOGIN` — your GitHub username, e.g. `adewale`
   - `SESSION_SECRET` — a long random string
5. Reload your Worker URL, sign in with GitHub, and run **Manual refresh**.

Sunrise also runs scheduled refreshes three times a day. Scheduled refreshes use the latest stored owner session token, compare the new GitHub snapshot with the previous one, and skip queue processing when nothing changed.

The first page includes the same setup checklist with the exact callback URL for that deployed instance.

## Manual deploy

```bash
npm install
npm run verify
wrangler d1 create sunrise
# copy the returned database_id into wrangler.jsonc for manual CLI deploys
wrangler queues create sunrise-github
wrangler queues create sunrise-github-dlq
wrangler d1 migrations apply DB --remote
wrangler secret put GITHUB_CLIENT_ID
wrangler secret put GITHUB_CLIENT_SECRET
wrangler secret put OWNER_LOGIN
wrangler secret put SESSION_SECRET
# Optional for private repo discovery; public-data default omits repo scope.
# wrangler secret put GITHUB_OAUTH_SCOPES
wrangler deploy
```

See [docs/deploy.md](docs/deploy.md).

## Updating a deployed fork

If you deployed with the button, your app runs from your own fork. A coding agent can update it with this flow:

```bash
git remote -v
# Add once if missing:
git remote add upstream https://github.com/adewale/sunrise.git
git fetch upstream --tags
git checkout -b update-sunrise-vX.Y.Z
git merge vX.Y.Z
npm install
npm run verify
npx wrangler d1 migrations apply DB --remote
npx wrangler deploy
```

When resolving conflicts, preserve your fork's deployment-specific Cloudflare config: Worker name, D1 database ID, queue names, secrets, and OAuth settings.

## Maintainer releases

Maintainers can publish a tagged GitHub release with generated notes and coding-agent update instructions:

```bash
npm run release -- vX.Y.Z "Sunrise vX.Y.Z"
```

The script creates an annotated tag, pushes it, and creates a GitHub release using `gh`. Release notes include a changelog and a copy/paste section for a user's coding agent to update that user's fork and Cloudflare instance.
