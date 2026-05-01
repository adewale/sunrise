import { Hono } from 'hono';
import { inertia, serializePage, type PageObject } from '@hono/inertia';
import type { Env } from './env';
import { clearSessionCookie, getSession, retryD1, sessionCookie } from './db';
import type { GitHubActionItem } from './types';
import { processGithubChange, runDiscovery } from './scanner';

type Bindings = Env;
const app = new Hono<{ Bindings: Bindings }>();

app.use(inertia({ version: 'sunrise-1', rootView: renderInertiaRoot }));

app.get('/favicon.svg', (c) => new Response(renderFaviconSvg(), { headers: { 'content-type': 'image/svg+xml; charset=utf-8', 'cache-control': 'public, max-age=86400' } }));

app.get('/', async (c) => {
  const session = await getSession(c.env.DB, c.req.header('Cookie') ?? null);
  if (session) return c.redirect('/dashboard');
  const setup = await setupDiagnostics(c.env, c.req.url);
  const props = { product: 'Sunrise', signedIn: false, setup, repoUrl: c.env.GITHUB_REPO_URL ?? 'https://github.com/adewale/sunrise' };
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
    return html(`<section class="section panel"><p class="eyebrow">Sign-in blocked</p><h1>OAuth setup needs attention</h1><p class="muted">Sunrise checked GitHub before redirecting so you do not land on a confusing GitHub 404.</p>${renderSetupChecks([clientCheck])}<p><a class="button primary" href="/setup">Open setup diagnostics</a></p></section>${renderSetupGuide(setup)}`, 400);
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
  url.searchParams.set('scope', 'read:user user:email notifications repo');
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
  if (c.req.query('refresh') === 'started') props.notice = { kind: 'success', message: `Manual refresh started. Found ${c.req.query('candidates') ?? '0'} GitHub events; the inbox will fill in as processing finishes.` };
  if (c.req.query('json') !== undefined || c.req.header('Accept')?.includes('application/json')) return c.json(props);
  return c.render('Dashboard', props);
});

app.get('/settings', async (c) => {
  const session = await requireSession(c);
  if (session instanceof Response) return session;
  const settings = await readSettings(c.env.DB);
  return c.render('Settings', { product: 'Sunrise', signedInAs: session.githubLogin, settings });
});

app.post('/settings', async (c) => {
  const session = await requireSession(c);
  if (session instanceof Response) return session;
  const form = await c.req.parseBody();
  const pageSize = clampPageSize(Number(form.inboxPageSize ?? 50));
  await writeSetting(c.env.DB, 'inbox_page_size', String(pageSize));
  return c.redirect('/settings?saved=1');
});

app.post('/refresh', async (c) => {
  const session = await requireSession(c);
  if (session instanceof Response) return session;
  const run = await runDiscovery(c.env, 'manual', session.accessToken);
  return c.redirect(`/dashboard?refresh=started&runId=${encodeURIComponent(run.runId)}&candidates=${run.candidateCount}`);
});

