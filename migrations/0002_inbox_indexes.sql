CREATE INDEX IF NOT EXISTS idx_action_items_updated_at
  ON action_items(updated_at DESC);
