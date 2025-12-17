CREATE TABLE IF NOT EXISTS recipes_inbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  slug TEXT,
  payload TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_recipes_inbox_status ON recipes_inbox (status);
CREATE INDEX IF NOT EXISTS idx_recipes_inbox_created_at ON recipes_inbox (created_at);
