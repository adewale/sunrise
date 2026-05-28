import { env, SELF } from 'cloudflare:test';
import { describe, expect, it, vi } from 'vitest';

async function signIn() {
  await env.DB.prepare("INSERT INTO sessions (id, github_login, github_id, access_token, expires_at, created_at) VALUES ('sid','ade','1','tok','2999-01-01T00:00:00Z','2026-01-01T00:00:00Z')").run();
}

describe('manual refresh lifecycle', () => {
  it('redirects back to the current page instead of hijacking the owner to runs', async () => {
    await signIn();
    env.TEST_GITHUB_FIXTURES = 'true';
    const res = await SELF.fetch('http://example.com/refresh', { method: 'POST', headers: { Cookie: 'sunrise_session=sid', Referer: 'http://example.com/dashboard?page=2' }, redirect: 'manual' });
    expect(res.status).toBe(302);
    const location = res.headers.get('location')!;
    expect(location).toContain('/dashboard?page=2&refresh=started');
    expect(location).toContain('runId=');
    expect(location).toContain('candidates=2');
    expect(location).not.toContain('/runs');
  });

  it('renders running, completed, empty, and failed refresh notices', async () => {
    await signIn();
    await env.DB.prepare('INSERT INTO scan_runs (id, trigger, status, started_at, candidate_count, processed_count) VALUES (?, ?, ?, ?, ?, ?)').bind('run1', 'manual', 'succeeded', '2026-05-01T00:00:00Z', 0, 0).run();
    await env.DB.prepare('UPDATE scan_runs SET status = ?, completed_at = ?, candidate_count = ? WHERE id = ?').bind('succeeded', '2026-05-01T00:00:00Z', 3, 'run1').run();
    let html = await (await SELF.fetch('http://example.com/runs?refresh=started&runId=run1&candidates=3', { headers: { Cookie: 'sunrise_session=sid' } })).text();
    expect(html).toContain('Manual refresh started');
    expect(html).toContain('processed 0 so far');
    expect(html).toContain('Reload manually if you want a newer snapshot.');
    expect(html).not.toContain('http-equiv="refresh"');

    await env.DB.prepare('UPDATE scan_runs SET processed_count = processed_count + 1 WHERE id = ?').bind('run1').run();
    await env.DB.prepare('UPDATE scan_runs SET processed_count = processed_count + 1 WHERE id = ?').bind('run1').run();
    await env.DB.prepare('UPDATE scan_runs SET processed_count = processed_count + 1 WHERE id = ?').bind('run1').run();
    html = await (await SELF.fetch('http://example.com/runs?refresh=started&runId=run1&candidates=3', { headers: { Cookie: 'sunrise_session=sid' } })).text();
    expect(html).toContain('Manual refresh completed');
    expect(html).not.toContain('http-equiv="refresh"');

    await env.DB.prepare('INSERT INTO scan_runs (id, trigger, status, started_at, candidate_count, processed_count) VALUES (?, ?, ?, ?, ?, ?)').bind('run2', 'manual', 'succeeded', '2026-05-02T00:00:00Z', 0, 0).run();
    html = await (await SELF.fetch('http://example.com/runs?refresh=started&runId=run2&candidates=0', { headers: { Cookie: 'sunrise_session=sid' } })).text();
    expect(html).toContain('No GitHub events were found');

    html = await (await SELF.fetch('http://example.com/runs?refresh=failed&error=GitHub%20500', { headers: { Cookie: 'sunrise_session=sid' } })).text();
    expect(html).toContain('Manual refresh failed: GitHub 500');
  });

  it('redirects failed refreshes back to the current page', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('boom', { status: 500 })));
    await signIn();
    const res = await SELF.fetch('http://example.com/refresh', { method: 'POST', headers: { Cookie: 'sunrise_session=sid', Referer: 'http://example.com/dashboard' }, redirect: 'manual' });
    expect(res.headers.get('location')).toContain('/dashboard?refresh=failed');
  });
});
