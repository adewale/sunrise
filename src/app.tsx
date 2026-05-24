import { Hono } from 'hono';
import { inertia } from '@hono/inertia';
import { SetupChecks, SetupGuide } from '../app/pages/_shared';
import { rootView, renderErrorDocument } from '../app/root-view';
import { renderFaviconSvg } from '../app/components/brand';
import type { Env } from './env';
import { clearSessionCookie, getSession, retryD1, sessionCookie } from './db';
import type { GitHubActionItem } from './types';
import { processGithubChange, runDiscovery } from './scanner';
import { SUNRISE_CHANGELOG, SUNRISE_VERSION } from './version';

type Bindings = Env;
const app = new Hono<{ Bindings: Bindings }>();

app.use(inertia({ version: 'sunrise-1', rootView }));

app.get('/favicon.svg', (c) => new Response(renderFaviconSvg(), { headers: { 'content-type': 'image/svg+xml; charset=utf-8', 'cache-control': 'public, max-age=86400' } }));

app.get('/', async (c) => {
  const session = await getSession(c.env.DB, c.req.header('Cookie') ?? null);
  if (session) return c.redirect('/dashboard');
  const projectLanding = c.env.PROJECT_LANDING === 'true';
  const setup = projectLanding ? null : await setupDiagnostics(c.env, c.req.url);
  const props = { product: 'Sunrise', signedIn: false, projectLanding, setup, repoUrl: c.env.GITHUB_REPO_URL ?? 'https://github.com/adewale/sunrise' };
  if (c.req.query('json') !== undefined) return c.json(props);
  return c.render('Landing', props);
});

app.get('/design', (c) => {
  return c.render('Design', { product: 'Sunrise' });
});

app.get('/setup', async (c) => {
  const setup = await setupDiagnostics(c.env, c.req.url);
  if (c.req.query('json') !== undefined || c.req.header('Accept')?.includes('application/json')) return c.json(setup);
  return c.render('Setup', { product: 'Sunrise', setup });
});

app.get('/login', async (c) => {
  const missing = setupMissing(c.env).filter((m) => m !== 'GITHUB_CLIENT_SECRET');
  if (missing.length) return c.text(`Missing setup: ${missing.join(', ')}`, 500);
  const callback = new URL(c.req.url); callback.pathname = '/callback'; callback.search = '';
  const clientCheck = await checkGitHubClientId(c.env.GITHUB_CLIENT_ID!, callback.toString());
  if (clientCheck.status === 'fail') {
    const setup = await setupDiagnostics(c.env, c.req.url);
    return html(`<section class="section panel"><p class="eyebrow">Sign-in blocked</p><h1>OAuth setup needs attention</h1><p class="muted">Sunrise checked GitHub before redirecting so you do not land on a confusing GitHub 404.</p>${(<SetupChecks checks={[clientCheck]} />).toString()}<p><a class="button primary" href="/setup">Open setup diagnostics</a></p></section>${(<SetupGuide setup={setup} />).toString()}`, 400);
  }
  const state = crypto.randomUUID();
  const verifier = crypto.randomUUID();
  const now = new Date();
  const expires = new Date(now.getTime() + 10 * 60 * 1000).toISOString();
  await retryD1(() => c.env.DB.prepare('INSERT INTO oauth_states (state, code_verifier, expires_at, created_at) VALUES (?, ?, ?, ?)').bind(state, verifier, expires, now.toISOString()).run());
  const url = new URL('https://github.com/login/oauth/authorize');
  url.searchParams.set('client_id', c.env.GITHUB_CLIENT_ID!);
  url.searchParams.set('redirect_uri', callback.toString());
  url.searchParams.set('state', state);
  url.searchParams.set('scope', githubOAuthScopes(c.env));
  return c.redirect(url.toString());
});

