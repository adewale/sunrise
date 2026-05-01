#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const token = process.env.GITHUB_TOKEN;
const owner = process.env.OWNER_LOGIN;
if (!token || !owner) {
  console.error('Usage: GITHUB_TOKEN=... OWNER_LOGIN=... node scripts/capture-github-fixtures.mjs');
  process.exit(1);
}
const stamp = new Date().toISOString().slice(0, 10);
const root = join('fixtures', 'github', stamp);
mkdirSync(root, { recursive: true });
const headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'sunrise-fixture-capture' };
async function capture(name, url) {
  const res = await fetch(url, { headers });
  const text = await res.text();
  writeFileSync(join(root, `${name}.json`), redact(text));
  console.log(`${name}: ${res.status}`);
}
function redact(text) {
  return text.replaceAll(token, 'REDACTED_TOKEN').replace(/"token"\s*:\s*"[^"]+"/gi, '"token":"REDACTED"');
}
const q = encodeURIComponent;
await capture('notifications', 'https://api.github.com/notifications?all=false&per_page=100');
await capture('review-requests', `https://api.github.com/search/issues?q=${q(`is:pr is:open review-requested:${owner} archived:false`)}&per_page=100`);
await capture('assigned', `https://api.github.com/search/issues?q=${q(`is:open assignee:${owner} archived:false`)}&per_page=100`);
await capture('authored-prs', `https://api.github.com/search/issues?q=${q(`is:pr is:open author:${owner} archived:false`)}&per_page=100`);
await capture('created-issues', `https://api.github.com/search/issues?q=${q(`is:issue is:open author:${owner} archived:false`)}&per_page=100`);
await capture('involved', `https://api.github.com/search/issues?q=${q(`is:open involves:${owner} archived:false`)}&per_page=100`);
await capture('discussions', `https://api.github.com/search/issues?q=${q(`is:discussion mentions:${owner} archived:false`)}&per_page=100`);
await capture('repo-invitations', 'https://api.github.com/user/repository_invitations?per_page=100');
await capture('org-memberships', 'https://api.github.com/user/memberships/orgs?state=pending&per_page=100');
await capture('repos', 'https://api.github.com/user/repos?affiliation=owner&sort=pushed&direction=desc&per_page=30');
await capture('rate-limit', 'https://api.github.com/rate_limit');
