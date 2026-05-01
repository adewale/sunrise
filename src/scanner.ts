import type { Env } from './env';
import type { GitHubChange, QueueMessage } from './types';

type ProcessGitHubChangeMessage = Extract<QueueMessage, { kind: 'process-github-change' }>;
import { classifyChange } from './classifier';
import { retryD1 } from './db';

export async function runDiscovery(env: Env, trigger: 'cron' | 'manual' = 'manual', accessToken?: string) {
  const runId = crypto.randomUUID();
  const now = new Date().toISOString();
  await retryD1(() => env.DB.prepare('INSERT INTO scan_runs (id, trigger, status, started_at, candidate_count, processed_count) VALUES (?, ?, ?, ?, 0, 0)').bind(runId, trigger, 'running', now).run());
  try {
    const changes = env.TEST_GITHUB_FIXTURES === 'true' || !accessToken ? fixtureChanges(runId, env.OWNER_LOGIN ?? 'owner') : await discoverFromGitHub(runId, accessToken, env.OWNER_LOGIN ?? '', env);
    const messages: ProcessGitHubChangeMessage[] = [];
    for (const change of changes) messages.push(await persistChange(env, change));
    await enqueueChanges(env, messages);
    await retryD1(() => env.DB.prepare('UPDATE scan_runs SET status = ?, completed_at = ?, candidate_count = ? WHERE id = ?').bind('succeeded', new Date().toISOString(), changes.length, runId).run());
    return { runId, candidateCount: changes.length };
  } catch (error) {
    await retryD1(() => env.DB.prepare('UPDATE scan_runs SET status = ?, completed_at = ?, error = ? WHERE id = ?').bind('failed', new Date().toISOString(), error instanceof Error ? error.message : String(error), runId).run());
    throw error;
  }
}

async function persistChange(env: Env, change: GitHubChange): Promise<ProcessGitHubChangeMessage> {
  await retryD1(() => env.DB.prepare(`INSERT INTO github_changes (id, run_id, canonical_subject_key, source_endpoint, repo, subject_type, subject_url, html_url, updated_at, raw_json, first_seen_at, last_seen_at, processing_status, attempt_count)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0)
    ON CONFLICT(canonical_subject_key, source_endpoint, updated_at) DO UPDATE SET run_id = excluded.run_id, raw_json = excluded.raw_json, last_seen_at = excluded.last_seen_at, processing_status = 'pending'`)
    .bind(change.id, change.runId, change.canonicalSubjectKey, change.sourceEndpoint, change.repo, change.subjectType, change.subjectUrl, change.htmlUrl, change.updatedAt, JSON.stringify(change.raw), new Date().toISOString(), new Date().toISOString()).run());
  return { kind: 'process-github-change', runId: change.runId, changeId: change.id };
}

async function enqueueChanges(env: Env, messages: ProcessGitHubChangeMessage[]) {
  if (!messages.length) return;
  if (!env.GITHUB_QUEUE) {
    for (const msg of messages) await processGithubChange(env, msg);
    return;
  }
  const queue = env.GITHUB_QUEUE as Queue<ProcessGitHubChangeMessage> & { sendBatch?: (messages: { body: ProcessGitHubChangeMessage }[]) => Promise<void> };
  if (typeof queue.sendBatch === 'function') {
    for (let i = 0; i < messages.length; i += 10) await queue.sendBatch(messages.slice(i, i + 10).map((body) => ({ body })));
    return;
  }
  for (const msg of messages) await env.GITHUB_QUEUE.send(msg);
}

