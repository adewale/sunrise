type Row = Record<string, any>;

const tables = ['settings','sessions','oauth_states','scan_runs','github_changes','action_items','item_evidence','rate_limit_snapshots','ignored_items'];

export function createMemoryDb(): D1Database {
  const store: Record<string, Row[]> = Object.fromEntries(tables.map((t) => [t, []]));
  const db = {
    prepare(sql: string) {
      let values: any[] = [];
      const stmt: any = {
        bind(...args: any[]) { values = args; return stmt; },
        async run() { execute(store, sql, values); return { success: true, meta: {} }; },
        async all() { return { results: select(store, sql, values), success: true, meta: {} }; },
        async first() { return select(store, sql, values)[0] ?? null; },
      };
      return stmt;
    },
    dump: () => store,
  };
  return db as unknown as D1Database;
}

function execute(store: Record<string, Row[]>, sql: string, v: any[]) {
  const normalized = sql.replace(/\s+/g, ' ').trim();
  if (/^INSERT INTO settings/i.test(normalized)) upsert(store.settings, 'key', row(['key','value','updated_at'], normalized.includes("'oauth_last_error'") ? ['oauth_last_error', v[0], v[1]] : v));
  else if (/^DELETE FROM settings/i.test(normalized)) store.settings = store.settings.filter((r) => r.key !== v[0]);
  else if (/^INSERT INTO sessions/i.test(normalized)) store.sessions.push(row(['id','github_login','github_id','access_token','expires_at','created_at'], literalOrBound(normalized, v)));
  else if (/^INSERT INTO oauth_states/i.test(normalized)) store.oauth_states.push(row(['state','code_verifier','expires_at','created_at'], v));
  else if (/^DELETE FROM oauth_states/i.test(normalized)) store.oauth_states = store.oauth_states.filter((r) => r.state !== v[0]);
  else if (/^DELETE FROM sessions/i.test(normalized)) store.sessions = store.sessions.filter((r) => r.id !== v[0]);
  else if (/^INSERT INTO scan_runs/i.test(normalized)) store.scan_runs.push({ id: v[0], trigger: v[1], status: v[2], started_at: v[3], candidate_count: v[4], processed_count: v[5] });
  else if (/^UPDATE scan_runs SET status/i.test(normalized)) { const r = byId(store.scan_runs, v.at(-1)); if (r) { r.status = v[0]; r.completed_at = v[1]; if (normalized.includes('candidate_count')) r.candidate_count = v[2]; else r.error = v[2]; } }
  else if (/^UPDATE scan_runs SET processed_count/i.test(normalized)) { const r = byId(store.scan_runs, v[0]); if (r) r.processed_count = (r.processed_count ?? 0) + 1; }
  else if (/^INSERT INTO github_changes/i.test(normalized)) upsert(store.github_changes, 'id', row(['id','run_id','canonical_subject_key','source_endpoint','repo','subject_type','subject_url','html_url','updated_at','raw_json','first_seen_at','last_seen_at'], v, { processing_status: 'pending', attempt_count: 0 }));
  else if (/^UPDATE github_changes/i.test(normalized)) { const r = byId(store.github_changes, v.at(-1)); if (r) { if (normalized.includes("'ignored'")) r.processing_status = 'ignored'; else if (normalized.includes("'processed'")) r.processing_status = 'processed'; else if (normalized.includes("'failed'")) { r.processing_status = 'failed'; r.last_error = v[0]; } r.attempt_count = (r.attempt_count ?? 0) + 1; } }
  else if (/^INSERT INTO action_items/i.test(normalized)) upsert(store.action_items, 'canonical_subject_key', row(['id','canonical_subject_key','kind','title','repo','url','updated_at','reason','suggested_action','evidence_json','source'], v, { ignored_at: null }));
  else if (/^DELETE FROM action_items/i.test(normalized)) store.action_items = store.action_items.filter((r) => r.canonical_subject_key !== v[0]);
  else if (/^INSERT INTO rate_limit_snapshots/i.test(normalized)) store.rate_limit_snapshots.push(row(['id','resource','remaining','reset_at','captured_at'], v));
  else if (/^INSERT INTO item_evidence/i.test(normalized)) store.item_evidence.push(row(['id','action_item_id','evidence_json','created_at'], v));
  else if (/^DELETE FROM item_evidence/i.test(normalized)) store.item_evidence = store.item_evidence.filter((r) => r.action_item_id !== v[0]);
  else if (/^INSERT OR IGNORE INTO ignored_items/i.test(normalized)) { if (!store.ignored_items.some((r) => r.canonical_subject_key === v[0])) store.ignored_items.push({ canonical_subject_key: v[0], reason: v[1], ignored_at: v[2] }); }
  else throw new Error(`Unsupported SQL run: ${sql}`);
}

function select(store: Record<string, Row[]>, sql: string, v: any[]) {
  const normalized = sql.replace(/\s+/g, ' ').trim();
  if (/FROM settings/i.test(normalized)) return store.settings.filter((r) => normalized.includes("oauth_last_error") ? r.key === 'oauth_last_error' : normalized.includes("inbox_page_size") ? r.key === 'inbox_page_size' : (!v[0] || r.key === v[0]));
  if (/FROM sessions/i.test(normalized)) return store.sessions.filter((r) => !v[0] || r.id === v[0]);
  if (/FROM oauth_states/i.test(normalized)) return v.length ? store.oauth_states.filter((r) => r.state === v[0]) : store.oauth_states;
  if (/COUNT\(\*\) AS count FROM github_changes/i.test(normalized)) {
    const status = /processing_status = '([^']+)'/i.exec(normalized)?.[1];
    return [{ count: store.github_changes.filter((r) => !status || r.processing_status === status).length }];
  }
  if (/FROM scan_runs/i.test(normalized)) {
    const rows = v.length ? store.scan_runs.filter((r) => r.id === v[0]) : store.scan_runs;
    return [...rows].sort(desc('started_at')).slice(0, normalized.includes('LIMIT 1') ? 1 : 10);
  }
  if (/FROM rate_limit_snapshots/i.test(normalized)) return [...store.rate_limit_snapshots].sort(desc('captured_at')).slice(0, 1);
  if (/FROM action_items/i.test(normalized)) return [...store.action_items].filter((r) => r.ignored_at == null).sort(desc('updated_at')).slice(0, normalized.includes('LIMIT 500') ? 500 : 50);
  if (/FROM github_changes/i.test(normalized)) return store.github_changes.filter((r) => !v[0] || r.id === v[0]);
  if (/FROM ignored_items/i.test(normalized)) return store.ignored_items.filter((r) => r.canonical_subject_key === v[0]);
  throw new Error(`Unsupported SQL select: ${sql}`);
}

function row(cols: string[], vals: any[], extra: Row = {}) { return { ...Object.fromEntries(cols.map((c, i) => [c, vals[i]])), ...extra }; }
function literalOrBound(sql: string, vals: any[]) {
  if (vals.length) return vals;
  const match = /VALUES \((.*)\)/i.exec(sql);
  if (!match) return vals;
  return [...match[1].matchAll(/'([^']*)'/g)].map((m) => m[1]);
}
function byId(rows: Row[], id: any) { return rows.find((r) => r.id === id); }
function upsert(rows: Row[], key: string, r: Row) { const i = rows.findIndex((x) => x[key] === r[key]); if (i >= 0) rows[i] = { ...rows[i], ...r }; else rows.push(r); }
function desc(key: string) { return (a: Row, b: Row) => Date.parse(b[key] ?? '0') - Date.parse(a[key] ?? '0'); }
