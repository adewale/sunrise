import { env } from 'cloudflare:test';
import fc from 'fast-check';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dedupeChanges, runDiscovery } from '../src/scanner';
import type { GitHubChange } from '../src/types';

const sourceEndpointArbitrary = fc.constantFrom(
  'notifications',
  'search/review-requests',
  'search/assigned',
  'search/authored-prs',
  'search/created-issues',
  'search/owned-repo-prs',
  'search/involved',
);

const equalSpecificityEndpointArbitrary = fc.constantFrom(
  'search/review-requests',
  'search/assigned',
  'search/created-issues',
);

const timestampArbitrary = fc.oneof(
  fc.integer({ min: 0, max: 4_102_444_800_000 }).map((timestamp) => new Date(timestamp).toISOString()),
  fc.constantFrom('', 'not-a-date', 'invalid timestamp'),
);

const githubChangeArbitrary = fc.record({
  id: fc.uuid(),
  runId: fc.uuid(),
  canonicalSubjectKey: fc.integer({ min: 0, max: 12 }).map((key) => `github:owner/repo:issue:${key}`),
  sourceEndpoint: sourceEndpointArbitrary,
  updatedAt: timestampArbitrary,
  title: fc.string({ maxLength: 40 }),
}).map(({ id, runId, canonicalSubjectKey, sourceEndpoint, updatedAt, title }): GitHubChange => ({
  id,
  runId,
  canonicalSubjectKey,
  sourceEndpoint,
  repo: 'owner/repo',
  subjectType: 'Issue',
  subjectUrl: `https://api.github.com/repos/${canonicalSubjectKey}`,
  htmlUrl: `https://github.com/${canonicalSubjectKey}`,
  updatedAt,
  raw: { title },
}));

