/**
 * Database schema. SQLite keeps the demo zero-dependency, but the schema is written to be
 * portable to PostgreSQL (no SQLite-only types; CHECK constraints model the enums).
 *
 * Design notes:
 *  - `authors` holds the business profile (from the dataset); `users` holds credentials and
 *    role. An author user links to exactly one author record; admins have no author_id.
 *  - `book_platforms` normalises the dataset's `available_on` array.
 *  - Author-visible conversation (`ticket_messages`) and admin-only `internal_notes` live in
 *    separate tables, so an author can never see a note through a forgotten WHERE clause.
 *  - `*_source` columns record whether category/priority came from the AI, the rules-based
 *    fallback, or an admin override — useful for measuring AI accuracy later.
 *  - `ai_usage` logs every model call (tokens, latency, outcome) for cost monitoring.
 */
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS authors (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  phone         TEXT,
  city          TEXT,
  joined_date   TEXT
);

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name          TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('author', 'admin')),
  author_id     TEXT REFERENCES authors(id),
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS books (
  id                        TEXT PRIMARY KEY,
  author_id                 TEXT NOT NULL REFERENCES authors(id),
  title                     TEXT NOT NULL,
  isbn                      TEXT,
  genre                     TEXT,
  publication_date          TEXT,
  status                    TEXT NOT NULL,
  mrp                       REAL,
  author_royalty_per_copy   REAL,
  total_copies_sold         INTEGER NOT NULL DEFAULT 0,
  total_royalty_earned      REAL NOT NULL DEFAULT 0,
  royalty_paid              REAL NOT NULL DEFAULT 0,
  royalty_pending           REAL NOT NULL DEFAULT 0,
  last_royalty_payout_date  TEXT,
  print_partner             TEXT
);
CREATE INDEX IF NOT EXISTS idx_books_author ON books(author_id);

CREATE TABLE IF NOT EXISTS book_platforms (
  book_id   TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  platform  TEXT NOT NULL,
  PRIMARY KEY (book_id, platform)
);

CREATE TABLE IF NOT EXISTS tickets (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  author_id             TEXT NOT NULL REFERENCES authors(id),
  book_id               TEXT REFERENCES books(id),
  subject               TEXT NOT NULL,
  description           TEXT NOT NULL,
  status                TEXT NOT NULL DEFAULT 'Open'
                        CHECK (status IN ('Open', 'In Progress', 'Resolved', 'Closed')),
  category              TEXT,
  category_source       TEXT CHECK (category_source IN ('ai', 'fallback', 'admin')),
  priority              TEXT CHECK (priority IN ('Critical', 'High', 'Medium', 'Low')),
  priority_source       TEXT CHECK (priority_source IN ('ai', 'fallback', 'admin')),
  ai_reasoning          TEXT,
  classification_status TEXT NOT NULL DEFAULT 'pending'
                        CHECK (classification_status IN ('pending', 'done', 'fallback')),
  assigned_admin_id     INTEGER REFERENCES users(id),
  ai_draft              TEXT,
  ai_draft_meta         TEXT, -- JSON: escalation, checklist, suggested status
  ai_draft_source       TEXT CHECK (ai_draft_source IN ('ai', 'template')),
  ai_draft_message_count INTEGER,
  ai_draft_generated_at TEXT,
  first_response_at     TEXT,
  resolved_at           TEXT,
  created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_tickets_author ON tickets(author_id);
CREATE INDEX IF NOT EXISTS idx_tickets_queue ON tickets(status, priority, created_at);

CREATE TABLE IF NOT EXISTS ticket_messages (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id       INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  sender_role     TEXT NOT NULL CHECK (sender_role IN ('author', 'admin')),
  sender_user_id  INTEGER NOT NULL REFERENCES users(id),
  body            TEXT NOT NULL,
  ai_assisted     INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_messages_ticket ON ticket_messages(ticket_id);

CREATE TABLE IF NOT EXISTS internal_notes (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id       INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  admin_user_id   INTEGER NOT NULL REFERENCES users(id),
  body            TEXT NOT NULL,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_notes_ticket ON internal_notes(ticket_id);

CREATE TABLE IF NOT EXISTS ticket_attachments (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id       INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  original_name   TEXT NOT NULL,
  stored_name     TEXT NOT NULL,
  mime_type       TEXT NOT NULL,
  size_bytes      INTEGER NOT NULL,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Audit trail: status changes, overrides, assignments. Shown to admins as a timeline.
CREATE TABLE IF NOT EXISTS ticket_events (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id       INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  actor_user_id   INTEGER REFERENCES users(id),
  type            TEXT NOT NULL,
  detail          TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_events_ticket ON ticket_events(ticket_id);

CREATE TABLE IF NOT EXISTS ai_usage (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id           INTEGER REFERENCES tickets(id) ON DELETE SET NULL,
  operation           TEXT NOT NULL CHECK (operation IN ('classify', 'draft')),
  model               TEXT NOT NULL,
  success             INTEGER NOT NULL,
  input_tokens        INTEGER,
  output_tokens       INTEGER,
  cache_read_tokens   INTEGER,
  cache_write_tokens  INTEGER,
  latency_ms          INTEGER,
  error               TEXT,
  created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
`;
