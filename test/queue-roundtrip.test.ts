import { env, createExecutionContext, createMessageBatch, getQueueResult, waitOnExecutionContext } from 'cloudflare:test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import worker from '../src/index';
import { runDiscovery } from '../src/scanner';
import type { QueueMessage } from '../src/types';

// Producer -> consumer round trip. runDiscovery enqueues through the Queue
// binding's sendBatch, which is stubbed so nothing reaches miniflare: the real
// binding has a consumer (wrangler.jsonc) that would process a full batch of
// 10 on its own, racing the replay below. We replay the recorded messages
// through worker.queue and assert the consumer materializes action_items.
// Catches drift between the producer's payload shape and the consumer's switch.
describe('queue producer -> consumer round trip', () => {
  afterEach(() => vi.restoreAllMocks());

  it('enqueues every persisted change once and the consumer turns each into an action item', async () => {
    const notificationCount = 2; // enough to distinguish loss or duplication
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes('/notifications')) {
        return Response.json(Array.from({ length: notificationCount }, (_, i) => ({
          id: String(i), reason: 'mention',
          subject: { title: `Mentioned thread ${i}`, url: `https://api.github.com/repos/o/r/issues/${i + 1}`, type: 'Issue' },
          repository: { full_name: 'o/r' },
          updated_at: '2026-05-01T10:00:00Z',
        })));
      }
      if (u.includes('/search/issues')) return Response.json({ items: [] });
      return Response.json([]);
    }));
    const queue = env.GITHUB_QUEUE as Queue<QueueMessage>;
    const sendBatch = vi.spyOn(queue, 'sendBatch').mockResolvedValue(undefined as never);
    const send = vi.spyOn(queue, 'send').mockResolvedValue(undefined as never);

    const result = await runDiscovery(env, 'manual', 'token');
    expect(result.candidateCount).toBe(notificationCount);

    expect(send).not.toHaveBeenCalled();
    // Cloudflare Queues rejects a sendBatch of more than 100 messages.
    for (const [batch] of sendBatch.mock.calls) expect([...batch].length).toBeLessThanOrEqual(100);
    const sent = sendBatch.mock.calls.flatMap(([batch]) => [...batch].map((m) => m.body));
    const persisted = await env.DB.prepare('SELECT id, run_id FROM github_changes').all<{ id: string; run_id: string }>();
    expect(sent.map((body) => body.kind === 'process-github-change' && body.changeId).sort())
      .toEqual(persisted.results.map((row) => row.id).sort());
    expect(new Set(sent.map((body) => body.kind === 'process-github-change' && body.runId))).toEqual(new Set([result.runId]));

    // Nothing is processed inline when a queue is bound.
    expect(await count('SELECT COUNT(*) AS c FROM action_items')).toBe(0);

    const batch = createMessageBatch<QueueMessage>('sunrise-github', sent.map((body, i) => ({
      id: `msg-${i}`,
      timestamp: new Date(),
      attempts: 1,
      body,
    })));
    const ctx = createExecutionContext();
    await worker.queue(batch, env);
    await waitOnExecutionContext(ctx);

    const queueResult = await getQueueResult(batch, ctx);
    expect(queueResult.ackAll).toBe(false);
    expect(queueResult.retryMessages).toEqual([]);
    expect([...queueResult.explicitAcks].sort()).toEqual(sent.map((_, i) => `msg-${i}`).sort());

    const items = await env.DB.prepare('SELECT kind, url FROM action_items').all<{ kind: string; url: string }>();
    expect(items.results).toHaveLength(notificationCount);
    expect(new Set(items.results.map((row) => row.kind))).toEqual(new Set(['mention']));
    expect(await count(`SELECT processed_count AS c FROM scan_runs WHERE id = '${result.runId}'`)).toBe(notificationCount);
  });
});

async function count(sql: string) {
  return (await env.DB.prepare(sql).first<{ c: number }>())?.c;
}