export async function processGithubChange(env: Env, msg: ProcessGitHubChangeMessage) {
  const row = await env.DB.prepare('SELECT * FROM github_changes WHERE id = ?').bind(msg.changeId).first<Record<string, string>>();
  if (!row) return;
  const ignored = await env.DB.prepare('SELECT 1 FROM ignored_items WHERE canonical_subject_key = ? LIMIT 1').bind(row.canonical_subject_key).first();
  if (ignored) {
    await retryD1(() => env.DB.prepare("UPDATE github_changes SET processing_status = 'ignored' WHERE id = ?").bind(msg.changeId).run());
    await incrementProcessedCount(env, row.run_id);
    return;
  }
  try {
    const item = classifyChange({
      id: row.id,
      runId: row.run_id,
      canonicalSubjectKey: row.canonical_subject_key,
      sourceEndpoint: row.source_endpoint,
      repo: row.repo,
      subjectType: row.subject_type,
      subjectUrl: row.subject_url,
      htmlUrl: row.html_url,
      updatedAt: row.updated_at,
      raw: JSON.parse(row.raw_json || '{}'),
    }, env.OWNER_LOGIN ?? '');
    if (item) {
      await retryD1(() => env.DB.prepare(`INSERT INTO action_items (id, canonical_subject_key, priority, kind, title, repo, url, updated_at, reason, suggested_action, evidence_json, source, ignored_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
        ON CONFLICT(canonical_subject_key) DO UPDATE SET priority = excluded.priority, kind = excluded.kind, title = excluded.title, repo = excluded.repo, url = excluded.url, updated_at = excluded.updated_at, reason = excluded.reason, suggested_action = excluded.suggested_action, evidence_json = excluded.evidence_json, source = excluded.source`)
        .bind(item.id, item.canonicalSubjectKey, item.priority, item.kind, item.title, item.repo, item.url, item.updatedAt, item.reason, item.suggestedAction, JSON.stringify(item.evidence ?? {}), item.source).run());
      await retryD1(() => env.DB.prepare('INSERT INTO item_evidence (id, action_item_id, evidence_json, created_at) VALUES (?, ?, ?, ?)').bind(crypto.randomUUID(), item.id, JSON.stringify(item.evidence ?? {}), new Date().toISOString()).run());
    }
    await retryD1(() => env.DB.prepare("UPDATE github_changes SET processing_status = 'processed', attempt_count = attempt_count + 1, last_error = NULL WHERE id = ?").bind(msg.changeId).run());
    await incrementProcessedCount(env, row.run_id);
  } catch (error) {
    await retryD1(() => env.DB.prepare("UPDATE github_changes SET processing_status = 'failed', attempt_count = attempt_count + 1, last_error = ? WHERE id = ?").bind(error instanceof Error ? error.message : String(error), msg.changeId).run());
    throw error;
  }
}

async function incrementProcessedCount(env: Env, runId: string) {
  await retryD1(() => env.DB.prepare('UPDATE scan_runs SET processed_count = processed_count + 1 WHERE id = ?').bind(runId).run());
}

