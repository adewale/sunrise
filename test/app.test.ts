import { afterEach, describe, expect, it, vi } from 'vitest';
import app from '../src/app';
import type { Env } from '../src/env';
import { createMemoryDb } from './memory-db';

describe('Sunrise app routes', () => {
  afterEach(() => vi.restoreAllMocks());
  const queue = { send: vi.fn(async () => undefined) } as unknown as Queue;
  it('renders public landing with deploy CTA and setup checklist when signed out', async () => {
    const env = { DB: createMemoryDb(), GITHUB_CLIENT_ID: '', OWNER_LOGIN: 'ade', SESSION_SECRET: 'x' } as unknown as Env;
    const res = await app.request('/', {}, env);
    const html = await res.text();
    expect(html).toContain('Sunrise');
    expect(html).toContain('Deploy your own');
    expect(html).toContain('Setup checklist');
  });

  it('renders dashboard as an inbox with marginal stats', async () => {
    const db = createMemoryDb();
    await db.prepare("INSERT INTO sessions (id, github_login, github_id, access_token, expires_at, created_at) VALUES ('sid','ade','1','tok','2999-01-01T00:00:00Z','2026-01-01T00:00:00Z')").run();
    await db.prepare('INSERT INTO action_items (id, canonical_subject_key, priority, kind, title, repo, url, updated_at, reason, suggested_action, evidence_json, source, ignored_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)')
      .bind('i1', 'k1', 'P0', 'review_requested', 'Review the launch PR', 'o/r', 'https://github.com/o/r/pull/1', '2026-04-30T00:00:00Z', 'You were requested for review.', 'Review PR', '{}', 'notifications').run();
    const res = await app.request('/dashboard', { headers: { Cookie: 'sunrise_session=sid' } }, { DB: db, OWNER_LOGIN: 'ade' } as unknown as Env);
    const html = await res.text();
    expect(html).toContain('class="dashboard-layout"');
    expect(html).toContain('class="inbox panel"');
    expect(html).not.toContain('GitHub inbox');
    expect(html).not.toContain('<p class="eyebrow">P0</p>');
    expect(html).toContain('class="marginalia"');
    expect(html).toContain('Review the launch PR');
    expect(html).toContain('class="item-time"');
    expect(html.indexOf('class="item-time"')).toBeLessThan(html.indexOf('Review the launch PR'));
    expect(html).toContain('Type: review requested');
    expect(html).toContain('@media(max-width:760px){main{width:min(100% - 20px,1120px);margin-top:12px');
    expect(html).toContain('.site-header{position:sticky;top:0;left:0;right:auto;width:100%');
    expect(html).not.toContain('Recent signal');
  });

  it('returns dashboard JSON from the same props shape with <=20 default items and P3 collapsed', async () => {
    const db = createMemoryDb();
    await db.prepare("INSERT INTO sessions (id, github_login, github_id, access_token, expires_at, created_at) VALUES ('sid','ade','1','tok','2999-01-01T00:00:00Z','2026-01-01T00:00:00Z')").run();
    for (let i = 0; i < 25; i++) {
      await db.prepare('INSERT INTO action_items (id, canonical_subject_key, priority, kind, title, repo, url, updated_at, reason, suggested_action, evidence_json, source, ignored_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)')
        .bind(`i${i}`, `k${i}`, i < 2 ? 'P0' : 'P3', 'notification', `Item ${i}`, 'o/r', 'https://github.com/o/r/issues/1', '2026-04-30T00:00:00Z', 'Reason', 'Do it', '{}', 'notifications').run();
    }
    const res = await app.request('/dashboard?json', { headers: { Cookie: 'sunrise_session=sid' } }, { DB: db, OWNER_LOGIN: 'ade' } as unknown as Env);
    expect(res.status).toBe(200);
    const props = await res.json() as any;
    expect(props.items.length).toBeLessThanOrEqual(20);
    expect(props.items.map((item: any) => item.title).slice(0, 2)).toEqual(['Item 0', 'Item 1']);
    expect(props.items.every((item: any) => item.suggestedAction)).toBe(true);
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
