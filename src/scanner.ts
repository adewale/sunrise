import type { Env } from './env';
import type { GitHubChange, QueueMessage } from './types';

type ProcessGitHubChangeMessage = Extract<QueueMessage, { kind: 'process-github-change' }>;
import { classifyChange } from './classifier';
import { retryD1 } from './db';

export async function runDiscovery(env: Env, trigger: 'cron' | 'manual' = 'manual', accessToken?: string) {
  const runId = crypto.randomUUID();
  const now = new Date().toISOString();
  await retryD1(() => env.DB.prepare('INSERT INTO scan_runs (id, trigger, status, started_at, candidate_count, processed_count) VALUES (?, ?, ?, ?, 0, 0)').bind(runId, trigger, 'running', now).run());
  try {
    const changes = env.TEST_GITHUB_FIXTURES === 'true' || !accessToken ? fixtureChanges(runId, env.OWNER_LOGIN ?? 'owner') : await discoverFromGitHub(runId, accessToken);
    for (const change of changes) await persistChange(env, change);
    await retryD1(() => env.DB.prepare('UPDATE scan_runs SET status = ?, completed_at = ?, candidate_count = ? WHERE id = ?').bind('succeeded', new Date().toISOString(), changes.length, runId).run());
    return { runId, candidateCount: changes.length };
  } catch (error) {
    await retryD1(() => env.DB.prepare('UPDATE scan_runs SET status = ?, completed_at = ?, error = ? WHERE id = ?').bind('failed', new Date().toISOString(), error instanceof Error ? error.message : String(error), runId).run());
    throw error;
  }
}

async function persistChange(env: Env, change: GitHubChange) {
  await retryD1(() => env.DB.prepare(`INSERT INTO github_changes (id, run_id, canonical_subject_key, source_endpoint, repo, subject_type, subject_url, html_url, updated_at, raw_json, first_seen_at, last_seen_at, processing_status, attempt_count)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0)
    ON CONFLICT(canonical_subject_key, source_endpoint, updated_at) DO UPDATE SET run_id = excluded.run_id, raw_json = excluded.raw_json, last_seen_at = excluded.last_seen_at, processing_status = 'pending'`)
    .bind(change.id, change.runId, change.canonicalSubjectKey, change.sourceEndpoint, change.repo, change.subjectType, change.subjectUrl, change.htmlUrl, change.updatedAt, JSON.stringify(change.raw), new Date().toISOString(), new Date().toISOString()).run());
  const msg: ProcessGitHubChangeMessage = { kind: 'process-github-change', runId: change.runId, changeId: change.id };
  if (env.GITHUB_QUEUE) await env.GITHUB_QUEUE.send(msg);
  else await processGithubChange(env, msg);
}

