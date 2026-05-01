CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS oauth_states (state TEXT PRIMARY KEY, code_verifier TEXT NOT NULL, expires_at TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, github_login TEXT NOT NULL, github_id TEXT, access_token TEXT NOT NULL, expires_at TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS scan_runs (id TEXT PRIMARY KEY, trigger TEXT NOT NULL, status TEXT NOT NULL, started_at TEXT NOT NULL, completed_at TEXT, candidate_count INTEGER DEFAULT 0, processed_count INTEGER DEFAULT 0, error TEXT);
CREATE TABLE IF NOT EXISTS github_changes (id TEXT PRIMARY KEY, run_id TEXT NOT NULL, canonical_subject_key TEXT NOT NULL, source_endpoint TEXT NOT NULL, repo TEXT, subject_type TEXT, subject_url TEXT, html_url TEXT, updated_at TEXT NOT NULL, raw_json TEXT NOT NULL, first_seen_at TEXT NOT NULL, last_seen_at TEXT NOT NULL, processing_status TEXT NOT NULL, attempt_count INTEGER DEFAULT 0, last_error TEXT);
CREATE TABLE IF NOT EXISTS action_items (id TEXT PRIMARY KEY, canonical_subject_key TEXT NOT NULL UNIQUE, kind TEXT NOT NULL, title TEXT NOT NULL, repo TEXT NOT NULL, url TEXT NOT NULL, updated_at TEXT NOT NULL, reason TEXT NOT NULL, suggested_action TEXT NOT NULL, evidence_json TEXT, source TEXT NOT NULL, ignored_at TEXT);
CREATE TABLE IF NOT EXISTS item_evidence (id TEXT PRIMARY KEY, action_item_id TEXT NOT NULL, evidence_json TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS rate_limit_snapshots (id TEXT PRIMARY KEY, resource TEXT, remaining INTEGER, reset_at TEXT, captured_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS ignored_items (canonical_subject_key TEXT PRIMARY KEY, reason TEXT, ignored_at TEXT NOT NULL);

CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_oauth_states_state ON oauth_states(state);
CREATE INDEX IF NOT EXISTS idx_scan_runs_started_at ON scan_runs(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_github_changes_status_updated ON github_changes(processing_status, updated_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_github_changes_canonical_subject ON github_changes(canonical_subject_key, source_endpoint, updated_at);
CREATE INDEX IF NOT EXISTS idx_action_items_kind_updated ON action_items(kind, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_item_evidence_action_item ON item_evidence(action_item_id);
CREATE INDEX IF NOT EXISTS idx_ignored_items_subject ON ignored_items(canonical_subject_key);
PRAGMA optimize;
