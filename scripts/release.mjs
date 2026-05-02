#!/usr/bin/env node
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

function run(cmd, args, options = {}) {
  return execFileSync(cmd, args, { encoding: 'utf8', stdio: options.stdio ?? ['ignore', 'pipe', 'pipe'] }).trim();
}

function tryRun(cmd, args) {
  try { return run(cmd, args); } catch { return ''; }
}

function fail(message) {
  console.error(`\nRelease failed: ${message}`);
  process.exit(1);
}

const tag = process.argv[2];
const title = process.argv.slice(3).join(' ') || `Sunrise ${tag ?? ''}`.trim();
if (!tag || !/^v\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(tag)) {
  fail('usage: npm run release -- v0.1.0 [optional release title]');
}

const status = run('git', ['status', '--porcelain']);
if (status) fail('working tree is not clean; commit or stash changes first.');

const branch = run('git', ['branch', '--show-current']);
if (branch !== 'main') fail(`expected to release from main, got ${branch || '(detached)'}.`);

if (tryRun('git', ['rev-parse', '-q', '--verify', `refs/tags/${tag}`])) fail(`tag ${tag} already exists locally.`);
if (tryRun('git', ['ls-remote', '--tags', 'origin', tag])) fail(`tag ${tag} already exists on origin.`);

try { run('gh', ['--version']); } catch { fail('GitHub CLI `gh` is required. Install it and run `gh auth login`.'); }
try { run('gh', ['auth', 'status']); } catch { fail('GitHub CLI is not authenticated. Run `gh auth login`.'); }

const repoUrl = run('git', ['config', '--get', 'remote.origin.url']);
const head = run('git', ['rev-parse', '--short', 'HEAD']);
const previousTag = tryRun('git', ['describe', '--tags', '--abbrev=0']);
const range = previousTag ? `${previousTag}..HEAD` : 'HEAD';
const changeLines = tryRun('git', ['log', '--pretty=format:- %s (%h)', range]) || '- Initial release.';
const compare = previousTag ? `\nCompare: https://github.com/adewale/sunrise/compare/${previousTag}...${tag}\n` : '';

const notes = `# ${title}\n\nReleased from \`${head}\`.\n${compare}\n## Changes\n\n${changeLines}\n\n## Updating a deployed Sunrise fork/instance\n\nWhen someone clicked **Deploy to Cloudflare**, Cloudflare created their own GitHub fork and deployed from that fork. This release does not automatically update those forks. Give the following instructions to the user's coding agent.\n\n\`\`\`text\nYou are updating a user's deployed Sunrise fork and Cloudflare instance to ${tag}.\n\nContext:\n- Upstream/canonical repo: https://github.com/adewale/sunrise\n- The user's repo is their own fork created by Deploy to Cloudflare.\n- Preserve the user's Cloudflare resource names, D1 database_id, queues, secrets, and OAuth settings. Do not replace them with upstream placeholder values.\n\nSteps:\n1. Open the user's Sunrise fork checkout.\n2. Inspect remotes with: git remote -v\n3. If there is no upstream remote, run: git remote add upstream https://github.com/adewale/sunrise.git\n4. Fetch the release: git fetch upstream --tags\n5. Ensure the working tree is clean: git status --short\n6. Create a safety branch: git checkout -b update-sunrise-${tag}\n7. Merge the release: git merge ${tag}\n8. Resolve conflicts carefully. Keep deployment-specific Cloudflare config from the user's fork where applicable.\n9. Install and verify: npm install && npm run verify\n10. Apply any new D1 migrations: npx wrangler d1 migrations apply DB --remote\n11. Deploy: npx wrangler deploy\n12. Open the user's Worker URL and check /setup, /dashboard, and /runs.\n13. Commit and push the update branch, then open a PR into the user's main branch, or fast-forward main if that is their preferred workflow.\n\`\`\`\n\n## Maintainer checklist\n\n- [ ] Source repo tag pushed.\n- [ ] GitHub release published.\n- [ ] Public landing Worker deployed if user-facing pages changed.\n- [ ] Personal deploy fork updated if needed.\n`;

const dir = mkdtempSync(join(tmpdir(), 'sunrise-release-'));
const notesFile = join(dir, `${tag}.md`);
writeFileSync(notesFile, notes);

console.log(`Creating annotated tag ${tag} on ${repoUrl}`);
run('git', ['tag', '-a', tag, '-m', title], { stdio: 'inherit' });
run('git', ['push', 'origin', tag], { stdio: 'inherit' });
console.log(`Creating GitHub release ${tag}`);
run('gh', ['release', 'create', tag, '--title', title, '--notes-file', notesFile], { stdio: 'inherit' });
console.log(`Release ${tag} created.`);
