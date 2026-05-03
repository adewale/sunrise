# Sunrise agent-readable upgrade contract

Sunrise deployments are user-owned. The Cloudflare Deploy Button creates a fork, Worker, D1 database, queues, secrets, and OAuth configuration in the deployer's own accounts. The upstream project (`adewale/sunrise`) does not receive deployment records, tokens, GitHub data, or automatic access to deployed instances.

This document defines the privacy-preserving contract that lets a deployer's coding agent upgrade their fork safely.

## Goals

- Keep deployers in control of their fork and Cloudflare resources.
- Give coding agents stable, explicit upgrade instructions.
- Avoid phoning home or registering deployments by default.
- Preserve local deployment configuration such as Worker names, D1 IDs, queue names, `.dev.vars`, and Cloudflare secrets.
- Make upgrades auditable: plan, verify, migrate, deploy, report.

## Non-goals

- Sunrise does not auto-update itself from inside the Worker.
- Sunrise does not overwrite deployer forks without an explicit agent action.
- Sunrise does not send anonymous or identifiable deployment telemetry upstream.
- Sunrise does not require a central installation registry.

## Implementation files

Sunrise exposes update information through files that are safe for coding agents to read:

- `sunrise.version.json` — machine-readable current version, upstream repo, changelog path, upgrade contract path, verify command, and deploy command.
- `CHANGELOG.md` — human- and agent-readable release notes with explicit agent upgrade notes.
- `/changelog` — in-product changelog page. Viewing it records `last_seen_sunrise_version` in the deployer's own D1 database.
- `/settings` — shows the local Sunrise version card and links to `/changelog`.

These surfaces are local to the deployed app/fork. They do not register the deployment or send telemetry upstream.

## Contract for coding agents

When a user asks a coding agent to upgrade Sunrise, the agent should treat the current repository as a user-owned deploy fork.

1. Inspect the repository state and version metadata.
   ```sh
   git status --short
   git remote -v
   cat sunrise.version.json
   ```

2. Preserve local deployment configuration.
   Never blindly overwrite:
   - `wrangler.jsonc` resource names and IDs
   - `.dev.vars` / `.dev.vars.*`
   - Cloudflare secrets
   - user-owned queue and D1 names
   - any local documentation the deployer added

3. Add or update the upstream remote.
   ```sh
   git remote add upstream https://github.com/adewale/sunrise.git 2>/dev/null || true
   git fetch upstream --tags
   ```

4. Choose the update target.
   Prefer the latest GitHub release tag when the user asked for a release upgrade. Use `upstream/main` when the user asked for the latest development version.

5. Merge, do not replace.
   ```sh
   git merge upstream/main
   ```
   Resolve conflicts by preserving deployer-specific Cloudflare config while accepting upstream app code, migrations, tests, docs, and UI changes.

6. Verify locally.
   ```sh
   npm install
   npm run verify
   ```

7. Apply D1 migrations remotely after verification.
   Use the deployer's configured D1 database name from `wrangler.jsonc`.
   ```sh
   npx wrangler d1 migrations apply <database_name> --remote
   ```

8. Deploy.
   ```sh
   npx wrangler deploy
   ```

9. Report back to the user.
   Include:
   - previous commit
   - new commit or release tag
   - conflicts resolved
   - verification result
   - migrations applied
   - deployed Worker URL

## Privacy model

The upgrade flow is pull-based. The deployer's agent fetches public upstream code from GitHub and applies it locally. No deployment metadata is sent to Sunrise upstream by this contract.

Optional update checks may query GitHub public release metadata from the deployer's environment, but they should not send the deployer's GitHub inbox data, OAuth tokens, Worker URL, account ID, or installation ID to any Sunrise-controlled service.

## User prompt

A deployer can give their coding agent this prompt:

> Upgrade this Sunrise deployment to the latest upstream version. Follow `docs/agent-upgrade-contract.md`. Preserve my Cloudflare resource IDs, secrets, OAuth configuration, D1 database, queues, and deployment-specific `wrangler.jsonc` values. Run verification, apply migrations, deploy, and summarize what changed.
