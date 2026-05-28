import { env, createScheduledController, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from '../src/index';

// Exercises the worker's `scheduled` (cron) export end-to-end against real
// workerd: real D1, real Hono context, real GitHub fetch mock. Catches the
// "cron doesn't pick up the most recent session" / "cron silently no-ops on
// missing token" classes of bug before they reach production.
describe('scheduled (cron)', () => {
  beforeEach(() => { (env as any).GITHUB_QUEUE = undefined; });
  afterEach(() => vi.restoreAllMocks());

  it('runs a discovery pass using the most recent session for the configured owner', async () => {
    (env as any).OWNER_LOGIN = 'ade';
    await env.DB.prepare('INSERT INTO sessions (id, github_login, github_id, access_token, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind('sid', 'ade', '1', 'cron-token', '2999-01-01T00:00:00Z', '2026-01-01T00:00:00Z').run();

    const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => {
      const u = String(url);
      if (u.includes('/notifications')) return Response.json([]);
      if (u.includes('/search/issues')) return Response.json({ items: [] });
      return Response.json([]);
    });
    vi.stubGlobal('fetch', fetchMock);

    const ctx = createExecutionContext();
    await worker.scheduled(createScheduledController({ scheduledTime: Date.now(), cron: '0 6 * * *' }), env, ctx);
    await waitOnExecutionContext(ctx);

    const authHeaders = fetchMock.mock.calls.map((call) => call[1]?.headers);
    expect(authHeaders.some((h) => JSON.stringify(h ?? {}).includes('Bearer cron-token'))).toBe(true);

    const run = await env.DB.prepare('SELECT * FROM scan_runs WHERE trigger = ? ORDER BY started_at DESC LIMIT 1').bind('cron').first<Record<string, any>>();
    expect(run?.status).toBe('succeeded');
  });

  it('is a no-op when no session token is available', async () => {
    const fetchMock = vi.fn(async () => Response.json([]));
    vi.stubGlobal('fetch', fetchMock);
    const ctx = createExecutionContext();
    await worker.scheduled(createScheduledController({ scheduledTime: Date.now(), cron: '0 6 * * *' }), env, ctx);
    await waitOnExecutionContext(ctx);
    expect(fetchMock).not.toHaveBeenCalled();
    const run = await env.DB.prepare('SELECT * FROM scan_runs WHERE trigger = ?').bind('cron').first<Record<string, any>>();
    expect(run).toBeNull();
  });
});
