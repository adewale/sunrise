import { describe, expect, it, vi } from 'vitest';
import app from '../src/app';
import type { Env } from '../src/env';
import { createMemoryDb } from './memory-db';

async function signedInDb() {
  const db = createMemoryDb();
  await db.prepare("INSERT INTO sessions (id, github_login, github_id, access_token, expires_at, created_at) VALUES ('sid','ade','1','tok','2999-01-01T00:00:00Z','2026-01-01T00:00:00Z')").run();
  return db;
}

describe('manual refresh lifecycle', () => {
  it('redirects to runs so the owner can see progress immediately', async () => {
    const db = await signedInDb();
    const res = await app.request('/refresh', { method: 'POST', headers: { Cookie: 'sunrise_session=sid' } }, { DB: db, OWNER_LOGIN: 'ade', TEST_GITHUB_FIXTURES: 'true' } as unknown as Env);
    expect(res.status).toBe(302);
    const location = res.headers.get('location')!;
    expect(location).toContain('/runs?refresh=started');
    expect(location).toContain('runId=');
    expect(location).toContain('candidates=3');
  });

  it('renders running, completed, empty, and failed refresh notices', async () => {
    const db = await signedInDb();
    await db.prepare('INSERT INTO scan_runs (id, trigger, status, started_at, candidate_count, processed_count) VALUES (?, ?, ?, ?, 0, 0)').bind('run1', 'manual', 'succeeded', '2026-05-01T00:00:00Z', 0, 0).run();
    await db.prepare('UPDATE scan_runs SET status = ?, completed_at = ?, candidate_count = ? WHERE id = ?').bind('succeeded', '2026-05-01T00:00:00Z', 3, 'run1').run();
    let html = await (await app.request('/runs?refresh=started&runId=run1&candidates=3', { headers: { Cookie: 'sunrise_session=sid' } }, { DB: db } as unknown as Env)).text();
    expect(html).toContain('Manual refresh started');
    expect(html).toContain('processed 0 so far');
    expect(html).toContain('http-equiv="refresh"');

    await db.prepare('UPDATE scan_runs SET processed_count = processed_count + 1 WHERE id = ?').bind('run1').run();
    await db.prepare('UPDATE scan_runs SET processed_count = processed_count + 1 WHERE id = ?').bind('run1').run();
    await db.prepare('UPDATE scan_runs SET processed_count = processed_count + 1 WHERE id = ?').bind('run1').run();
    html = await (await app.request('/runs?refresh=started&runId=run1&candidates=3', { headers: { Cookie: 'sunrise_session=sid' } }, { DB: db } as unknown as Env)).text();
    expect(html).toContain('Manual refresh completed');
    expect(html).not.toContain('http-equiv="refresh"');

    await db.prepare('INSERT INTO scan_runs (id, trigger, status, started_at, candidate_count, processed_count) VALUES (?, ?, ?, ?, 0, 0)').bind('run2', 'manual', 'succeeded', '2026-05-02T00:00:00Z', 0, 0).run();
    html = await (await app.request('/runs?refresh=started&runId=run2&candidates=0', { headers: { Cookie: 'sunrise_session=sid' } }, { DB: db } as unknown as Env)).text();
    expect(html).toContain('No GitHub events were found');

    html = await (await app.request('/runs?refresh=failed&error=GitHub%20500', { headers: { Cookie: 'sunrise_session=sid' } }, { DB: db } as unknown as Env)).text();
    expect(html).toContain('Manual refresh failed: GitHub 500');
  });

  it('redirects to a failed runs notice when discovery throws', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('boom', { status: 500 })));
    const db = await signedInDb();
    const res = await app.request('/refresh', { method: 'POST', headers: { Cookie: 'sunrise_session=sid' } }, { DB: db, OWNER_LOGIN: 'ade' } as unknown as Env);
    expect(res.headers.get('location')).toContain('/runs?refresh=failed');
  });
});
