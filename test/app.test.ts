import { env, SELF } from 'cloudflare:test';
import { afterEach, describe, expect, it, vi } from 'vitest';

async function signIn() {
  await env.DB.prepare("INSERT INTO sessions (id, github_login, github_id, access_token, expires_at, created_at) VALUES ('sid','ade','1','tok','2999-01-01T00:00:00Z','2026-01-01T00:00:00Z')").run();
}

describe('Sunrise app routes', () => {
  afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

  it('renders public landing with deploy CTA, setup checklist, and branded favicon', async () => {
    const res = await SELF.fetch('http://example.com/');
    const html = await res.text();
    expect(html).toContain('Sunrise');
    expect(html).toContain('Deploy your own');
    expect(html).toContain('Setup checklist');
    expect(html).toContain('<link rel="icon" type="image/svg+xml" href="/favicon.svg"');
    expect(html).toContain('/raw/main/docs/assets/screenshots/dashboard.png');
    expect(html).toContain('/app/client.tsx');
    expect(html).toContain('/app/styles.css');
  });

  it('can render a project landing page without personal setup claims', async () => {
    env.PROJECT_LANDING = 'true';
    const res = await SELF.fetch('http://example.com/');
    const html = await res.text();
    expect(html).toContain('Deploy your own');
    expect(html).toContain('/raw/main/docs/assets/screenshots/dashboard.png');
    expect(html).not.toContain('Setup needs attention');
    expect(html).not.toContain('Sign in with GitHub');
  });

  it('boots the Inertia client and stylesheet through Vite', async () => {
    await signIn();
    const html = await (await SELF.fetch('http://example.com/dashboard', { headers: { Cookie: 'sunrise_session=sid' } })).text();
    // Real Inertia hydration: the page object is embedded and the #app mount is server-rendered
    // for the Vite-built client (app/client.tsx) to hydrate. Asset hashing is handled by Vite.
    expect(html).toContain('<script data-page="app" type="application/json">');
    expect(html).toContain('data-server-rendered="true" id="app"');
    expect(html).toContain('/app/client.tsx');
    expect(html).toContain('/app/styles.css');
  });

  it('serves a sunrise inbox favicon with light and dark variants', async () => {
    const res = await SELF.fetch('http://example.com/favicon.svg');
    const svg = await res.text();
    expect(res.headers.get('content-type')).toContain('image/svg+xml');
    expect(svg).toContain('<title>Sunrise favicon</title>');
    expect(svg).toContain('prefers-color-scheme: dark');
    expect(svg).toContain('aria-hidden');
  });

  it('renders dashboard as an inbox with marginal stats', async () => {
    await signIn();
    await env.DB.prepare('INSERT INTO scan_runs (id, trigger, status, started_at, candidate_count, processed_count) VALUES (?, ?, ?, ?, ?, ?)')
      .bind('run1', 'manual', 'succeeded', '2026-04-30T00:00:00Z', 0, 0).run();
    await env.DB.prepare('UPDATE scan_runs SET status = ?, completed_at = ?, candidate_count = ? WHERE id = ?').bind('succeeded', '2026-04-30T00:00:00Z', 3, 'run1').run();
    await env.DB.prepare('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)')
      .bind('last_refresh_summary', JSON.stringify({ status: 'changed', candidateCount: 5, resolvedCount: 1, updatedAt: '2026-04-30T00:00:00Z' }), '2026-04-30T00:00:00Z').run();
    await env.DB.prepare('INSERT INTO action_items (id, canonical_subject_key, kind, title, repo, url, updated_at, reason, suggested_action, evidence_json, source, ignored_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)')
      .bind('i1', 'k1', 'review_requested', 'Review the launch PR', 'o/r', 'https://github.com/o/r/pull/1', '2026-04-30T00:00:00Z', 'You were requested for review.', 'Review PR', '{}', 'notifications').run();
    await env.DB.prepare('INSERT INTO action_items (id, canonical_subject_key, kind, title, repo, url, updated_at, reason, suggested_action, evidence_json, source, ignored_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)')
      .bind('i2', 'k2', 'authored_pr_pending', 'My PR to another repo', 'someone/project', 'https://github.com/someone/project/pull/2', '2026-04-29T00:00:00Z', 'Your authored PR is waiting on pending checks or review.', 'Nudge reviewers or update PR', '{"isOwnRepo":false,"isAuthored":true}', 'search').run();
    await env.DB.prepare('INSERT INTO action_items (id, canonical_subject_key, kind, title, repo, url, updated_at, reason, suggested_action, evidence_json, source, ignored_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)')
      .bind('i3', 'k3', 'repo_pr', 'External PR to my repo', 'ade/r', 'https://github.com/ade/r/pull/8', '2026-04-28T00:00:00Z', 'An open PR targets one of your repositories.', 'Review or triage this PR', '{"isOwnRepo":true,"isAuthored":false}', 'search').run();
    await env.DB.prepare('INSERT INTO action_items (id, canonical_subject_key, kind, title, repo, url, updated_at, reason, suggested_action, evidence_json, source, ignored_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)')
      .bind('i4', 'k4', 'invitation', 'Repository invitation', 'ade/new', 'https://github.com/ade/new', '2026-04-27T00:00:00Z', 'A repository invitation is pending.', 'Accept or decline invitation', '{}', 'search').run();
    await env.DB.prepare('INSERT INTO action_items (id, canonical_subject_key, kind, title, repo, url, updated_at, reason, suggested_action, evidence_json, source, ignored_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)')
      .bind('i5', 'k5', 'maintenance', 'My open issue', 'ade/r', 'https://github.com/ade/r/issues/9', '2026-04-26T00:00:00Z', 'A thread you opened has activity or needs closure.', 'Respond, close, or archive this loop', '{"isAuthored":true}', 'issues').run();
    const res = await SELF.fetch('http://example.com/dashboard', { headers: { Cookie: 'sunrise_session=sid' } });
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
    const rendered = html.slice(html.indexOf('data-server-rendered'));
    expect(rendered.indexOf('class="item-time"')).toBeLessThan(rendered.indexOf('Review the launch PR'));
    expect(html).toContain('Review requested');
    expect(html).toContain('time-section');
    expect(html).toContain('type-icon');
    expect(html).toContain('repo-avatar');
    expect(html).toContain('item-signals');
    expect(html).toContain('updated ');
    expect(html).toContain('Open in GitHub');
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
    expect(html).toContain('Invitation · ade/new');
    expect(html).toContain('href="https://github.com/ade/new" target="_blank" rel="noreferrer"');
    expect(html).not.toContain('href="https://github.com/settings/repositories" target="_blank" rel="noreferrer"');
    expect(html).not.toContain('href="https://github.com/notifications" target="_blank" rel="noreferrer"');
    expect(html).toContain('↗');
    expect(html).toContain('<span>PRs</span><strong>3</strong>');
    expect(html).toContain('<span>Issues</span><strong>1</strong>');
    expect(html).toContain('<span>My PRs · elsewhere</span><strong>1</strong>');
    expect(html).toContain('<span>PRs to my repos</span><strong>1</strong>');
    expect(html).toContain('<header class="site-header"><a class="brand" href="/"><svg class="brand-mark"');
    expect(html).toContain('<button class="theme-toggle"');
    expect(html.indexOf('<button class="theme-toggle"')).toBeLessThan(html.indexOf('</header>'));
    expect(html).toContain('Manual refresh');
    expect(html).toContain('data-refresh-form');
    expect(html).toContain('Refreshing...');
    expect(html).toContain('Collected GitHub');
    expect(html).toContain('found ·');
    expect(html).not.toContain('Ignore</button>');
    expect(html).not.toContain('Recent signal');
  });

  it('uses UTC calendar days for updated today/yesterday labels', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-01T23:30:00Z'));
    await signIn();
    await env.DB.prepare('INSERT INTO action_items (id, canonical_subject_key, kind, title, repo, url, updated_at, reason, suggested_action, evidence_json, source, ignored_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)')
      .bind('today', 'today', 'review_requested', 'Updated just after midnight UTC', 'o/r', 'https://github.com/o/r/pull/1', '2026-05-01T00:05:00Z', 'Review requested', 'Review PR', '{}', 'notifications').run();
    await env.DB.prepare('INSERT INTO action_items (id, canonical_subject_key, kind, title, repo, url, updated_at, reason, suggested_action, evidence_json, source, ignored_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)')
      .bind('yesterday', 'yesterday', 'maintenance', 'Updated just before midnight UTC', 'o/r', 'https://github.com/o/r/issues/2', '2026-04-30T23:59:00Z', 'Issue activity', 'Respond', '{}', 'issues').run();

    const html = await (await SELF.fetch('http://example.com/dashboard', { headers: { Cookie: 'sunrise_session=sid' } })).text();
    expect(html).toMatch(/updated\s*(?:<!-- -->)?\s*today/);
    expect(html).toMatch(/updated\s*(?:<!-- -->)?\s*yesterday/);
  });

  it('serves dashboard through the Inertia protocol without changing the HTML view', async () => {
    await signIn();
    await env.DB.prepare('INSERT INTO action_items (id, canonical_subject_key, kind, title, repo, url, updated_at, reason, suggested_action, evidence_json, source, ignored_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)')
      .bind('i1', 'k1', 'review_requested', 'Review the launch PR', 'o/r', 'https://github.com/o/r/pull/1', '2026-04-30T00:00:00Z', 'You were requested for review.', 'Review PR', '{}', 'notifications').run();

    const html = await (await SELF.fetch('http://example.com/dashboard', { headers: { Cookie: 'sunrise_session=sid' } })).text();
    expect(html).toContain('data-page="app"');
    expect(html).toContain('"component":"Dashboard"');
    expect(html).toContain('Review the launch PR');

    const inertiaRes = await SELF.fetch('http://example.com/dashboard', { headers: { Cookie: 'sunrise_session=sid', 'X-Inertia': 'true', 'X-Inertia-Version': 'sunrise-1' } });
    const page = await inertiaRes.json() as any;
    expect(page.component).toBe('Dashboard');
    expect(page.props.items[0].title).toBe('Review the launch PR');
  });

  it('renders a single item card and handles a missing item', async () => {
    await signIn();
    await env.DB.prepare('INSERT INTO action_items (id, canonical_subject_key, kind, title, repo, url, updated_at, reason, suggested_action, evidence_json, source, ignored_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)')
      .bind('i1', 'k1', 'review_requested', 'Review the launch PR', 'o/r', 'https://github.com/o/r/pull/1', '2026-04-30T00:00:00Z', 'You were requested for review.', 'Review PR', '{}', 'notifications').run();
    const h = { Cookie: 'sunrise_session=sid' };

    const found = await SELF.fetch('http://example.com/items/i1', { headers: h });
    const foundHtml = await found.text();
    expect(found.status).toBe(200);
    expect(foundHtml).toContain('Review the launch PR');
    expect(foundHtml).toContain('"component":"Item"');

    const foundJson = await SELF.fetch('http://example.com/items/i1', { headers: { ...h, 'X-Inertia': 'true', 'X-Inertia-Version': 'sunrise-1' } });
    const page = await foundJson.json() as any;
    expect(page.component).toBe('Item');
    expect(page.props.item.title).toBe('Review the launch PR');

    const missing = await SELF.fetch('http://example.com/items/nope', { headers: h });
    const missingHtml = await missing.text();
    expect(missing.status).toBe(200);
    expect(missingHtml).toContain('Card not found');
  });

  it('returns paginated dashboard JSON with configurable 50 item default', async () => {
    await signIn();
    for (let i = 0; i < 55; i++) {
      await env.DB.prepare('INSERT INTO action_items (id, canonical_subject_key, kind, title, repo, url, updated_at, reason, suggested_action, evidence_json, source, ignored_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)')
        .bind(`i${i}`, `k${i}`, 'notification', `Item ${i}`, 'o/r', 'https://github.com/o/r/issues/1', `2026-04-${String(30 - Math.floor(i / 24)).padStart(2, '0')}T${String(23 - (i % 24)).padStart(2, '0')}:00:00Z`, 'Reason', 'Do it', '{}', 'notifications').run();
    }
    const res = await SELF.fetch('http://example.com/dashboard?json', { headers: { Cookie: 'sunrise_session=sid' } });
    expect(res.status).toBe(200);
    const props = await res.json() as any;
    expect(props.items.length).toBe(50);
    expect(props.pagination).toMatchObject({ page: 1, pageSize: 50, totalItems: 55, totalPages: 2, hasNext: true });
    expect(props.items.map((item: any) => item.title).slice(0, 2)).toEqual(['Item 0', 'Item 1']);
    expect(props.items.every((item: any) => item.suggestedAction)).toBe(true);

    const page2 = await SELF.fetch('http://example.com/dashboard?json&page=2', { headers: { Cookie: 'sunrise_session=sid' } });
    const page2Props = await page2.json() as any;
    expect(page2Props.items.length).toBe(5);
  });

  it('derives authored PR ownership counts from repo owner when evidence is missing', async () => {
    await signIn();
    const generated = Array.from({ length: 30 }, (_, i) => ({ repo: i % 2 === 0 ? `ade/project-${i}` : `other/project-${i}`, own: i % 2 === 0 }));
    for (const [i, item] of generated.entries()) {
      await env.DB.prepare('INSERT INTO action_items (id, canonical_subject_key, kind, title, repo, url, updated_at, reason, suggested_action, evidence_json, source, ignored_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)')
        .bind(`pr${i}`, `pr-k${i}`, 'authored_pr_pending', `PR ${i}`, item.repo, `https://github.com/${item.repo}/pull/${i}`, `2026-04-30T${String(23 - (i % 24)).padStart(2, '0')}:00:00Z`, 'Pending', 'Nudge reviewers', '{}', 'search').run();
    }

    const json = await SELF.fetch('http://example.com/dashboard?json', { headers: { Cookie: 'sunrise_session=sid' } });
    const props = await json.json() as any;
    expect(props.counts.myPrsOwnRepos).toBe(generated.filter((item) => item.own).length);
    expect(props.counts.myPrsOtherRepos).toBe(generated.filter((item) => !item.own).length);

    const html = await (await SELF.fetch('http://example.com/dashboard', { headers: { Cookie: 'sunrise_session=sid' } })).text();
    expect(html).toContain('My PR · own repo');
    expect(html).toContain('My PR · other repo');
  });

  it('shows richer runs operations with queue and rate-limit status', async () => {
    await signIn();
    await env.DB.prepare('INSERT INTO scan_runs (id, trigger, status, started_at, candidate_count, processed_count) VALUES (?, ?, ?, ?, ?, ?)').bind('run1', 'manual', 'succeeded', '2026-04-30T00:00:00Z', 0, 0).run();
    await env.DB.prepare('UPDATE scan_runs SET status = ?, completed_at = ?, candidate_count = ? WHERE id = ?').bind('succeeded', '2026-04-30T00:00:00Z', 3, 'run1').run();
    await env.DB.prepare('INSERT INTO github_changes (id, run_id, canonical_subject_key, source_endpoint, repo, subject_type, subject_url, html_url, updated_at, raw_json, first_seen_at, last_seen_at, processing_status, attempt_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind('c1', 'run1', 'k1', 'notifications', 'o/r', 'Issue', 'api', 'html', '2026-04-30T00:00:00Z', '{}', '2026-04-30T00:00:00Z', '2026-04-30T00:00:00Z', 'pending', 0).run();
    await env.DB.prepare('INSERT INTO rate_limit_snapshots (id, resource, remaining, reset_at, captured_at) VALUES (?, ?, ?, ?, ?)')
      .bind('rate1', 'core', 4999, '2026-04-30T01:00:00Z', '2026-04-30T00:00:00Z').run();

    const html = await (await SELF.fetch('http://example.com/runs', { headers: { Cookie: 'sunrise_session=sid' } })).text();
    expect(html).toContain('Queue backlog');
    expect(html).toContain('sunrise-github-dlq');
    expect(html).toContain('Rate limit');
    expect(html).toContain('4999');
    expect(html).toContain('Last checked');
  });

  it('renders privacy-preserving changelog and marks it seen', async () => {
    await signIn();
    const res = await SELF.fetch('http://example.com/changelog', { headers: { Cookie: 'sunrise_session=sid' } });
    const html = await res.text();
    expect(html).toContain('Changelog');
    expect(html).toContain('does not register this deployment upstream');
    const setting = await env.DB.prepare('SELECT value FROM settings WHERE key = ?').bind('last_seen_sunrise_version').first<Record<string, any>>();
    expect(setting?.value).toBe('0.1.0');
  });

  it('renders settings update card', async () => {
    await signIn();
    const res = await SELF.fetch('http://example.com/settings', { headers: { Cookie: 'sunrise_session=sid' } });
    const html = await res.text();
    expect(html).toContain('Sunrise version');
    expect(html).toContain('docs/agent-upgrade-contract.md');
    expect(html).toContain('/changelog');
  });

  it('lets the owner change inbox page size in settings', async () => {
    await signIn();
    const get = await SELF.fetch('http://example.com/settings', { headers: { Cookie: 'sunrise_session=sid' } });
    expect(await get.text()).toContain('Inbox page size');
    const post = await SELF.fetch('http://example.com/settings', {
      method: 'POST',
      headers: { Cookie: 'sunrise_session=sid', 'content-type': 'application/x-www-form-urlencoded' },
      body: 'inboxPageSize=25',
      redirect: 'manual',
    });
    expect(post.status).toBe(302);
    const row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'inbox_page_size'").first<Record<string, string>>();
    expect(row?.value).toBe('25');
  });

  it('renders public design language without authentication', async () => {
    const res = await SELF.fetch('http://example.com/design');
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
    env.GITHUB_CLIENT_ID = 'Y37UUaM_wXXgc3k';
    env.GITHUB_CLIENT_SECRET = 'secret';
    env.SESSION_SECRET = 'long-enough-session-secret';
    const res = await SELF.fetch('http://example.com/setup?json');
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
    env.GITHUB_CLIENT_ID = 'bogus';
    env.GITHUB_CLIENT_SECRET = 'secret';
    env.SESSION_SECRET = 'long-enough-session-secret';
    const res = await SELF.fetch('http://example.com/setup?json');
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
    env.GITHUB_CLIENT_ID = 'Ov23liValidClientId';
    env.GITHUB_CLIENT_SECRET = 'secret';
    env.OWNER_LOGIN = 'https://github.com/adewale';
    env.SESSION_SECRET = 'long-enough-session-secret';
    const res = await SELF.fetch('http://example.com/setup?json');
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
    env.GITHUB_CLIENT_ID = 'Ov23liValidClientId';
    env.GITHUB_CLIENT_SECRET = 'secret';
    env.SESSION_SECRET = 'long-enough-session-secret';
    const res = await SELF.fetch('http://example.com/setup?json');
    const props = await res.json() as any;
    expect(props.callbackUrl).toBe('http://example.com/callback');
    expect(props.ready).toBe(true);
    expect(props.checks.every((check: any) => ['pass', 'warn'].includes(check.status))).toBe(true);
  });

  it('does not redirect to GitHub when OAuth client ID would produce GitHub 404', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).startsWith('https://github.com/login/oauth/authorize')) return new Response('not found', { status: 404 });
      if (String(url).startsWith('https://api.github.com/users/ade')) return Response.json({ login: 'ade' });
      return new Response('ok');
    }));
    env.GITHUB_CLIENT_ID = 'Y37UUaM_wXXgc3k';
    env.GITHUB_CLIENT_SECRET = 'secret';
    env.SESSION_SECRET = 'long-enough-session-secret';
    const res = await SELF.fetch('http://example.com/login', { redirect: 'manual' });
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
    env.GITHUB_CLIENT_ID = 'client';
    env.SESSION_SECRET = 'secret';
    (env as any).GITHUB_OAUTH_SCOPES = 'read:user user:email notifications repo';
    const res = await SELF.fetch('http://example.com/login', { redirect: 'manual' });
    const scope = new URL(res.headers.get('location') ?? '').searchParams.get('scope');
    expect(scope).toBe('read:user user:email notifications repo');
  });

  it('renders accessible controls and landmarks for critical interactions', async () => {
    await signIn();
    const html = await (await SELF.fetch('http://example.com/dashboard', { headers: { Cookie: 'sunrise_session=sid' } })).text();
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
    env.GITHUB_CLIENT_ID = 'client';
    env.SESSION_SECRET = 'secret';
    const res = await SELF.fetch('http://example.com/login', { redirect: 'manual' });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toContain('github.com/login/oauth/authorize');
    const scope = new URL(res.headers.get('location') ?? '').searchParams.get('scope');
    expect(scope).toBe('read:user user:email notifications');
    expect(scope).not.toContain('repo');
    const state = await env.DB.prepare('SELECT * FROM oauth_states').all();
    expect(state.results).toHaveLength(1);
  });

  it('refresh uses scan path and persists scan run plus github changes', async () => {
    await signIn();
    env.TEST_GITHUB_FIXTURES = 'true';
    const res = await SELF.fetch('http://example.com/refresh', { method: 'POST', headers: { Cookie: 'sunrise_session=sid' }, redirect: 'manual' });
    expect(res.status).toBe(302);
    expect((await env.DB.prepare('SELECT * FROM scan_runs').all()).results.length).toBe(1);
    expect((await env.DB.prepare('SELECT * FROM github_changes').all()).results.length).toBeGreaterThan(0);
  });
});
