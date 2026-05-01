# D1 query plan checks

Date: 2026-05-01

Run these checks after migrations on any deployed database:

```sh
wrangler d1 execute DB --remote --command "EXPLAIN QUERY PLAN SELECT * FROM action_items WHERE ignored_at IS NULL ORDER BY updated_at DESC LIMIT 500"
wrangler d1 execute DB --remote --command "EXPLAIN QUERY PLAN SELECT * FROM scan_runs ORDER BY started_at DESC LIMIT 1"
wrangler d1 execute DB --remote --command "EXPLAIN QUERY PLAN SELECT * FROM rate_limit_snapshots ORDER BY captured_at DESC LIMIT 1"
wrangler d1 execute DB --remote --command "EXPLAIN QUERY PLAN SELECT COUNT(*) AS count FROM github_changes WHERE processing_status = 'pending'"
```

Expected index usage:

- `action_items` should use `idx_action_items_updated_at` for reverse-chronological inbox reads.
- `scan_runs` should use `idx_scan_runs_started_at`.
- `github_changes` count queries should use `idx_github_changes_status_updated`.

Latest live check against `sunrise-deploy` after `migrations/0002_inbox_indexes.sql`:

```txt
EXPLAIN QUERY PLAN SELECT * FROM action_items WHERE ignored_at IS NULL ORDER BY updated_at DESC LIMIT 500
→ SCAN action_items USING INDEX idx_action_items_updated_at

EXPLAIN QUERY PLAN SELECT * FROM scan_runs ORDER BY started_at DESC LIMIT 1
→ SCAN scan_runs USING INDEX idx_scan_runs_started_at

EXPLAIN QUERY PLAN SELECT COUNT(*) AS count FROM github_changes WHERE processing_status = 'pending'
→ SEARCH github_changes USING COVERING INDEX idx_github_changes_status_updated (processing_status=?)
```
