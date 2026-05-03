# Deploy Sunrise on Cloudflare

Sunrise is single-user and self-hosted. Do not send tokens to a hosted service.

## Recommended: Deploy to Cloudflare button

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/adewale/sunrise&paid=true)

Deploy-button flow, following the Tasche pattern:

1. Click **Deploy to Cloudflare**.
2. Cloudflare forks the repo into your GitHub account.
3. Cloudflare parses `wrangler.jsonc` and provisions D1 + Queues.
4. On the Cloudflare setup page, you can accept or customize the Worker name and resource names. Any changes are written into the fork Cloudflare creates for you — no local checkout or manual Wrangler edit is required.
5. Cloudflare prompts for secrets listed in `.dev.vars.example`, using descriptions from `package.json` `cloudflare.bindings`.
6. Cloudflare runs `npm run build` and `npm run deploy`.
7. Visit the deployed Worker URL.
8. The Sunrise homepage shows a first-boot checklist and the exact GitHub OAuth callback URL for that instance.

## Post-deploy steps

1. Create a GitHub OAuth app at <https://github.com/settings/developers>:
   - **Homepage URL:** your deployed Worker URL.
   - **Authorization callback URL:** `<your-worker-url>/callback`.
2. Add secrets in Cloudflare dashboard under **Workers & Pages → sunrise → Settings → Variables and Secrets**:
   - `GITHUB_CLIENT_ID` — the **Client ID** from a GitHub **OAuth App**. If GitHub `/login/oauth/authorize` returns 404, this value is usually wrong.
   - `GITHUB_CLIENT_SECRET` — the **Client secret** from the same OAuth App.
   - `OWNER_LOGIN` — your GitHub username, for example `adewale`.
   - `SESSION_SECRET` — a long random string.
3. Reload the Worker URL.
4. Sign in with GitHub.
5. Click **Manual refresh** to create the first scan.

## Updates after deployment

Deploy-button users own their fork and Cloudflare resources, so Sunrise does not auto-update deployed instances and does not keep a registry of deployments.

Sunrise includes a privacy-preserving update surface:

- `/settings` shows the current bundled Sunrise version.
- `/changelog` shows bundled release notes and records `last_seen_sunrise_version` in the deployer's own D1 database.
- `sunrise.version.json` exposes machine-readable version and upgrade metadata.
- `docs/agent-upgrade-contract.md` tells a coding agent how to fetch upstream, preserve deployment-specific Cloudflare config, verify, migrate, deploy, and report back.

No update check or changelog view sends Worker URLs, account IDs, OAuth tokens, GitHub inbox data, or install IDs to Sunrise upstream.

## Manual CLI deploy

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
# Optional: add repo scope for private repository discovery.
# wrangler secret put GITHUB_OAUTH_SCOPES
wrangler deploy
```

Cloudflare Access can be added as an optional extra protection layer, but GitHub OAuth owner sign-in is the product auth model.

## Dogfooding the Deploy to Cloudflare path

The Deploy to Cloudflare flow is the intended path. Cloudflare reads the default names from `wrangler.jsonc`, shows them in the setup page, provisions resources, and writes the selected names/IDs into the fork it creates. Users should not need to edit Wrangler locally.

Changing OAuth secret values to `sunrise-deploy` does not rename infrastructure. If testing in an account that already has a queue named `sunrise-github` with a consumer, either delete the old queue/Worker or choose a unique queue name in the Cloudflare setup page. Queue names are account-level and a Cloudflare Queue can only have one consumer.

## Why the app shows onboarding

Users do not know their workers.dev URL before deployment, but GitHub OAuth requires an exact callback URL. Sunrise derives the current URL from the request and shows:

```txt
Homepage URL: https://your-worker.workers.dev
Callback URL: https://your-worker.workers.dev/callback
```

This avoids asking users to infer callback paths from docs.
