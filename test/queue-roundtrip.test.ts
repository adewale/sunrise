import { env, createExecutionContext, createMessageBatch, getQueueResult, waitOnExecutionContext } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from '../src/index';
import { runDiscovery } from '../src/scanner';
import type { QueueMessage } from '../src/types';

// Producer -> consumer round trip. The previous queue.test.ts hand-builds a
// MessageBatch and feeds it to worker.queue; this exercises the FULL flow:
// runDiscovery enqueues via env.GITHUB_QUEUE.send/sendBatch, we replay the
// resulting messages through worker.queue, and assert the consumer actually
// materializes action_items. Catches drift between the producer's payload
// shape and the consumer's switch.
describe('queue producer -> consumer round trip', () => {
  beforeEach(() => {
    // Capture the messages the producer enqueues so we can replay them through
    // the consumer. Real broker isn't strictly needed for the assertion; we
    // just need shape agreement between producer and consumer.
    const sent: { body: QueueMessage }[] = [];
    (env as any).GITHUB_QUEUE = {
      send: vi.fn(async (body: QueueMessage) => { sent.push({ body }); }),
      sendBatch: vi.fn(async (batch: { body: QueueMessage }[]) => { for (const m of batch) sent.push({ body: m.body }); }),
    };
    (env as any).__sent = sent;
  });
  afterEach(() => { vi.restoreAllMocks(); delete (env as any).__sent; });

  it('enqueues GitHub changes from a scan and the consumer turns them into action items', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes('/notifications')) {
        return Response.json([{
          id: '1', reason: 'mention',
          subject: { title: 'Mentioned thread', url: 'https://api.github.com/repos/o/r/issues/1', type: 'Issue' },
          repository: { full_name: 'o/r' },
          updated_at: '2026-05-01T10:00:00Z',
        }]);
      }
      if (u.includes('/search/issues')) return Response.json({ items: [] });
      return Response.json([]);
    }));

    const result = await runDiscovery(env, 'manual', 'token');
    expect(result.candidateCount).toBeGreaterThan(0);

    const sent = (env as any).__sent as { body: QueueMessage }[];
    expect(sent.length).toBeGreaterThan(0);

    const beforeItems = await env.DB.prepare('SELECT COUNT(*) AS c FROM action_items').first<{ c: number }>();
    expect(beforeItems?.c ?? 0).toBe(0);

    const batch = createMessageBatch<QueueMessage>('sunrise-github', sent.map((m, i) => ({
      id: `msg-${i}`,
      timestamp: new Date(),
      attempts: 1,
      body: m.body,
    })));
    const ctx = createExecutionContext();
    await worker.queue(batch, env);
    await waitOnExecutionContext(ctx);

    const queueResult = await getQueueResult(batch, ctx);
    expect(queueResult.outcome).toBe('ok');
    for (const ack of queueResult.ackAll ? [] : queueResult.explicitAcks ?? []) expect(ack).toBeTruthy();

    const afterItems = await env.DB.prepare('SELECT * FROM action_items').all<Record<string, any>>();
    expect(afterItems.results.length).toBeGreaterThan(0);
    expect(afterItems.results.map((row) => row.kind)).toContain('mention');
  });
});
