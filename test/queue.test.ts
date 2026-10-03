import { env, createExecutionContext, createMessageBatch, getQueueResult } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import worker from '../src/index';
import type { QueueMessage } from '../src/types';

describe('queue lifecycle', () => {
  it('acks processed and setup diagnostic messages while updating processed_count', async () => {
    await seedRun();
    await seedChange('c1', JSON.stringify({ reason: 'mention', title: 'Mentioned' }));
    const batch = createMessageBatch<QueueMessage>('sunrise-github', [
      queued('diagnostic', { kind: 'setup-diagnostic', diagnosticId: 'd1', createdAt: '2026-05-01T00:00:00Z' }),
      queued('processed', { kind: 'process-github-change', runId: 'run1', changeId: 'c1' }),
    ]);

    await worker.queue(batch, env);

    const result = await getQueueResult(batch, createExecutionContext());
    expect([...result.explicitAcks].sort()).toEqual(['diagnostic', 'processed']);
    expect(result.retryMessages).toEqual([]);
    const run = await env.DB.prepare('SELECT * FROM scan_runs WHERE id = ?').bind('run1').first<Record<string, any>>();
    expect(run?.processed_count).toBe(1);
    const item = await env.DB.prepare('SELECT kind FROM action_items WHERE canonical_subject_key = ?').bind('k-c1').first<{ kind: string }>();
    expect(item?.kind).toBe('mention');
  });

  it('retries a message whose change fails to process, records the error, and still acks the rest', async () => {
    await seedRun();
    await seedChange('bad', '{not json');
    await seedChange('good', JSON.stringify({ reason: 'mention', title: 'Mentioned' }));
    const batch = createMessageBatch<QueueMessage>('sunrise-github', [
      queued('bad', { kind: 'process-github-change', runId: 'run1', changeId: 'bad' }),
      queued('good', { kind: 'process-github-change', runId: 'run1', changeId: 'good' }),
    ]);

    await worker.queue(batch, env);

    const result = await getQueueResult(batch, createExecutionContext());
    expect(result.retryMessages.map((m: { msgId: string }) => m.msgId)).toEqual(['bad']);
    expect(result.explicitAcks).toEqual(['good']);
    const bad = await env.DB.prepare('SELECT processing_status, attempt_count, last_error FROM github_changes WHERE id = ?').bind('bad').first<Record<string, any>>();
    expect(bad).toMatchObject({ processing_status: 'failed', attempt_count: 1 });
    expect(bad?.last_error).toEqual(expect.any(String));
    const run = await env.DB.prepare('SELECT processed_count FROM scan_runs WHERE id = ?').bind('run1').first<{ processed_count: number }>();
    expect(run?.processed_count).toBe(1);
  });
});

function queued(id: string, body: QueueMessage) {
  return { id, timestamp: new Date('2026-05-01T00:00:00Z'), attempts: 1, body };
}

async function seedRun() {
  await env.DB.prepare('INSERT INTO scan_runs (id, trigger, status, started_at, candidate_count, processed_count) VALUES (?, ?, ?, ?, ?, ?)').bind('run1', 'manual', 'succeeded', '2026-05-01T00:00:00Z', 0, 0).run();
}

async function seedChange(id: string, rawJson: string) {
  await env.DB.prepare('INSERT INTO github_changes (id, run_id, canonical_subject_key, source_endpoint, repo, subject_type, subject_url, html_url, updated_at, raw_json, first_seen_at, last_seen_at, processing_status, attempt_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(id, 'run1', `k-${id}`, 'notifications', 'o/r', 'Issue', 'api', 'html', '2026-05-01T00:00:00Z', rawJson, '2026-05-01T00:00:00Z', '2026-05-01T00:00:00Z', 'pending', 0).run();
}
