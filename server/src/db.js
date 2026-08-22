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
const usingPersistentVolume = !!(process.env.DATA_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH);
const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : process.env.RAILWAY_VOLUME_MOUNT_PATH
    ? path.resolve(process.env.RAILWAY_VOLUME_MOUNT_PATH)
    : path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// Loud, impossible-to-miss startup warning when running on a known
// ephemeral-disk host (Railway or Render, detected via the env vars they
// auto-inject — not NODE_ENV, which Railway doesn't reliably set) with no
// volume attached: every redeploy on those hosts wipes the container's own
// disk, so without DATA_DIR/RAILWAY_VOLUME_MOUNT_PATH set, all users/chats/
// messages/posts/communities silently disappear on the next push. This is
// the actual failure mode behind "I pushed an update and lost my data" —
// surfacing it at boot means it shows up in deploy logs immediately
// instead of being discovered after the fact.
const onKnownEphemeralHost = !!(process.env.RAILWAY_ENVIRONMENT || process.env.RENDER);
if (!usingPersistentVolume && onKnownEphemeralHost) {
  console.warn(
    '\n⚠️  ⚠️  ⚠️  NO PERSISTENT STORAGE CONFIGURED  ⚠️  ⚠️  ⚠️\n' +
    '  The database is being written to the container\'s own ephemeral disk.\n' +
    '  On Railway/Render, EVERY REDEPLOY WIPES THIS — all users, chats,\n' +
    '  messages, statuses, posts and communities will be permanently lost\n' +
    '  the next time you push an update.\n\n' +
    '  Fix: attach a persistent volume and it will be picked up automatically.\n' +
    '    Railway → your service → Volumes tab → New Volume (auto-detected via\n' +
    '      RAILWAY_VOLUME_MOUNT_PATH, no other config needed)\n' +
    '    Render  → your service → Disks → Add Disk, then set DATA_DIR to its\n' +
    '      mount path (Render Disks require a paid plan)\n' +
    '  See DEPLOY.md → "Never lose data on deploy" for full steps.\n'
  );
}