app.get('/runs', async (c) => {
  const session = await requireSession(c);
  if (session instanceof Response) return session;
  const runs = (await c.env.DB.prepare('SELECT * FROM scan_runs ORDER BY started_at DESC LIMIT 10').all()).results;
  if (c.req.header('Accept')?.includes('application/json')) return c.json({ runs });
  return c.render('Runs', { product: 'Sunrise', runs });
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

async function dashboardProps(env: Env, login: string, page = 1) {
  const settings = await readSettings(env.DB);
  const pageSize = settings.inboxPageSize;
  const currentPage = Math.max(1, Math.floor(page || 1));
  const rows = await env.DB.prepare('SELECT * FROM action_items WHERE ignored_at IS NULL ORDER BY updated_at DESC LIMIT 500').all<Record<string, any>>();
  const allItems = rows.results.map(rowToItem).sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  const totalItems = allItems.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const safePage = Math.min(currentPage, totalPages);
  const items = allItems.slice((safePage - 1) * pageSize, safePage * pageSize);
  const lastRun = await env.DB.prepare('SELECT * FROM scan_runs ORDER BY started_at DESC LIMIT 1').first<Record<string, any>>();
  const rate = await env.DB.prepare('SELECT * FROM rate_limit_snapshots ORDER BY captured_at DESC LIMIT 1').first<Record<string, any>>();
  return {
    product: 'Sunrise',
    signedInAs: login,
    freshness: { lastScanAt: lastRun?.completed_at ?? lastRun?.started_at ?? null, status: scanStatus(lastRun) },
    rateLimit: rate ? { remaining: rate.remaining, resetAt: rate.reset_at } : null,
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
    items,
    pagination: { page: safePage, pageSize, totalItems, totalPages, hasPrevious: safePage > 1, hasNext: safePage < totalPages },
    settings,
    usingFixtures: env.TEST_GITHUB_FIXTURES === 'true',
  };
}

function rowToItem(row: Record<string, any>): GitHubActionItem {
  return { id: row.id, canonicalSubjectKey: row.canonical_subject_key, priority: row.priority, kind: row.kind, title: row.title, repo: row.repo, url: row.url, updatedAt: row.updated_at, reason: row.reason, suggestedAction: row.suggested_action, evidence: JSON.parse(row.evidence_json || '{}'), source: row.source };
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

async function requireSession(c: any) {
  const session = await getSession(c.env.DB, c.req.header('Cookie') ?? null);
  return session ?? c.redirect('/login');
}

function setupMissing(env: Env) {
  return ['DB', 'GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET', 'OWNER_LOGIN', 'SESSION_SECRET'].filter((key) => !(env as any)[key]);
}

type UserSettings = { inboxPageSize: number };

async function readSettings(db: D1Database): Promise<UserSettings> {
  const row = await db.prepare("SELECT value FROM settings WHERE key = 'inbox_page_size'").first<Record<string, string>>();
  return { inboxPageSize: clampPageSize(Number(row?.value ?? 50)) };
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
  url.searchParams.set('scope', 'read:user user:email notifications repo');
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

function renderInertiaRoot(page: PageObject) {
  const rendered = renderInertiaPage(page);
  return documentHtml(rendered.body, rendered.headerExtra, `<script data-page="app" type="application/json">${serializePage(page)}</script>`);
}

function renderInertiaPage(page: PageObject) {
  const props: any = page.props ?? {};
  switch (page.component) {
    case 'Landing':
      return { body: renderLanding(props), headerExtra: '' };
    case 'Dashboard':
      return { body: renderDashboard(props), headerExtra: renderDashboardHeader(props) };
    case 'Settings':
      return { body: renderSettings(props.settings), headerExtra: renderSettingsHeader(props) };
    case 'Setup':
      return { body: renderSetupGuide(props.setup), headerExtra: '' };
    case 'Runs':
      return { body: renderRuns(props.runs ?? []), headerExtra: '' };
    case 'Design':
      return { body: renderDesignLanguage(), headerExtra: '' };
    default:
      return { body: '<section class="section panel"><h1>Page not found</h1></section>', headerExtra: '' };
  }
}

function renderLanding(props: any) {
  return `
    <section class="hero panel">
    <p class="actions"><a class="button primary" href="${escapeHtml(props.repoUrl ?? 'https://github.com/adewale/sunrise')}">Deploy your own</a> <a class="button ghost" href="/login">Sign in with GitHub</a></p>
    <p class="muted">Single-user, read-only by default, and your snapshots stay in your Cloudflare account.</p></section>
    ${renderSetupGuide(props.setup)}
  `;
}

function renderDashboardHeader(props: any) {
  return `<div class="header-extra"><div><p class="eyebrow">${escapeHtml(props.signedInAs)} · ${props.freshness.status}</p><p class="header-meta">Checked ${escapeHtml(formatDateTime(props.freshness.lastScanAt))}${props.rateLimit ? ` · rate limit ${props.rateLimit.remaining}` : ''}</p></div><div class="header-actions"><a class="button icon-button" href="/settings" aria-label="Settings" title="Settings"><svg class="settings-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 8.25a3.75 3.75 0 1 1 0 7.5 3.75 3.75 0 0 1 0-7.5Zm0-5 1.12 2.35 2.52.36-1.82 1.78.43 2.51L12 9.07l-2.25 1.18.43-2.51-1.82-1.78 2.52-.36L12 3.25Z"/><path d="M4.5 13.2v-2.4l2.1-.75c.18-.56.41-1.1.7-1.6L6.35 6.4l1.7-1.7 2.05.95c.5-.28 1.03-.52 1.6-.7l.75-2.1h2.4l.75 2.1c.56.18 1.1.42 1.6.7l2.05-.95 1.7 1.7-.95 2.05c.28.5.52 1.04.7 1.6l2.1.75v2.4l-2.1.75c-.18.56-.42 1.1-.7 1.6l.95 2.05-1.7 1.7-2.05-.95c-.5.29-1.04.52-1.6.7l-.75 2.1h-2.4l-.75-2.1a8.2 8.2 0 0 1-1.6-.7l-2.05.95-1.7-1.7.95-2.05a8.2 8.2 0 0 1-.7-1.6l-2.1-.75Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg></a><form method="post" action="/refresh"><button class="button primary">Manual refresh</button></form></div></div>`;
}

function renderSettingsHeader(props: any) {
  return `<div class="header-extra"><div><p class="eyebrow">${escapeHtml(props.signedInAs)}</p><strong>Settings</strong><p class="header-meta">Tune your inbox rhythm.</p></div><a class="button ghost" href="/dashboard">Inbox</a></div>`;
}

function renderRuns(runs: any[]) {
  return `<section class="section panel"><p class="eyebrow">Operations</p><h1>Runs</h1><table><thead><tr><th>Started</th><th>Trigger</th><th>Status</th><th>Candidates</th><th>Processed</th><th>Error</th></tr></thead><tbody>${runs.map((r: any) => `<tr><td>${r.started_at}</td><td>${r.trigger}</td><td><span class="badge">${r.status}</span></td><td>${r.candidate_count}</td><td>${r.processed_count ?? 0}</td><td>${escapeHtml(r.error ?? '')}</td></tr>`).join('')}</tbody></table></section>`;
}

function renderDashboard(props: any) {
  return `${props.notice ? `<section class="setup-status ready">${escapeHtml(props.notice.message)}</section>` : ''}
  ${props.usingFixtures ? '<section class="setup-status"><strong>Test fixture mode is enabled.</strong> Dashboard items are sample data, not your live GitHub account. Remove TEST_GITHUB_FIXTURES in Cloudflare to use real GitHub data.</section>' : ''}
  <div class="dashboard-layout"><section class="inbox panel"><div class="item-list inbox-list">${props.items.map((item: GitHubActionItem) => renderItem(item, props.signedInAs)).join('') || '<p class="empty">No GitHub events need your attention right now.</p>'}</div>${renderPagination(props.pagination)}</section><aside class="marginalia" aria-label="Dashboard statistics"><section class="panel stat-card"><p class="eyebrow">Counts</p><div class="stat-list">${renderStat('PRs', props.counts.pullRequests)}${renderStat('Issues', props.counts.issues)}${renderStat('My PRs · own repos', props.counts.myPrsOwnRepos)}${renderStat('My PRs · elsewhere', props.counts.myPrsOtherRepos)}${renderStat('PRs to my repos', props.counts.prsInMyRepos)}</div></section></aside></div>`;
}

function renderPagination(p: any) {
  if (!p || p.totalPages <= 1) return '';
  const prev = p.hasPrevious ? `<a class="button ghost" href="/dashboard?page=${p.page - 1}">Newer</a>` : '<span></span>';
  const next = p.hasNext ? `<a class="button primary" href="/dashboard?page=${p.page + 1}">Older</a>` : '<span></span>';
  return `<nav class="pagination" aria-label="Inbox pagination">${prev}<span class="muted">Page ${p.page} of ${p.totalPages} · ${p.totalItems} events · ${p.pageSize} per page</span>${next}</nav>`;
}

function renderSettings(settings: UserSettings) {
  const options = [25, 50, 100].map((n) => `<option value="${n}"${settings.inboxPageSize === n ? ' selected' : ''}>${n} events</option>`).join('');
  return `<section class="section panel settings-panel"><div class="section-head"><div><p class="eyebrow">Preferences</p><h1>Settings</h1><p class="muted">Keep Sunrise quiet, skimmable, and tuned to how much GitHub you want at once.</p></div></div><form method="post" action="/settings" class="settings-form"><label><span>Inbox page size</span><select name="inboxPageSize">${options}</select></label><p class="muted">Pagination starts after this many events. Default is 50.</p><button class="button primary">Save settings</button></form></section>`;
}

function renderStat(label: string, value: number) {
  return `<p class="stat"><span>${escapeHtml(label)}</span><strong>${value}</strong></p>`;
}

function renderMetric(label: string, value: number) {
  return `<div class="metric panel"><span>${escapeHtml(label)}</span><strong>${value}</strong></div>`;
}

function renderDesignLanguage() {
  const sampleItem: GitHubActionItem = {
    id: 'design-sample',
    canonicalSubjectKey: 'design:sample',
    priority: 'P0',
    kind: 'authored_pr_unverified',
    title: 'Authored PR is green but missing verification evidence',
    repo: 'owner/repo',
    url: '#',
    updatedAt: new Date().toISOString(),
    reason: 'The item row, chips, title, reason, and action copy reuse the dashboard renderer.',
    suggestedAction: 'Add verification summary or run the declared verify command',
    evidence: { checks: 'success', hasVerificationSummary: false },
    source: 'pulls',
  };
  return `<header class="masthead panel"><div><p class="eyebrow">Design language</p><h1>Interface kit</h1><p class="muted">This page is public and reuses the same components as the product UI, so changes to originals update here too.</p></div><a class="button ghost" href="/">Back home</a></header>
  <section class="metrics">${renderMetric('Assigned', 3)}${renderMetric('Mentioned', 7)}${renderMetric('Authored PRs', 12)}${renderMetric('Reviews', 2)}</section>
  <section class="section panel"><div class="section-head"><div><p class="eyebrow">Type</p><h2>Warm, crisp, operational</h2></div><span class="badge">public</span></div><p class="muted">Fraunces gives Sunrise its personality. IBM Plex Sans keeps dense dashboard text readable. IBM Plex Mono marks system labels, chips, code, and table headers.</p><p class="actions"><a class="button primary" href="#">Primary action</a><button class="button ghost">Secondary action</button><button class="button quiet">Quiet action</button></p></section>
  <section class="section panel priority-p0"><div class="section-head"><div><p class="eyebrow">Action item</p><h2>Dashboard row</h2></div><span class="badge">P0</span></div><div class="item-list">${renderItem(sampleItem)}</div></section>
  <section class="section panel"><div class="section-head"><div><p class="eyebrow">Setup pattern</p><h2>First-boot cards</h2></div></div><div class="deploy-card"><div><strong>Start with one-click deploy</strong><p>Cards, copy, buttons, and code styling mirror onboarding.</p></div><a class="button primary" href="#">Deploy to Cloudflare</a></div><div class="config-card"><p><span>Homepage URL</span><code>https://sunrise.example.workers.dev</code></p><p><span>Callback URL</span><code>https://sunrise.example.workers.dev/callback</code></p></div></section>
  <section class="section panel"><div class="section-head"><div><p class="eyebrow">Table</p><h2>Runs table</h2></div></div><table><thead><tr><th>Started</th><th>Trigger</th><th>Status</th><th>Candidates</th></tr></thead><tbody><tr><td>2026-05-01</td><td>manual</td><td><span class="badge">succeeded</span></td><td>18</td></tr></tbody></table></section>`;
}

function renderItem(item: GitHubActionItem, ownerLogin = '') {
  const when = formatInboxTime(item.updatedAt);
  const chips = [itemTypeLabel(item), itemRelationshipLabel(item, ownerLogin), item.repo].filter(Boolean).map((chip) => `<span class="chip">${escapeHtml(chip)}</span>`).join('');
  return `<article class="item"><time class="item-time" datetime="${escapeHtml(item.updatedAt)}"><span>${escapeHtml(when.date)}</span><strong>${escapeHtml(when.time)}</strong></time><div class="item-main"><div class="chips">${chips}</div><a class="item-title" href="${item.url}">${escapeHtml(item.title)}</a><p>${escapeHtml(item.reason)}</p><p class="action">${escapeHtml(item.suggestedAction)}</p></div></article>`;
}

function itemTypeLabel(item: GitHubActionItem) {
  if (isPullRequestItem(item)) return 'Pull request';
  if (isIssueItem(item)) return 'Issue';
  return item.kind.replaceAll('_', ' ');
}

function itemRelationshipLabel(item: GitHubActionItem, ownerLogin = '') {
  if (isAuthoredPrItem(item)) return isOwnRepoItem(item, ownerLogin) ? 'My PR · own repo' : 'My PR · other repo';
  if (item.kind === 'repo_pr') return 'Other person’s PR · my repo';
  if (item.kind === 'review_requested') return 'Review requested';
  if (item.kind === 'maintenance') return 'Created by me';
  return item.source;
}

function formatInboxTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return { date: value, time: '' };
  return {
    date: date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', timeZone: 'UTC' }),
    time: date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }),
  };
}

function formatDateTime(value: string | null) {
  if (!value) return 'not yet';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });
}

