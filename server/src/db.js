const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'broskie.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  phone         TEXT UNIQUE NOT NULL,
  name          TEXT NOT NULL,
  about         TEXT DEFAULT 'Hey there! I am using BROSKIE.',
  avatar        TEXT,
  password_hash TEXT NOT NULL,
  last_seen     INTEGER DEFAULT 0,
  is_online     INTEGER DEFAULT 0,
  created_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS chats (
  id          TEXT PRIMARY KEY,
  type        TEXT NOT NULL DEFAULT 'direct',   -- direct | group
  name        TEXT,                              -- group name
  avatar      TEXT,
  created_by  TEXT,
  archived_by TEXT DEFAULT '',                   -- csv of user ids
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS chat_members (
  chat_id   TEXT NOT NULL,
  user_id   TEXT NOT NULL,
  role      TEXT DEFAULT 'member',              -- admin | member
  joined_at INTEGER NOT NULL,
  muted     INTEGER DEFAULT 0,
  PRIMARY KEY (chat_id, user_id),
  FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS messages (
  id           TEXT PRIMARY KEY,
  chat_id      TEXT NOT NULL,
  sender_id    TEXT NOT NULL,
  type         TEXT NOT NULL DEFAULT 'text',    -- text | image | voice | system
  body         TEXT DEFAULT '',
  media_url    TEXT,
  duration     INTEGER DEFAULT 0,               -- voice note seconds
  reply_to     TEXT,
  deleted      INTEGER DEFAULT 0,
  created_at   INTEGER NOT NULL,
  FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_messages_chat ON messages(chat_id, created_at);

CREATE TABLE IF NOT EXISTS receipts (
  message_id TEXT NOT NULL,
  user_id    TEXT NOT NULL,
  state      TEXT NOT NULL,                     -- delivered | read
  at         INTEGER NOT NULL,
  PRIMARY KEY (message_id, user_id, state)
);

CREATE TABLE IF NOT EXISTS reactions (
  message_id TEXT NOT NULL,
  user_id    TEXT NOT NULL,
  emoji      TEXT NOT NULL,
  PRIMARY KEY (message_id, user_id)
);

CREATE TABLE IF NOT EXISTS statuses (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  type       TEXT DEFAULT 'text',               -- text | image
  body       TEXT,
  media_url  TEXT,
  bg         TEXT DEFAULT '#075E54',
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS status_views (
  status_id TEXT NOT NULL,
  user_id   TEXT NOT NULL,
  at        INTEGER NOT NULL,
  PRIMARY KEY (status_id, user_id)
);

/* ---- The Network: public, worldwide posts ---- */

CREATE TABLE IF NOT EXISTS posts (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  title      TEXT DEFAULT '',
  body       TEXT NOT NULL DEFAULT '',
  media_url  TEXT,
  tag        TEXT,
  created_at INTEGER NOT NULL,
  deleted    INTEGER DEFAULT 0,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_posts_created ON posts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_tag ON posts(tag);

CREATE TABLE IF NOT EXISTS post_likes (
  post_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  at      INTEGER NOT NULL,
  PRIMARY KEY (post_id, user_id),
  FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS post_comments (
  id         TEXT PRIMARY KEY,
  post_id    TEXT NOT NULL,
  user_id    TEXT NOT NULL,
  body       TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_comments_post ON post_comments(post_id, created_at);
`);

module.exports = db;
