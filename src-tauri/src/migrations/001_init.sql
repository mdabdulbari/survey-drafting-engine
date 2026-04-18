CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  laz_path TEXT NOT NULL,
  copc_path TEXT NOT NULL,
  copc_ready INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
