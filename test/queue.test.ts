import { describe, expect, it, vi } from 'vitest';
import worker from '../src/index';
import { createMemoryDb } from './memory-db';
import type { Env } from '../src/env';

describe('queue lifecycle', () => {
  it('acks processed and setup diagnostic messages while updating processed_count', async () => {
    const db = createMemoryDb();
    await db.prepare('INSERT INTO scan_runs (id, trigger, status, started_at, candidate_count, processed_count) VALUES (?, ?, ?, ?, 0, 0)').bind('run1', 'manual', 'succeeded', '2026-05-01T00:00:00Z', 0, 0).run();
    await db.prepare('INSERT INTO github_changes (id, run_id, canonical_subject_key, source_endpoint, repo, subject_type, subject_url, html_url, updated_at, raw_json, first_seen_at, last_seen_at, processing_status, attempt_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind('c1', 'run1', 'k1', 'notifications', 'o/r', 'Issue', 'api', 'html', '2026-05-01T00:00:00Z', JSON.stringify({ reason: 'mention', title: 'Mentioned' }), '2026-05-01T00:00:00Z', '2026-05-01T00:00:00Z', 'pending', 0).run();
    const processed = message({ kind: 'process-github-change', runId: 'run1', changeId: 'c1' });
    const diagnostic = message({ kind: 'setup-diagnostic', diagnosticId: 'd1', createdAt: '2026-05-01T00:00:00Z' });
    await worker.queue({ messages: [diagnostic, processed] } as any, { DB: db, OWNER_LOGIN: 'ade' } as unknown as Env);
    expect(diagnostic.ack).toHaveBeenCalledOnce();
    expect(processed.ack).toHaveBeenCalledOnce();
    expect(processed.retry).not.toHaveBeenCalled();
    const run = await db.prepare('SELECT * FROM scan_runs WHERE id = ?').bind('run1').first<Record<string, any>>();
    expect(run?.processed_count).toBe(1);
  });
});

function message(body: any) {
  return { body, ack: vi.fn(), retry: vi.fn() };
}
