CREATE TABLE IF NOT EXISTS action_items_new (
  id TEXT PRIMARY KEY,
  canonical_subject_key TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  repo TEXT NOT NULL,
  url TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  reason TEXT NOT NULL,
  suggested_action TEXT NOT NULL,
  evidence_json TEXT,
  source TEXT NOT NULL,
  ignored_at TEXT
);

INSERT OR REPLACE INTO action_items_new (id, canonical_subject_key, kind, title, repo, url, updated_at, reason, suggested_action, evidence_json, source, ignored_at)
SELECT id, canonical_subject_key, kind, title, repo, url, updated_at, reason, suggested_action, evidence_json, source, ignored_at
FROM action_items;

DROP TABLE action_items;
ALTER TABLE action_items_new RENAME TO action_items;

CREATE INDEX IF NOT EXISTS idx_action_items_kind_updated ON action_items(kind, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_action_items_updated_at ON action_items(updated_at DESC);
PRAGMA optimize;