app.get('/callback', async (c) => {
  const state = c.req.query('state');
  const code = c.req.query('code');
  const oauthError = c.req.query('error');
  if (oauthError) {
    await recordOAuthFailure(c.env, `GitHub OAuth error: ${oauthError} ${c.req.query('error_description') ?? ''}`.trim());
    return html(`<section class="section panel"><p class="eyebrow">GitHub sign-in failed</p><h1>OAuth error</h1><p class="muted">${escapeHtml(c.req.query('error_description') ?? oauthError)}</p><p><a class="button primary" href="/setup">Open setup diagnostics</a></p></section>`, 400);
  }
  if (!state || !code) return c.text('Missing OAuth callback parameters', 400);
  const row = await c.env.DB.prepare('SELECT * FROM oauth_states WHERE state = ? AND expires_at > ?').bind(state, new Date().toISOString()).first<Record<string, string>>();
  await c.env.DB.prepare('DELETE FROM oauth_states WHERE state = ?').bind(state).run();
  if (!row) return c.text('Invalid or expired OAuth state', 400);
  const callback = new URL(c.req.url); callback.pathname = '/callback'; callback.search = '';
  const tokenRes = await fetch('https://github.com/login/oauth/access_token', { method: 'POST', headers: { Accept: 'application/json' }, body: new URLSearchParams({ client_id: c.env.GITHUB_CLIENT_ID!, client_secret: c.env.GITHUB_CLIENT_SECRET!, code, redirect_uri: callback.toString(), state }) });
  const tokenJson = await tokenRes.json<any>();
  if (!tokenJson.access_token) {
    await recordOAuthFailure(c.env, `OAuth token exchange failed: ${JSON.stringify(tokenJson).slice(0, 500)}`);
    return html('<section class="section panel"><p class="eyebrow">GitHub sign-in failed</p><h1>Token exchange failed</h1><p class="muted">Your Client ID, Client secret, or callback URL likely does not match the GitHub OAuth App.</p><p><a class="button primary" href="/setup">Open setup diagnostics</a></p></section>', 401);
  }
  const userRes = await fetch('https://api.github.com/user', { headers: { Authorization: `Bearer ${tokenJson.access_token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'sunrise-dashboard' } });
  const user = await userRes.json<any>();
  const expectedOwner = normalizeGitHubLogin(c.env.OWNER_LOGIN ?? '');
  if (expectedOwner && user.login.toLowerCase() !== expectedOwner.toLowerCase()) return html(`<h1>Not owner</h1><p>Signed in as ${escapeHtml(user.login)}, but this Sunrise instance expects ${escapeHtml(expectedOwner)}.</p><p>This is a personal Sunrise instance. Deploy your own version from the GitHub repo.</p>`, 403);
  const sid = crypto.randomUUID();
  await c.env.DB.prepare('INSERT INTO sessions (id, github_login, github_id, access_token, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(sid, user.login, String(user.id), tokenJson.access_token, new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(), new Date().toISOString()).run();
  c.header('Set-Cookie', sessionCookie(sid));
  return c.redirect('/dashboard');
});

app.get('/dashboard', async (c) => {
  const session = await requireSession(c);
  if (session instanceof Response) return session;
  const props: any = await dashboardProps(c.env, session.githubLogin, Number(c.req.query('page') ?? '1'));
  if (c.req.query('refresh') === 'started') props.notice = { kind: 'success', message: `Manual refresh started. Found ${c.req.query('candidates') ?? '0'} GitHub events; the inbox will fill in as processing finishes. View details on the runs page.` };
  if (c.req.query('refresh') === 'failed') props.notice = { kind: 'fail', message: `Manual refresh failed${c.req.query('error') ? `: ${c.req.query('error')}` : '.'}` };
  if (c.req.query('json') !== undefined || c.req.header('Accept')?.includes('application/json')) return c.json(props);
  return c.render('Dashboard', props);
});

app.get('/items/:id', async (c) => {
  const session = await requireSession(c);
  if (session instanceof Response) return session;
  const row = await c.env.DB.prepare('SELECT * FROM action_items WHERE id = ? AND ignored_at IS NULL LIMIT 1').bind(c.req.param('id')).first<Record<string, any>>();
  const props = { product: 'Sunrise', signedInAs: session.githubLogin, item: row ? rowToItem(row) : null };
  if (c.req.header('Accept')?.includes('application/json')) return c.json(props);
  return c.render('Item', props);
});

app.get('/settings', async (c) => {
  const session = await requireSession(c);
  if (session instanceof Response) return session;
  const settings = await readSettings(c.env.DB);
  const lastSeenVersion = await readSetting(c.env.DB, 'last_seen_sunrise_version');
  return c.render('Settings', { product: 'Sunrise', signedInAs: session.githubLogin, settings, version: SUNRISE_VERSION, update: { currentVersion: SUNRISE_VERSION.version, lastSeenVersion, hasUnseenChangelog: lastSeenVersion !== SUNRISE_VERSION.version } });
});

app.get('/changelog', async (c) => {
  const session = await requireSession(c);
  if (session instanceof Response) return session;
  await writeSetting(c.env.DB, 'last_seen_sunrise_version', SUNRISE_VERSION.version);
  const props = { product: 'Sunrise', signedInAs: session.githubLogin, version: SUNRISE_VERSION, changelog: SUNRISE_CHANGELOG };
  if (c.req.header('Accept')?.includes('application/json')) return c.json(props);
  return c.render('Changelog', props);
});

app.post('/settings', async (c) => {
  const session = await requireSession(c);
  if (session instanceof Response) return session;
  const form = await c.req.parseBody();
  const pageSize = clampPageSize(Number(form.inboxPageSize ?? 50));
  await writeSetting(c.env.DB, 'inbox_page_size', String(pageSize));
  await writeSetting(c.env.DB, 'include_subscribed_notifications', form.includeSubscribedNotifications === 'on' ? 'true' : 'false');
  return c.redirect('/settings?saved=1');
});

app.post('/refresh', async (c) => {
  const session = await requireSession(c);
  if (session instanceof Response) return session;
  const backTo = safeReturnPath(c.req.header('Referer'), new URL(c.req.url).origin);
  try {
    const run = await runDiscovery(c.env, 'manual', session.accessToken);
    return c.redirect(withRefreshParams(backTo, { refresh: 'started', runId: run.runId, candidates: String(run.candidateCount) }));
  } catch (error) {
    return c.redirect(withRefreshParams(backTo, { refresh: 'failed', error: error instanceof Error ? error.message : String(error) }));
  }
});

app.get('/runs', async (c) => {
  const session = await requireSession(c);
  if (session instanceof Response) return session;
  const props = await runsProps(c.env, c.req.query('runId'), c.req.query('refresh'), c.req.query('candidates'), c.req.query('error'));
  if (c.req.header('Accept')?.includes('application/json')) return c.json(props);
  return c.render('Runs', props);
});

app.post('/logout', async (c) => {
  const cookie = c.req.header('Cookie') ?? '';
  const sid = /(?:^|;\s*)sunrise_session=([^;]+)/.exec(cookie)?.[1];
  if (sid) await c.env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(sid).run();
  c.header('Set-Cookie', clearSessionCookie());
  return c.redirect('/');
});

app.post('/ignore', async (c) => {
  const session = await requireSession(c);
  if (session instanceof Response) return session;
  const form = await c.req.parseBody();
  const key = String(form.canonicalSubjectKey ?? '');
  if (key) await c.env.DB.prepare('INSERT OR IGNORE INTO ignored_items (canonical_subject_key, reason, ignored_at) VALUES (?, ?, ?)').bind(key, 'manual ignore', new Date().toISOString()).run();
  return c.redirect('/dashboard');
});

app.post('/__debug/run-daily-scan', async (c) => {
  if (c.env.TEST_GITHUB_FIXTURES !== 'true') return c.text('Not enabled', 403);
  return c.json(await runDiscovery(c.env, 'manual'));
});

app.post('/__debug/reprocess/:changeId', async (c) => {
  if (c.env.TEST_GITHUB_FIXTURES !== 'true') return c.text('Not enabled', 403);
  await processGithubChange(c.env, { kind: 'process-github-change', runId: 'debug', changeId: c.req.param('changeId') });
  return c.json({ ok: true });
});

async function runsProps(env: Env, runId?: string, refresh?: string, candidateCount?: string, error?: string) {
  const runs = (await env.DB.prepare('SELECT * FROM scan_runs ORDER BY started_at DESC LIMIT 10').all()).results;
  const lastRun = await env.DB.prepare('SELECT * FROM scan_runs ORDER BY started_at DESC LIMIT 1').first<Record<string, any>>();
  const activeRun = runId ? await env.DB.prepare('SELECT * FROM scan_runs WHERE id = ? LIMIT 1').bind(runId).first<Record<string, any>>() : null;
  const rate = await env.DB.prepare('SELECT * FROM rate_limit_snapshots ORDER BY captured_at DESC LIMIT 1').first<Record<string, any>>();
  const pending = await countRows(env.DB, "SELECT COUNT(*) AS count FROM github_changes WHERE processing_status = 'pending'");
  const failed = await countRows(env.DB, "SELECT COUNT(*) AS count FROM github_changes WHERE processing_status = 'failed'");
  const processed = await countRows(env.DB, "SELECT COUNT(*) AS count FROM github_changes WHERE processing_status = 'processed'");
  const queue = await queueStats(env, { pending, failed, processed, dlq: 'sunrise-github-dlq', maxBatchSize: 10, maxBatchTimeout: 30, maxRetries: 3 });
  const notice = refreshNotice(refresh, activeRun, candidateCount, error);
  return {
    product: 'Sunrise',
    runs,
    activeRunId: runId ?? null,
    activeRun,
    notice,
    freshness: { lastScanAt: lastRun?.completed_at ?? lastRun?.started_at ?? null, status: scanStatus(lastRun) },
    rateLimit: rate ? { resource: rate.resource, remaining: rate.remaining, resetAt: rate.reset_at, capturedAt: rate.captured_at } : null,
    queue,
  };
}

function refreshNotice(refresh?: string, activeRun?: Record<string, any> | null, candidateCount?: string, error?: string) {
  if (refresh === 'failed') return { kind: 'fail', message: `Manual refresh failed${error ? `: ${error}` : '.'}` };
  if (refresh !== 'started') return null;
  const found = Number(activeRun?.candidate_count ?? candidateCount ?? 0);
  const processed = Number(activeRun?.processed_count ?? 0);
  const status = activeRun?.status ?? 'queued';
  if (found === 0) return { kind: 'success', message: 'Manual refresh completed. No GitHub events were found.' };
  if (processed >= found) return { kind: 'success', message: `Manual refresh completed. Processed ${processed} of ${found} GitHub events.` };
  return { kind: 'running', message: `Manual refresh started. Found ${found} GitHub events; processed ${processed} so far. Status: ${status}. Reload manually if you want a newer snapshot.` };
}

async function countRows(db: D1Database, sql: string) {
  const row = await db.prepare(sql).first<Record<string, number>>();
  return Number(row?.count ?? 0);
}

async function queueStats(env: Env, fallback: any) {
  const accountId = env.CLOUDFLARE_ACCOUNT_ID;
  const token = env.CLOUDFLARE_API_TOKEN;
  if (!accountId || !token) return { ...fallback, source: 'd1' };
  const queueName = env.GITHUB_QUEUE_NAME || 'sunrise-github';
  const dlqName = env.GITHUB_QUEUE_DLQ_NAME || fallback.dlq;
  const [queue, dlq] = await Promise.all([cloudflareQueueDepth(accountId, token, queueName), cloudflareQueueDepth(accountId, token, dlqName)]);
  return { ...fallback, brokerPending: queue ?? null, dlqCount: dlq ?? null, source: queue == null && dlq == null ? 'd1' : 'cloudflare' };
}

async function cloudflareQueueDepth(accountId: string, token: string, queueName: string) {
  try {
    const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/queues/${encodeURIComponent(queueName)}`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
    if (!res.ok) return null;
    const json = await res.json<any>();
    const q = json.result ?? json;
    return Number(q.messages ?? q.backlog ?? q.message_count ?? q.pending_messages ?? q.depth ?? 0);
  } catch { return null; }
}

async function dashboardProps(env: Env, login: string, page = 1) {
  const settings = await readSettings(env.DB);
  const pageSize = settings.inboxPageSize;
  const currentPage = Math.max(1, Math.floor(page || 1));
  const rows = await env.DB.prepare('SELECT * FROM action_items WHERE ignored_at IS NULL ORDER BY updated_at DESC LIMIT 500').all<Record<string, any>>();
  const allItems = rows.results.map(rowToItem).filter((item) => settings.includeSubscribedNotifications || !isSubscribedNotification(item)).sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  const totalItems = allItems.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const safePage = Math.min(currentPage, totalPages);
  const items = allItems.slice((safePage - 1) * pageSize, safePage * pageSize);
  const lastRun = await env.DB.prepare('SELECT * FROM scan_runs ORDER BY started_at DESC LIMIT 1').first<Record<string, any>>();
  const rate = await env.DB.prepare('SELECT * FROM rate_limit_snapshots ORDER BY captured_at DESC LIMIT 1').first<Record<string, any>>();
  const refreshSummary = await readRefreshSummary(env.DB);
  return {
    product: 'Sunrise',
    signedInAs: login,
    freshness: { lastScanAt: lastRun?.completed_at ?? lastRun?.started_at ?? null, status: scanStatus(lastRun) },
    rateLimit: rate ? { remaining: rate.remaining, resetAt: rate.reset_at } : null,
    refreshSummary,
    counts: {
      assigned: allItems.filter((i) => i.kind === 'assigned').length,
      mentioned: allItems.filter((i) => i.kind === 'mention').length,
      createdIssuesNeedingResponse: allItems.filter((i) => i.kind === 'maintenance').length,
      pullRequests: allItems.filter(isPullRequestItem).length,
      issues: allItems.filter(isIssueItem).length,
      myPrsOwnRepos: allItems.filter((i) => isAuthoredPrItem(i) && isOwnRepoItem(i, login)).length,
      myPrsOtherRepos: allItems.filter((i) => isAuthoredPrItem(i) && !isOwnRepoItem(i, login)).length,
      prsInMyRepos: allItems.filter((i) => i.kind === 'repo_pr').length,
      authoredOpenPrs: allItems.filter(isAuthoredPrItem).length,
      reviewRequests: allItems.filter((i) => i.kind === 'review_requested').length,
    },
    unresolvedLinks: unresolvedGitHubLinks(allItems, login),
    items,
    pagination: { page: safePage, pageSize, totalItems, totalPages, hasPrevious: safePage > 1, hasNext: safePage < totalPages },
    settings,
    usingFixtures: env.TEST_GITHUB_FIXTURES === 'true',
  };
}

function rowToItem(row: Record<string, any>): GitHubActionItem {
  return { id: row.id, canonicalSubjectKey: row.canonical_subject_key, kind: row.kind, title: row.title, repo: row.repo, url: row.url, updatedAt: row.updated_at, reason: row.reason, suggestedAction: row.suggested_action, evidence: JSON.parse(row.evidence_json || '{}'), source: row.source };
}

function isSubscribedNotification(item: GitHubActionItem) {
  return item.kind === 'notification' && item.source === 'notifications' && (item.evidence?.notificationReason === 'subscribed' || item.reason === 'GitHub notification.');
}

function isPullRequestItem(item: GitHubActionItem) {
  return item.url.includes('/pull/') || item.kind === 'review_requested' || item.kind === 'repo_pr' || isAuthoredPrItem(item) || item.source === 'pulls' || item.source === 'reviews';
}

function isAuthoredPrItem(item: GitHubActionItem) {
  return item.kind.startsWith('authored_pr') || item.kind === 'stale_green_pr';
}

function isOwnRepoItem(item: GitHubActionItem, ownerLogin: string) {
  if (item.evidence?.isOwnRepo !== undefined) return item.evidence.isOwnRepo;
  return item.repo.split('/')[0]?.toLowerCase() === ownerLogin.toLowerCase();
}

function isIssueItem(item: GitHubActionItem) {
  return !isPullRequestItem(item) && (item.url.includes('/issues/') || item.kind === 'assigned' || item.kind === 'maintenance' || item.source === 'issues');
}

function unresolvedGitHubLinks(items: GitHubActionItem[], login: string) {
  const rows = [
    unresolvedRow('open-issues-owned', 'Open issues in my repos', items.filter((i) => isIssueItem(i) && isOwnRepoItem(i, login)).length, '/issues', `is:issue is:open user:${login} archived:false`),
    unresolvedRow('open-prs-owned', 'Open PRs in my repos', items.filter((i) => isPullRequestItem(i) && isOwnRepoItem(i, login)).length, '/pulls', `is:pr is:open user:${login} archived:false`),
    unresolvedRow('review-requests', 'Review requests', items.filter((i) => i.kind === 'review_requested').length, '/pulls/review-requested'),
    unresolvedRow('my-open-prs', 'My open PRs', items.filter(isAuthoredPrItem).length, '/pulls', `is:pr is:open author:${login} archived:false`),
    unresolvedRow('my-open-issues', 'My open issues', items.filter((i) => isIssueItem(i) && (i.kind === 'maintenance' || i.evidence?.isAuthored === true)).length, '/issues', `is:issue is:open author:${login} archived:false`),
    unresolvedRow('assigned', 'Assigned to me', items.filter((i) => i.kind === 'assigned').length, '/issues/assigned'),
    unresolvedRow('mentions', 'Mentions', items.filter((i) => i.kind === 'mention').length, '/issues/mentioned'),
    unresolvedRow('failed-workflows', 'Failed workflows', items.filter((i) => i.kind === 'workflow_failure').length, '/actions'),
    ...items.filter((i) => i.kind === 'invitation').map(invitationLink),
  ];
  return rows.filter((row) => row.count > 0);
}

function unresolvedRow(id: string, label: string, count: number, path: string, query?: string) {
  const url = new URL(path, 'https://github.com');
  if (query) url.searchParams.set('q', query);
  return { id, label, count, href: url.toString(), query };
}

function invitationLink(item: GitHubActionItem) {
  const label = item.repo ? `Invitation · ${item.repo}` : item.title;
  return { id: `invitation-${item.canonicalSubjectKey}`, label, count: 1, href: item.url, query: 'Open the invited repository or organization in GitHub to accept or decline.' };
}

async function requireSession(c: any) {
  const session = await getSession(c.env.DB, c.req.header('Cookie') ?? null);
  return session ?? c.redirect('/login');
}

function safeReturnPath(referer: string | undefined, origin: string) {
  if (!referer) return '/dashboard';
  try {
    const url = new URL(referer);
    if (url.origin !== origin) return '/dashboard';
    return `${url.pathname}${url.search}` || '/dashboard';
  } catch {
    return '/dashboard';
  }
}

function withRefreshParams(path: string, params: Record<string, string>) {
  const url = new URL(path, 'https://sunrise.local');
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return `${url.pathname}${url.search}`;
}

function setupMissing(env: Env) {
  return ['DB', 'GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET', 'OWNER_LOGIN', 'SESSION_SECRET'].filter((key) => !(env as any)[key]);
}

type UserSettings = { inboxPageSize: number; includeSubscribedNotifications: boolean };

async function readSetting(db: D1Database, key: string) {
  const row = await db.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first<Record<string, string>>();
  return row?.value ?? null;
}

async function readRefreshSummary(db: D1Database) {
  const row = await db.prepare("SELECT value FROM settings WHERE key = 'last_refresh_summary'").first<Record<string, string>>();
  if (!row?.value) return null;
  try { return JSON.parse(row.value); } catch { return null; }
}

async function readSettings(db: D1Database): Promise<UserSettings> {
  const [pageSizeRow, subscribedRow] = await Promise.all([
    db.prepare("SELECT value FROM settings WHERE key = 'inbox_page_size'").first<Record<string, string>>(),
    db.prepare("SELECT value FROM settings WHERE key = 'include_subscribed_notifications'").first<Record<string, string>>(),
  ]);
  return { inboxPageSize: clampPageSize(Number(pageSizeRow?.value ?? 50)), includeSubscribedNotifications: subscribedRow?.value === 'true' };
}

async function writeSetting(db: D1Database, key: string, value: string) {
  await db.prepare(`INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`).bind(key, value, new Date().toISOString()).run();
}

function clampPageSize(value: number) {
  return [25, 50, 100].includes(value) ? value : 50;
}

type SetupCheck = { id: string; label: string; status: 'pass' | 'warn' | 'fail'; message: string; fix?: string };

type SetupDiagnostics = {
  ready: boolean;
  origin: string;
  callbackUrl: string;
  missing: string[];
  checks: SetupCheck[];
};

async function setupDiagnostics(env: Env, requestUrl: string): Promise<SetupDiagnostics> {
  const origin = new URL(requestUrl).origin;
  const callbackUrl = `${origin}/callback`;
  const checks: SetupCheck[] = [];
  const add = (check: SetupCheck) => checks.push(check);

  if (env.DB) {
    try {
      await env.DB.prepare('SELECT 1 FROM sessions LIMIT 1').first();
      const key = `setup_probe_${crypto.randomUUID()}`;
      await env.DB.prepare('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)').bind(key, 'ok', new Date().toISOString()).run();
      await env.DB.prepare('DELETE FROM settings WHERE key = ?').bind(key).run();
      add({ id: 'd1_schema', label: 'D1 database', status: 'pass', message: 'D1 is connected, writable, and the Sunrise schema is present.' });
    } catch (error) {
      add({ id: 'd1_schema', label: 'D1 database', status: 'fail', message: 'D1 is bound, but the Sunrise schema is missing or inaccessible.', fix: 'Run D1 migrations for the DB binding, then redeploy.' });
    }
  } else {
    add({ id: 'd1_schema', label: 'D1 database', status: 'fail', message: 'D1 binding DB is missing.', fix: 'Deploy to Cloudflare should provision D1. For manual deploys, create D1 and bind it as DB.' });
  }

  if (env.GITHUB_QUEUE) {
    try {
      await env.GITHUB_QUEUE.send({ kind: 'setup-diagnostic', diagnosticId: crypto.randomUUID(), createdAt: new Date().toISOString() });
      add({ id: 'queue', label: 'Queue binding', status: 'pass', message: 'Queue binding GITHUB_QUEUE is present and accepts diagnostic messages.' });
    } catch {
      add({ id: 'queue', label: 'Queue binding', status: 'fail', message: 'Queue binding exists but did not accept a diagnostic message.', fix: 'Check Queue provisioning and consumer configuration in Cloudflare.' });
    }
  } else {
    add({ id: 'queue', label: 'Queue binding', status: 'fail', message: 'Queue binding GITHUB_QUEUE is missing.', fix: 'Deploy to Cloudflare should provision Queues. If a queue name collides, choose a unique queue name in the deploy setup.' });
  }

  const normalizedOwner = normalizeGitHubLogin(env.OWNER_LOGIN ?? '');
  if (normalizedOwner) {
    const owner = await checkOwnerLogin(normalizedOwner, env.OWNER_LOGIN ?? normalizedOwner);
    add(owner);
  } else {
    add({ id: 'owner_login', label: 'GitHub owner', status: 'fail', message: 'OWNER_LOGIN is missing.', fix: 'Set OWNER_LOGIN to your GitHub username, for example `adewale`.' });
  }

  add(env.SESSION_SECRET && env.SESSION_SECRET.length >= 16
    ? { id: 'session_secret', label: 'Session secret', status: 'pass', message: 'SESSION_SECRET is set.' }
    : { id: 'session_secret', label: 'Session secret', status: 'fail', message: 'SESSION_SECRET is missing or too short.', fix: 'Set SESSION_SECRET to a long random string, for example from `openssl rand -base64 32`.' });

  if (env.GITHUB_CLIENT_ID) {
    add(checkSecretShape('github_client_id_shape', 'GitHub OAuth client ID shape', env.GITHUB_CLIENT_ID, 'client_id'));
    add(await checkGitHubClientId(env.GITHUB_CLIENT_ID, callbackUrl));
  } else {
    add({ id: 'github_client_id', label: 'GitHub OAuth client ID', status: 'fail', message: 'GITHUB_CLIENT_ID is missing.', fix: 'Create a GitHub OAuth App and copy its Client ID. Do not use a GitHub App ID or Cloudflare value.' });
  }

  if (env.GITHUB_CLIENT_SECRET) {
    add(checkSecretShape('github_client_secret', 'GitHub OAuth client secret', env.GITHUB_CLIENT_SECRET, 'client_secret'));
  } else {
    add({ id: 'github_client_secret', label: 'GitHub OAuth client secret', status: 'fail', message: 'GITHUB_CLIENT_SECRET is missing.', fix: 'Copy the Client secret from the same GitHub OAuth App as GITHUB_CLIENT_ID.' });
  }

  if (env.TEST_GITHUB_FIXTURES === 'true') add({ id: 'fixture_mode', label: 'Fixture mode', status: 'fail', message: 'TEST_GITHUB_FIXTURES is enabled. Dashboard data is sample data, not live GitHub data.', fix: 'Remove TEST_GITHUB_FIXTURES from Cloudflare Variables and Secrets for production.' });

  const lastOAuthFailure = env.DB ? await env.DB.prepare("SELECT value, updated_at FROM settings WHERE key = 'oauth_last_error'").first<Record<string, string>>() : null;
  if (lastOAuthFailure) add({ id: 'last_oauth_failure', label: 'Last OAuth failure', status: 'fail', message: `${lastOAuthFailure.value} (${lastOAuthFailure.updated_at})`, fix: 'Update GitHub OAuth App settings and Cloudflare secrets, then try Sign in again.' });

  add({ id: 'callback_url', label: 'OAuth callback URL', status: 'pass', message: callbackUrl, fix: 'Use this exact URL as the GitHub OAuth App Authorization callback URL.' });

  return { ready: checks.every((check) => check.status !== 'fail'), origin, callbackUrl, missing: setupMissing(env), checks };
}

function githubOAuthScopes(env: Env) {
  return env.GITHUB_OAUTH_SCOPES?.trim() || 'read:user user:email notifications';
}

function normalizeGitHubLogin(value: string) {
  const trimmed = value.trim().replace(/^@/, '');
  if (!trimmed) return '';
  try {
    const url = new URL(trimmed);
    if (url.hostname === 'github.com' || url.hostname === 'www.github.com') return url.pathname.split('/').filter(Boolean)[0] ?? '';
  } catch {
    // Plain GitHub login, not a URL.
  }
  return trimmed.replace(/^https?:\/\/(www\.)?github\.com\//, '').split('/').filter(Boolean)[0] ?? '';
}

async function checkOwnerLogin(login: string, configuredValue = login): Promise<SetupCheck> {
  try {
    const res = await fetch(`https://api.github.com/users/${encodeURIComponent(login)}`, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'sunrise-dashboard' } });
    if (res.ok) return { id: 'owner_login', label: 'GitHub owner', status: 'pass', message: configuredValue === login ? `GitHub user ${login} exists.` : `OWNER_LOGIN normalized to ${login}; GitHub user exists.` };
    return { id: 'owner_login', label: 'GitHub owner', status: 'fail', message: `GitHub user ${login} was not found.`, fix: 'Set OWNER_LOGIN to your GitHub username only, for example `adewale`. A profile URL also works, but the username is clearer.' };
  } catch {
    return { id: 'owner_login', label: 'GitHub owner', status: 'warn', message: `Could not verify ${login} with GitHub right now.` };
  }
}

function checkSecretShape(id: string, label: string, value: string, kind: 'client_id' | 'client_secret'): SetupCheck {
  const trimmed = value.trim();
  if (!trimmed || /^changeme|placeholder|todo|test$/i.test(trimmed)) return { id, label, status: 'fail', message: `${label} looks like a placeholder.`, fix: 'Replace it with the value from your GitHub OAuth App.' };
  if (/^https?:\/\//i.test(trimmed) || trimmed.includes('github.com/')) return { id, label, status: 'fail', message: `${label} looks like a URL, not a GitHub OAuth value.`, fix: 'Copy the raw Client ID or Client secret from the GitHub OAuth App settings.' };
  if (kind === 'client_id' && trimmed.length < 10) return { id, label, status: 'warn', message: 'Client ID is present but shorter than expected.', fix: 'Double-check that this is the GitHub OAuth App Client ID.' };
  if (kind === 'client_secret' && trimmed.length < 20) return { id, label, status: 'warn', message: 'Client secret is present but shorter than expected. GitHub verifies it during sign-in.', fix: 'If sign-in fails, generate a new Client secret in the GitHub OAuth App and update Cloudflare.' };
  return { id, label, status: kind === 'client_secret' ? 'warn' : 'pass', message: kind === 'client_secret' ? 'Client secret is present and has a plausible shape. GitHub only verifies it during sign-in.' : 'Client ID is present and has a plausible shape.' };
}

async function recordOAuthFailure(env: Env, message: string) {
  try {
    await env.DB.prepare(`INSERT INTO settings (key, value, updated_at) VALUES ('oauth_last_error', ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`).bind(message, new Date().toISOString()).run();
  } catch (error) {
    console.log(JSON.stringify({ level: 'error', msg: 'failed to record oauth failure', error: error instanceof Error ? error.message : String(error) }));
  }
}

async function checkGitHubClientId(clientId: string, callbackUrl: string): Promise<SetupCheck> {
  const url = new URL('https://github.com/login/oauth/authorize');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', callbackUrl);
  url.searchParams.set('state', 'sunrise-setup-check');
  url.searchParams.set('scope', 'read:user user:email notifications');
  try {
    const res = await fetch(url.toString(), { method: 'GET', redirect: 'manual' });
    if (res.status === 404) {
      return { id: 'github_client_id', label: 'GitHub OAuth client ID', status: 'fail', message: 'GitHub returned 404 for this OAuth authorize URL.', fix: 'Use the Client ID from a GitHub OAuth App. A GitHub App ID/client value or typo will send users to a GitHub 404.' };
    }
    if (res.status >= 200 && res.status < 400) {
      return { id: 'github_client_id', label: 'GitHub OAuth client ID', status: 'warn', message: 'GitHub redirects unauthenticated checks to login, so Sunrise cannot fully verify this client ID until browser sign-in.', fix: 'If the browser lands on a GitHub 404 after login, recreate a GitHub OAuth App and copy its Client ID and Client secret into Cloudflare.' };
    }
    return { id: 'github_client_id', label: 'GitHub OAuth client ID', status: 'warn', message: `GitHub returned HTTP ${res.status} while checking the client ID.`, fix: 'If sign-in fails, recreate the GitHub OAuth App and copy the Client ID again.' };
  } catch {
    return { id: 'github_client_id', label: 'GitHub OAuth client ID', status: 'warn', message: 'Could not reach GitHub to verify the OAuth client ID.' };
  }
}

function scanStatus(run: Record<string, any> | null) {
  if (!run) return 'stale';
  if (run.status === 'failed' || run.status === 'running') return run.status;
  return Date.now() - Date.parse(run.completed_at ?? run.started_at) > 36 * 60 * 60 * 1000 ? 'stale' : 'fresh';
}

async function html(body: string, status = 200) {
  return new Response(await renderErrorDocument(body), { status, headers: { 'content-type': 'text/html; charset=utf-8' } });
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

export default app;
