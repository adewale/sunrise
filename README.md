# Sunrise

A self-hosted morning dashboard for the GitHub work that needs your attention.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/adewale/sunrise&paid=true)

Public homepage → GitHub repo → Deploy your own version → own your data.

## Screenshots

![Sunrise inbox](docs/assets/screenshots/dashboard.png)

| Landing | Mobile inbox |
| --- | --- |
| ![Sunrise landing page](docs/assets/screenshots/landing.png) | ![Sunrise mobile inbox](docs/assets/screenshots/dashboard-mobile.png) |

More screenshots are in [`docs/assets/screenshots`](docs/assets/screenshots).

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
