export const SUNRISE_VERSION = {
  name: 'sunrise',
  version: '0.1.0',
  commit: 'local',
  upstream: 'https://github.com/adewale/sunrise',
  changelog: 'CHANGELOG.md',
  upgradeContract: 'docs/agent-upgrade-contract.md',
  verify: 'npm run verify',
  deploy: 'npx wrangler deploy',
  privacy: 'No phone-home or deployment registry is required for update visibility. Deployer-owned agents pull public upstream code.',
} as const;

export const SUNRISE_CHANGELOG = `# Changelog

All notable Sunrise changes are recorded here for deployers and their coding agents.

## [0.1.0] - 2026-05-03

### User-facing changes

- Added a GitHub inbox/dashboard for self-hosted Cloudflare deployments.
- Added setup diagnostics, OAuth troubleshooting, operations runs, settings, pagination, and design pages.
- Added calendar-style inbox sections, direct GitHub unresolved links, card-level pages, and GitHub repo links.
- Added watched-repository notification filtering. Subscribed/watched repo notifications are off by default.
- Added scheduled refreshes every four hours, anchored around 06:00 in the deployment cron timezone.

### Operational changes

- Added D1 migrations and indexes for inbox queries.
- Added queue-backed GitHub change processing, DLQs, refresh summaries, reconciliation, and ETag-based no-change detection.
- Added screenshot capture and release scripts.

### Agent upgrade notes

- Follow \`docs/agent-upgrade-contract.md\`.
- Preserve deployer-specific \`wrangler.jsonc\` resource IDs, D1 database names, queue names, secrets, and OAuth configuration.
- Verify with \`npm run verify\`.
- Apply D1 migrations before deploy when new migration files are present.
`;