async function discoverFromGitHub(runId: string, token: string, ownerLogin: string, env: Env): Promise<GitHubChange[]> {
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'sunrise-dashboard' };
  const [notifications, reviewRequests, assigned, authoredPrs, authoredIssues, ownedRepoPrs, involved, discussions, repoInvitations, orgMemberships, activeRepos] = await Promise.all([
    fetchPaginated<any>('https://api.github.com/notifications?all=false&per_page=100', headers, 'GitHub notifications'),
    searchIssues(headers, 'search/review-requests', `is:pr is:open review-requested:${ownerLogin} archived:false`),
    searchIssues(headers, 'search/assigned', `is:open assignee:${ownerLogin} archived:false`),
    searchIssues(headers, 'search/authored-prs', `is:pr is:open author:${ownerLogin} archived:false`),
    searchIssues(headers, 'search/created-issues', `is:issue is:open author:${ownerLogin} archived:false`),
    searchIssues(headers, 'search/owned-repo-prs', `is:pr is:open user:${ownerLogin} -author:${ownerLogin} archived:false`),
    searchIssues(headers, 'search/involved', `is:open involves:${ownerLogin} archived:false`),
    safeSearchIssues(headers, 'search/discussions', `is:discussion mentions:${ownerLogin} archived:false`),
    safeFetchPaginated<any>('https://api.github.com/user/repository_invitations?per_page=100', headers, 'repository invitations'),
    safeFetchPaginated<any>('https://api.github.com/user/memberships/orgs?state=pending&per_page=100', headers, 'organization memberships'),
    safeFetchPaginated<any>('https://api.github.com/user/repos?affiliation=owner&sort=pushed&direction=desc&per_page=30', headers, 'owned repositories'),
  ]);
  const enrichedAuthoredPrs = await enrichPullRequests(headers, authoredPrs.slice(0, 20), ownerLogin);
  const repoReadiness = await discoverRepoReadiness(runId, headers, activeRepos.slice(0, 10), ownerLogin);
  const repoAlerts = await discoverRepoAlerts(runId, headers, activeRepos.slice(0, 10), ownerLogin);
  await captureRateLimit(env, headers);
  return dedupeChanges([
    ...notifications.map((n) => notificationToChange(runId, n)),
    ...reviewRequests.map((i) => issueSearchToChange(runId, i, 'search/review-requests', 'review_requested', ownerLogin)),
    ...assigned.map((i) => issueSearchToChange(runId, i, 'search/assigned', 'assign', ownerLogin)),
    ...enrichedAuthoredPrs.map((i) => issueSearchToChange(runId, i, 'search/authored-prs', 'author', ownerLogin)),
    ...authoredIssues.map((i) => issueSearchToChange(runId, i, 'search/created-issues', 'author', ownerLogin)),
    ...ownedRepoPrs.map((i) => issueSearchToChange(runId, i, 'search/owned-repo-prs', 'repo_pr', ownerLogin)),
    ...involved.map((i) => issueSearchToChange(runId, i, 'search/involved', 'comment', ownerLogin)),
    ...discussions.map((i) => issueSearchToChange(runId, i, 'search/discussions', 'mention', ownerLogin)),
    ...repoInvitations.map((i) => invitationToChange(runId, i, 'invitations/repository')),
    ...orgMemberships.map((i) => invitationToChange(runId, i, 'invitations/org')),
    ...repoReadiness,
    ...repoAlerts,
  ]);
}

async function fetchPaginated<T>(firstUrl: string, headers: Record<string, string>, label: string, maxPages = 5): Promise<T[]> {
  const out: T[] = [];
  let url: string | null = firstUrl;
  for (let page = 0; url && page < maxPages; page++) {
    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error(`${label} failed: ${res.status}`);
    const json = await res.json<any>();
    out.push(...(Array.isArray(json) ? json : json.items ?? []));
    url = nextLink(res.headers.get('link'));
  }
  return out;
}

async function searchIssues(headers: Record<string, string>, endpoint: string, query: string) {
  return fetchPaginated<any>(`https://api.github.com/search/issues?q=${encodeURIComponent(query)}&sort=updated&order=desc&per_page=100`, headers, endpoint);
}

async function safeSearchIssues(headers: Record<string, string>, endpoint: string, query: string) {
  try { return await searchIssues(headers, endpoint, query); } catch { return []; }
}

async function safeFetchPaginated<T>(firstUrl: string, headers: Record<string, string>, label: string, maxPages = 2): Promise<T[]> {
  try { return await fetchPaginated<T>(firstUrl, headers, label, maxPages); } catch { return []; }
}

async function enrichPullRequests(headers: Record<string, string>, prs: any[], ownerLogin: string) {
  return Promise.all(prs.map(async (item) => {
    if (!item.pull_request?.url) return item;
    try {
      const pr = await fetchJson<any>(item.pull_request.url, headers);
      const reviews = await safeFetchPaginated<any>(`${item.pull_request.url}/reviews?per_page=100`, headers, 'PR reviews', 1);
      const statuses = pr.statuses_url ? await safeFetchPaginated<any>(pr.statuses_url, headers, 'PR statuses', 1) : [];
      const checkRuns = pr.head?.repo?.full_name && pr.head?.sha ? await safeFetchPaginated<any>(`https://api.github.com/repos/${pr.head.repo.full_name}/commits/${pr.head.sha}/check-runs?per_page=100`, { ...headers, Accept: 'application/vnd.github+json' }, 'PR check runs', 1) : [];
      const latestReviewState = reviews.at(-1)?.state;
      const checks = checkRuns.some((r) => ['failure', 'timed_out', 'cancelled', 'action_required'].includes(String(r.conclusion))) || statuses.some((s) => ['failure', 'error'].includes(String(s.state))) ? 'failure' : checkRuns.some((r) => !r.conclusion || String(r.status) !== 'completed') || statuses.some((s) => String(s.state) === 'pending') ? 'pending' : checkRuns.length || statuses.length ? 'success' : item.checks;
      return { ...item, mergeable: pr.mergeable === false || pr.mergeable_state === 'dirty' ? 'conflicting' : pr.mergeable === true ? 'mergeable' : 'unknown', checks, checkRunCount: checkRuns.length, latestReviewState, hasVerificationSummary: hasVerificationText(`${item.body ?? ''}\n${pr.body ?? ''}`), user: item.user ?? { login: ownerLogin } };
    } catch { return item; }
  }));
}