describe('GitHub discovery', () => {
  // By default, exercise inline scanning (write directly to action_items). The
  // 'uses sendBatch' test re-sets GITHUB_QUEUE to its own mock.
  beforeEach(() => { (env as any).GITHUB_QUEUE = undefined; });
  afterEach(() => vi.restoreAllMocks());

  it('deduplicates production discovery inputs independently of source order', () => {
    fc.assert(
      fc.property(fc.array(fc.record({ change: githubChangeArbitrary, rank: fc.integer() }), { maxLength: 80 }), (rankedChanges) => {
        const changes = rankedChanges.map(({ change }) => change);
        const reordered = [...rankedChanges]
          .sort((a, b) => a.rank - b.rank)
          .map(({ change }) => change);
        const canonical = dedupeChanges(changes);

        expect(dedupeChanges(reordered)).toEqual(canonical);
        expect(dedupeChanges([...changes].reverse())).toEqual(canonical);
        expect(dedupeChanges(canonical)).toEqual(canonical);
        expect(new Set(canonical.map((change) => change.canonicalSubjectKey)).size).toBe(canonical.length);
      }),
      { numRuns: 250 },
    );
  });

  it('uses a total tie-break for malformed timestamps on the production dedupe path', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.uuid(), { minLength: 2, maxLength: 2 }),
        fc.tuple(equalSpecificityEndpointArbitrary, equalSpecificityEndpointArbitrary),
        fc.tuple(fc.constantFrom('', 'not-a-date', 'invalid timestamp'), fc.constantFrom('', 'not-a-date', 'invalid timestamp')),
        ([firstId, secondId], [firstEndpoint, secondEndpoint], [firstTimestamp, secondTimestamp]) => {
          const makeChange = (id: string, sourceEndpoint: string, updatedAt: string): GitHubChange => ({
            id,
            runId: 'run',
            canonicalSubjectKey: 'github:owner/repo:issue:malformed-date',
            sourceEndpoint,
            repo: 'owner/repo',
            subjectType: 'Issue',
            subjectUrl: 'https://api.github.com/repos/owner/repo/issues/1',
            htmlUrl: 'https://github.com/owner/repo/issues/1',
            updatedAt,
            raw: { title: id },
          });
          const changes = [
            makeChange(firstId, firstEndpoint, firstTimestamp),
            makeChange(secondId, secondEndpoint, secondTimestamp),
          ];

          expect(dedupeChanges(changes)).toHaveLength(1);
          expect(dedupeChanges([...changes].reverse())).toEqual(dedupeChanges(changes));
        },
      ),
      { numRuns: 250 },
    );
  });

  it('paginates notifications and discovers open issues, PRs, and involved threads', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes('/notifications') && !u.includes('page=2')) {
        return Response.json([
          notification('mention', 'Mentioned thread', 'https://api.github.com/repos/o/r/issues/1', '2026-05-01T10:00:00Z'),
        ], { headers: { link: '<https://api.github.com/notifications?all=false&per_page=100&page=2>; rel="next"' } });
      }
      if (u.includes('/notifications') && u.includes('page=2')) {
        return Response.json([
          notification('subscribed', 'Second page notification', 'https://api.github.com/repos/o/r/issues/2', '2026-05-01T09:00:00Z'),
        ]);
      }
      if (u.includes('/search/issues')) {
        const query = decodeURIComponent(new URL(u).searchParams.get('q') ?? '');
        if (query.includes('review-requested:ade')) return search([issue('Review me', 'https://github.com/o/r/pull/3', '2026-05-01T12:00:00Z', 'teammate')]);
        if (query.includes('assignee:ade')) return search([issue('Assigned issue', 'https://github.com/o/r/issues/4', '2026-05-01T11:00:00Z', 'teammate')]);
        if (query.includes('user:ade') && query.includes('-author:ade')) return search([issue('External PR to my repo', 'https://github.com/ade/r/pull/8', '2026-05-01T06:30:00Z', 'teammate')]);
        if (query.includes('is:pr') && query.includes('author:ade')) return search([issue('Authored PR', 'https://github.com/o/r/pull/5', '2026-05-01T08:00:00Z', 'ade')]);
        if (query.includes('is:issue') && query.includes('author:ade')) return search([issue('Authored issue', 'https://github.com/o/r/issues/6', '2026-05-01T07:00:00Z', 'ade')]);
        if (query.includes('involves:ade')) return search([issue('Active discussion', 'https://github.com/o/r/issues/7', '2026-05-01T06:00:00Z', 'teammate')]);
      }
      return Response.json([]);
    }));

    const result = await runDiscovery(env, 'manual', 'token');

    expect(result.candidateCount).toBe(7);
    const changes = await env.DB.prepare('SELECT * FROM github_changes').all<Record<string, any>>();
    expect(changes.results.map((row) => row.source_endpoint)).toEqual(expect.arrayContaining([
      'notifications',
      'search/review-requests',
      'search/assigned',
      'search/authored-prs',
      'search/created-issues',
      'search/owned-repo-prs',
      'search/involved',
    ]));
    const items = await env.DB.prepare('SELECT * FROM action_items').all<Record<string, any>>();
    expect(items.results.find((row) => row.kind === 'mention')?.url).toBe('https://github.com/o/r/issues/1');
    expect(items.results.map((row) => row.kind)).toEqual(expect.arrayContaining([
      'mention',
      'review_requested',
      'assigned',
      'authored_pr_pending',
      'maintenance',
      'repo_pr',
    ]));
    const run = (await env.DB.prepare('SELECT * FROM scan_runs').first<Record<string, any>>())!;
    expect(run.processed_count).toBe(7);
  });

  it('can include watched-repository notifications when enabled', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes('/notifications')) return Response.json([notification('subscribed', 'Watched repo issue', 'https://api.github.com/repos/o/r/issues/2', '2026-05-01T09:00:00Z')]);
      if (u.includes('/search/issues')) return search([]);
      return Response.json([]);
    }));
    await env.DB.prepare('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)').bind('include_subscribed_notifications', 'true', '2026-05-01T00:00:00Z').run();
    const result = await runDiscovery(env, 'manual', 'token');
    const items = await env.DB.prepare('SELECT * FROM action_items').all<Record<string, any>>();
    expect(result.candidateCount).toBe(1);
    expect(items.results[0].kind).toBe('notification');
    expect(JSON.parse(items.results[0].evidence_json).notificationReason).toBe('subscribed');
  });

  it('removes snapshot-backed action items after GitHub no longer returns them', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes('/notifications')) return Response.json([]);
      if (u.includes('/search/issues')) return search([]);
      if (u.includes('/user/repository_invitations')) return Response.json([]);
      if (u.includes('/user/memberships/orgs')) return Response.json([]);
      return Response.json([]);
    }));
    const stale = [
      ['old-invite', 'github:invitations/repository:ade/new', 'invitation', 'Repository invitation: ade/new', 'https://github.com/ade/new'],
      ['old-review', 'github:o/r/pull/1', 'review_requested', 'Review me', 'https://github.com/o/r/pull/1'],
      ['old-assigned', 'github:o/r/issues/2', 'assigned', 'Assigned issue', 'https://github.com/o/r/issues/2'],
      ['old-authored', 'github:o/r/pull/3', 'authored_pr_pending', 'Authored PR', 'https://github.com/o/r/pull/3'],
      ['old-created', 'github:o/r/issues/4', 'maintenance', 'Created issue', 'https://github.com/o/r/issues/4'],
      ['old-repo-pr', 'github:ade/r/pull/5', 'repo_pr', 'Repo PR', 'https://github.com/ade/r/pull/5'],
    ];
    for (const [id, key, kind, title, url] of stale) {
      await env.DB.prepare('INSERT INTO action_items (id, canonical_subject_key, kind, title, repo, url, updated_at, reason, suggested_action, evidence_json, source, ignored_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)')
        .bind(id, key, kind, title, 'ade/r', url, '2026-05-01T00:00:00Z', 'stale', 'act', '{}', 'search').run();
    }
    await env.DB.prepare('INSERT INTO action_items (id, canonical_subject_key, kind, title, repo, url, updated_at, reason, suggested_action, evidence_json, source, ignored_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)')
      .bind('keep-mention', 'github:o/r/issues/9', 'mention', 'Mention', 'o/r', 'https://github.com/o/r/issues/9', '2026-05-01T00:00:00Z', 'mention', 'reply', '{}', 'notifications').run();

    await runDiscovery(env, 'manual', 'token');

    const items = await env.DB.prepare('SELECT * FROM action_items').all<Record<string, any>>();
    expect(items.results.map((row) => row.kind)).not.toEqual(expect.arrayContaining(['invitation', 'review_requested', 'assigned', 'authored_pr_pending', 'maintenance', 'repo_pr']));
    expect(items.results.some((row) => row.kind === 'mention')).toBe(true);
  });

  it('skips processing when the GitHub snapshot has not changed', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes('/notifications')) return Response.json([notification('mention', 'Mentioned thread', 'https://api.github.com/repos/o/r/issues/1', '2026-05-01T10:00:00Z')]);
      if (u.includes('/search/issues')) return search([]);
      return Response.json([]);
    }));
    const first = await runDiscovery(env, 'manual', 'token');
    const second = await runDiscovery(env, 'manual', 'token') as any;
    expect(first.candidateCount).toBe(1);
    expect(second).toMatchObject({ candidateCount: 0, noChange: true });
    const runs = await env.DB.prepare('SELECT * FROM scan_runs').all<Record<string, any>>();
    expect(runs.results.some((run) => run.status === 'no_change')).toBe(true);
  });

  it('uses GitHub ETags to detect an unchanged snapshot early', async () => {
    let calls = 0;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.includes('/notifications')) {
        calls++;
        if ((init?.headers as Record<string, string>)?.['If-None-Match']) return new Response(null, { status: 304 });
        return Response.json([], { headers: { etag: '"notifications-v1"' } });
      }
      if (u.includes('/search/issues')) return search([]);
      return Response.json([]);
    }));
    await runDiscovery(env, 'manual', 'token');
    const second = await runDiscovery(env, 'manual', 'token') as any;
    expect(calls).toBeGreaterThan(1);
    expect(second.noChange).toBe(true);
  });

  it('uses sendBatch when a queue binding is available', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes('/notifications')) return Response.json([notification('mention', 'Mentioned thread', 'https://api.github.com/repos/o/r/issues/1', '2026-05-01T10:00:00Z')]);
      if (u.includes('/search/issues')) return search([]);
      return Response.json([]);
    }));
    const queue = { sendBatch: vi.fn(async () => undefined), send: vi.fn(async () => undefined) };
    (env as any).GITHUB_QUEUE = queue;
    await runDiscovery(env, 'manual', 'token');
    expect(queue.sendBatch).toHaveBeenCalledOnce();
    expect(queue.send).not.toHaveBeenCalled();
    const run = (await env.DB.prepare('SELECT * FROM scan_runs').first<Record<string, any>>())!;
    expect(run.processed_count ?? 0).toBe(0);
  });
});

function notification(reason: string, title: string, subjectUrl: string, updatedAt: string) {
  return {
    reason,
    updated_at: updatedAt,
    repository: { full_name: 'o/r', html_url: 'https://github.com/o/r' },
    subject: { type: 'Issue', title, url: subjectUrl },
  };
}

function issue(title: string, htmlUrl: string, updatedAt: string, author: string) {
  return {
    title,
    html_url: htmlUrl,
    url: htmlUrl.replace('https://github.com/', 'https://api.github.com/repos/'),
    repository_url: 'https://api.github.com/repos/o/r',
    updated_at: updatedAt,
    user: { login: author },
    pull_request: htmlUrl.includes('/pull/') ? {} : undefined,
    state: 'open',
  };
}

function search(items: any[]) {
  return Response.json({ total_count: items.length, items });
}