export async function processGithubChange(env: Env, msg: ProcessGitHubChangeMessage) {
  const row = await env.DB.prepare('SELECT * FROM github_changes WHERE id = ?').bind(msg.changeId).first<Record<string, string>>();
  if (!row) return;
  const ignored = await env.DB.prepare('SELECT 1 FROM ignored_items WHERE canonical_subject_key = ? LIMIT 1').bind(row.canonical_subject_key).first();
  if (ignored) {
    await env.DB.prepare("UPDATE github_changes SET processing_status = 'ignored' WHERE id = ?").bind(msg.changeId).run();
    return;
  }
  try {
    const item = classifyChange({
      id: row.id,
      runId: row.run_id,
      canonicalSubjectKey: row.canonical_subject_key,
      sourceEndpoint: row.source_endpoint,
      repo: row.repo,
      subjectType: row.subject_type,
      subjectUrl: row.subject_url,
      htmlUrl: row.html_url,
      updatedAt: row.updated_at,
      raw: JSON.parse(row.raw_json || '{}'),
    }, env.OWNER_LOGIN ?? '');
    if (item) {
      await retryD1(() => env.DB.prepare(`INSERT INTO action_items (id, canonical_subject_key, priority, kind, title, repo, url, updated_at, reason, suggested_action, evidence_json, source, ignored_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
        ON CONFLICT(canonical_subject_key) DO UPDATE SET priority = excluded.priority, kind = excluded.kind, title = excluded.title, repo = excluded.repo, url = excluded.url, updated_at = excluded.updated_at, reason = excluded.reason, suggested_action = excluded.suggested_action, evidence_json = excluded.evidence_json, source = excluded.source`)
        .bind(item.id, item.canonicalSubjectKey, item.priority, item.kind, item.title, item.repo, item.url, item.updatedAt, item.reason, item.suggestedAction, JSON.stringify(item.evidence ?? {}), item.source).run());
      await retryD1(() => env.DB.prepare('INSERT INTO item_evidence (id, action_item_id, evidence_json, created_at) VALUES (?, ?, ?, ?)').bind(crypto.randomUUID(), item.id, JSON.stringify(item.evidence ?? {}), new Date().toISOString()).run());
    }
    await retryD1(() => env.DB.prepare("UPDATE github_changes SET processing_status = 'processed', attempt_count = attempt_count + 1, last_error = NULL WHERE id = ?").bind(msg.changeId).run());
  } catch (error) {
    await retryD1(() => env.DB.prepare("UPDATE github_changes SET processing_status = 'failed', attempt_count = attempt_count + 1, last_error = ? WHERE id = ?").bind(error instanceof Error ? error.message : String(error), msg.changeId).run());
    throw error;
  }
}

async function discoverFromGitHub(runId: string, token: string): Promise<GitHubChange[]> {
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'sunrise-dashboard' };
  const res = await fetch('https://api.github.com/notifications?all=false&per_page=50', { headers });
  const remaining = res.headers.get('x-ratelimit-remaining') ?? '';
  const reset = res.headers.get('x-ratelimit-reset') ?? '';
  if (!res.ok) throw new Error(`GitHub notifications failed: ${res.status}`);
  const notifications = await res.json<any[]>();
  void remaining; void reset;
  return notifications.map((n) => ({
    id: crypto.randomUUID(),
    runId,
    canonicalSubjectKey: canonicalKey(n),
    sourceEndpoint: 'notifications',
    repo: n.repository?.full_name ?? '',
    subjectType: n.subject?.type ?? 'Notification',
    subjectUrl: n.subject?.url ?? n.url,
    htmlUrl: n.subject?.latest_comment_url ?? n.repository?.html_url ?? n.url,
    updatedAt: n.updated_at,
    raw: { reason: n.reason, title: n.subject?.title, unread: n.unread },
  }));
}

function canonicalKey(n: any): string {
  return String(n.subject?.url ?? n.url ?? n.id).replace('https://api.github.com/repos/', 'github:');
}

function fixtureChanges(runId: string, owner: string): GitHubChange[] {
  const now = new Date().toISOString();
  const base = { runId, repo: `${owner}/sunrise`, subjectType: 'PullRequest', subjectUrl: 'https://api.github.com/repos/o/r/pulls/1', htmlUrl: 'https://github.com/o/r/pull/1', updatedAt: now };
  return [
    { ...base, id: crypto.randomUUID(), canonicalSubjectKey: 'github:o/r:pull:1', sourceEndpoint: 'notifications', raw: { reason: 'review_requested', title: 'Review dashboard PR' } },
    { ...base, id: crypto.randomUUID(), canonicalSubjectKey: 'github:o/r:pull:2', sourceEndpoint: 'search/authored-prs', raw: { author: owner, title: 'Green but unexplained', checks: 'success', hasVerificationSummary: false } },
    { ...base, id: crypto.randomUUID(), canonicalSubjectKey: 'github:o/r:readiness:agent', sourceEndpoint: 'contents', subjectType: 'Repository', raw: { title: 'sunrise missing agent instructions', hasAgentInstructions: false } },
  ];
}