async function discoverRepoReadiness(runId: string, headers: Record<string, string>, repos: any[], ownerLogin: string): Promise<GitHubChange[]> {
  const out: GitHubChange[] = [];
  for (const repo of repos) {
    const fullName = String(repo.full_name ?? '');
    if (!fullName || String(repo.owner?.login ?? '').toLowerCase() !== ownerLogin.toLowerCase()) continue;
    const [agents, packageJson, reality] = await Promise.all([
      contentExists(headers, fullName, 'AGENTS.md'),
      hasVerifyCommand(headers, fullName),
      contentExists(headers, fullName, 'reality.manifest.md'),
    ]);
    const pushed = String(repo.pushed_at ?? repo.updated_at ?? new Date().toISOString());
    if (!agents) out.push(repoReadinessChange(runId, fullName, pushed, 'repo_missing_agent_instructions', 'Active repo is missing AGENTS.md', { hasAgentInstructions: false }));
    if (!packageJson) out.push(repoReadinessChange(runId, fullName, pushed, 'repo_missing_verify_command', 'Active repo is missing an obvious package.json verify command', { hasVerifyCommand: false }));
    if (!reality) out.push(repoReadinessChange(runId, fullName, pushed, 'repo_missing_reality_manifest', 'Active repo is missing reality.manifest.md', { hasRealityManifest: false }));
  }
  return out;
}

async function discoverRepoAlerts(runId: string, headers: Record<string, string>, repos: any[], ownerLogin: string): Promise<GitHubChange[]> {
  const out: GitHubChange[] = [];
  for (const repo of repos) {
    const fullName = String(repo.full_name ?? '');
    if (!fullName || String(repo.owner?.login ?? '').toLowerCase() !== ownerLogin.toLowerCase()) continue;
    const [runs, dependabot, codeScanning, secretScanning] = await Promise.all([
      safeFetchPaginated<any>(`https://api.github.com/repos/${fullName}/actions/runs?status=failure&per_page=5`, headers, 'workflow runs', 1),
      safeFetchPaginated<any>(`https://api.github.com/repos/${fullName}/dependabot/alerts?state=open&per_page=5`, headers, 'dependabot alerts', 1),
      safeFetchPaginated<any>(`https://api.github.com/repos/${fullName}/code-scanning/alerts?state=open&per_page=5`, headers, 'code scanning alerts', 1),
      safeFetchPaginated<any>(`https://api.github.com/repos/${fullName}/secret-scanning/alerts?state=open&per_page=5`, headers, 'secret scanning alerts', 1),
    ]);
    out.push(...runs.map((run) => repoAlertChange(runId, fullName, 'actions/workflow-failure', `Failed workflow run: ${run.name ?? run.display_title ?? fullName}`, run.html_url, run.updated_at ?? run.created_at, { reason: 'ci_activity', checks: 'failure' })));
    out.push(...dependabot.map((alert) => repoAlertChange(runId, fullName, 'security/dependabot', `Dependabot alert: ${alert.security_advisory?.summary ?? alert.dependency?.package?.name ?? fullName}`, alert.html_url, alert.updated_at ?? alert.created_at, { reason: 'security_alert' })));
    out.push(...codeScanning.map((alert) => repoAlertChange(runId, fullName, 'security/code-scanning', `Code scanning alert: ${alert.rule?.description ?? alert.rule?.id ?? fullName}`, alert.html_url, alert.updated_at ?? alert.created_at, { reason: 'security_alert' })));
    out.push(...secretScanning.map((alert) => repoAlertChange(runId, fullName, 'security/secret-scanning', `Secret scanning alert: ${alert.secret_type_display_name ?? alert.secret_type ?? fullName}`, alert.html_url, alert.updated_at ?? alert.created_at, { reason: 'security_alert' })));
  }
  return out;
}

