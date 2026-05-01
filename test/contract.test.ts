import { describe, expect, it } from 'vitest';
import app from '../src/app';
import type { Env } from '../src/env';
import { createMemoryDb } from './memory-db';

async function signedInDb() {
  const db = createMemoryDb();
  await db.prepare("INSERT INTO sessions (id, github_login, github_id, access_token, expires_at, created_at) VALUES ('sid','ade','1','tok','2999-01-01T00:00:00Z','2026-01-01T00:00:00Z')").run();
  return db;
}

describe('route prop contracts', () => {
  it('returns stable dashboard props for agents and UI', async () => {
    const db = await signedInDb();
    await db.prepare('INSERT INTO action_items (id, canonical_subject_key, kind, title, repo, url, updated_at, reason, suggested_action, evidence_json, source, ignored_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)')
      .bind('i1', 'k1', 'review_requested', 'Review me', 'o/r', 'https://github.com/o/r/pull/1', '2026-05-01T00:00:00Z', 'Review requested', 'Review PR', '{}', 'notifications').run();
    const res = await app.request('/dashboard?json', { headers: { Cookie: 'sunrise_session=sid' } }, { DB: db, OWNER_LOGIN: 'ade' } as unknown as Env);
    const props = await res.json() as any;
    expect(props).toMatchObject({ product: 'Sunrise', signedInAs: 'ade' });
    expect(props.items[0]).toMatchObject({ title: 'Review me', repo: 'o/r', suggestedAction: 'Review PR' });
    expect(props.counts).toMatchObject({ pullRequests: 1, issues: 0 });
    expect(props.pagination).toMatchObject({ page: 1, pageSize: 50, totalItems: 1 });
  });

  it('returns stable runs props including queue, notice, and auto refresh state', async () => {
    const db = await signedInDb();
    await db.prepare('INSERT INTO scan_runs (id, trigger, status, started_at, candidate_count, processed_count) VALUES (?, ?, ?, ?, 0, 0)')
      .bind('run1', 'manual', 'succeeded', '2026-05-01T00:00:00Z', 0, 0).run();
    await db.prepare('UPDATE scan_runs SET status = ?, completed_at = ?, candidate_count = ? WHERE id = ?').bind('succeeded', '2026-05-01T00:00:00Z', 3, 'run1').run();
    const res = await app.request('/runs?refresh=started&runId=run1&candidates=3', { headers: { Cookie: 'sunrise_session=sid', Accept: 'application/json' } }, { DB: db } as unknown as Env);
    const props = await res.json() as any;
    expect(props.notice.message).toContain('processed 0 so far');
    expect(props.autoRefresh).toBe(true);
    expect(props.queue).toMatchObject({ pending: 0, failed: 0, source: 'd1' });
  });

  it('returns setup diagnostics JSON without pretending OAuth is verified', async () => {
    const res = await app.request('/setup?json', {}, { DB: createMemoryDb(), GITHUB_CLIENT_ID: '', OWNER_LOGIN: '', SESSION_SECRET: '' } as unknown as Env);
    const setup = await res.json() as any;
    expect(setup.ready).toBe(false);
    expect(setup.checks.some((c: any) => c.id === 'callback_url')).toBe(true);
    expect(setup.checks.find((c: any) => c.id === 'github_client_id').status).toBe('fail');
  });
});
