import { env, SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

// The session row's expires_at is the only thing that ends a signed-in
// session; the cookie itself carries no expiry the server trusts.
describe('session expiry', () => {
  async function insertSession(id: string, expiresAt: string) {
    await env.DB.prepare('INSERT INTO sessions (id, github_login, github_id, access_token, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(id, 'ade', '1', 'tok', expiresAt, '2026-01-01T00:00:00Z').run();
  }

  it('serves the dashboard to a live session and sends an expired or unknown one to /login', async () => {
    await insertSession('live', '2999-01-01T00:00:00Z');
    await insertSession('expired', '2000-01-01T00:00:00Z');

    const live = await SELF.fetch('http://example.com/dashboard', { headers: { Cookie: 'sunrise_session=live' }, redirect: 'manual' });
    expect(live.status).toBe(200);

    for (const cookie of ['sunrise_session=expired', 'sunrise_session=unknown']) {
      const res = await SELF.fetch('http://example.com/dashboard', { headers: { Cookie: cookie }, redirect: 'manual' });
      expect(res.status).toBe(302);
      expect(new URL(res.headers.get('location')!, 'http://example.com').pathname).toBe('/login');
    }
  });

  it('does not start a scan for an expired session', async () => {
    await insertSession('expired', '2000-01-01T00:00:00Z');
    env.TEST_GITHUB_FIXTURES = 'true';

    const res = await SELF.fetch('http://example.com/refresh', { method: 'POST', headers: { Cookie: 'sunrise_session=expired' }, redirect: 'manual' });

    expect(new URL(res.headers.get('location')!, 'http://example.com').pathname).toBe('/login');
    const runs = await env.DB.prepare('SELECT COUNT(*) AS c FROM scan_runs').first<{ c: number }>();
    expect(runs?.c).toBe(0);
  });
});