function capitalize(value: string) {
  return value ? value[0].toUpperCase() + value.slice(1) : value;
}

function renderSetupGuide(setup: SetupDiagnostics) {
  const deployUrl = 'https://deploy.workers.cloudflare.com/?url=https://github.com/adewale/sunrise&paid=true';
  const dashboardPath = 'Workers & Pages → sunrise → Settings → Variables and Secrets';
  const steps = [
    ['Deploy your own copy', 'Use the Deploy to Cloudflare button. Cloudflare forks the repo, provisions D1 and Queues from wrangler.jsonc, runs the build, and enables deploys from your fork.'],
    ['Create a GitHub OAuth app', `Use Homepage URL ${setup.origin} and Authorization callback URL ${setup.callbackUrl}.`],
    ['Add secrets in Cloudflare', `Open ${dashboardPath}. Set GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET, OWNER_LOGIN, and SESSION_SECRET.`],
    ['Reload this page', 'The checklist verifies this instance configuration against Cloudflare, D1, Queues, and GitHub where possible.'],
    ['Sign in and refresh', 'Sign in as the configured owner, then use Manual refresh to populate the first dashboard snapshot.'],
  ];
  const status = setup.ready ? '<p class="setup-status ready">Configuration looks ready. Sign in to scan GitHub.</p>' : '<p class="setup-status">Setup needs attention. Fix failing checks below, then reload.</p>';
  return `<section class="panel setup"><div class="section-head"><div><p class="eyebrow">First boot</p><h2>Setup checklist</h2></div><span class="badge">${setup.ready ? 'ready' : 'action needed'}</span></div>${status}${renderSetupChecks(setup.checks)}<div class="deploy-card"><div><strong>Start with one-click deploy</strong><p>Best for most users: no local CLI required for the first deployment.</p></div><a class="button primary" href="${deployUrl}">Deploy to Cloudflare</a></div><div class="config-card"><p><span>Homepage URL</span><code>${escapeHtml(setup.origin)}</code></p><p><span>Callback URL</span><code>${escapeHtml(setup.callbackUrl)}</code></p></div><ol class="setup-steps">${steps.map(([title, copy], index) => `<li><span class="step-number">${index + 1}</span><div><strong>${escapeHtml(title)}</strong><p>${escapeHtml(copy)}</p></div></li>`).join('')}</ol><p class="muted">Sunrise should never ask users to send tokens to a hosted service. OAuth secrets and GitHub data stay in the deployer’s Cloudflare account.</p></section>`;
}