async function contentExists(headers: Record<string, string>, repo: string, path: string) {
  const res = await fetch(`https://api.github.com/repos/${repo}/contents/${path}`, { headers });
  return res.ok;
}

async function hasVerifyCommand(headers: Record<string, string>, repo: string) {
  try {
    const json = await fetchJson<any>(`https://api.github.com/repos/${repo}/contents/package.json`, headers);
    const decoded = atob(String(json.content ?? '').replace(/\s/g, ''));
    const pkg = JSON.parse(decoded);
    const scripts = pkg.scripts ?? {};
    return Boolean(scripts.verify || scripts.test || scripts.check || scripts.build || scripts.lint);
  } catch { return false; }
}

async function fetchJson<T>(url: string, headers: Record<string, string>): Promise<T> {
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`${url} failed: ${res.status}`);
  return res.json() as Promise<T>;
}

function hasVerificationText(value: string) {
  return /verified|verification|tested|npm test|npm run verify|deployed/i.test(value);
}

async function captureRateLimit(env: Env, headers: Record<string, string>) {
  try {
    const json = await fetchJson<any>('https://api.github.com/rate_limit', headers);
    const core = json.resources?.core ?? json.rate ?? {};
    await retryD1(() => env.DB.prepare('INSERT INTO rate_limit_snapshots (id, resource, remaining, reset_at, captured_at) VALUES (?, ?, ?, ?, ?)').bind(crypto.randomUUID(), 'core', Number(core.remaining ?? 0), core.reset ? new Date(Number(core.reset) * 1000).toISOString() : null, new Date().toISOString()).run());
  } catch {}
}

function nextLink(link: string | null): string | null {
  return link?.split(',').map((part) => part.trim()).find((part) => part.includes('rel="next"'))?.match(/<([^>]+)>/)?.[1] ?? null;
}

function notificationToChange(runId: string, n: any): GitHubChange {
  return {
    id: crypto.randomUUID(),
    runId,
    canonicalSubjectKey: canonicalKey(n),
    sourceEndpoint: 'notifications',
    repo: n.repository?.full_name ?? '',
    subjectType: n.subject?.type ?? 'Notification',
    subjectUrl: n.subject?.url ?? n.url,
    htmlUrl: n.subject?.latest_comment_url ?? n.repository?.html_url ?? n.url,
    updatedAt: n.updated_at,
    raw: { reason: n.reason, title: n.subject?.title, unread: n.unread },
  };
}

function issueSearchToChange(runId: string, item: any, endpoint: string, reason: string, ownerLogin: string): GitHubChange {
  const isPr = Boolean(item.pull_request);
  const repo = String(item.repository_url ?? '').replace('https://api.github.com/repos/', '');
  const repoOwner = repo.split('/')[0] ?? '';
  const author = String(item.user?.login ?? '');
  return {
    id: crypto.randomUUID(),
    runId,
    canonicalSubjectKey: String(item.html_url ?? item.url ?? item.id).replace('https://github.com/', 'github:'),
    sourceEndpoint: endpoint,
    repo,
    subjectType: isPr ? 'PullRequest' : endpoint.includes('discussions') ? 'Discussion' : 'Issue',
    subjectUrl: item.url,
    htmlUrl: item.html_url,
    updatedAt: item.updated_at ?? item.created_at ?? new Date().toISOString(),
    raw: { reason, title: item.title, author, repoOwner, isOwnRepo: repoOwner.toLowerCase() === ownerLogin.toLowerCase(), isAuthored: author.toLowerCase() === ownerLogin.toLowerCase(), checks: item.checks ?? (isPr ? 'pending' : undefined), mergeable: item.mergeable, latestReviewState: item.latestReviewState, hasVerificationSummary: item.hasVerificationSummary, comments: item.comments, state: item.state },
  };
}

