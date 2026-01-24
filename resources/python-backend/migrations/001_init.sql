PRAGMA journal_mode=WAL;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS app_state (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  started_at REAL NOT NULL,
  ended_at REAL,
  duration_sec REAL,
  client_type TEXT NOT NULL,
  user_id TEXT,
  personality_id TEXT
);

CREATE TABLE IF NOT EXISTS personalities (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  prompt TEXT NOT NULL,
  short_description TEXT,
  tags TEXT,
  is_visible BOOLEAN DEFAULT 1,
  voice_id TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  role TEXT NOT NULL,
  transcript TEXT NOT NULL,
  timestamp REAL NOT NULL,
  session_id TEXT
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  age INTEGER,
  dob TEXT,
  hobbies TEXT,
  personality_type TEXT,
  likes TEXT,
  current_personality_id TEXT,
  user_type TEXT DEFAULT 'family',
  device_volume INTEGER DEFAULT 70,
  FOREIGN KEY (current_personality_id) REFERENCES personalities (id)
);

ALTER TABLE personalities ADD COLUMN is_global BOOLEAN DEFAULT 0;

PRAGMA foreign_keys=ON;

CREATE TABLE IF NOT EXISTS voices (
  voice_id TEXT PRIMARY KEY,
  gender TEXT,
  voice_name TEXT NOT NULL,
  voice_description TEXT,
  voice_src TEXT,
  is_global BOOLEAN DEFAULT 0
);

ALTER TABLE personalities ADD COLUMN img_src TEXT;

PRAGMA foreign_keys=OFF;

-- Add created_at for ordering
ALTER TABLE voices ADD COLUMN created_at REAL;
UPDATE voices SET created_at = COALESCE(created_at, strftime('%s','now'));

ALTER TABLE personalities ADD COLUMN created_at REAL;
UPDATE personalities SET created_at = COALESCE(created_at, strftime('%s','now'));

-- Replace hobbies tags with a single about_you string (keep hobbies column for backward compatibility)
ALTER TABLE users ADD COLUMN about_you TEXT;
UPDATE users SET about_you = COALESCE(about_you, '');

-- Global (per-laptop) volume lives in app_state
INSERT INTO app_state (key, value)
VALUES ('laptop_volume', '70')
ON CONFLICT(key) DO NOTHING;

PRAGMA foreign_keys=ON;