function renderSetupChecks(checks: SetupCheck[]) {
  return `<div class="setup-checks">${checks.map((check) => `<article class="setup-check ${check.status}"><span class="check-dot">${check.status === 'pass' ? '✓' : check.status === 'warn' ? '!' : '×'}</span><div><strong>${escapeHtml(check.label)}</strong><p>${escapeHtml(check.message)}</p>${check.fix ? `<p class="fix">${escapeHtml(check.fix)}</p>` : ''}</div></article>`).join('')}</div>`;
}

function html(body: string, status = 200, headerExtra = '') {
  return new Response(documentHtml(body, headerExtra), { status, headers: { 'content-type': 'text/html; charset=utf-8' } });
}

function documentHtml(body: string, headerExtra = '', afterMain = '') {
  return `<!doctype html><html><head><title>Sunrise</title><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="icon" type="image/svg+xml" href="/favicon.svg"><link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght,SOFT,WONK@9..144,600..900,60,1&family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@500;600&display=swap" rel="stylesheet"><script>${themeScript()}</script><style>${designCss()}</style></head><body><a class="skip-link" href="#content">Skip to content</a><header class="site-header"><a class="brand" href="/">${renderBrandMark()}<span>Sunrise</span></a>${headerExtra}<button class="theme-toggle" type="button" aria-label="Toggle dark mode" aria-pressed="false" title="Toggle dark mode"><span class="sun-icon" aria-hidden="true"></span><span class="moon-icon" aria-hidden="true"></span></button></header><main id="content">${body}</main>${afterMain}</body></html>`;
}

function renderFaviconSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-hidden="true"><title>Sunrise favicon</title><style>:root{color-scheme:light dark}.sky{fill:#fff4dc}.tray{fill:#fffaf0;stroke:#7b5a34;stroke-width:3}.sun{fill:#ffb23f}.ray{stroke:#c97814;stroke-width:3;stroke-linecap:round}.line{stroke:#7b5a34;stroke-width:3;stroke-linecap:round}.moon{fill:none;stroke:#7b5a34;stroke-width:3;opacity:.28}@media (prefers-color-scheme: dark){.sky{fill:#101824}.tray{fill:#172230;stroke:#dbe8fb}.sun{fill:none;stroke:#dbe8fb;stroke-width:3;opacity:.28}.ray{stroke:#dbe8fb;opacity:.22}.line{stroke:#dbe8fb}.moon{opacity:1;stroke:#dbe8fb;fill:#dbe8fb}}</style>${brandMarkSvgContent()}</svg>`;
}

function renderBrandMark() {
  return `<svg class="brand-mark" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" aria-hidden="true">${brandMarkSvgContent()}</svg>`;
}

function brandMarkSvgContent() {
  return `<rect class="sky" width="64" height="64" rx="16"/><path class="tray" d="M12 38h40l-4 12H16z"/><path class="line" d="M20 44h24"/><circle class="sun" cx="28" cy="31" r="11"/><path class="ray" d="M28 12v5M12 31h5M39 20l4-4M17 20l-4-4"/><path class="moon" d="M45 18a10 10 0 1 0 0 20 12 12 0 0 1 0-20z"/>`;
}

