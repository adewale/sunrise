import { applyD1Migrations, env, reset, SELF } from 'cloudflare:test';
import type { D1Migration } from '@cloudflare/vitest-pool-workers';
import { beforeEach, describe, expect, it } from 'vitest';

// Real-D1 integration test running inside workerd. Applies the project's D1
// migrations against the workerd D1 binding, seeds a session + an action item,
// then drives /dashboard end-to-end through SELF.fetch. Exercises the actual
// Cloudflare runtime (D1, fetch, Hono routing, Inertia SSR) rather than the
// in-memory shim the node-pool tests use.
describe('dashboard (workerd runtime, real D1)', () => {
  beforeEach(async () => {
    await reset();
    const migrations = (env as unknown as { TEST_MIGRATIONS: D1Migration[] }).TEST_MIGRATIONS;
    await applyD1Migrations(env.DB, migrations);
  });

  it('renders the inbox with a seeded session and action item', async () => {
    await env.DB.prepare("INSERT INTO sessions (id, github_login, github_id, access_token, expires_at, created_at) VALUES ('sid','ade','1','tok','2999-01-01T00:00:00Z','2026-01-01T00:00:00Z')").run();
    await env.DB.prepare('INSERT INTO action_items (id, canonical_subject_key, kind, title, repo, url, updated_at, reason, suggested_action, evidence_json, source, ignored_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)')
      .bind('i1', 'k1', 'review_requested', 'Review the launch PR', 'o/r', 'https://github.com/o/r/pull/1', '2026-04-30T00:00:00Z', 'You were requested for review.', 'Review PR', '{}', 'notifications')
      .run();

    const res = await SELF.fetch('http://example.com/dashboard', {
      headers: { Cookie: 'sunrise_session=sid' },
    });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('Review the launch PR');
    expect(html).toContain('data-server-rendered="true" id="app"');
    expect(html).toContain('"component":"Dashboard"');
    expect(html).toContain('aria-label="Settings"');
  });

  it('returns an Inertia JSON page object for X-Inertia GET', async () => {
    await env.DB.prepare("INSERT INTO sessions (id, github_login, github_id, access_token, expires_at, created_at) VALUES ('sid','ade','1','tok','2999-01-01T00:00:00Z','2026-01-01T00:00:00Z')").run();

    const res = await SELF.fetch('http://example.com/dashboard', {
      headers: {
        Cookie: 'sunrise_session=sid',
        'X-Inertia': 'true',
        'X-Inertia-Version': 'sunrise-1',
      },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('x-inertia')).toBe('true');
    const page = (await res.json()) as { component: string; props: { items: unknown[] } };
    expect(page.component).toBe('Dashboard');
    expect(Array.isArray(page.props.items)).toBe(true);
  });
});