function invitationToChange(runId: string, item: any, endpoint: string): GitHubChange {
  const repo = item.repository?.full_name ?? item.organization?.login ?? '';
  const title = endpoint.includes('org') ? `Organization invitation: ${repo}` : `Repository invitation: ${repo}`;
  return { id: crypto.randomUUID(), runId, canonicalSubjectKey: `github:${endpoint}:${repo}`, sourceEndpoint: endpoint, repo, subjectType: 'Invitation', subjectUrl: item.url ?? '', htmlUrl: item.html_url ?? item.repository?.html_url ?? `https://github.com/${repo}`, updatedAt: item.updated_at ?? item.created_at ?? new Date().toISOString(), raw: { reason: 'invitation', title } };
}

function repoReadinessChange(runId: string, repo: string, updatedAt: string, key: string, title: string, raw: Record<string, unknown>): GitHubChange {
  return { id: crypto.randomUUID(), runId, canonicalSubjectKey: `github:${repo}:readiness:${key}`, sourceEndpoint: 'contents/repo-readiness', repo, subjectType: 'Repository', subjectUrl: `https://api.github.com/repos/${repo}`, htmlUrl: `https://github.com/${repo}`, updatedAt, raw: { title, ...raw } };
}

function repoAlertChange(runId: string, repo: string, endpoint: string, title: string, htmlUrl: string, updatedAt: string, raw: Record<string, unknown>): GitHubChange {
  return { id: crypto.randomUUID(), runId, canonicalSubjectKey: `github:${repo}:${endpoint}:${title}`, sourceEndpoint: endpoint, repo, subjectType: endpoint.includes('actions') ? 'WorkflowRun' : 'SecurityAlert', subjectUrl: htmlUrl, htmlUrl: htmlUrl || `https://github.com/${repo}`, updatedAt: updatedAt ?? new Date().toISOString(), raw: { title, ...raw } };
}

function dedupeChanges(changes: GitHubChange[]): GitHubChange[] {
  const byKey = new Map<string, GitHubChange>();
  for (const change of changes) {
    const existing = byKey.get(change.canonicalSubjectKey);
    if (!existing || changeSpecificity(change) > changeSpecificity(existing) || (changeSpecificity(change) === changeSpecificity(existing) && Date.parse(change.updatedAt) > Date.parse(existing.updatedAt))) byKey.set(change.canonicalSubjectKey, change);
  }
  return [...byKey.values()].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
}

function changeSpecificity(change: GitHubChange): number {
  if (change.sourceEndpoint.includes('owned-repo-prs')) return 5;
  if (change.sourceEndpoint.includes('authored-prs')) return 5;
  if (change.sourceEndpoint.includes('review-requests')) return 4;
  if (change.sourceEndpoint.includes('assigned')) return 4;
  if (change.sourceEndpoint.includes('created-issues')) return 4;
  if (change.sourceEndpoint.includes('involved')) return 2;
  return 1;
}

function canonicalKey(n: any): string {
  return String(n.subject?.url ?? n.url ?? n.id).replace('https://api.github.com/repos/', 'github:');
}

function fixtureChanges(runId: string, owner: string): GitHubChange[] {
  const now = new Date().toISOString();
  const base = { runId, repo: `${owner}/sunrise`, subjectType: 'PullRequest', subjectUrl: 'https://api.github.com/repos/o/r/pulls/1', htmlUrl: 'https://github.com/o/r/pull/1', updatedAt: now };
  return [
    { ...base, id: crypto.randomUUID(), canonicalSubjectKey: 'github:o/r:pull:1', sourceEndpoint: 'notifications', raw: { reason: 'review_requested', title: 'Review dashboard PR' } },
    { ...base, id: crypto.randomUUID(), canonicalSubjectKey: 'github:o/r:pull:2', sourceEndpoint: 'search/authored-prs', raw: { author: owner, title: 'Green but unexplained', checks: 'success', hasVerificationSummary: false } },
    { ...base, id: crypto.randomUUID(), canonicalSubjectKey: 'github:o/r:readiness:agent', sourceEndpoint: 'contents', subjectType: 'Repository', raw: { title: 'sunrise missing agent instructions', hasAgentInstructions: false } },
  ];
}