const db = new Database(path.join(DATA_DIR, 'tomodachi.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  username      TEXT UNIQUE,
  username_key  TEXT,
  phone         TEXT UNIQUE NOT NULL,
  name          TEXT NOT NULL,
  about         TEXT DEFAULT 'Hey there! I am using +one.',
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

/* Incoming direct messages from people outside accepted contacts live here
   until the receiver accepts, deletes, or blocks the request. Existing direct
   chats have no row and remain accepted for backward compatibility. */
CREATE TABLE IF NOT EXISTS chat_requests (
  chat_id      TEXT PRIMARY KEY,
  sender_id    TEXT NOT NULL,
  receiver_id  TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'pending', -- pending | accepted
  created_at   INTEGER NOT NULL,
  responded_at INTEGER,
  FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE CASCADE,
  FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (receiver_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_chat_requests_receiver ON chat_requests(receiver_id, status, created_at);

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
  media_aspect REAL,
  bg         TEXT DEFAULT '#075E54',
  song       TEXT,                               -- JSON blob: {id,name,artist,albumArt,previewUrl,url}
  audience   TEXT DEFAULT 'public',              -- public | contacts | contacts_except | selected
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
  media_aspect REAL,
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

/* ---- GCs: Instagram-style group chats (chats.type = 'gc') ----
   A GC is a real chat (messages/receipts/sockets all reused) that lives in
   the dedicated GC section instead of the main Chats inbox. Anyone can
   discover one and join — instantly when privacy = 'open', or via an
   admin-approved request when privacy = 'request'. */
CREATE TABLE IF NOT EXISTS gcs (
  chat_id     TEXT PRIMARY KEY,
  description TEXT DEFAULT '',
  privacy     TEXT NOT NULL DEFAULT 'request',   -- open | request
  created_at  INTEGER NOT NULL,
  FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS gc_requests (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id      TEXT NOT NULL,
  user_id      TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'pending',  -- pending (rows are removed once handled)
  created_at   INTEGER NOT NULL,
  UNIQUE (chat_id, user_id),
  FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_gc_requests_chat ON gc_requests(chat_id, status);


/* ---- Colleagues: discover people through shared places ---- */
CREATE TABLE IF NOT EXISTS affiliations (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  type            TEXT NOT NULL,                 -- institution | organization | workplace
  created_by      TEXT NOT NULL,
  created_at      INTEGER NOT NULL,
  UNIQUE (type, normalized_name),
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_affiliations_type_name ON affiliations(type, normalized_name);

CREATE TABLE IF NOT EXISTS user_affiliations (
  user_id       TEXT NOT NULL,
  affiliation_id TEXT NOT NULL,
  title         TEXT DEFAULT '',                 -- course, department, role, etc.
  joined_at     INTEGER NOT NULL,
  PRIMARY KEY (user_id, affiliation_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (affiliation_id) REFERENCES affiliations(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_user_affiliations_affiliation ON user_affiliations(affiliation_id, joined_at);

CREATE TABLE IF NOT EXISTS colleague_requests (
  id           TEXT PRIMARY KEY,
  sender_id    TEXT NOT NULL,
  receiver_id  TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'pending',  -- pending | accepted | declined | cancelled
  created_at   INTEGER NOT NULL,
  responded_at INTEGER,
  FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (receiver_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_colleague_requests_receiver ON colleague_requests(receiver_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_colleague_requests_sender ON colleague_requests(sender_id, status, created_at);
/* One pending request per unordered pair, so crossing requests cannot duplicate. */
CREATE UNIQUE INDEX IF NOT EXISTS idx_colleague_pending_pair
ON colleague_requests (
  CASE WHEN sender_id < receiver_id THEN sender_id ELSE receiver_id END,
  CASE WHEN sender_id < receiver_id THEN receiver_id ELSE sender_id END
) WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS colleague_connections (
  user_a     TEXT NOT NULL,
  user_b     TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_a, user_b),
  CHECK (user_a < user_b),
  FOREIGN KEY (user_a) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (user_b) REFERENCES users(id) ON DELETE CASCADE
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

/* ---- Calls: real WebRTC voice/video calling (1:1), signalled over Socket.IO ---- */
CREATE TABLE IF NOT EXISTS calls (
  id           TEXT PRIMARY KEY,
  chat_id      TEXT NOT NULL,
  caller_id    TEXT NOT NULL,
  callee_id    TEXT NOT NULL,
  type         TEXT NOT NULL DEFAULT 'audio',   -- audio | video
  status       TEXT NOT NULL DEFAULT 'ringing', -- ringing | ongoing | ended | missed | declined | busy | failed
  started_at   INTEGER NOT NULL,
  answered_at  INTEGER,
  ended_at     INTEGER,
  ended_reason TEXT,                             -- hangup | declined | missed | busy | failed
  FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE CASCADE,
  FOREIGN KEY (caller_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (callee_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_calls_participants ON calls(caller_id, callee_id, started_at);
`);

/* Branding migration: update only the untouched legacy default; custom user
   bios are never modified. Technical database/storage names intentionally
   remain "tomodachi" so existing production data and installed sessions keep working. */
db.prepare("UPDATE users SET about = 'Hey there! I am using +one.' WHERE about = 'Hey there! I am using 友達.'").run();

/* ---- lightweight migrations for columns added after initial release ---- */
function addColumnIfMissing(table, column, ddl) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!cols.includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
}
addColumnIfMissing('users', 'username', 'username TEXT');
addColumnIfMissing('users', 'username_key', 'username_key TEXT');
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(username)');
// Every legacy username was already stored as lowercase ASCII. Backfill a
// canonical lookup key once, while keeping the visible username untouched.
db.exec("UPDATE users SET username_key = lower(trim(username)) WHERE username IS NOT NULL AND (username_key IS NULL OR username_key = '')");
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_key ON users(username_key) WHERE username_key IS NOT NULL');
addColumnIfMissing('statuses', 'song', 'song TEXT');
addColumnIfMissing('statuses', 'audience', "audience TEXT DEFAULT 'public'");
addColumnIfMissing('statuses', 'media_aspect', 'media_aspect REAL');
addColumnIfMissing('posts', 'song', 'song TEXT');
addColumnIfMissing('posts', 'audience', "audience TEXT DEFAULT 'public'");
addColumnIfMissing('posts', 'media_aspect', 'media_aspect REAL');
// Safety & moderation: backend roles (user | admin) + enforcement state.
// Access to the Admin Safety Center is role-based and verified server-side
// on every request — never a username check in the client.
addColumnIfMissing('users', 'role', "role TEXT DEFAULT 'user'");
addColumnIfMissing('users', 'moderation', "moderation TEXT DEFAULT 'active'"); // active|warned|restricted|suspended|banned
addColumnIfMissing('users', 'suspended_until', 'suspended_until INTEGER');
// Admin-managed verification badge. Stored per account so it is visible everywhere.
addColumnIfMissing('users', 'gold_tick', 'gold_tick INTEGER NOT NULL DEFAULT 0');

// Phase 3: community invite links — short unique code per community; admins
// can regenerate it. A valid code joins regardless of join_policy.
addColumnIfMissing('communities', 'invite_code', "invite_code TEXT");
try { db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_communities_invite_code ON communities(invite_code) WHERE invite_code IS NOT NULL'); } catch {}
// Backfill: every existing community gets a code once.
db.exec(`UPDATE communities SET invite_code = lower(hex(randomblob(4))) WHERE invite_code IS NULL OR invite_code = ''`);

// A single JSON blob for notification/privacy preferences — avoids a new
// migration every time a toggle is added. Server validates/merges keys
// (see DEFAULT_SETTINGS + sanitizeSettings in index.js) so bad client
// input can't corrupt it or add arbitrary keys.
addColumnIfMissing('users', 'settings', "settings TEXT DEFAULT '{}'");

/* ---- feature migrations: disappearing messages, edits, forwards, polls ---- */
// Per-chat default disappearing-message timer (seconds; 0 = off). Applied to
// new messages unless a per-message override is sent.
addColumnIfMissing('chats', 'disappear_seconds', 'disappear_seconds INTEGER DEFAULT 0');
// Per-conversation chat theme. The theme belongs to the conversation (not the
// user): everyone in the chat sees the same theme. theme_id is validated
// against the server-side allow-list (see CHAT_THEMES in index.js) — arbitrary
// client-provided ids/colors are never accepted. theme_updated_by/at record
// who changed it and when, for the realtime "changed the chat theme" notice.
addColumnIfMissing('chats', 'theme_id', "theme_id TEXT DEFAULT 'graphite'");
addColumnIfMissing('chats', 'theme_updated_by', 'theme_updated_by TEXT');
addColumnIfMissing('chats', 'theme_updated_at', 'theme_updated_at INTEGER');
// Per-user chat-list state lives on membership rows.
addColumnIfMissing('chat_members', 'pinned_at', 'pinned_at INTEGER');
// Messages at or before this timestamp are hidden for that user after
// "Delete chat"; a later incoming/outgoing message makes the chat reappear.
addColumnIfMissing('chat_members', 'cleared_at', 'cleared_at INTEGER');
// messages: expires_at (disappearing), edited flag, forwarded provenance,
// and an optional link to a poll created alongside the message.
addColumnIfMissing('messages', 'expires_at', 'expires_at INTEGER');
addColumnIfMissing('messages', 'edited', 'edited INTEGER DEFAULT 0');
addColumnIfMissing('messages', 'forwarded_from', 'forwarded_from TEXT');
addColumnIfMissing('messages', 'poll_id', 'poll_id TEXT');
addColumnIfMissing('messages', 'client_id', 'client_id TEXT');
addColumnIfMissing('messages', 'client_created_at', 'client_created_at INTEGER');
addColumnIfMissing('messages', 'updated_at', 'updated_at INTEGER');
addColumnIfMissing('messages', 'media_thumb_url', 'media_thumb_url TEXT');
// "Delete for me": csv of user ids who hid this message only on their own
// devices. Unlike the global `deleted` flag ("delete for everyone"), this
// never removes the message for other participants.
addColumnIfMissing('messages', 'hidden_for', 'hidden_for TEXT DEFAULT \'\'');
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_client_id ON messages(client_id) WHERE client_id IS NOT NULL');
db.exec('CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages(sender_id, created_at)');
db.exec('CREATE INDEX IF NOT EXISTS idx_messages_updated ON messages(chat_id, updated_at)');
db.exec("UPDATE messages SET client_id = id WHERE client_id IS NULL");
db.exec('UPDATE messages SET client_created_at = created_at WHERE client_created_at IS NULL');
db.exec('UPDATE messages SET updated_at = created_at WHERE updated_at IS NULL');

/* ---- status replies: every reply is also a chat message with a status reference (gentle update, no rebuild) ---- */
addColumnIfMissing('messages', 'status_id', 'status_id TEXT');
addColumnIfMissing('messages', 'status_snapshot', 'status_snapshot TEXT');
try { db.exec('CREATE INDEX IF NOT EXISTS idx_messages_status_id ON messages(status_id) WHERE status_id IS NOT NULL'); } catch {}

/* ---- push notifications (Expo push) ---- */
/* One row per registered device token. The token itself is the primary key:
   a device that signs in as a different user simply reassigns its row, so a
   token can never ping two accounts at once. Tokens are deleted by the client
   on logout (best-effort) and by the server whenever Expo reports the
   registration as gone (DeviceNotRegistered). */
db.exec(`
CREATE TABLE IF NOT EXISTS push_tokens (
  token       TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  platform    TEXT DEFAULT 'android',   -- android | ios | web
  device_id   TEXT,
  app_version TEXT,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_push_tokens_user ON push_tokens(user_id);

/* ---- Phase 2: the daily campus loop ---- */

/* Follow a person from the Network so the feed can be "Following" instead of
   a global firehose. Lightweight, one-way, no approval. */
CREATE TABLE IF NOT EXISTS follows (
  follower_id TEXT NOT NULL,
  followed_id TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (follower_id, followed_id),
  FOREIGN KEY (follower_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (followed_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_follows_followed ON follows(followed_id);

/* "I'm around" — a 12-hour presence flag for your shared places. One row per
   user; re-upping extends it. Row is deleted on "not around" and lazily when
   expired (mirrors statuses' expiry sweep). */
CREATE TABLE IF NOT EXISTS around_status (
  user_id    TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_around_expires ON around_status(expires_at);
`);

/* ---- Phase 3: web push + community invite links ---- */

db.exec(`
/* Browser Push API subscriptions (Chrome/Edge/Firefox, Safari 16.4+ as an
   installed PWA). The server signs sends itself with VAPID keys — unlike the
   Android/iOS Expo path, no third-party push service sits in the middle. */
CREATE TABLE IF NOT EXISTS web_push_subscriptions (
  endpoint   TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  subscription TEXT NOT NULL,   -- full PushSubscription JSON
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_web_push_user ON web_push_subscriptions(user_id);
`);

db.exec(`
/* ---- Safety & Moderation Center (admin-only) ----
   Evidence is kept minimal: message/chat ids plus a bounded text snapshot.
   Private conversations are never bulk-copied — the pipeline stores only
   what a serious safety event needs for human review. */

CREATE TABLE IF NOT EXISTS moderation_cases (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      TEXT NOT NULL,             -- flagged user
  chat_id      TEXT,
  message_id   TEXT,
  category     TEXT NOT NULL,             -- threat|violence|hate|harassment|self_harm|sexual_exploitation|child_safety|extremism|illegal|spam|scam|doxxing|graphic_violence|weapons|dangerous|profanity|other
  severity     TEXT NOT NULL,             -- INFO|LOW|MEDIUM|HIGH|CRITICAL
  confidence   REAL DEFAULT 0,            -- 0..1
  source       TEXT NOT NULL DEFAULT 'auto',  -- auto | user | mixed
  signals      INTEGER DEFAULT 1,         -- dedup/aggregation counter
  reason       TEXT,
  snapshot     TEXT,                      -- bounded excerpt of the flagged message
  status       TEXT NOT NULL DEFAULT 'OPEN', -- OPEN|UNDER_REVIEW|CONFIRMED|FALSE_POSITIVE|ACTION_TAKEN|ESCALATED|CLOSED
  action_taken TEXT,
  reviewed_by  TEXT,
  reviewed_at  INTEGER,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mod_cases_status ON moderation_cases(status, severity);
CREATE INDEX IF NOT EXISTS idx_mod_cases_user ON moderation_cases(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_mod_cases_message ON moderation_cases(message_id);

CREATE TABLE IF NOT EXISTS moderation_reports (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id     INTEGER,
  reporter_id TEXT NOT NULL,
  message_id  TEXT,
  chat_id     TEXT,
  reason      TEXT NOT NULL,
  note        TEXT,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mod_reports_case ON moderation_reports(case_id);

CREATE TABLE IF NOT EXISTS moderation_actions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id       INTEGER,
  admin_id      TEXT NOT NULL,
  action        TEXT NOT NULL,
  target_user_id TEXT,
  reason        TEXT,
  created_at    INTEGER NOT NULL
);

/* Append-only from the admin UI: no endpoint ever updates or deletes rows. */
CREATE TABLE IF NOT EXISTS moderation_audit_log (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_id  TEXT NOT NULL,
  admin_name TEXT,
  action    TEXT NOT NULL,
  target    TEXT,
  case_id   INTEGER,
  detail    TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS moderation_settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`);

db.exec(`
CREATE TABLE IF NOT EXISTS starred_messages (
  message_id TEXT NOT NULL,
  user_id    TEXT NOT NULL,
  at         INTEGER NOT NULL,
  PRIMARY KEY (message_id, user_id),
  FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

/* ---- polls: group-chat polls rendered inside a 'poll' message ---- */
CREATE TABLE IF NOT EXISTS polls (
  id         TEXT PRIMARY KEY,
  chat_id    TEXT NOT NULL,
  created_by TEXT NOT NULL,
  question   TEXT NOT NULL,
  options    TEXT NOT NULL,             -- JSON array of strings
  created_at INTEGER NOT NULL,
  FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS poll_votes (
  poll_id      TEXT NOT NULL,
  user_id      TEXT NOT NULL,
  option_index INTEGER NOT NULL,
  at           INTEGER NOT NULL,
  PRIMARY KEY (poll_id, user_id),
  FOREIGN KEY (poll_id) REFERENCES polls(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

/* ---- Operational Transformation: collaborative documents & message edit history ---- */
CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  chat_id TEXT,
  community_id TEXT,
  post_id TEXT,
  title TEXT DEFAULT '',
  content TEXT DEFAULT '',
  version INTEGER DEFAULT 0,
  created_by TEXT,
  meta TEXT DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_documents_chat ON documents(chat_id);
CREATE INDEX IF NOT EXISTS idx_documents_community ON documents(community_id);

CREATE TABLE IF NOT EXISTS document_operations (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  operation TEXT NOT NULL,
  base_version INTEGER NOT NULL,
  version INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_doc_ops_doc ON document_operations(document_id, version);

CREATE TABLE IF NOT EXISTS message_edit_operations (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  operation TEXT NOT NULL,
  base_version INTEGER NOT NULL,
  version INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_msg_edit_ops_msg ON message_edit_operations(message_id, version);
`);

module.exports = db;
module.exports.DATA_DIR = DATA_DIR;
