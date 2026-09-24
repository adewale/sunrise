import { afterEach, describe, expect, it, vi } from 'vitest';
import { discoverPeopleThreads, peopleThread, type PeopleCandidate } from '../src/people';

function candidate(overrides: Partial<PeopleCandidate>): PeopleCandidate {
  return { repo: 'ade/r', number: 1, title: 'Thread', url: 'https://github.com/ade/r/issues/1', author: { login: 'reporter', type: 'User' }, draft: false, actions: [], ...overrides };
}

describe('who a thread is waiting on', () => {
  it('an outside issue nobody has answered is waiting on you', () => {
    expect(peopleThread(candidate({ actions: [{ login: 'reporter', at: '2026-02-09T00:00:00Z' }] }), 'ade'))
      .toMatchObject({ waitingOn: 'you', person: 'reporter', since: '2026-02-09T00:00:00Z' });
  });

  it('a reviewer question on your PR elsewhere is waiting on you, not the repo owner', () => {
    const pr = candidate({ repo: 'maintainer/project', author: { login: 'ade', type: 'User' }, actions: [
      { login: 'ade', at: '2026-04-21T17:40:00Z' },
      { login: 'reviewer', at: '2026-04-21T18:00:00Z' },
    ] });
    expect(peopleThread(pr, 'ade')).toMatchObject({ waitingOn: 'you', person: 'reviewer' });
  });

  it('your unanswered PR elsewhere is waiting on the repo owner', () => {
    const pr = candidate({ repo: 'maintainer/project', author: { login: 'ade', type: 'User' }, actions: [{ login: 'ade', at: '2025-10-15T00:00:00Z' }] });
    expect(peopleThread(pr, 'ade')).toMatchObject({ waitingOn: 'them', person: 'maintainer', since: '2025-10-15T00:00:00Z' });
  });

  it('once you reply last, an outside issue is waiting on its reporter', () => {
    const issue = candidate({ actions: [{ login: 'Ade', at: '2026-03-01T00:00:00Z' }, { login: 'reporter', at: '2026-02-09T00:00:00Z' }] });
    expect(peopleThread(issue, 'ade')).toMatchObject({ waitingOn: 'them', person: 'reporter', since: '2026-03-01T00:00:00Z' });
  });

  it('skips drafts, which are still in progress, and bot-authored threads', () => {
    const actions = [{ login: 'contributor', at: '2026-08-02T00:00:00Z' }];
    expect(peopleThread(candidate({ draft: true, actions }), 'ade')).toBeNull();
    expect(peopleThread(candidate({ author: { login: 'dependabot[bot]', type: 'Bot' }, actions }), 'ade')).toBeNull();
  });
});

describe('people discovery', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('only looks up comments and reviews where they can change the answer', async () => {
    const requested: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const u = String(url);
      requested.push(u);
      if (u.includes('/search/issues')) {
        const query = new URL(u).searchParams.get('q') ?? '';
        if (query === 'is:open user:ade -author:ade archived:false') return Response.json({ items: [
          searchItem({ repo: 'ade/scanner', number: 6, author: 'reporter', created: '2026-02-09T00:00:00Z' }),
          searchItem({ repo: 'ade/harness', number: 82, author: 'contributor', created: '2026-08-02T00:00:00Z', pr: true, draft: true }),
          searchItem({ repo: 'ade/deps', number: 19, author: 'dependabot[bot]', type: 'Bot', created: '2026-07-24T00:00:00Z', pr: true }),
        ] });
        if (query === 'is:open author:ade -user:ade archived:false') return Response.json({ items: [
          searchItem({ repo: 'maintainer/gardener', number: 10, author: 'ade', created: '2026-04-21T17:40:00Z', pr: true }),
          searchItem({ repo: 'upstream/py', number: 68, author: 'ade', created: '2026-02-27T00:00:00Z', comments: 2 }),
          searchItem({ repo: 'ade/own', number: 5, author: 'ade', created: '2026-01-01T00:00:00Z' }),
        ] });
      }
      if (u === 'https://api.github.com/repos/maintainer/gardener/pulls/10/reviews?per_page=100') {
        return Response.json([{ user: { login: 'reviewer', type: 'User' }, submitted_at: '2026-04-21T18:00:00Z', state: 'COMMENTED' }]);
      }
      if (u === 'https://api.github.com/repos/upstream/py/issues/68/comments?per_page=100&page=1') {
        return Response.json([
          { user: { login: 'ade', type: 'User' }, created_at: '2026-03-01T00:00:00Z' },
          { user: { login: 'ci-helper[bot]', type: 'Bot' }, created_at: '2026-03-02T00:00:00Z' },
        ]);
      }
      return Response.json([]);
    }));

    const threads = await discoverPeopleThreads({}, 'ade');

    expect(threads).toEqual([
      expect.objectContaining({ repo: 'ade/scanner', number: 6, waitingOn: 'you', person: 'reporter', url: 'https://github.com/ade/scanner/issues/6' }),
      expect.objectContaining({ repo: 'maintainer/gardener', number: 10, waitingOn: 'you', person: 'reviewer', since: '2026-04-21T18:00:00Z' }),
      expect.objectContaining({ repo: 'upstream/py', number: 68, waitingOn: 'them', person: 'upstream', since: '2026-03-01T00:00:00Z' }),
    ]);
    expect(requested.some((u) => u.includes('/repos/ade/scanner/'))).toBe(false);
    expect(requested.some((u) => u.includes('/repos/ade/harness/') || u.includes('/repos/ade/deps/'))).toBe(false);
  });

  it('fails instead of returning a partial list when GitHub errors', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unavailable', { status: 502 })));
    await expect(discoverPeopleThreads({}, 'ade')).rejects.toThrow('502');
  });
});

function searchItem({ repo, number, author, type = 'User', created, pr = false, draft = false, comments = 0 }: { repo: string; number: number; author: string; type?: string; created: string; pr?: boolean; draft?: boolean; comments?: number }) {
  const api = `https://api.github.com/repos/${repo}`;
  return {
    number,
    title: `${repo}#${number}`,
    html_url: `https://github.com/${repo}/${pr ? 'pull' : 'issues'}/${number}`,
    url: `${api}/issues/${number}`,
    repository_url: api,
    user: { login: author, type },
    created_at: created,
    comments,
    draft,
    pull_request: pr ? { url: `${api}/pulls/${number}` } : undefined,
  };
}
