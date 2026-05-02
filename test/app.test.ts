import { afterEach, describe, expect, it, vi } from 'vitest';
import app from '../src/app';
import type { Env } from '../src/env';
import { createMemoryDb } from './memory-db';

describe('Sunrise app routes', () => {
  afterEach(() => vi.restoreAllMocks());
  const queue = { send: vi.fn(async () => undefined) } as unknown as Queue;
  it('renders public landing with deploy CTA, setup checklist, and branded favicon', async () => {
    const env = { DB: createMemoryDb(), GITHUB_CLIENT_ID: '', OWNER_LOGIN: 'ade', SESSION_SECRET: 'x' } as unknown as Env;
    const res = await app.request('/', {}, env);
    const html = await res.text();
    expect(html).toContain('Sunrise');
    expect(html).toContain('Deploy your own');
    expect(html).toContain('Setup checklist');
    expect(html).toContain('<link rel="icon" type="image/svg+xml" href="/favicon.svg">');
    expect(html).toContain('/raw/main/docs/assets/screenshots/dashboard.png');
    expect(html).toContain('/assets/sunrise-inertia-client.js');
  });

  it('can render a project landing page without personal setup claims', async () => {
    const env = { DB: createMemoryDb(), PROJECT_LANDING: 'true', GITHUB_REPO_URL: 'https://github.com/adewale/sunrise' } as unknown as Env;
    const res = await app.request('/', {}, env);
    const html = await res.text();
    expect(html).toContain('Deploy your own');
    expect(html).toContain('/raw/main/docs/assets/screenshots/dashboard.png');
    expect(html).not.toContain('Setup needs attention');
    expect(html).not.toContain('Sign in with GitHub');
  });

  it('serves a progressive Inertia client bundle', async () => {
    const res = await app.request('/assets/sunrise-inertia-client.js', {}, { DB: createMemoryDb() } as unknown as Env);
    const js = await res.text();
    expect(res.headers.get('content-type')).toContain('text/javascript');
    expect(js).toContain("X-Inertia");
    expect(js).toContain('history.pushState');
  });

  it('serves a sunrise inbox favicon with light and dark variants', async () => {
    const res = await app.request('/favicon.svg', {}, { DB: createMemoryDb() } as unknown as Env);
    const svg = await res.text();
    expect(res.headers.get('content-type')).toContain('image/svg+xml');
    expect(svg).toContain('<title>Sunrise favicon</title>');
    expect(svg).toContain('prefers-color-scheme: dark');
    expect(svg).toContain('aria-hidden');
  });

  it('renders dashboard as an inbox with marginal stats', async () => {
    const db = createMemoryDb();
    await db.prepare("INSERT INTO sessions (id, github_login, github_id, access_token, expires_at, created_at) VALUES ('sid','ade','1','tok','2999-01-01T00:00:00Z','2026-01-01T00:00:00Z')").run();
    await db.prepare('INSERT INTO scan_runs (id, trigger, status, started_at, candidate_count, processed_count) VALUES (?, ?, ?, ?, 0, 0)')
      .bind('run1', 'manual', 'succeeded', '2026-04-30T00:00:00Z', 0, 0).run();
    await db.prepare('UPDATE scan_runs SET status = ?, completed_at = ?, candidate_count = ? WHERE id = ?').bind('succeeded', '2026-04-30T00:00:00Z', 3, 'run1').run();
    await db.prepare('INSERT INTO action_items (id, canonical_subject_key, kind, title, repo, url, updated_at, reason, suggested_action, evidence_json, source, ignored_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)')
      .bind('i1', 'k1', 'review_requested', 'Review the launch PR', 'o/r', 'https://github.com/o/r/pull/1', '2026-04-30T00:00:00Z', 'You were requested for review.', 'Review PR', '{}', 'notifications').run();
    await db.prepare('INSERT INTO action_items (id, canonical_subject_key, kind, title, repo, url, updated_at, reason, suggested_action, evidence_json, source, ignored_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)')
      .bind('i2', 'k2', 'authored_pr_pending', 'My PR to another repo', 'someone/project', 'https://github.com/someone/project/pull/2', '2026-04-29T00:00:00Z', 'Your authored PR is waiting on pending checks or review.', 'Nudge reviewers or update PR', '{"isOwnRepo":false,"isAuthored":true}', 'search').run();
    await db.prepare('INSERT INTO action_items (id, canonical_subject_key, kind, title, repo, url, updated_at, reason, suggested_action, evidence_json, source, ignored_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)')
      .bind('i3', 'k3', 'repo_pr', 'External PR to my repo', 'ade/r', 'https://github.com/ade/r/pull/8', '2026-04-28T00:00:00Z', 'An open PR targets one of your repositories.', 'Review or triage this PR', '{"isOwnRepo":true,"isAuthored":false}', 'search').run();
    await db.prepare('INSERT INTO action_items (id, canonical_subject_key, kind, title, repo, url, updated_at, reason, suggested_action, evidence_json, source, ignored_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)')
      .bind('i4', 'k4', 'invitation', 'Repository invitation', 'ade/new', 'https://github.com/ade/new', '2026-04-27T00:00:00Z', 'A repository invitation is pending.', 'Accept or decline invitation', '{}', 'search').run();
    await db.prepare('INSERT INTO action_items (id, canonical_subject_key, kind, title, repo, url, updated_at, reason, suggested_action, evidence_json, source, ignored_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)')
      .bind('i5', 'k5', 'maintenance', 'My open issue', 'ade/r', 'https://github.com/ade/r/issues/9', '2026-04-26T00:00:00Z', 'A thread you opened has activity or needs closure.', 'Respond, close, or archive this loop', '{"isAuthored":true}', 'issues').run();
    const res = await app.request('/dashboard', { headers: { Cookie: 'sunrise_session=sid' } }, { DB: db, OWNER_LOGIN: 'ade' } as unknown as Env);
    const html = await res.text();
    expect(html).toContain('class="dashboard-layout"');
    expect(html).toContain('class="inbox panel"');
    expect(html).toContain('class="brand-mark"');
    expect(html).not.toContain('<strong>Inbox</strong>');
    expect(html).not.toContain('GitHub inbox');
    expect(html).not.toContain('<strong>Dashboard</strong>');
        expect(html).toContain('class="marginalia"');
    expect(html).toContain('Review the launch PR');
    expect(html).toContain('class="item-time"');
    expect(html.indexOf('class="item-time"')).toBeLessThan(html.indexOf('Review the launch PR'));
    expect(html).toContain('Review requested');
    expect(html).toContain('My PR · other repo');
    expect(html).toContain('Other person’s PR · my repo');
    expect(html).toContain('Checked');
    expect(html).toContain('30 Apr 2026, 00:00');
    expect(html).toContain('class="settings-icon"');
    expect(html).not.toContain('Inbox settings');
    expect(html).not.toContain('<p class="eyebrow">Freshness</p>');
    expect(html).not.toContain('Last scan 2026-04-30T00:00:00Z');
    expect(html).toContain('Unresolved on GitHub');
    expect(html).toContain('href="https://github.com/pulls/review-requested" target="_blank" rel="noreferrer"');
    expect(html).toContain('Open PRs in my repos');
    expect(html).toContain('q=is%3Apr+is%3Aopen+user%3Aade+archived%3Afalse');
    expect(html).toContain('My open PRs');
    expect(html).toContain('My open issues');
    expect(html).toContain('q=is%3Aissue+is%3Aopen+author%3Aade+archived%3Afalse');
    expect(html).toContain('href="https://github.com/settings/repositories" target="_blank" rel="noreferrer"');
    expect(html).not.toContain('href="https://github.com/notifications" target="_blank" rel="noreferrer"');
    expect(html).toContain('↗');
    expect(html).toContain('<span>PRs</span><strong>3</strong>');
    expect(html).toContain('<span>Issues</span><strong>1</strong>');
    expect(html).toContain('<span>My PRs · elsewhere</span><strong>1</strong>');
    expect(html).toContain('<span>PRs to my repos</span><strong>1</strong>');
    expect(html).toContain('@media(max-width:760px){main{width:min(100% - 20px,1120px);margin-top:12px');
    expect(html).toContain('<header class="site-header"><a class="brand" href="/"><svg class="brand-mark"');
    expect(html).toContain('<button class="theme-toggle"');
    expect(html.indexOf('<button class="theme-toggle"')).toBeLessThan(html.indexOf('</header>'));
    expect(html).toContain('html:not([data-theme=dark])[data-daypart=morning]');
    expect(html).toContain('.site-header{position:fixed;z-index:19;top:0;left:0;right:0');
    expect(html).toContain('border-radius:0 0 var(--radius) var(--radius)');
    expect(html).toContain('.site-header{position:sticky;top:0;left:0;right:auto;width:100%');
    expect(html).toContain('.header-extra form{display:block;flex:0 0 auto}');
    expect(html).toContain('.sun-icon{left:10px');
    expect(html).toContain('.moon-icon{right:10px');
    expect(html).toContain('Manual refresh');
    expect(html).not.toContain('Ignore</button>');
    expect(html).not.toContain('Recent signal');
  });

  it('serves dashboard through the Inertia protocol without changing the HTML view', async () => {
    const db = createMemoryDb();
    await db.prepare("INSERT INTO sessions (id, github_login, github_id, access_token, expires_at, created_at) VALUES ('sid','ade','1','tok','2999-01-01T00:00:00Z','2026-01-01T00:00:00Z')").run();
    await db.prepare('INSERT INTO action_items (id, canonical_subject_key, kind, title, repo, url, updated_at, reason, suggested_action, evidence_json, source, ignored_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)')
      .bind('i1', 'k1', 'review_requested', 'Review the launch PR', 'o/r', 'https://github.com/o/r/pull/1', '2026-04-30T00:00:00Z', 'You were requested for review.', 'Review PR', '{}', 'notifications').run();

    const htmlRes = await app.request('/dashboard', { headers: { Cookie: 'sunrise_session=sid' } }, { DB: db, OWNER_LOGIN: 'ade' } as unknown as Env);
    const html = await htmlRes.text();
    expect(html).toContain('data-page="app"');
    expect(html).toContain('"component":"Dashboard"');
    expect(html).toContain('Review the launch PR');

    const inertiaRes = await app.request('/dashboard', { headers: { Cookie: 'sunrise_session=sid', 'X-Inertia': 'true', 'X-Inertia-Version': 'sunrise-1' } }, { DB: db, OWNER_LOGIN: 'ade' } as unknown as Env);
    const page = await inertiaRes.json() as any;
    expect(page.component).toBe('Dashboard');
    expect(page.props.items[0].title).toBe('Review the launch PR');
  });

  it('returns paginated dashboard JSON with configurable 50 item default', async () => {
    const db = createMemoryDb();
    await db.prepare("INSERT INTO sessions (id, github_login, github_id, access_token, expires_at, created_at) VALUES ('sid','ade','1','tok','2999-01-01T00:00:00Z','2026-01-01T00:00:00Z')").run();
    for (let i = 0; i < 55; i++) {
      await db.prepare('INSERT INTO action_items (id, canonical_subject_key, kind, title, repo, url, updated_at, reason, suggested_action, evidence_json, source, ignored_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)')
        .bind(`i${i}`, `k${i}`, 'notification', `Item ${i}`, 'o/r', 'https://github.com/o/r/issues/1', `2026-04-${String(30 - Math.floor(i / 24)).padStart(2, '0')}T${String(23 - (i % 24)).padStart(2, '0')}:00:00Z`, 'Reason', 'Do it', '{}', 'notifications').run();
    }
    const res = await app.request('/dashboard?json', { headers: { Cookie: 'sunrise_session=sid' } }, { DB: db, OWNER_LOGIN: 'ade' } as unknown as Env);
    expect(res.status).toBe(200);
    const props = await res.json() as any;
    expect(props.items.length).toBe(50);
    expect(props.pagination).toMatchObject({ page: 1, pageSize: 50, totalItems: 55, totalPages: 2, hasNext: true });
    expect(props.items.map((item: any) => item.title).slice(0, 2)).toEqual(['Item 0', 'Item 1']);
    expect(props.items.every((item: any) => item.suggestedAction)).toBe(true);

    const page2 = await app.request('/dashboard?json&page=2', { headers: { Cookie: 'sunrise_session=sid' } }, { DB: db, OWNER_LOGIN: 'ade' } as unknown as Env);
    const page2Props = await page2.json() as any;
    expect(page2Props.items.length).toBe(5);
  });

  it('derives authored PR ownership counts from repo owner when evidence is missing', async () => {
    const db = createMemoryDb();
    await db.prepare("INSERT INTO sessions (id, github_login, github_id, access_token, expires_at, created_at) VALUES ('sid','ade','1','tok','2999-01-01T00:00:00Z','2026-01-01T00:00:00Z')").run();
    const generated = Array.from({ length: 30 }, (_, i) => ({ repo: i % 2 === 0 ? `ade/project-${i}` : `other/project-${i}`, own: i % 2 === 0 }));
    for (const [i, item] of generated.entries()) {
      await db.prepare('INSERT INTO action_items (id, canonical_subject_key, kind, title, repo, url, updated_at, reason, suggested_action, evidence_json, source, ignored_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)')
        .bind(`pr${i}`, `pr-k${i}`, 'authored_pr_pending', `PR ${i}`, item.repo, `https://github.com/${item.repo}/pull/${i}`, `2026-04-30T${String(23 - (i % 24)).padStart(2, '0')}:00:00Z`, 'Pending', 'Nudge reviewers', '{}', 'search').run();
    }

    const json = await app.request('/dashboard?json', { headers: { Cookie: 'sunrise_session=sid' } }, { DB: db, OWNER_LOGIN: 'ade' } as unknown as Env);
    const props = await json.json() as any;
    expect(props.counts.myPrsOwnRepos).toBe(generated.filter((item) => item.own).length);
    expect(props.counts.myPrsOtherRepos).toBe(generated.filter((item) => !item.own).length);

    const html = await (await app.request('/dashboard', { headers: { Cookie: 'sunrise_session=sid' } }, { DB: db, OWNER_LOGIN: 'ade' } as unknown as Env)).text();
    expect(html).toContain('My PR · own repo');
    expect(html).toContain('My PR · other repo');
  });

  it('shows richer runs operations with queue and rate-limit status', async () => {
    const db = createMemoryDb();
    await db.prepare("INSERT INTO sessions (id, github_login, github_id, access_token, expires_at, created_at) VALUES ('sid','ade','1','tok','2999-01-01T00:00:00Z','2026-01-01T00:00:00Z')").run();
    await db.prepare('INSERT INTO scan_runs (id, trigger, status, started_at, candidate_count, processed_count) VALUES (?, ?, ?, ?, 0, 0)').bind('run1', 'manual', 'succeeded', '2026-04-30T00:00:00Z', 0, 0).run();
    await db.prepare('UPDATE scan_runs SET status = ?, completed_at = ?, candidate_count = ? WHERE id = ?').bind('succeeded', '2026-04-30T00:00:00Z', 3, 'run1').run();
    await db.prepare('INSERT INTO github_changes (id, run_id, canonical_subject_key, source_endpoint, repo, subject_type, subject_url, html_url, updated_at, raw_json, first_seen_at, last_seen_at, processing_status, attempt_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind('c1', 'run1', 'k1', 'notifications', 'o/r', 'Issue', 'api', 'html', '2026-04-30T00:00:00Z', '{}', '2026-04-30T00:00:00Z', '2026-04-30T00:00:00Z', 'pending', 0).run();
    await db.prepare('INSERT INTO rate_limit_snapshots (id, resource, remaining, reset_at, captured_at) VALUES (?, ?, ?, ?, ?)')
      .bind('rate1', 'core', 4999, '2026-04-30T01:00:00Z', '2026-04-30T00:00:00Z').run();

    const html = await (await app.request('/runs', { headers: { Cookie: 'sunrise_session=sid' } }, { DB: db, OWNER_LOGIN: 'ade' } as unknown as Env)).text();
    expect(html).toContain('Queue backlog');
    expect(html).toContain('sunrise-github-dlq');
    expect(html).toContain('Rate limit');
    expect(html).toContain('4999');
    expect(html).toContain('Last checked');
  });

  it('lets the owner change inbox page size in settings', async () => {
    const db = createMemoryDb();
    await db.prepare("INSERT INTO sessions (id, github_login, github_id, access_token, expires_at, created_at) VALUES ('sid','ade','1','tok','2999-01-01T00:00:00Z','2026-01-01T00:00:00Z')").run();
    const get = await app.request('/settings', { headers: { Cookie: 'sunrise_session=sid' } }, { DB: db, OWNER_LOGIN: 'ade' } as unknown as Env);
    expect(await get.text()).toContain('Inbox page size');
    const post = await app.request('/settings', { method: 'POST', headers: { Cookie: 'sunrise_session=sid', 'content-type': 'application/x-www-form-urlencoded' }, body: 'inboxPageSize=25' }, { DB: db, OWNER_LOGIN: 'ade' } as unknown as Env);
    expect(post.status).toBe(302);
    const row = await db.prepare("SELECT value FROM settings WHERE key = 'inbox_page_size'").first<Record<string, string>>();
    expect(row?.value).toBe('25');
  });

  it('renders public design language without authentication', async () => {
    const env = { DB: createMemoryDb(), GITHUB_CLIENT_ID: '', OWNER_LOGIN: 'ade', SESSION_SECRET: 'x' } as unknown as Env;
    const res = await app.request('/design', {}, env);
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('Interface kit');
    expect(html).toContain('Dashboard row');
    expect(html).toContain('Deploy to Cloudflare');
  });

  it('diagnoses invalid GitHub OAuth client IDs before sending users to a 404', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).startsWith('https://github.com/login/oauth/authorize')) return new Response('not found', { status: 404 });
      if (String(url).startsWith('https://api.github.com/users/ade')) return Response.json({ login: 'ade' });
      return new Response('ok');
    }));
    const env = { DB: createMemoryDb(), GITHUB_CLIENT_ID: 'Y37UUaM_wXXgc3k', GITHUB_CLIENT_SECRET: 'secret', OWNER_LOGIN: 'ade', SESSION_SECRET: 'long-enough-session-secret' } as unknown as Env;
    const res = await app.request('/setup?json', {}, env);
    const props = await res.json() as any;
    const oauth = props.checks.find((check: any) => check.id === 'github_client_id');
    expect(oauth.status).toBe('fail');
    expect(oauth.message).toContain('GitHub returned 404');
    expect(oauth.fix).toContain('OAuth App');
  });

  it('does not claim GitHub OAuth client ID is verified when GitHub only redirects to login', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).startsWith('https://github.com/login/oauth/authorize')) {
        return new Response('', { status: 302, headers: { location: 'https://github.com/login?return_to=%2Flogin%2Foauth%2Fauthorize' } });
      }
      if (String(url).startsWith('https://api.github.com/users/ade')) return Response.json({ login: 'ade' });
      return new Response('ok');
    }));
    const env = { DB: createMemoryDb(), GITHUB_QUEUE: queue, GITHUB_CLIENT_ID: 'bogus', GITHUB_CLIENT_SECRET: 'secret', OWNER_LOGIN: 'ade', SESSION_SECRET: 'long-enough-session-secret' } as unknown as Env;
    const res = await app.request('/setup?json', {}, env);
    const props = await res.json() as any;
    const oauth = props.checks.find((check: any) => check.id === 'github_client_id');
    expect(oauth.status).toBe('warn');
    expect(oauth.message).toContain('cannot fully verify');
    expect(props.ready).toBe(true);
  });

  it('normalizes OWNER_LOGIN values that users enter as GitHub profile URLs', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).startsWith('https://github.com/login/oauth/authorize')) return new Response('', { status: 302 });
      if (String(url).startsWith('https://api.github.com/users/adewale')) return Response.json({ login: 'adewale' });
      return new Response('not found', { status: 404 });
    }));
    const env = { DB: createMemoryDb(), GITHUB_QUEUE: queue, GITHUB_CLIENT_ID: 'Ov23liValidClientId', GITHUB_CLIENT_SECRET: 'secret', OWNER_LOGIN: 'https://github.com/adewale', SESSION_SECRET: 'long-enough-session-secret' } as unknown as Env;
    const res = await app.request('/setup?json', {}, env);
    const props = await res.json() as any;
    const owner = props.checks.find((check: any) => check.id === 'owner_login');
    expect(owner.status).toBe('pass');
    expect(owner.message).toContain('adewale');
  });

  it('reports setup readiness for D1, queue, owner login, secrets, and callback URL', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).startsWith('https://github.com/login/oauth/authorize')) return new Response('', { status: 302 });
      if (String(url).startsWith('https://api.github.com/users/ade')) return Response.json({ login: 'ade' });
      return new Response('ok');
    }));
    const env = { DB: createMemoryDb(), GITHUB_QUEUE: queue, GITHUB_CLIENT_ID: 'Ov23liValidClientId', GITHUB_CLIENT_SECRET: 'secret', OWNER_LOGIN: 'ade', SESSION_SECRET: 'long-enough-session-secret' } as unknown as Env;
    const res = await app.request('/setup?json', {}, env);
    const props = await res.json() as any;
    expect(props.callbackUrl).toBe('http://localhost/callback');
    expect(props.ready).toBe(true);
    expect(props.checks.every((check: any) => ['pass', 'warn'].includes(check.status))).toBe(true);
  });

  it('does not redirect to GitHub when OAuth client ID would produce GitHub 404', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).startsWith('https://github.com/login/oauth/authorize')) return new Response('not found', { status: 404 });
      if (String(url).startsWith('https://api.github.com/users/ade')) return Response.json({ login: 'ade' });
      return new Response('ok');
    }));
    const env = { DB: createMemoryDb(), GITHUB_QUEUE: queue, GITHUB_CLIENT_ID: 'Y37UUaM_wXXgc3k', GITHUB_CLIENT_SECRET: 'secret', OWNER_LOGIN: 'ade', SESSION_SECRET: 'long-enough-session-secret' } as unknown as Env;
    const res = await app.request('/login', {}, env);
    const html = await res.text();
    expect(res.status).toBe(400);
    expect(res.headers.get('location')).toBeNull();
    expect(html).toContain('GitHub returned 404');
    expect(html).toContain('OAuth App');
  });

  it('honors explicit OAuth scope override for private repository discovery', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).startsWith('https://github.com/login/oauth/authorize')) return new Response('', { status: 302 });
      return new Response('ok');
    }));
    const db = createMemoryDb();
    const env = { DB: db, GITHUB_CLIENT_ID: 'client', OWNER_LOGIN: 'ade', SESSION_SECRET: 'secret', GITHUB_OAUTH_SCOPES: 'read:user user:email notifications repo' } as unknown as Env;
    const res = await app.request('/login', {}, env);
    const scope = new URL(res.headers.get('location') ?? '').searchParams.get('scope');
    expect(scope).toBe('read:user user:email notifications repo');
  });

  it('renders accessible controls and landmarks for critical interactions', async () => {
    const db = createMemoryDb();
    await db.prepare("INSERT INTO sessions (id, github_login, github_id, access_token, expires_at, created_at) VALUES ('sid','ade','1','tok','2999-01-01T00:00:00Z','2026-01-01T00:00:00Z')").run();
    const html = await (await app.request('/dashboard', { headers: { Cookie: 'sunrise_session=sid' } }, { DB: db, OWNER_LOGIN: 'ade' } as unknown as Env)).text();
    expect(html).toContain('href="#content"');
    expect(html).toContain('aria-label="Settings"');
    expect(html).toContain('aria-label="Toggle dark mode"');
    expect(html).toContain('aria-pressed="false"');
    expect(html).toContain('aria-label="Dashboard statistics"');
  });

  it('creates OAuth state in D1 on login and redirects to GitHub', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).startsWith('https://github.com/login/oauth/authorize')) return new Response('', { status: 302 });
      return new Response('ok');
    }));
    const db = createMemoryDb();
    const env = { DB: db, GITHUB_CLIENT_ID: 'client', OWNER_LOGIN: 'ade', SESSION_SECRET: 'secret' } as unknown as Env;
    const res = await app.request('/login', {}, env);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toContain('github.com/login/oauth/authorize');
    const scope = new URL(res.headers.get('location') ?? '').searchParams.get('scope');
    expect(scope).toBe('read:user user:email notifications');
    expect(scope).not.toContain('repo');
    const state = await db.prepare('SELECT * FROM oauth_states').all();
    expect(state.results).toHaveLength(1);
  });

  it('refresh uses scan path and persists scan run plus github changes', async () => {
    const db = createMemoryDb();
    await db.prepare("INSERT INTO sessions (id, github_login, github_id, access_token, expires_at, created_at) VALUES ('sid','ade','1','tok','2999-01-01T00:00:00Z','2026-01-01T00:00:00Z')").run();
    const env = { DB: db, OWNER_LOGIN: 'ade', TEST_GITHUB_FIXTURES: 'true' } as unknown as Env;
    const res = await app.request('/refresh', { method: 'POST', headers: { Cookie: 'sunrise_session=sid' } }, env);
    expect(res.status).toBe(302);
    expect((await db.prepare('SELECT * FROM scan_runs').all()).results.length).toBe(1);
    expect((await db.prepare('SELECT * FROM github_changes').all()).results.length).toBeGreaterThan(0);
  });
});
