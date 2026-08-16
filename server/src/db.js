require('dotenv').config();
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// DATA_DIR can be pointed at a mounted persistent volume (Railway Volume,
// Render Disk, etc.) so the SQLite file — and locally-stored uploads —
// survive redeploys instead of resetting every time the container rebuilds.
//
//   1. Explicit DATA_DIR env var always wins.
//   2. RAILWAY_VOLUME_MOUNT_PATH is set automatically by Railway once a
//      Volume is attached to the service, so we pick it up with zero config
//      the moment a volume exists — see DEPLOY.md for the one-time setup.
//   3. Falls back to server/data for local dev / no-volume deploys.
const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : process.env.RAILWAY_VOLUME_MOUNT_PATH
    ? path.resolve(process.env.RAILWAY_VOLUME_MOUNT_PATH)
    : path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'tomodachi.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  username      TEXT UNIQUE,
  phone         TEXT UNIQUE NOT NULL,
  name          TEXT NOT NULL,
  about         TEXT DEFAULT 'Hey there! I am using 友達.',
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
  type       TEXT DEFAULT 'text',               -- text | image | song
  body       TEXT,
  media_url  TEXT,
  bg         TEXT DEFAULT '#075E54',
  song       TEXT,                               -- JSON blob: {id,name,artist,albumArt,previewUrl,url}
  audience   TEXT DEFAULT 'public',              -- public | contacts | selected
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

/* audience list for 'selected' (hand-picked) private statuses */
CREATE TABLE IF NOT EXISTS status_recipients (
  status_id TEXT NOT NULL,
  user_id   TEXT NOT NULL,
  PRIMARY KEY (status_id, user_id),
  FOREIGN KEY (status_id) REFERENCES statuses(id) ON DELETE CASCADE
);

/* ---- The Network: public, worldwide posts ---- */

CREATE TABLE IF NOT EXISTS posts (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  title      TEXT DEFAULT '',
  body       TEXT NOT NULL DEFAULT '',
  media_url  TEXT,
  song       TEXT,
  tag        TEXT,
  audience   TEXT DEFAULT 'public',
  created_at INTEGER NOT NULL,
  deleted    INTEGER DEFAULT 0,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_posts_created ON posts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_tag ON posts(tag);

/* audience list for 'selected' (hand-picked) private posts */
CREATE TABLE IF NOT EXISTS post_recipients (
  post_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  PRIMARY KEY (post_id, user_id),
  FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
);

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

/* ---- Communities: purpose-based groups (club night, house party, trip planning, etc.) ---- */

CREATE TABLE IF NOT EXISTS communities (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  description   TEXT DEFAULT '',
  category      TEXT DEFAULT 'custom',   -- club | party | chai | trip | run | custom | ...
  avatar        TEXT,
  chat_id       TEXT,                     -- linked group chat (created alongside)
  created_by    TEXT NOT NULL,
  join_policy   TEXT DEFAULT 'request',   -- open | request | invite
  visibility    TEXT DEFAULT 'public',    -- public (discoverable) | unlisted (link/invite only)
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_communities_category ON communities(category);

CREATE TABLE IF NOT EXISTS community_members (
  community_id TEXT NOT NULL,
  user_id      TEXT NOT NULL,
  role         TEXT DEFAULT 'member',    -- admin | member
  joined_at    INTEGER NOT NULL,
  PRIMARY KEY (community_id, user_id),
  FOREIGN KEY (community_id) REFERENCES communities(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

/* pending join requests when join_policy = 'request' */
CREATE TABLE IF NOT EXISTS community_requests (
  community_id TEXT NOT NULL,
  user_id      TEXT NOT NULL,
  requested_at INTEGER NOT NULL,
  PRIMARY KEY (community_id, user_id),
  FOREIGN KEY (community_id) REFERENCES communities(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

/* ---- Blocking: real, server-enforced (not cosmetic) ---- */
CREATE TABLE IF NOT EXISTS blocked_users (
  blocker_id TEXT NOT NULL,
  blocked_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (blocker_id, blocked_id),
  FOREIGN KEY (blocker_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (blocked_id) REFERENCES users(id) ON DELETE CASCADE
);
`);

/* ---- lightweight migrations for columns added after initial release ---- */
function addColumnIfMissing(table, column, ddl) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!cols.includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
}
addColumnIfMissing('users', 'username', 'username TEXT');
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(username)');
addColumnIfMissing('statuses', 'song', 'song TEXT');
addColumnIfMissing('statuses', 'audience', "audience TEXT DEFAULT 'public'");
addColumnIfMissing('posts', 'song', 'song TEXT');
addColumnIfMissing('posts', 'audience', "audience TEXT DEFAULT 'public'");
// A single JSON blob for notification/privacy preferences — avoids a new
// migration every time a toggle is added. Server validates/merges keys
// (see DEFAULT_SETTINGS + sanitizeSettings in index.js) so bad client
// input can't corrupt it or add arbitrary keys.
addColumnIfMissing('users', 'settings', "settings TEXT DEFAULT '{}'");

module.exports = db;
module.exports.DATA_DIR = DATA_DIR;
