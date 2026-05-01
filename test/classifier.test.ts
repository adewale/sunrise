import { describe, expect, it } from 'vitest';
import { classifyChange, dedupeActionItems, orderActionItems } from '../src/classifier';
import type { GitHubChange } from '../src/types';

const base = {
  id: 'c1',
  runId: 'r1',
  canonicalSubjectKey: 'github:repo:owner/repo:pull:1',
  sourceEndpoint: 'notifications',
  repo: 'owner/repo',
  subjectType: 'PullRequest',
  subjectUrl: 'https://api.github.com/repos/owner/repo/pulls/1',
  htmlUrl: 'https://github.com/owner/repo/pull/1',
  updatedAt: '2026-04-30T10:00:00Z',
  raw: {},
} satisfies GitHubChange;

describe('classifier', () => {
  it('maps review-request notifications to action items with suggested action', () => {
    const item = classifyChange({ ...base, raw: { reason: 'review_requested', title: 'Please review' } }, 'ade');
    expect(item).toMatchObject({ kind: 'review_requested', suggestedAction: 'Review this PR' });
  });

  it('maps authored PR failures, conflicts, and requested changes', () => {
    expect(classifyChange({ ...base, sourceEndpoint: 'search/authored-prs', raw: { title: 'Broken', author: 'ade', checks: 'failure' } }, 'ade')?.kind).toBe('authored_pr_failing');
    expect(classifyChange({ ...base, sourceEndpoint: 'search/authored-prs', raw: { title: 'Conflict', author: 'ade', mergeable: 'conflicting' } }, 'ade')?.kind).toBe('authored_pr_conflict');
    expect(classifyChange({ ...base, sourceEndpoint: 'reviews', raw: { title: 'Changes', author: 'ade', latestReviewState: 'CHANGES_REQUESTED' } }, 'ade')?.kind).toBe('authored_pr_changes_requested');
  });

  it('deduplicates same canonical subject from notifications and search keeping the more direct item', () => {
    const dupes = [
      classifyChange({ ...base, id: 'n', raw: { reason: 'mention', title: 'Mention' } }, 'ade')!,
      classifyChange({ ...base, id: 's', sourceEndpoint: 'search/review-requests', raw: { reason: 'review_requested', title: 'Review' } }, 'ade')!,
    ];
    const deduped = dedupeActionItems(dupes);
    expect(deduped).toHaveLength(1);
    expect(deduped[0].kind).toBe('review_requested');
  });

  it('orders by directness, then recency', () => {
    const items = [
      classifyChange({ ...base, id: 'old-author', canonicalSubjectKey: 'a', raw: { reason: 'author', title: 'Author' } }, 'ade')!,
      classifyChange({ ...base, id: 'assigned', canonicalSubjectKey: 'b', raw: { reason: 'assign', title: 'Assigned' } }, 'ade')!,
      classifyChange({ ...base, id: 'mention', canonicalSubjectKey: 'c', updatedAt: '2026-05-01T10:00:00Z', raw: { reason: 'mention', title: 'Mention' } }, 'ade')!,
    ];
    expect(orderActionItems(items).map((i) => i.id)).toEqual(['assigned', 'mention', 'old-author']);
  });
});
