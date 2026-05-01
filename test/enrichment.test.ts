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

  it('detects repo verification scripts semantically instead of accepting any package.json', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes('/notifications')) return Response.json([]);
      if (u.includes('/search/issues')) return search([]);
      if (u.includes('/user/repos')) return Response.json([{ full_name: 'ade/noverify', owner: { login: 'ade' }, pushed_at: '2026-05-01T00:00:00Z' }, { full_name: 'ade/verify', owner: { login: 'ade' }, pushed_at: '2026-05-01T00:00:00Z' }]);
      if (u.includes('/repos/ade/noverify/contents/AGENTS.md') || u.includes('/repos/ade/verify/contents/AGENTS.md')) return Response.json({ ok: true });
      if (u.includes('/repos/ade/noverify/contents/reality.manifest.md') || u.includes('/repos/ade/verify/contents/reality.manifest.md')) return Response.json({ ok: true });
      if (u.includes('/repos/ade/noverify/contents/package.json')) return Response.json({ content: btoa(JSON.stringify({ scripts: { start: 'node index.js' } })) });
      if (u.includes('/repos/ade/verify/contents/package.json')) return Response.json({ content: btoa(JSON.stringify({ scripts: { verify: 'npm test' } })) });
      if (u.includes('/rate_limit')) return Response.json({ resources: { core: { remaining: 4999, reset: 1770000000 } } });
      return Response.json([]);
    }));
    const db = createMemoryDb();
    await runDiscovery({ DB: db, OWNER_LOGIN: 'ade' } as unknown as Env, 'manual', 'token');
    const changes = await db.prepare('SELECT * FROM github_changes').all<Record<string, any>>();
    const readiness = changes.results.filter((r) => r.source_endpoint === 'contents/repo-readiness');
    expect(readiness.some((r) => r.repo === 'ade/noverify' && r.raw_json.includes('hasVerifyCommand'))).toBe(true);
    expect(readiness.some((r) => r.repo === 'ade/verify' && r.raw_json.includes('hasVerifyCommand'))).toBe(false);
  });
});

function prIssue(title: string, htmlUrl: string) {
  return { title, html_url: htmlUrl, url: htmlUrl.replace('https://github.com/', 'https://api.github.com/repos/'), repository_url: 'https://api.github.com/repos/ade/r', updated_at: '2026-05-01T00:00:00Z', user: { login: 'ade' }, pull_request: { url: 'https://api.github.com/repos/ade/r/pull/5' }, state: 'open' };
}
function search(items: any[]) { return Response.json({ total_count: items.length, items }); }
