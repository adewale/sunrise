import { afterEach, describe, expect, it, vi } from 'vitest';
import { runDiscovery } from '../src/scanner';
import type { Env } from '../src/env';
import { createMemoryDb } from './memory-db';

describe('GitHub enrichment fixtures', () => {
  afterEach(() => vi.restoreAllMocks());

  it('classifies authored PR check-run failures as broken authored work', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes('/notifications')) return Response.json([]);
      if (u.includes('/search/issues')) {
        const q = decodeURIComponent(new URL(u).searchParams.get('q') ?? '');
        if (q.includes('is:pr') && q.includes('author:ade')) return search([prIssue('Broken PR', 'https://github.com/ade/r/pull/5')]);
        return search([]);
      }
      if (u.endsWith('/repos/ade/r/pull/5')) return Response.json({ body: 'no verification', mergeable: true, head: { sha: 'abc', repo: { full_name: 'ade/r' } } });
      if (u.endsWith('/repos/ade/r/pull/5/reviews?per_page=100')) return Response.json([]);
      if (u.includes('/commits/abc/check-runs')) return Response.json({ check_runs: [{ name: 'test', status: 'completed', conclusion: 'failure' }] });
      if (u.includes('/user/repos')) return Response.json([]);
      if (u.includes('/rate_limit')) return Response.json({ resources: { core: { remaining: 4999, reset: 1770000000 } } });
      return Response.json([]);
    }));
    const db = createMemoryDb();
    await runDiscovery({ DB: db, OWNER_LOGIN: 'ade' } as unknown as Env, 'manual', 'token');
    const items = await db.prepare('SELECT * FROM action_items').all<Record<string, any>>();
    expect(items.results.map((r) => r.kind)).toContain('authored_pr_failing');
  });

});

function prIssue(title: string, htmlUrl: string) {
  return { title, html_url: htmlUrl, url: htmlUrl.replace('https://github.com/', 'https://api.github.com/repos/'), repository_url: 'https://api.github.com/repos/ade/r', updated_at: '2026-05-01T00:00:00Z', user: { login: 'ade' }, pull_request: { url: 'https://api.github.com/repos/ade/r/pull/5' }, state: 'open' };
}
function search(items: any[]) { return Response.json({ total_count: items.length, items }); }