function themeScript() {
  return `(function(){var key='sunrise-theme';var saved=localStorage.getItem(key);var theme=saved||((matchMedia&&matchMedia('(prefers-color-scheme: dark)').matches)?'dark':'light');var h=new Date().getHours();document.documentElement.dataset.daypart=h<6?'night':h<11?'morning':h<17?'day':h<21?'evening':'night';function apply(t,animate){var root=document.documentElement;if(animate){root.classList.add('theme-changing',t==='dark'?'theme-to-dark':'theme-to-light');clearTimeout(window.__sunriseThemeTimer);window.__sunriseThemeTimer=setTimeout(function(){root.classList.remove('theme-changing','theme-to-dark','theme-to-light');},1500);}root.dataset.theme=t;var b=document.querySelector('.theme-toggle');if(b)b.setAttribute('aria-pressed',String(t==='dark'));}document.documentElement.dataset.theme=theme;addEventListener('DOMContentLoaded',function(){apply(theme,false);var b=document.querySelector('.theme-toggle');if(!b)return;b.addEventListener('click',function(){var next=document.documentElement.dataset.theme==='dark'?'light':'dark';apply(next,true);localStorage.setItem(key,next);});});})();`;
}

function designCss() {
  return `:root{color-scheme:light;--bg:#f8f1df;--bg-wash:radial-gradient(circle at 20% -10%,rgba(255,178,63,.35),transparent 34rem),radial-gradient(circle at 90% 10%,rgba(223,111,89,.16),transparent 30rem),linear-gradient(180deg,#fbf4e5,#f7edd9 58%,#f4e7cf);--surface:#fffaf0;--surface-2:#fffbf3;--surface-3:#f5e6c9;--ink:#24180d;--muted:#7b6d5f;--accent:#ffb23f;--accent-ink:#24180d;--line:rgba(85,55,21,.22);--line-strong:rgba(85,55,21,.30);--focus:rgba(255,178,63,.85);--shadow:0 1px 0 rgba(255,255,255,.65) inset,0 1px 2px rgba(61,37,13,.08),0 10px 24px rgba(61,37,13,.10);--button-shadow:0 1px 0 rgba(255,255,255,.55) inset,0 1px 2px rgba(61,37,13,.08);--radius:12px;--inner:8px;--gap:16px;--font-body:"IBM Plex Sans",ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;--font-display:"Fraunces",Georgia,serif;--font-mono:"IBM Plex Mono",ui-monospace,monospace}html[data-theme=dark]{color-scheme:dark;--bg:#0c1118;--bg-wash:radial-gradient(circle at 18% -10%,rgba(83,109,151,.20),transparent 34rem),radial-gradient(circle at 92% 8%,rgba(92,72,126,.16),transparent 30rem),linear-gradient(180deg,#0f1620,#0b1017 58%,#080c12);--surface:#162130;--surface-2:#172230;--surface-3:#223144;--ink:#f3efe7;--muted:#9da8b4;--accent:#adc4e6;--accent-ink:#06101c;--line:rgba(222,232,245,.18);--line-strong:rgba(222,232,245,.30);--focus:rgba(159,182,216,.82);--shadow:0 1px 0 rgba(255,255,255,.07) inset,0 1px 2px rgba(0,0,0,.50),0 18px 38px rgba(0,0,0,.42);--button-shadow:0 1px 0 rgba(255,255,255,.10) inset,0 -1px 0 rgba(0,0,0,.35) inset,0 2px 3px rgba(0,0,0,.35),0 10px 18px rgba(0,0,0,.20)}*{box-sizing:border-box}html{min-height:100%;background:var(--bg)}body{min-height:100%;margin:0;color:var(--ink);font-family:var(--font-body);-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility;background:var(--bg-wash);transition:background-color 1.35s cubic-bezier(.2,0,0,1),color 1.1s cubic-bezier(.2,0,0,1)}html:not([data-theme=dark])[data-daypart=morning]{--bg-wash:radial-gradient(circle at 18% -12%,rgba(255,194,104,.42),transparent 34rem),radial-gradient(circle at 82% 4%,rgba(255,142,112,.18),transparent 30rem),linear-gradient(180deg,#fbf4e5,#f7edd9 58%,#f4e7cf)}html:not([data-theme=dark])[data-daypart=day]{--bg-wash:radial-gradient(circle at 18% -12%,rgba(255,211,128,.28),transparent 34rem),radial-gradient(circle at 92% 10%,rgba(156,190,210,.16),transparent 30rem),linear-gradient(180deg,#fbf4e5,#f7edd9 58%,#f4e7cf)}html:not([data-theme=dark])[data-daypart=evening]{--bg-wash:radial-gradient(circle at 20% -10%,rgba(255,166,79,.30),transparent 34rem),radial-gradient(circle at 88% 8%,rgba(173,112,161,.16),transparent 30rem),linear-gradient(180deg,#fbf0df,#f7ead7 58%,#f2dfc8)}body:before{content:"";position:fixed;inset:0;pointer-events:none;opacity:.22;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140' viewBox='0 0 140 140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.8' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='140' height='140' filter='url(%23n)' opacity='.22'/%3E%3C/svg%3E");mix-blend-mode:multiply}html[data-theme=dark] body:before{opacity:.13;mix-blend-mode:screen}body:after{content:"";position:fixed;inset:0;z-index:10;pointer-events:none;background:#0b1017;opacity:0;transition:none}html.theme-to-dark body:after{animation:theme-dim 1.45s cubic-bezier(.2,0,0,1)}html.theme-to-light body:after{background:#f8f1df;animation:theme-lift 1.35s cubic-bezier(.2,0,0,1)}@keyframes theme-dim{0%{opacity:0}45%{opacity:.07}100%{opacity:0}}@keyframes theme-lift{0%{opacity:0}45%{opacity:.035}100%{opacity:0}}
.site-header{position:fixed;z-index:19;top:0;left:0;right:0;display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:20px;align-items:center;min-height:62px;min-width:0;padding:10px 14px;border:1px solid var(--line);border-radius:0 0 var(--radius) var(--radius);background:color-mix(in srgb,var(--surface) 88%,transparent);box-shadow:var(--shadow);backdrop-filter:blur(14px)}.brand{display:inline-flex;align-items:center;gap:10px;max-width:100%;padding:.08em 0 .12em;overflow:visible;white-space:nowrap;font-family:var(--font-display);font-size:34px;font-weight:850;font-variation-settings:"SOFT" 60,"WONK" 1;letter-spacing:-.06em;line-height:1.12;color:var(--ink);text-decoration:none;text-shadow:0 1px 0 rgba(255,255,255,.28);transition:color .42s cubic-bezier(.2,0,0,1),transform .18s ease}.brand-mark{width:38px;height:38px;flex:0 0 auto;filter:drop-shadow(0 1px 1px rgba(61,37,13,.12))}.brand-mark .sky{fill:#fff4dc}.brand-mark .tray{fill:#fffaf0;stroke:#7b5a34;stroke-width:3}.brand-mark .sun{fill:#ffb23f}.brand-mark .ray{stroke:#c97814;stroke-width:3;stroke-linecap:round}.brand-mark .line{stroke:#7b5a34;stroke-width:3;stroke-linecap:round}.brand-mark .moon{fill:none;stroke:#7b5a34;stroke-width:3;opacity:.28}html[data-theme=dark] .brand-mark .sky{fill:#101824}html[data-theme=dark] .brand-mark .tray{fill:#172230;stroke:#dbe8fb}html[data-theme=dark] .brand-mark .sun{fill:none;stroke:#dbe8fb;stroke-width:3;opacity:.28}html[data-theme=dark] .brand-mark .ray{stroke:#dbe8fb;opacity:.22}html[data-theme=dark] .brand-mark .line{stroke:#dbe8fb}html[data-theme=dark] .brand-mark .moon{opacity:1;stroke:#dbe8fb;fill:#dbe8fb}.brand:hover{transform:translateY(-1px)}.header-extra{min-width:0;display:flex;align-items:center;justify-content:space-between;gap:14px}.header-actions{display:flex;gap:10px;align-items:center;flex-wrap:wrap}.header-extra strong{display:block;font-family:var(--font-display);font-size:28px;letter-spacing:-.04em;line-height:1}.header-extra .eyebrow{margin:0 0 4px}.header-meta{margin:3px 0 0;color:var(--muted);font-size:13px;line-height:1.25;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}html[data-theme=dark] .brand{text-shadow:0 1px 0 rgba(255,255,255,.06)}main{width:min(1120px,calc(100% - 32px));margin:96px auto 72px;display:grid;grid-template-columns:repeat(12,minmax(0,1fr));gap:var(--gap);align-items:start}main>*{grid-column:1/-1;min-width:0}.panel{position:relative;min-width:0;border:1px solid var(--line);border-radius:var(--radius);background:var(--surface);box-shadow:var(--shadow);transition:background .95s cubic-bezier(.2,0,0,1),border-color .95s cubic-bezier(.2,0,0,1),box-shadow .95s cubic-bezier(.2,0,0,1)}.panel>*{position:relative;z-index:1}.panel:after{content:"";position:absolute;inset:0;border-radius:calc(var(--radius) - 1px);pointer-events:none;border-top:1px solid rgba(255,255,255,.42)}html[data-theme=dark] .panel:after{border-top-color:rgba(255,255,255,.095)}.hero{padding:72px;overflow:hidden}.section,.setup,.masthead{padding:24px}.masthead{display:flex;justify-content:space-between;gap:12px;align-items:center;flex-wrap:wrap;min-width:0}.masthead h1{font-size:52px;margin:0 0 8px}.section-head{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:16px;align-items:start;margin-bottom:18px}
.skip-link{position:fixed;left:16px;top:12px;z-index:30;transform:translateY(-160%);background:var(--ink);color:var(--surface);padding:10px 12px;border-radius:8px}.skip-link:focus{transform:none}.theme-toggle{position:relative;z-index:20;width:96px;height:56px;flex:0 0 auto;padding:0;border:1px solid var(--line-strong);border-radius:999px;background:linear-gradient(90deg,color-mix(in srgb,var(--accent) 26%,var(--surface-3)),var(--surface-3));box-shadow:var(--button-shadow);cursor:pointer;transition:transform .22s cubic-bezier(.2,0,0,1),background .72s cubic-bezier(.2,0,0,1),box-shadow .72s cubic-bezier(.2,0,0,1)}.theme-toggle:hover{transform:translateY(-1px)}.theme-toggle:active{transform:scale(.98)}.sun-icon,.moon-icon{position:absolute;top:10px;width:34px;height:34px;border-radius:999px;transition:opacity .9s cubic-bezier(.2,0,0,1),transform 1.25s cubic-bezier(.2,0,0,1),filter .9s cubic-bezier(.2,0,0,1),box-shadow 1.25s cubic-bezier(.2,0,0,1),background 1.25s cubic-bezier(.2,0,0,1),border-color 1.25s cubic-bezier(.2,0,0,1)}.sun-icon{left:10px;background:radial-gradient(circle,#ffe2ad 0 34%,#ffb23f 68%,#f29a27 100%);border:1px solid color-mix(in srgb,var(--accent) 72%,var(--line));box-shadow:0 1px 2px rgba(61,37,13,.16),0 0 0 7px color-mix(in srgb,var(--accent) 14%,transparent);opacity:1;transform:scale(1);filter:blur(0)}.moon-icon{right:10px;background:transparent;border:1.5px solid color-mix(in srgb,var(--muted) 42%,transparent);box-shadow:inset 10px 0 0 -4px color-mix(in srgb,var(--muted) 38%,transparent);opacity:.34;transform:scale(.86) rotate(-12deg);filter:blur(.15px)}.moon-icon:after{content:"";position:absolute;left:22px;top:7px;width:3px;height:3px;border-radius:999px;background:currentColor;color:color-mix(in srgb,var(--muted) 38%,transparent);box-shadow:5px 9px 0 1px currentColor,-2px 18px 0 0 currentColor;pointer-events:none}html[data-theme=dark] .theme-toggle{background:linear-gradient(90deg,var(--surface-3),color-mix(in srgb,var(--accent) 22%,var(--surface-3)));box-shadow:var(--button-shadow),inset 0 0 18px rgba(173,196,230,.08)}html[data-theme=dark] .sun-icon{opacity:.30;transform:scale(.86) rotate(16deg);background:transparent;border-color:color-mix(in srgb,var(--muted) 38%,transparent);box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--muted) 22%,transparent);filter:blur(.15px)}html[data-theme=dark] .moon-icon{opacity:1;transform:scale(1) rotate(-18deg);background:transparent;border-color:transparent;box-shadow:14px 0 0 0 #dbe8fb,17px 0 18px rgba(151,185,255,.22);filter:blur(0)}html.theme-changing .sun-icon,html.theme-changing .moon-icon{transition-duration:1.35s}
h1,h2,p{margin-block-start:0}h1,h2{text-wrap:balance;font-family:var(--font-display);font-variation-settings:"SOFT" 60,"WONK" 1}h1{font-size:clamp(58px,10vw,128px);font-weight:850;letter-spacing:-.07em;line-height:.82;margin-bottom:24px}h2{font-size:28px;font-weight:760;letter-spacing:-.04em;line-height:.95;margin-bottom:0}.muted,.empty{color:var(--muted);line-height:1.55;text-wrap:pretty}.eyebrow{font-family:var(--font-mono);font-size:11px;font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:color-mix(in srgb,var(--accent) 72%,var(--ink));margin-bottom:14px}.actions{display:flex;gap:12px;align-items:center;flex-wrap:wrap;min-width:0}.button{min-height:40px;display:inline-flex;align-items:center;justify-content:center;border:1px solid var(--line-strong);border-radius:8px;padding:0 16px;font:inherit;font-weight:700;letter-spacing:-.01em;text-decoration:none;color:var(--ink);background:var(--surface-2);box-shadow:var(--button-shadow);transition:transform .16s ease,box-shadow .16s ease,background .16s ease,border-color .16s ease}.icon-button{width:40px;padding:0}.settings-icon{width:20px;height:20px;display:block}.settings-icon path:first-child{display:none}.button:hover{transform:translateY(-1px);border-color:var(--line-strong)}.button:active{transform:scale(.96)}.primary{background:var(--accent);color:var(--accent-ink);border-color:color-mix(in srgb,var(--accent) 55%,var(--line-strong))}.ghost,.quiet{background:var(--surface-2)}.quiet{color:var(--muted)}:focus-visible{outline:3px solid var(--focus);outline-offset:3px}
.metrics{display:grid;grid-template-columns:repeat(12,minmax(0,1fr));gap:12px;margin:0}.metric{grid-column:span 3;min-width:0;padding:18px;border-radius:10px}.metric span{display:block;color:var(--muted);font-size:13px;font-weight:600}.metric strong{font-family:var(--font-display);font-variant-numeric:tabular-nums;font-size:38px;font-weight:780;letter-spacing:-.055em}.dashboard-layout{grid-column:1/-1;display:grid;grid-template-columns:minmax(0,8fr) minmax(220px,3fr);gap:var(--gap);align-items:start}.inbox{min-width:0;overflow:hidden}.marginalia{display:grid;gap:var(--gap);position:sticky;top:116px;min-width:0}.stat-card{padding:16px}.stat-list{display:grid;gap:0}.stat{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:12px;margin:0;padding:10px 0;border-top:1px solid var(--line);align-items:baseline}.stat:first-child{border-top:0}.stat span{color:var(--muted);font-size:13px;font-weight:600}.stat strong{font-family:var(--font-display);font-variant-numeric:tabular-nums;font-size:32px;font-weight:780;letter-spacing:-.055em}.item-list{display:grid;gap:10px}.pagination{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:12px;align-items:center;padding:12px 10px 14px;border-top:1px solid var(--line)}.pagination .muted{text-align:center;margin:0}.settings-form{display:grid;gap:14px;max-width:520px}.settings-form label{display:grid;gap:7px;font-weight:700}.settings-form select{min-height:42px;border:1px solid var(--line-strong);border-radius:8px;background:var(--surface-2);color:var(--ink);font:inherit;padding:0 12px}.item-list{display:grid;gap:10px}.item,.deploy-card,.setup-steps li{background:var(--surface-2);border:1px solid var(--line);border-radius:var(--inner);box-shadow:0 1px 0 rgba(255,255,255,.22) inset,0 1px 2px rgba(0,0,0,.06)}.inbox-list{padding:10px}.item{display:grid;grid-template-columns:96px minmax(0,1fr);gap:18px;align-items:start;padding:14px 16px;transition:background-color .42s cubic-bezier(.2,0,0,1),border-color .42s cubic-bezier(.2,0,0,1),box-shadow .42s cubic-bezier(.2,0,0,1)}.item-time{padding-top:2px;color:var(--muted);font-family:var(--font-mono);font-size:11px;font-weight:600;letter-spacing:-.03em;text-align:right;text-decoration:none;font-variant-numeric:tabular-nums}.item-time span,.item-time strong{display:block}.item-time strong{margin-top:3px;color:color-mix(in srgb,var(--ink) 70%,var(--muted));font-size:13px}.item-main{min-width:0}.item-title{display:block;margin:7px 0 5px;color:var(--ink);font-size:18px;font-weight:700;letter-spacing:-.025em;line-height:1.12;text-decoration:none}.item-title:hover{text-decoration:underline;text-decoration-thickness:2px;text-underline-offset:3px}.item p{margin-bottom:5px;color:var(--muted);line-height:1.35}.item .action{color:var(--ink);font-weight:700}.chips{display:flex;gap:6px;flex-wrap:wrap}.chip,.badge{display:inline-flex;align-items:center;min-height:24px;padding:0 9px;border-radius:6px;background:var(--surface-3);border:1px solid var(--line);color:color-mix(in srgb,var(--accent) 45%,var(--ink));font-family:var(--font-mono);font-size:11px;font-weight:600;letter-spacing:-.02em}.priority-p0{border-color:color-mix(in srgb,#df6f59 28%,var(--line))}.priority-p1{border-color:color-mix(in srgb,var(--accent) 32%,var(--line))}.priority-p2{border-color:color-mix(in srgb,#5f8f6a 24%,var(--line))}
.setup-status,.config-card{border:1px solid var(--line);border-radius:var(--inner);background:var(--surface-2);padding:12px;color:var(--ink)}.setup-status.ready{color:#315d38}html[data-theme=dark] .setup-status.ready{color:#add6b5}.setup-checks{display:grid;gap:8px;margin:12px 0}.setup-check{display:grid;grid-template-columns:28px minmax(0,1fr);gap:10px;padding:12px;border:1px solid var(--line);border-radius:var(--inner);background:var(--surface-2)}.setup-check p{margin:3px 0 0;color:var(--muted);line-height:1.35}.setup-check .fix{color:var(--ink);font-weight:600}.check-dot{display:grid;place-items:center;width:24px;height:24px;border-radius:999px;background:var(--surface-3);font-family:var(--font-mono);font-size:13px;font-weight:600}.setup-check.pass .check-dot{background:#d8ead4;color:#315d38}.setup-check.warn .check-dot{background:#f7dfad;color:#6b4b26}.setup-check.fail .check-dot{background:#f3c7bd;color:#7b2d21}html[data-theme=dark] .setup-check.pass .check-dot{background:#244633;color:#add6b5}html[data-theme=dark] .setup-check.warn .check-dot{background:#4c3b1f;color:#e1cfa8}html[data-theme=dark] .setup-check.fail .check-dot{background:#4a2525;color:#f0b2a7}.deploy-card,.config-card{display:grid;grid-template-columns:minmax(0,1fr) auto;justify-content:space-between;gap:16px;align-items:center;margin-top:12px;padding:14px}.deploy-card p{margin:4px 0 0;color:var(--muted)}.config-card{grid-template-columns:1fr;align-items:stretch}.config-card p{display:grid;grid-template-columns:minmax(140px,auto) minmax(0,1fr);gap:12px;margin:0;color:var(--muted)}.config-card code{display:block;min-width:0;overflow:auto;white-space:nowrap}.setup-steps{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;padding:0;margin:16px 0 0;list-style:none}.setup-steps li{display:grid;grid-template-columns:28px minmax(0,1fr);gap:12px;padding:14px}.setup-steps p{margin:4px 0 0;color:var(--muted);text-wrap:pretty}.step-number{height:28px;display:grid;place-items:center;border-radius:7px;background:var(--accent);color:var(--accent-ink);font-family:var(--font-mono);font-weight:600;font-variant-numeric:tabular-nums}code{font-family:var(--font-mono);font-size:.92em;padding:2px 5px;border:1px solid var(--line);border-radius:5px;background:color-mix(in srgb,var(--surface-2) 70%,white)}html[data-theme=dark] code{background:rgba(255,255,255,.075)}table{width:100%;min-width:640px;border-collapse:separate;border-spacing:0 8px}th{text-align:left;color:var(--muted);font-family:var(--font-mono);font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.08em}td,th{padding:10px 12px}td{background:var(--surface-2);border-block:1px solid var(--line)}td:first-child{border-left:1px solid var(--line);border-radius:8px 0 0 8px}td:last-child{border-right:1px solid var(--line);border-radius:0 8px 8px 0}
@media(prefers-reduced-motion:reduce){*,*:before,*:after{transition:none!important;animation:none!important;scroll-behavior:auto!important}}@media(max-width:900px){.metric{grid-column:span 6}.dashboard-layout{grid-template-columns:1fr}.marginalia{position:static;grid-row:1;grid-template-columns:repeat(2,minmax(0,1fr))}.setup-steps{grid-template-columns:1fr}}@media(max-width:760px){main{width:min(100% - 20px,1120px);margin-top:12px;grid-template-columns:repeat(6,minmax(0,1fr));gap:12px}.site-header{position:sticky;top:0;left:0;right:auto;width:100%;min-height:56px;grid-template-columns:minmax(0,1fr) auto;grid-template-areas:"brand toggle" "extra toggle";padding:8px 10px 8px 12px;gap:6px 10px;border-radius:0;border-top:0;border-left:0;border-right:0}.brand{font-size:30px;grid-area:brand}.header-extra{grid-area:extra;align-items:center}.header-extra strong{font-size:22px}.header-extra form{display:block;flex:0 0 auto}.header-extra .button{min-height:34px;padding:0 10px;font-size:13px}.theme-toggle{grid-area:toggle;width:88px;height:44px;align-self:center}.theme-toggle .sun-icon,.theme-toggle .moon-icon{top:7px;width:28px;height:28px}.theme-toggle .sun-icon{left:8px}.theme-toggle .moon-icon{right:8px}.hero{padding:36px 24px}.metric{grid-column:span 3}.item{grid-template-columns:76px minmax(0,1fr);gap:12px}.item form{grid-column:2}.item-time{text-align:left}.masthead,.deploy-card{grid-template-columns:1fr;align-items:stretch}.section-head,.config-card p{grid-template-columns:1fr}.config-card p{gap:4px}table{min-width:560px}h1{font-size:64px}}@media(max-width:440px){.metric{grid-column:1/-1}.marginalia{grid-template-columns:1fr}.actions .button{width:100%}.hero,.section,.setup,.masthead{padding:20px}.item{grid-template-columns:64px minmax(0,1fr);padding:14px 12px}.item-time{font-size:10px}.item-time strong{font-size:12px}h1{font-size:54px}}`;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

export default app;
