export default `
CREATE TABLE projects (
  name     TEXT PRIMARY KEY,
  path     TEXT NOT NULL,
  team_key TEXT NOT NULL
);

CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE sessions (
  id            TEXT PRIMARY KEY,
  kind          TEXT NOT NULL,
  project       TEXT,
  ticket        TEXT,
  cwd           TEXT NOT NULL,
  model         TEXT,
  effort        TEXT,
  brainstorming INTEGER NOT NULL DEFAULT 0,
  state         TEXT NOT NULL,
  alert         TEXT,
  created_at    INTEGER NOT NULL,
  last_event_at INTEGER NOT NULL
);
CREATE INDEX sessions_ticket ON sessions (ticket);

CREATE TABLE sdk_tasks (
  id         TEXT PRIMARY KEY,
  type       TEXT NOT NULL,
  input      TEXT NOT NULL,
  status     TEXT NOT NULL,
  log        TEXT NOT NULL DEFAULT '[]',
  error      TEXT,
  result     TEXT,
  archived   INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
`;
