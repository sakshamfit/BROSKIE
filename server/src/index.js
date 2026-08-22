require('dotenv').config();
const express = require('express');
const compression = require('compression');
const http = require('http');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const { Server } = require('socket.io');
const { customAlphabet } = require('nanoid');

const db = require('./db');
const { sign, verify, requireAuth } = require('./auth');
const jamendo = require('./jamendo');
const TextOperation = require('./ot/textOperation');
const OTStore = require('./ot/otStore');

const nano = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 16);
const now = () => Date.now();

// OT store for collaborative editing
const otStore = new OTStore(db);
try { otStore.ensureTables(); } catch {}
console.log('[ot] Operational Transformation enabled — collaborative docs & message edit OT');

/* ------------------------------------------------------------------ */
/* per-conversation chat themes                                        */
/* ------------------------------------------------------------------ */

// The single source of truth for which theme ids exist and their display
// names. The client mirrors these ids in app/src/chatThemes.js — the id is
// the contract; names shown in the chat UI come from the client registry.
// Only ids in this map are ever persisted; anything else is rejected so no
// arbitrary CSS/colors/theme objects can be injected through the database.
const CHAT_THEMES = {
  graphite: 'Graphite',
  obsidian: 'Obsidian',
  carbon: 'Carbon',
  aurora: 'Aurora',
  midnight: 'Midnight',
  ocean: 'Ocean',
  sunset: 'Sunset',
  sakura: 'Sakura',
  lavender: 'Lavender',
  mint: 'Mint',
  cream: 'Cream',
  'neon-night': 'Neon Night',
  galaxy: 'Galaxy',
};
const ALLOWED_THEME_IDS = new Set(Object.keys(CHAT_THEMES));


// Keep account creation approachable and consistent across every client.
// Length is the only password-shape rule; bcrypt still hashes every password.
const PASSWORD_RULE = 'Password must be at least 8 characters.';
function passwordError(value) {
  return String(value || '').length < 8 ? PASSWORD_RULE : null;
}

const app = express();
// Gzip every compressible response (JS/CSS bundles, API JSON). The web
// bundle drops from ~1.4 MB to ~380 KB over the wire — the single biggest
// win for slow connections. Socket.IO traffic is unaffected (it attaches to
// the raw HTTP server), and tiny responses skip compression via `threshold`.
app.use(compression({ threshold: 1024 }));
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '25mb' }));

const storage = require('./storage');

// Local files are still served when the disk backend is in use (and harmless
// otherwise — old /uploads/... URLs in the DB keep resolving).
app.use('/uploads', express.static(storage.UPLOAD_DIR));

// Buffer in memory, then hand off to the storage backend (Supabase or disk).
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* user preferences — notifications + privacy                         */
/* ------------------------------------------------------------------ */

const DEFAULT_SETTINGS = {
  notifications: {
    messages: true,        // new chat messages
    messagePreview: true,  // show text/photo preview vs "New message"
    activity: true,        // message requests + colleague requests (push)
    reactions: true,       // likes/comments on your Network posts (push)
    calls: true,           // incoming call pushes (ringing)
    status: true,          // someone posted to See
    network: true,         // new Network posts from people you follow-ish (public feed)
    communityActivity: true, // join requests / approvals / added-to-community
    sound: true,
    // Quiet hours: pushes still arrive but silently (no sound/vibration,
    // low-importance channel) so a 3am message is there in the morning
    // without waking anyone. Minutes are 0..1439 local wall-clock;
    // tzOffsetMinutes is minutes EAST of UTC (client sends its offset).
    quietHours: { enabled: false, startMinute: 22 * 60, endMinute: 7 * 60, tzOffsetMinutes: 0 },
  },
  privacy: {
    lastSeen: 'everyone',   // everyone | contacts | nobody — who sees your last-seen/online dot
    readReceipts: true,     // off = you don't send blue ticks AND you don't see others' either (mirrors WhatsApp)
  },
};

/** Validate/normalize one quiet-hours object against `base`. */
function sanitizeQuietHours(input, base) {
  const out = {
    enabled: base.enabled === true,
    startMinute: Number(base.startMinute) || 0,
    endMinute: Number(base.endMinute) || 0,
    tzOffsetMinutes: Number(base.tzOffsetMinutes) || 0,
  };
  if (input && typeof input === 'object') {
    if (typeof input.enabled === 'boolean') out.enabled = input.enabled;
    ['startMinute', 'endMinute'].forEach((k) => {
      const v = Number(input[k]);
      if (Number.isFinite(v)) out[k] = Math.min(1439, Math.max(0, Math.round(v)));
    });
    if (Number.isFinite(Number(input.tzOffsetMinutes))) {
      out.tzOffsetMinutes = Math.min(840, Math.max(-720, Math.round(Number(input.tzOffsetMinutes))));
    }
  }
  return out;
}

function sanitizeSettings(input, base = DEFAULT_SETTINGS) {
  const out = { notifications: { ...base.notifications }, privacy: { ...base.privacy } };
  if (input && typeof input === 'object') {
    if (input.notifications && typeof input.notifications === 'object') {
      Object.keys(DEFAULT_SETTINGS.notifications).forEach((k) => {
        if (k === 'quietHours') return;
        if (typeof input.notifications[k] === 'boolean') out.notifications[k] = input.notifications[k];
      });
      out.notifications.quietHours = sanitizeQuietHours(
        input.notifications.quietHours,
        base.notifications.quietHours || DEFAULT_SETTINGS.notifications.quietHours
      );
    }
    if (input.privacy && typeof input.privacy === 'object') {
      if (['everyone', 'contacts', 'nobody'].includes(input.privacy.lastSeen)) out.privacy.lastSeen = input.privacy.lastSeen;
      if (typeof input.privacy.readReceipts === 'boolean') out.privacy.readReceipts = input.privacy.readReceipts;
    }
  }
  return out;
}

function getSettings(u) {
  let parsed = {};
  try { parsed = JSON.parse(u?.settings || '{}'); } catch { parsed = {}; }
  return sanitizeSettings(parsed);
}

// Push notifications fan out from the same events that hit Socket.IO.
// getUser/getSettings are injected lazily (they are consts defined further
// down) to avoid a circular require.
const push = require('./push');
push.init({ getUser: (id) => getUser(id), getSettings: (u) => getSettings(u) });

/* ------------------------------------------------------------------ */
/* Safety & Moderation Center — role-based, server-verified access    */
/* ------------------------------------------------------------------ */
const moderation = require('./moderation');

// The admin console is owner-only: it is available exclusively to @saksham.
// This is enforced on the server (not just hidden in the app), so an old
// session, a manually changed client, or ADMIN_USERNAMES cannot grant access.
const OWNER_ADMIN_USERNAME_KEY = 'saksham';
db.prepare("UPDATE users SET role = CASE WHEN username_key = ? THEN 'admin' ELSE 'user' END WHERE role = 'admin' OR username_key = ?")
  .run(OWNER_ADMIN_USERNAME_KEY, OWNER_ADMIN_USERNAME_KEY);

// Accounts granted the backend admin role at registration (owner first).
// Keep this in sync with the sole username that requireAdmin() accepts.
const ADMIN_USERNAME_KEYS = (process.env.ADMIN_USERNAMES || OWNER_ADMIN_USERNAME_KEY)
  .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
if (!ADMIN_USERNAME_KEYS.includes(OWNER_ADMIN_USERNAME_KEY)) {
  ADMIN_USERNAME_KEYS.unshift(OWNER_ADMIN_USERNAME_KEY);
}

// Optional one-time bootstrap list. Afterwards verification is managed in the
// Admin Safety Center and persists in the database.
const GOLD_TICK_USERNAME_KEYS = (process.env.GOLD_TICK_USERNAMES || 'saksham')
  .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
if (GOLD_TICK_USERNAME_KEYS.length) {
  db.prepare(`UPDATE users SET gold_tick = 1 WHERE username_key IN (${GOLD_TICK_USERNAME_KEYS.map(() => '?').join(',')})`)
    .run(...GOLD_TICK_USERNAME_KEYS);
}

/** Server-side authorization for EVERY admin API request. */
function requireAdmin(req, res, next) {
  const u = getUser(req.userId);
  if (!u || u.username_key !== OWNER_ADMIN_USERNAME_KEY || u.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access is restricted to @saksham' });
  }
  next();
}

function areContacts(idA, idB) {
  const [userA, userB] = colleaguePair(idA, idB);
  const colleagues = !!db
    .prepare('SELECT 1 FROM colleague_connections WHERE user_a = ? AND user_b = ?')
    .get(userA, userB);
  if (colleagues) return true;
  // Opening a blank composer must not make two strangers contacts. A direct
  // chat only counts after it is accepted, or it is a legacy thread that
  // already has real messages and never went through requests.
  return !!db
    .prepare(
      `SELECT 1 FROM chat_members a
       JOIN chat_members b ON a.chat_id = b.chat_id
       JOIN chats c ON c.id = a.chat_id
       LEFT JOIN chat_requests cr ON cr.chat_id = c.id
       WHERE a.user_id = ? AND b.user_id = ?
         AND (
           c.type != 'direct'
           OR cr.status = 'accepted'
           OR (
             cr.chat_id IS NULL
             AND EXISTS (
               SELECT 1 FROM messages m
               WHERE m.chat_id = c.id AND m.type != 'system' AND m.deleted = 0
             )
           )
         )
       LIMIT 1`
    )
    .get(idA, idB);
}

function isBlocked(blockerId, blockedId) {
  return !!db.prepare('SELECT 1 FROM blocked_users WHERE blocker_id = ? AND blocked_id = ?').get(blockerId, blockedId);
}

/** True if either side has blocked the other — used to hard-stop messaging/visibility both ways. */
function blockedEitherWay(idA, idB) {
  return isBlocked(idA, idB) || isBlocked(idB, idA);
}

/**
 * Presence fields respect the target user's last-seen privacy setting.
 * `viewerId` null/undefined means "no relationship" (e.g. public feed) —
 * treated the same as a stranger.
 */
function presenceFor(target, viewerId) {
  if (!target) return { isOnline: false, lastSeen: 0 };
  if (viewerId && target.id === viewerId) return { isOnline: !!target.is_online, lastSeen: target.last_seen };
  const settings = getSettings(target);
  const pref = settings.privacy.lastSeen;
  const allowed =
    pref === 'everyone' || (pref === 'contacts' && viewerId && areContacts(target.id, viewerId));
  if (!allowed) return { isOnline: false, lastSeen: 0 };
  return { isOnline: !!target.is_online, lastSeen: target.last_seen };
}

const publicUser = (u) =>
  u && {
    id: u.id,
    username: u.username,
    phone: u.phone,
    name: u.name,
    about: u.about,
    avatar: u.avatar,
    lastSeen: u.last_seen,
    isOnline: !!u.is_online,
    createdAt: u.created_at,
    goldTick: !!u.gold_tick,
  };

const MAX_USERNAME_LENGTH = 64;

/** Usernames that cannot be newly registered. Existing accounts are never
 * mutated or deleted merely because a name later becomes reserved. */
const RESERVED_USERNAMES = new Set(['yupp']);
function isReservedUsername(raw) {
  return RESERVED_USERNAMES.has(usernameKey(raw));
}

/** Preserve the username people typed; only surrounding whitespace is input chrome. */
function cleanUsername(raw) {
  return String(raw ?? '').trim();
}

/** Separate canonical key keeps sign-in/uniqueness compatible with legacy lowercase accounts. */
function usernameKey(raw) {
  return cleanUsername(raw).normalize('NFKC').toLowerCase();
}

function validateUsername(raw) {
  const username = cleanUsername(raw);
  if (!username) return 'Username is required';
  if (username.length > MAX_USERNAME_LENGTH) return `Username must be ${MAX_USERNAME_LENGTH} characters or fewer`;
  return null;
}

const getUser = (id) => db.prepare('SELECT * FROM users WHERE id = ?').get(id);
const getUserByUsername = (username) =>
  db.prepare('SELECT * FROM users WHERE username_key = ?').get(usernameKey(username));

const AFFILIATION_TYPES = ['institution', 'organization', 'workplace'];

function normalizeAffiliationName(raw) {
  return String(raw || '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
}

function affiliationsForUser(userId) {
  return db
    .prepare(
      `SELECT a.id, a.name, a.type, ua.title, ua.joined_at,
              (SELECT COUNT(*) FROM user_affiliations members WHERE members.affiliation_id = a.id) member_count
       FROM user_affiliations ua
       JOIN affiliations a ON a.id = ua.affiliation_id
       WHERE ua.user_id = ?
       ORDER BY ua.joined_at DESC, a.name COLLATE NOCASE`
    )
    .all(userId)
    .map((a) => ({
      id: a.id,
      name: a.name,
      type: a.type,
      title: a.title || '',
      joinedAt: a.joined_at,
      memberCount: a.member_count,
      joined: true,
    }));
}

function accountUser(u) {
  // `role` is included ONLY in the account's own profile responses — never
  // in publicUser, so admin identity isn't broadcast to other users.
  return u ? { ...publicUser(u), role: u.role || 'user', moderation: u.moderation || 'active', settings: getSettings(u), affiliations: affiliationsForUser(u.id) } : null;
}

function sharedAffiliations(userId, otherId) {
  return db
    .prepare(
      `SELECT a.id, a.name, a.type, theirs.title
       FROM user_affiliations mine
       JOIN user_affiliations theirs ON theirs.affiliation_id = mine.affiliation_id
       JOIN affiliations a ON a.id = mine.affiliation_id
       WHERE mine.user_id = ? AND theirs.user_id = ?
       ORDER BY a.name COLLATE NOCASE`
    )
    .all(userId, otherId)
    .map((a) => ({ id: a.id, name: a.name, type: a.type, title: a.title || '' }));
}

/* ---------------- Phase 2: the daily campus loop ---------------- */

/** Every userId that shares at least one affiliation with `userId` (self and
 *  blocked pairs excluded). This is "people from my college / workplace". */
function usersSharingPlaces(userId) {
  return db
    .prepare(
      `SELECT DISTINCT theirs.user_id id
       FROM user_affiliations mine
       JOIN user_affiliations theirs ON theirs.affiliation_id = mine.affiliation_id
       WHERE mine.user_id = ? AND theirs.user_id != ?`
    )
    .all(userId, userId)
    .map((r) => r.id)
    .filter((id) => !blockedEitherWay(userId, id));
}

/** ids this user follows. */
function followingIds(userId) {
  return db.prepare('SELECT followed_id id FROM follows WHERE follower_id = ?').all(userId).map((r) => r.id);
}

function isFollowing(followerId, followedId) {
  return !!db.prepare('SELECT 1 FROM follows WHERE follower_id = ? AND followed_id = ?').get(followerId, followedId);
}

/** "from your college" / "from your workplace" — how a place-shared event is
 *  described in pushes and the greeter, derived from the author's first
 *  affiliation type (institution → college, org/workplace → workplace). */
function placeLabelFor(userId) {
  const rows = db
    .prepare(
      `SELECT a.type FROM user_affiliations ua JOIN affiliations a ON a.id = ua.affiliation_id
       WHERE ua.user_id = ? ORDER BY ua.joined_at DESC LIMIT 1`
    )
    .all(userId);
  const type = rows[0]?.type;
  if (type === 'institution') return 'college';
  if (type === 'organization' || type === 'workplace') return 'workplace';
  return 'place';
}

/** One person's live "around" row, sweeping expired flags as a side effect. */
function aroundRowFor(userId) {
  db.prepare('DELETE FROM around_status WHERE expires_at < ?').run(now());
  return db.prepare('SELECT * FROM around_status WHERE user_id = ?').get(userId);
}

const AROUND_TTL_MS = 12 * 3600 * 1000;

function colleaguePair(idA, idB) {
  return idA < idB ? [idA, idB] : [idB, idA];
}

function colleagueRelationship(viewerId, otherId) {
  const [userA, userB] = colleaguePair(viewerId, otherId);
  if (db.prepare('SELECT 1 FROM colleague_connections WHERE user_a = ? AND user_b = ?').get(userA, userB)) {
    return { status: 'connected', requestId: null };
  }
  const pending = db
    .prepare(
      `SELECT id, sender_id, receiver_id FROM colleague_requests
       WHERE status = 'pending' AND ((sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?))
       ORDER BY created_at DESC LIMIT 1`
    )
    .get(viewerId, otherId, otherId, viewerId);
  if (!pending) return { status: 'none', requestId: null };
  return {
    status: pending.sender_id === viewerId ? 'outgoing' : 'incoming',
    requestId: pending.id,
  };
}

function hydrateColleague(u, viewerId) {
  if (!u) return null;
  return {
    ...publicUser(u),
    ...presenceFor(u, viewerId),
    sharedAffiliations: sharedAffiliations(viewerId, u.id),
    relationship: colleagueRelationship(viewerId, u.id),
  };
}

function hydrateAffiliation(row, viewerId) {
  if (!row) return null;
  const membership = db
    .prepare('SELECT title, joined_at FROM user_affiliations WHERE user_id = ? AND affiliation_id = ?')
    .get(viewerId, row.id);
  const count = db.prepare('SELECT COUNT(*) c FROM user_affiliations WHERE affiliation_id = ?').get(row.id).c;
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    memberCount: count,
    joined: !!membership,
    title: membership?.title || '',
    joinedAt: membership?.joined_at || null,
  };
}

function affiliationMemberIds(affiliationId) {
  return db
    .prepare('SELECT user_id FROM user_affiliations WHERE affiliation_id = ?')
    .all(affiliationId)
    .map((r) => r.user_id);
}

function memberIds(chatId) {
  return db.prepare('SELECT user_id FROM chat_members WHERE chat_id = ?').all(chatId).map((r) => r.user_id);
}

function pendingChatRequest(chatId) {
  return db.prepare("SELECT * FROM chat_requests WHERE chat_id = ? AND status = 'pending'").get(chatId);
}

function hydrateChatRequest(row, viewerId) {
  if (!row) return null;
  const requester = getUser(row.sender_id);
  return {
    id: row.chat_id,
    chatId: row.chat_id,
    requestedAt: row.created_at,
    requester: publicUser(requester),
    chat: chatSummary(row.chat_id, viewerId),
  };
}

/** True when `viewerId` has hidden this message via "Delete for me". */
function isHiddenForMe(m, viewerId) {
  if (!viewerId || !m.hidden_for) return false;
  return m.hidden_for.split(',').filter(Boolean).includes(viewerId);
}

/**
 * SQL fragment that excludes messages a user hid via "Delete for me".
 * Returns an array [expression, param] to AND into a query. Because
 * `hidden_for` is a plain comma-separated list (mirroring `archived_by`),
 * the delimiter-wrapped LIKE matches whole ids without a costly table.
 */
function notHiddenFor(viewerId, alias = 'm') {
  const needle = `%,${viewerId},%`;
  return [`(',' || ${alias}.hidden_for || ',') NOT LIKE ?`, needle];
}

function hydrateMessage(m, viewerId) {
  if (!m) return null;
  // A message hidden via "Delete for me" never leaves the server for that
  // viewer. The row still exists for everyone else (and for "delete for
  // everyone", which uses the separate `deleted` flag).
  if (isHiddenForMe(m, viewerId)) return null;
  // Explicit conversation type on EVERY hydrated message, so clients can
  // unambiguously route direct vs GC traffic without a second lookup:
  //   conversationType: 'direct' | 'group' | 'gc'
  // `gcId` is set (equal to chat_id — a GC's id IS its chat id) only for
  // GC messages; it is null for every direct/group message.
  const messageChat = db.prepare('SELECT type FROM chats WHERE id = ?').get(m.chat_id);
  const conversationType = messageChat?.type || 'direct';
  const reactions = db.prepare('SELECT user_id, emoji FROM reactions WHERE message_id = ?').all(m.id);
  const receipts = db.prepare('SELECT user_id, state FROM receipts WHERE message_id = ?').all(m.id);
  const others = memberIds(m.chat_id).filter((id) => id !== m.sender_id);
  const readers = new Set(receipts.filter((r) => r.state === 'read').map((r) => r.user_id));
  const delivered = new Set(receipts.filter((r) => r.state === 'delivered').map((r) => r.user_id));

  let status = 'sent';
  if (others.length && others.every((id) => delivered.has(id) || readers.has(id))) status = 'delivered';
  if (others.length && others.every((id) => readers.has(id))) status = 'read';

  // Real "read receipts" toggle: mirrors WhatsApp — turn it off and you stop
  // BOTH sending read confirmations (enforced at mark-read time, see
  // socket.on('message:read')) AND seeing anyone else's, even in your own
  // sent messages. So if the person currently looking at this chat has it
  // disabled, a computed 'read' status never surfaces to them.
  if (status === 'read' && viewerId) {
    const viewer = getUser(viewerId);
    if (viewer && !getSettings(viewer).privacy.readReceipts) status = 'delivered';
  }

  let replyTo = null;
  if (m.reply_to) {
    const r = db.prepare('SELECT * FROM messages WHERE id = ?').get(m.reply_to);
    if (r) {
      const sender = getUser(r.sender_id);
      replyTo = {
        id: r.id,
        senderId: r.sender_id,
        senderName: sender ? sender.name : 'Unknown',
        type: r.type,
        body: r.deleted ? 'This message was deleted' : r.body,
      };
    }
  }

  const starred = viewerId
    ? !!db.prepare('SELECT 1 FROM starred_messages WHERE message_id = ? AND user_id = ?').get(m.id, viewerId)
    : false;

  // Status reply preview — frozen snapshot so the quoted status survives after the 24h expiry.
  let statusReply = null;
  if (m.status_id) {
    if (m.status_snapshot) {
      try { statusReply = JSON.parse(m.status_snapshot); } catch {}
    }
    if (!statusReply) {
      const st = db.prepare('SELECT * FROM statuses WHERE id = ?').get(m.status_id);
      if (st) {
        statusReply = {
          id: st.id, type: st.type, body: st.body, mediaUrl: st.media_url, mediaAspect: st.media_aspect || null, bg: st.bg,
          song: st.song ? JSON.parse(st.song) : null, audience: st.audience || 'public', createdAt: st.created_at,
          author: publicUser(getUser(st.user_id)),
        };
      } else {
        statusReply = { id: m.status_id, expired: true };
      }
    }
  }

  return {
    id: m.id,
    clientId: m.client_id || m.id,
    chatId: m.chat_id,
    senderId: m.sender_id,
    type: m.type,
    conversationType,
    gcId: conversationType === 'gc' ? m.chat_id : null,
    body: m.deleted ? '' : m.body,
    mediaUrl: m.deleted ? null : m.media_url,
    mediaThumbUrl: m.deleted ? null : (m.media_thumb_url || null),
    duration: m.duration,
    deleted: !!m.deleted,
    createdAt: m.created_at,
    clientCreatedAt: m.client_created_at || m.created_at,
    updatedAt: m.updated_at || m.created_at,
    expiresAt: m.expires_at || null,
    edited: !!m.edited,
    forwarded: !!m.forwarded_from,
    starred,
    poll: !m.deleted && m.type === 'poll' ? hydratePoll(m.poll_id, viewerId) : null,
    replyTo,
    statusReply,
    status,
    reactions: reactions.map((r) => ({ userId: r.user_id, emoji: r.emoji })),
  };
}

/** Live poll state (counts + my vote) hydrated per viewer. */
function hydratePoll(pollId, viewerId) {
  if (!pollId) return null;
  const p = db.prepare('SELECT * FROM polls WHERE id = ?').get(pollId);
  if (!p) return null;
  let options = [];
  try { options = JSON.parse(p.options || '[]'); } catch { options = []; }
  const votes = db.prepare('SELECT user_id, option_index FROM poll_votes WHERE poll_id = ?').all(pollId);
  const counts = options.map((_, i) => votes.filter((v) => v.option_index === i).length);
  const creator = getUser(p.created_by);
  return {
    id: p.id,
    question: p.question,
    options: options.map((text, i) => ({ index: i, text, votes: counts[i] })),
    totalVotes: votes.length,
    myVote: viewerId ? (votes.find((v) => v.user_id === viewerId)?.option_index ?? null) : null,
    createdByName: creator ? creator.name : 'Unknown',
    createdAt: p.created_at,
  };
}

/** Timers users can pick for disappearing messages (seconds). 0 = off. */
const DISAPPEAR_OPTIONS = [0, 30, 300, 3600, 86400];
const clampDisappear = (s) => (DISAPPEAR_OPTIONS.includes(Number(s)) ? Number(s) : 0);

function chatSummary(chatId, viewerId) {
  const chat = db.prepare('SELECT * FROM chats WHERE id = ?').get(chatId);
  if (!chat) return null;
  const members = db
    .prepare(
      `SELECT u.*, cm.role, cm.muted, cm.pinned_at, cm.cleared_at FROM chat_members cm
       JOIN users u ON u.id = cm.user_id WHERE cm.chat_id = ?`
    )
    .all(chatId);

  const me = members.find((m) => m.id === viewerId);
  const other = chat.type === 'direct' ? members.find((m) => m.id !== viewerId) : null;
  const clearedAt = me?.cleared_at || 0;
  const [notHiddenMessagesSql, notHiddenMessagesParam] = notHiddenFor(viewerId, 'messages');
  const [notHiddenMSql, notHiddenMParam] = notHiddenFor(viewerId, 'm');

  const last = db
    .prepare(`SELECT * FROM messages WHERE chat_id = ? AND created_at > ? AND ${notHiddenMessagesSql} ORDER BY created_at DESC LIMIT 1`)
    .get(chatId, clearedAt, notHiddenMessagesParam);

  const unread = db
    .prepare(
      `SELECT COUNT(*) c FROM messages m
       WHERE m.chat_id = ? AND m.sender_id != ? AND m.sender_id != 'system' AND m.created_at > ?
         AND ${notHiddenMSql}
         AND NOT EXISTS (SELECT 1 FROM receipts r WHERE r.message_id = m.id AND r.user_id = ? AND r.state='read')`
    )
    .get(chatId, viewerId, clearedAt, notHiddenMParam, viewerId).c;

  const archived = (chat.archived_by || '').split(',').filter(Boolean).includes(viewerId);
  const otherPresence = other ? presenceFor(other, viewerId) : { isOnline: false, lastSeen: 0 };
  const request = chat.type === 'direct'
    ? db.prepare('SELECT * FROM chat_requests WHERE chat_id = ?').get(chatId)
    : null;

  return {
    id: chat.id,
    type: chat.type,
    name: chat.type !== 'direct' ? chat.name : other ? other.name : 'Unknown',
    username: chat.type === 'direct' && other ? other.username : null,
    avatar: chat.type !== 'direct' ? chat.avatar : other ? other.avatar : null,
    about: other ? other.about : null,
    otherUserId: other ? other.id : null,
    isOnline: otherPresence.isOnline,
    lastSeen: otherPresence.lastSeen,
    muted: me ? !!me.muted : false,
    archived,
    pinned: me ? !!me.pinned_at : false,
    disappearSeconds: chat.disappear_seconds || 0,
    // Per-conversation chat theme — persisted on the chat row, broadcast to
    // every participant via chat:updated / chat:theme. Unknown/legacy values
    // are resolved by clients to the 'graphite' default.
    themeId: chat.theme_id || 'graphite',
    themeUpdatedBy: chat.theme_updated_by || null,
    themeUpdatedAt: chat.theme_updated_at || null,
    role: me ? me.role : 'member',
    members: members.map((m) => ({ ...publicUser(m), role: m.role })),
    lastMessage: last ? hydrateMessage(last, viewerId) : null,
    unread,
    requestStatus: request?.status || null,
    requestDirection: request
      ? request.sender_id === viewerId ? 'outgoing' : request.receiver_id === viewerId ? 'incoming' : null
      : null,
    updatedAt: chat.updated_at,
  };
}

/** Everyone who shares a chat or has accepted a colleague connection — the "contacts" audience. */
function contactIds(userId) {
  const chatRows = db
    .prepare(
      `SELECT DISTINCT cm2.user_id FROM chat_members cm1
       JOIN chat_members cm2 ON cm2.chat_id = cm1.chat_id AND cm2.user_id != cm1.user_id
       JOIN chats c ON c.id = cm1.chat_id
       LEFT JOIN chat_requests cr ON cr.chat_id = c.id
       WHERE cm1.user_id = ?
         AND (
           c.type != 'direct'
           OR cr.status = 'accepted'
           OR (
             cr.chat_id IS NULL
             AND EXISTS (
               SELECT 1 FROM messages m
               WHERE m.chat_id = c.id AND m.type != 'system' AND m.deleted = 0
             )
           )
         )`
    )
    .all(userId)
    .map((r) => r.user_id);
  const colleagueRows = db
    .prepare(
      `SELECT CASE WHEN user_a = ? THEN user_b ELSE user_a END user_id
       FROM colleague_connections WHERE user_a = ? OR user_b = ?`
    )
    .all(userId, userId, userId)
    .map((r) => r.user_id);
  return [...new Set([...chatRows, ...colleagueRows])];
}

function userChats(userId) {
  const rows = db
    .prepare(
      `SELECT c.id FROM chats c
       JOIN chat_members cm ON cm.chat_id = c.id
       LEFT JOIN chat_requests cr ON cr.chat_id = c.id
       WHERE cm.user_id = ?
         /* GCs (Instagram-style group chats, chats.type = 'gc') live in their
            own GC section — never in the Chats inbox. */
         AND c.type != 'gc'
         /* Incoming requests stay in Activity until accepted. This is the only
            inbox-level exclusion that is unrelated to an explicit user clear. */
         AND (cr.chat_id IS NULL OR cr.status != 'pending' OR cr.receiver_id != ?)
         AND (
           /* A message after an explicit per-user clear makes that same
              conversation visible again; no replacement chat/id is created. */
           EXISTS (
             SELECT 1 FROM messages visible_message
             WHERE visible_message.chat_id = c.id
               AND visible_message.created_at > COALESCE(cm.cleared_at, 0)
           )
           OR (
             /* With no explicit clear, retain conversation history even when
                it has no unread/recent messages. Groups and accepted directs
                remain discoverable, as do legacy threads whose disappearing
                messages have since expired (updated_at records that activity). */
             cm.cleared_at IS NULL
             AND (
               c.type != 'direct'
               OR cr.status = 'accepted'
               OR EXISTS (SELECT 1 FROM messages history_message WHERE history_message.chat_id = c.id)
               OR c.updated_at > c.created_at
               /* A blank direct draft is private to its creator/sender and is
                  not leaked into the other participant's Chats list. */
               OR c.created_by = ?
               OR (cr.status = 'pending' AND cr.sender_id = ?)
             )
           )
         )
       ORDER BY c.updated_at DESC`
    )
    .all(userId, userId, userId, userId);
  // Pinned chats float to the top; within each group keep recency order.
  return rows
    .map((r) => chatSummary(r.id, userId))
    .filter(Boolean)
    .sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));
}

/**
 * Permanently remove one account while preserving healthy shared groups,
 * communities and institutions. Owned shared resources transfer to their
 * oldest remaining member; empty resources are removed.
 */
function deleteAccountData(userId) {
  const user = getUser(userId);
  const directChats = db.prepare(
    `SELECT c.id FROM chats c JOIN chat_members cm ON cm.chat_id = c.id
     WHERE cm.user_id = ? AND c.type = 'direct'`
  ).all(userId).map((row) => row.id);
  const directPeers = [...new Set(directChats.flatMap((chatId) => memberIds(chatId)).filter((id) => id !== userId))];
  const groupChats = db.prepare(
    `SELECT c.id, c.created_by FROM chats c JOIN chat_members cm ON cm.chat_id = c.id
     WHERE cm.user_id = ? AND c.type IN ('group', 'gc')`
  ).all(userId);
  const ownedPostIds = db.prepare('SELECT id FROM posts WHERE user_id = ?').all(userId).map((row) => row.id);

  const transaction = db.transaction(() => {
    const survivingGroups = [];

    // Transfer or remove institutions created by this account so the users
    // table's RESTRICT foreign key can never block intentional deletion.
    db.prepare('SELECT id FROM affiliations WHERE created_by = ?').all(userId).forEach(({ id }) => {
      const successor = db.prepare(
        `SELECT user_id FROM user_affiliations WHERE affiliation_id = ? AND user_id != ?
         ORDER BY joined_at ASC LIMIT 1`
      ).get(id, userId);
      if (successor) db.prepare('UPDATE affiliations SET created_by = ? WHERE id = ?').run(successor.user_id, id);
      else db.prepare('DELETE FROM affiliations WHERE id = ?').run(id);
    });

    // Preserve shared communities by handing ownership/admin to a remaining
    // member. A community with no one left is removed with its group chat.
    db.prepare(
      `SELECT c.*, cm.role member_role FROM communities c
       JOIN community_members cm ON cm.community_id = c.id WHERE cm.user_id = ?`
    ).all(userId).forEach((community) => {
      const successor = db.prepare(
        `SELECT user_id FROM community_members WHERE community_id = ? AND user_id != ?
         ORDER BY role = 'admin' DESC, joined_at ASC LIMIT 1`
      ).get(community.id, userId);
      if (!successor) {
        db.prepare('DELETE FROM communities WHERE id = ?').run(community.id);
        if (community.chat_id) db.prepare('DELETE FROM chats WHERE id = ?').run(community.chat_id);
        return;
      }
      const otherAdmin = db.prepare(
        `SELECT 1 FROM community_members WHERE community_id = ? AND user_id != ? AND role = 'admin' LIMIT 1`
      ).get(community.id, userId);
      if (community.created_by === userId) {
        db.prepare('UPDATE communities SET created_by = ?, updated_at = ? WHERE id = ?')
          .run(successor.user_id, now(), community.id);
      }
      if (community.member_role === 'admin' && !otherAdmin) {
        db.prepare('UPDATE community_members SET role = ? WHERE community_id = ? AND user_id = ?')
          .run('admin', community.id, successor.user_id);
      }
    });

    // Keep ordinary group chats alive, transfer ownership/admin where needed,
    // and remove the departing membership. One-person groups are discarded.
    groupChats.forEach((group) => {
      const chat = db.prepare('SELECT * FROM chats WHERE id = ?').get(group.id);
      if (!chat) return; // may have been removed with an empty community
      const successor = db.prepare(
        `SELECT user_id FROM chat_members WHERE chat_id = ? AND user_id != ?
         ORDER BY role = 'admin' DESC, joined_at ASC LIMIT 1`
      ).get(group.id, userId);
      if (!successor) {
        db.prepare('DELETE FROM chats WHERE id = ?').run(group.id);
        return;
      }
      const myMembership = db.prepare('SELECT role FROM chat_members WHERE chat_id = ? AND user_id = ?')
        .get(group.id, userId);
      const otherAdmin = db.prepare(
        `SELECT 1 FROM chat_members WHERE chat_id = ? AND user_id != ? AND role = 'admin' LIMIT 1`
      ).get(group.id, userId);
      if (chat.created_by === userId) {
        db.prepare('UPDATE chats SET created_by = ? WHERE id = ?').run(successor.user_id, group.id);
      }
      if (myMembership?.role === 'admin' && !otherAdmin) {
        db.prepare('UPDATE chat_members SET role = ? WHERE chat_id = ? AND user_id = ?')
          .run('admin', group.id, successor.user_id);
      }
      db.prepare('DELETE FROM chat_members WHERE chat_id = ? AND user_id = ?').run(group.id, userId);
      survivingGroups.push(group.id);
    });

    // Direct conversations belong to the account pair and are removed.
    directChats.forEach((chatId) => db.prepare('DELETE FROM chats WHERE id = ?').run(chatId));

    // Clean non-FK message/user edges before deleting authored group messages.
    db.prepare('DELETE FROM reactions WHERE user_id = ? OR message_id IN (SELECT id FROM messages WHERE sender_id = ?)')
      .run(userId, userId);
    db.prepare('DELETE FROM receipts WHERE user_id = ? OR message_id IN (SELECT id FROM messages WHERE sender_id = ?)')
      .run(userId, userId);
    db.prepare('DELETE FROM starred_messages WHERE user_id = ? OR message_id IN (SELECT id FROM messages WHERE sender_id = ?)')
      .run(userId, userId);
    db.prepare('DELETE FROM poll_votes WHERE user_id = ? OR poll_id IN (SELECT id FROM polls WHERE created_by = ?)')
      .run(userId, userId);
    db.prepare('DELETE FROM polls WHERE created_by = ?').run(userId);
    db.prepare('DELETE FROM messages WHERE sender_id = ?').run(userId);

    // Clean social edges that do not all have user foreign keys.
    db.prepare(
      `DELETE FROM status_views WHERE user_id = ? OR status_id IN (SELECT id FROM statuses WHERE user_id = ?)`
    ).run(userId, userId);
    db.prepare(
      `DELETE FROM status_recipients WHERE user_id = ? OR status_id IN (SELECT id FROM statuses WHERE user_id = ?)`
    ).run(userId, userId);
    db.prepare(
      `DELETE FROM post_likes WHERE user_id = ? OR post_id IN (SELECT id FROM posts WHERE user_id = ?)`
    ).run(userId, userId);
    db.prepare(
      `DELETE FROM post_comments WHERE user_id = ? OR post_id IN (SELECT id FROM posts WHERE user_id = ?)`
    ).run(userId, userId);
    db.prepare(
      `DELETE FROM post_recipients WHERE user_id = ? OR post_id IN (SELECT id FROM posts WHERE user_id = ?)`
    ).run(userId, userId);
    db.prepare('DELETE FROM statuses WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM posts WHERE user_id = ?').run(userId);

    // Remove this id from per-chat CSV archive state.
    db.prepare("SELECT id, archived_by FROM chats WHERE archived_by != ''").all().forEach((chat) => {
      const next = (chat.archived_by || '').split(',').filter(Boolean).filter((id) => id !== userId).join(',');
      if (next !== chat.archived_by) db.prepare('UPDATE chats SET archived_by = ? WHERE id = ?').run(next, chat.id);
    });

    survivingGroups.forEach((chatId) => {
      if (db.prepare('SELECT 1 FROM chats WHERE id = ?').get(chatId)) {
        insertSystemMessage(chatId, `${user.name} deleted their One ID`);
      }
    });

    db.prepare('DELETE FROM users WHERE id = ?').run(userId);
    return survivingGroups;
  });

  return {
    directChats,
    directPeers,
    groupChats: transaction(),
    postIds: ownedPostIds,
  };
}

/* ------------------------------------------------------------------ */
/* auth routes                                                         */
/* ------------------------------------------------------------------ */

app.get('/api/health', (req, res) => res.json({ ok: true, time: now(), storage: storage.describe() }));

app.get('/api/auth/username-available', (req, res) => {
  const raw = req.query.username;
  const err = validateUsername(raw);
  if (err) return res.json({ available: false, error: err });
  const taken = !!getUserByUsername(raw);
  res.json({ available: !taken, error: taken ? 'That username is already taken' : null });
});

app.post('/api/auth/register', (req, res) => {
  const { username, phone, name, password } = req.body || {};
  if (!String(name || '').trim()) return res.status(400).json({ error: 'Name is required' });
  const passwordValidationError = passwordError(password);
  if (passwordValidationError) return res.status(400).json({ error: passwordValidationError });

  const usernameErr = validateUsername(username);
  if (usernameErr) return res.status(400).json({ error: usernameErr });
  const visibleUsername = cleanUsername(username);
  const canonicalUsername = usernameKey(username);

  if (getUserByUsername(visibleUsername)) {
    return res.status(409).json({ error: 'That username is already taken' });
  }

  const trimmedPhone = phone ? String(phone).trim() : null;
  if (trimmedPhone) {
    const phoneExists = db.prepare('SELECT id FROM users WHERE phone = ?').get(trimmedPhone);
    if (phoneExists) return res.status(409).json({ error: 'That phone number is already registered' });
  }

  const user = {
    id: nano(),
    username: visibleUsername,
    username_key: canonicalUsername,
    // phone is optional now but the column is NOT NULL — fall back to a
    // unique placeholder so old schema constraints keep working.
    phone: trimmedPhone || `unset:${nano()}`,
    name: String(name).trim(),
    about: 'Hey there! I am using +one.',
    avatar: null,
    password_hash: bcrypt.hashSync(String(password), 8),
    last_seen: now(),
    is_online: 0,
    created_at: now(),
  };
  db.prepare(
    `INSERT INTO users (id, username, username_key, phone, name, about, avatar, password_hash, last_seen, is_online, created_at)
     VALUES (@id, @username, @username_key, @phone, @name, @about, @avatar, @password_hash, @last_seen, @is_online, @created_at)`
  ).run(user);

  // Bootstrap role: if this account is the owner admin username it receives
  // the backend admin role immediately — same rule as the boot-time grant,
  // for fresh databases.
  if (canonicalUsername === OWNER_ADMIN_USERNAME_KEY) {
    db.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(user.id);
    user.role = 'admin';
  }

  res.json({ token: sign(user), user: accountUser(user) });
});

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body || {};
  const user = getUserByUsername(username);
  if (!user || !bcrypt.compareSync(String(password || ''), user.password_hash))
    return res.status(401).json({ error: 'Invalid username or password' });
  // Enforcement state is checked server-side on login.
  const gate = moderation.moderationGate(user.id);
  if (gate.blocked) return res.status(403).json({ error: gate.error });
  res.json({ token: sign(user), user: accountUser(user) });
});

app.get('/api/me', requireAuth, (req, res) => {
  const u = getUser(req.userId);
  res.json({ user: accountUser(u) });
});

/** Compact daily briefing used by the animated AI greeting. */
app.get('/api/greeting-summary', requireAuth, (req, res) => {
  const chats = userChats(req.userId);
  const unreadMessages = chats.reduce((sum, chat) => sum + (chat.unread || 0), 0);
  const unreadChats = chats.filter((chat) => (chat.unread || 0) > 0).length;
  const messageRequests = db.prepare(
    `SELECT COUNT(*) c FROM chat_requests cr
     WHERE cr.receiver_id = ? AND cr.status = 'pending'`
  ).get(req.userId).c;
  const colleagueRequests = db.prepare(
    "SELECT COUNT(*) c FROM colleague_requests WHERE receiver_id = ? AND status = 'pending'"
  ).get(req.userId).c;
  const communityRequests = db.prepare(
    `SELECT COUNT(*) c FROM community_requests r
     JOIN community_members me ON me.community_id = r.community_id
     WHERE me.user_id = ? AND me.role = 'admin'`
  ).get(req.userId).c;

  // Phase 2: the campus loop — "2 people from your college posted today"
  // and "Amit is around" in the morning greeting. `since` is the client's
  // local midnight (fallback: last 24h).
  const since = Math.min(Number(req.query.since) || now() - 24 * 3600 * 1000, now());
  const sharerIds = usersSharingPlaces(req.userId);
  const placesPosters = sharerIds.length
    ? db
        .prepare(
          `SELECT COUNT(DISTINCT p.user_id) c FROM posts p
           WHERE p.deleted = 0 AND p.created_at > ? AND p.user_id IN (${sharerIds.map(() => '?').join(',')})`
        )
        .get(since, ...sharerIds).c
    : 0;
  const aroundNow = sharerIds.length
    ? db
        .prepare(
          `SELECT COUNT(*) c FROM around_status a
           WHERE a.expires_at > ? AND a.user_id IN (${sharerIds.map(() => '?').join(',')})`
        )
        .get(now(), ...sharerIds).c
    : 0;
  res.json({
    summary: {
      unreadMessages,
      unreadChats,
      messageRequests,
      colleagueRequests,
      communityRequests,
      placesPostersToday: placesPosters,
      aroundNow,
      total: unreadMessages + messageRequests + colleagueRequests + communityRequests,
    },
  });
});

/** Permanently delete the authenticated One ID after password confirmation. */
app.delete('/api/me', requireAuth, (req, res) => {
  const password = String(req.body?.password || '');
  if (!password) return res.status(400).json({ error: 'Password is required to delete your One ID' });
  const user = getUser(req.userId);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Incorrect password' });
  }

  try {
    const result = deleteAccountData(req.userId);
    result.directPeers.forEach((userId) => result.directChats.forEach((chatId) =>
      emitToUser(userId, 'chat:removed', { chatId, accountDeleted: true })
    ));
    result.groupChats.forEach((chatId) => memberIds(chatId).forEach((userId) =>
      emitToUser(userId, 'chat:updated', chatSummary(chatId, userId))
    ));
    result.postIds.forEach((id) => io.emit('post:deleted', { id }));
    io.emit('user:deleted', { id: req.userId });
    emitToUser(req.userId, 'account:deleted', { ok: true });
    res.json({ ok: true });

    // End every socket session for this account after the HTTP response has
    // reached the deleting device.
    setTimeout(() => {
      const ids = sockets.get(req.userId);
      ids?.forEach((socketId) => io.sockets.sockets.get(socketId)?.disconnect(true));
      sockets.delete(req.userId);
    }, 80);
  } catch (error) {
    console.error('[account delete]', error);
    res.status(500).json({ error: 'Could not delete your One ID' });
  }
});

app.patch('/api/me/settings', requireAuth, (req, res) => {
  const u = getUser(req.userId);
  const current = getSettings(u);
  // Sanitize the incoming patch against the CURRENT (already-valid) settings
  // as the base, not the hardcoded defaults — so an invalid/garbage value in
  // one field (e.g. a bad lastSeen string) is simply ignored rather than
  // silently resetting that field to its default.
  const merged = sanitizeSettings(
    {
      notifications: { ...current.notifications, ...(req.body?.notifications || {}) },
      privacy: { ...current.privacy, ...(req.body?.privacy || {}) },
    },
    current
  );
  db.prepare('UPDATE users SET settings = ? WHERE id = ?').run(JSON.stringify(merged), req.userId);
  // Keep every active session in sync immediately; foreground refresh still
  // covers devices that were offline when this event was emitted.
  emitToUser(req.userId, 'settings:updated', { settings: merged });
  res.json({ settings: merged });
});

/* ------------------------------------------------------------------ */
/* push notification device registry                                  */
/* ------------------------------------------------------------------ */

/** Register (or re-register) this device's Expo push token. Called on sign-in
 *  and whenever the OS rotates the token. A token belongs to exactly one
 *  account at a time — signing in on a used device reassigns it. */
app.post('/api/push/token', requireAuth, (req, res) => {
  try {
    const { token, platform, deviceId, appVersion } = req.body || {};
    const saved = push.registerToken(req.userId, { token, platform, deviceId, appVersion });
    res.json({ ok: true, token: saved.token });
  } catch (e) {
    res.status(400).json({ error: e.message || 'Could not register push token' });
  }
});

/** Remove this device's token (log out / notifications off). */
app.delete('/api/push/token', requireAuth, (req, res) => {
  const removed = push.unregisterToken(req.userId, req.body?.token);
  res.json({ ok: true, removed });
});

/** Which devices currently have push registered (for the Notifications screen). */
app.get('/api/push/info', requireAuth, (req, res) => {
  res.json(push.describeFor(req.userId));
});

/** Browser push: VAPID public key the page subscribes with. */
app.get('/api/push/web-config', requireAuth, (req, res) => {
  res.json(push.webPushConfig());
});

/** Register/refresh this browser's PushSubscription (web push parity with
 *  the Expo token flow — same rules, same events). */
app.post('/api/push/web-subscription', requireAuth, (req, res) => {
  try {
    const saved = push.registerWebSubscription(req.userId, req.body?.subscription);
    res.json({ ok: true, endpoint: saved.endpoint });
  } catch (e) {
    res.status(400).json({ error: e.message || 'Could not register web push' });
  }
});

/** Remove this browser's subscription (sign out / notifications off). */
app.delete('/api/push/web-subscription', requireAuth, (req, res) => {
  const removed = push.unregisterWebSubscription(req.userId, req.body?.endpoint);
  res.json({ ok: true, removed });
});

app.patch('/api/me', requireAuth, (req, res) => {
  const { name, about, avatar, username, phone } = req.body || {};
  const u = getUser(req.userId);

  let nextUsername = u.username;
  let nextUsernameKey = u.username_key || usernameKey(u.username);
  if (username !== undefined && cleanUsername(username) !== u.username) {
    const err = validateUsername(username);
    if (err) return res.status(400).json({ error: err });
    const taken = getUserByUsername(username);
    if (taken && taken.id !== req.userId) return res.status(409).json({ error: 'That username is already taken' });
    nextUsername = cleanUsername(username);
    nextUsernameKey = usernameKey(username);
  }

  let nextPhone = u.phone;
  if (phone !== undefined) {
    const trimmed = String(phone).trim();
    nextPhone = trimmed || `unset:${nano()}`;
    if (trimmed) {
      const taken = db.prepare('SELECT id FROM users WHERE phone = ?').get(trimmed);
      if (taken && taken.id !== req.userId) return res.status(409).json({ error: 'That phone number is already registered' });
    }
  }

  // Undefined means the client is not changing the avatar; null is the
  // deliberate, supported removal operation. Empty strings are ignored to
  // prevent an accidental picker/upload failure from clearing the photo.
  const nextAvatar = avatar === null ? null : avatar !== undefined ? (String(avatar).trim() || u.avatar) : u.avatar;

  db.prepare('UPDATE users SET name = ?, about = ?, avatar = ?, username = ?, username_key = ?, phone = ? WHERE id = ?').run(
    name ?? u.name,
    about ?? u.about,
    nextAvatar,
    nextUsername,
    nextUsernameKey,
    nextPhone,
    req.userId
  );
  const updatedRow = getUser(req.userId);
  const updated = publicUser(updatedRow);
  io.emit('user:updated', updated);
  res.json({ user: accountUser(updatedRow) });
});

app.post('/api/me/password', requireAuth, (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'Current and new password are required' });
  }
  const passwordValidationError = passwordError(newPassword);
  if (passwordValidationError) return res.status(400).json({ error: passwordValidationError });
  const u = getUser(req.userId);
  if (!bcrypt.compareSync(String(currentPassword), u.password_hash)) {
    return res.status(401).json({ error: 'Current password is incorrect' });
  }
  const hash = bcrypt.hashSync(String(newPassword), 8);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, req.userId);
  res.json({ ok: true });
});

app.get('/api/users', requireAuth, (req, res) => {
  const q = String(req.query.q || '').toLowerCase();
  let all = db.prepare('SELECT * FROM users WHERE id != ? ORDER BY name').all(req.userId);
  if (req.query.contacts === '1' || req.query.contacts === 'true') {
    const allowed = new Set(contactIds(req.userId));
    all = all.filter((user) => allowed.has(user.id));
  }
  const filtered = q
    ? all.filter((u) =>
        u.name.toLowerCase().includes(q) ||
        (u.username && u.username.includes(q)) ||
        u.phone.includes(q))
    : all;
  const contacts = new Set(contactIds(req.userId));
  const pendingOut = new Set(
    db.prepare("SELECT receiver_id FROM chat_requests WHERE sender_id = ? AND status = 'pending'")
      .all(req.userId).map((r) => r.receiver_id)
  );
  const pendingIn = new Set(
    db.prepare("SELECT sender_id FROM chat_requests WHERE receiver_id = ? AND status = 'pending'")
      .all(req.userId).map((r) => r.sender_id)
  );
  res.json({
    users: filtered.map((u) => ({
      ...publicUser(u),
      ...presenceFor(u, req.userId),
      blocked: isBlocked(req.userId, u.id),
      connectStatus: contacts.has(u.id)
        ? 'connected'
        : pendingOut.has(u.id)
          ? 'outgoing'
          : pendingIn.has(u.id)
            ? 'incoming'
            : 'none',
    })),
  });
});

/* ------------------------------------------------------------------ */
/* affiliations + colleagues                                          */
/* ------------------------------------------------------------------ */

/** Discover registered colleges/institutions, organizations and workplaces. */
/** GET /api/users/:id/profile — public profile page (tapping any avatar
 *  opens this). Blocked pairs see a 404, never a profile. */
app.get('/api/users/:id/profile', requireAuth, (req, res) => {
  const target = getUser(req.params.id);
  if (!target) return res.status(404).json({ error: 'User not found' });
  const isSelf = target.id === req.userId;
  if (!isSelf && (isBlocked(req.userId, target.id) || isBlocked(target.id, req.userId))) {
    return res.status(404).json({ error: 'User not found' });
  }

  const followers = db.prepare('SELECT COUNT(*) c FROM follows WHERE followed_id = ?').get(target.id).c;
  const followingCount = db.prepare('SELECT COUNT(*) c FROM follows WHERE follower_id = ?').get(target.id).c;
  // Post count respects audience — the viewer only ever counts what they
  // could actually open in the feed.
  const postRows = db
    .prepare('SELECT id, user_id, audience FROM posts WHERE user_id = ? AND deleted = 0')
    .all(target.id);
  const postsCount = postRows.filter((r) => canViewPost(r.id, r.user_id, r.audience || 'public', req.userId)).length;

  res.json({
    profile: {
      user: { ...publicUser(target), ...presenceFor(target, req.userId) },
      affiliations: affiliationsForUser(target.id),
      stats: { posts: postsCount, followers, following: followingCount },
      isSelf,
      following: isSelf ? undefined : isFollowing(req.userId, target.id),
      followsYou: isSelf ? undefined : isFollowing(target.id, req.userId),
      relationship: isSelf ? undefined : colleagueRelationship(req.userId, target.id),
      sharedAffiliations: isSelf ? [] : sharedAffiliations(req.userId, target.id),
    },
  });
});

app.get('/api/affiliations', requireAuth, (req, res) => {
  const q = normalizeAffiliationName(req.query.q || '');
  const typeFilter = String(req.query.type || '');
  const mine = req.query.mine === '1' || req.query.mine === 'true';
  if (typeFilter && !AFFILIATION_TYPES.includes(typeFilter)) {
    return res.status(400).json({ error: 'Invalid affiliation type' });
  }

  const params = [];
  let sql = 'SELECT DISTINCT a.* FROM affiliations a';
  if (mine) {
    sql += ' JOIN user_affiliations mine ON mine.affiliation_id = a.id AND mine.user_id = ?';
    params.push(req.userId);
  }
  const where = [];
  if (typeFilter) { where.push('a.type = ?'); params.push(typeFilter); }
  if (q) { where.push('a.normalized_name LIKE ?'); params.push(`%${q}%`); }
  if (where.length) sql += ` WHERE ${where.join(' AND ')}`;
  sql += ' ORDER BY a.name COLLATE NOCASE LIMIT 100';

  const rows = db.prepare(sql).all(...params);
  res.json({ affiliations: rows.map((row) => hydrateAffiliation(row, req.userId)) });
});

/** Create a place if needed and immediately add it to the current profile. */
app.post('/api/affiliations', requireAuth, (req, res) => {
  const { name, type = 'institution', title = '' } = req.body || {};
  const cleanName = String(name || '').trim().replace(/\s+/g, ' ');
  const normalizedName = normalizeAffiliationName(cleanName);
  if (cleanName.length < 2 || cleanName.length > 100) {
    return res.status(400).json({ error: 'Name must be between 2 and 100 characters' });
  }
  if (!AFFILIATION_TYPES.includes(type)) return res.status(400).json({ error: 'Invalid affiliation type' });
  if (String(title || '').trim().length > 80) return res.status(400).json({ error: 'Course or role is too long' });

  let row = db.prepare('SELECT * FROM affiliations WHERE type = ? AND normalized_name = ?').get(type, normalizedName);
  if (!row) {
    const id = nano();
    db.prepare(
      'INSERT INTO affiliations (id, name, normalized_name, type, created_by, created_at) VALUES (?,?,?,?,?,?)'
    ).run(id, cleanName, normalizedName, type, req.userId, now());
    row = db.prepare('SELECT * FROM affiliations WHERE id = ?').get(id);
  }

  const t = now();
  db.prepare(
    `INSERT INTO user_affiliations (user_id, affiliation_id, title, joined_at) VALUES (?,?,?,?)
     ON CONFLICT(user_id, affiliation_id) DO UPDATE SET title = excluded.title`
  ).run(req.userId, row.id, String(title || '').trim(), t);

  const payload = { affiliation: hydrateAffiliation(row, req.userId), user: publicUser(getUser(req.userId)) };
  affiliationMemberIds(row.id).forEach((uid) => emitToUser(uid, 'affiliation:updated', payload));
  res.json({ affiliation: payload.affiliation, affiliations: affiliationsForUser(req.userId) });
});

/** Join an existing place, optionally recording a course, department or role. */
app.post('/api/affiliations/:id/join', requireAuth, (req, res) => {
  const row = db.prepare('SELECT * FROM affiliations WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Place not found' });
  const title = String(req.body?.title || '').trim();
  if (title.length > 80) return res.status(400).json({ error: 'Course or role is too long' });
  const t = now();
  db.prepare(
    `INSERT INTO user_affiliations (user_id, affiliation_id, title, joined_at) VALUES (?,?,?,?)
     ON CONFLICT(user_id, affiliation_id) DO UPDATE SET title = excluded.title`
  ).run(req.userId, row.id, title, t);
  const payload = { affiliation: hydrateAffiliation(row, req.userId), user: publicUser(getUser(req.userId)) };
  affiliationMemberIds(row.id).forEach((uid) => emitToUser(uid, 'affiliation:updated', payload));
  res.json({ affiliation: payload.affiliation, affiliations: affiliationsForUser(req.userId) });
});

app.delete('/api/affiliations/:id/leave', requireAuth, (req, res) => {
  const row = db.prepare('SELECT * FROM affiliations WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Place not found' });
  const result = db.prepare('DELETE FROM user_affiliations WHERE user_id = ? AND affiliation_id = ?').run(req.userId, row.id);
  if (!result.changes) return res.status(400).json({ error: 'This place is not on your profile' });
  const remainingMembers = affiliationMemberIds(row.id);
  remainingMembers.forEach((uid) => emitToUser(uid, 'affiliation:updated', { affiliationId: row.id, leftUserId: req.userId }));
  res.json({ ok: true, affiliations: affiliationsForUser(req.userId) });
});

/** People who share a registered place, plus already-accepted colleague connections. */
app.get('/api/colleagues', requireAuth, (req, res) => {
  const q = String(req.query.q || '').trim().toLowerCase();
  const typeFilter = String(req.query.type || '');
  const affiliationId = String(req.query.affiliationId || '');
  if (typeFilter && !AFFILIATION_TYPES.includes(typeFilter)) {
    return res.status(400).json({ error: 'Invalid affiliation type' });
  }

  const params = [req.userId, req.userId, req.userId];
  let sql = `
    SELECT DISTINCT u.*
    FROM user_affiliations mine
    JOIN user_affiliations theirs ON theirs.affiliation_id = mine.affiliation_id AND theirs.user_id != mine.user_id
    JOIN users u ON u.id = theirs.user_id
    JOIN affiliations a ON a.id = mine.affiliation_id
    WHERE mine.user_id = ?
      AND NOT EXISTS (
        SELECT 1 FROM blocked_users b
        WHERE (b.blocker_id = ? AND b.blocked_id = u.id) OR (b.blocker_id = u.id AND b.blocked_id = ?)
      )`;
  if (typeFilter) { sql += ' AND a.type = ?'; params.push(typeFilter); }
  if (affiliationId) { sql += ' AND a.id = ?'; params.push(affiliationId); }
  sql += ' ORDER BY u.name COLLATE NOCASE';

  let users = db.prepare(sql).all(...params);

  // Accepted colleagues remain in the section even if one person later
  // removes the shared place from their profile. Type/place filters still
  // show only people who currently share that selected context.
  if (!typeFilter && !affiliationId) {
    const connected = db
      .prepare(
        `SELECT u.* FROM colleague_connections c
         JOIN users u ON u.id = CASE WHEN c.user_a = ? THEN c.user_b ELSE c.user_a END
         WHERE (c.user_a = ? OR c.user_b = ?)
           AND NOT EXISTS (
             SELECT 1 FROM blocked_users b
             WHERE (b.blocker_id = ? AND b.blocked_id = u.id) OR (b.blocker_id = u.id AND b.blocked_id = ?)
           )`
      )
      .all(req.userId, req.userId, req.userId, req.userId, req.userId);
    const byId = new Map(users.map((u) => [u.id, u]));
    connected.forEach((u) => byId.set(u.id, u));
    users = [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  if (q) {
    users = users.filter((u) => {
      const shared = sharedAffiliations(req.userId, u.id);
      return u.name.toLowerCase().includes(q) ||
        (u.username && u.username.toLowerCase().includes(q)) ||
        (u.about && u.about.toLowerCase().includes(q)) ||
        shared.some((a) => a.name.toLowerCase().includes(q) || a.title.toLowerCase().includes(q));
    });
  }
  res.json({ colleagues: users.map((u) => hydrateColleague(u, req.userId)) });
});

app.get('/api/colleagues/requests', requireAuth, (req, res) => {
  const rows = db
    .prepare(
      `SELECT r.id request_id, r.created_at requested_at, u.*
       FROM colleague_requests r JOIN users u ON u.id = r.sender_id
       WHERE r.receiver_id = ? AND r.status = 'pending'
         AND NOT EXISTS (
           SELECT 1 FROM blocked_users b
           WHERE (b.blocker_id = ? AND b.blocked_id = u.id) OR (b.blocker_id = u.id AND b.blocked_id = ?)
         )
       ORDER BY r.created_at DESC`
    )
    .all(req.userId, req.userId, req.userId);
  res.json({
    requests: rows.map((row) => ({
      id: row.request_id,
      requestedAt: row.requested_at,
      user: hydrateColleague(row, req.userId),
    })),
  });
});

app.post('/api/colleagues/:userId/request', requireAuth, (req, res) => {
  const targetId = req.params.userId;
  const target = getUser(targetId);
  if (!target) return res.status(404).json({ error: 'User not found' });
  if (targetId === req.userId) return res.status(400).json({ error: "You can't connect with yourself" });
  if (blockedEitherWay(req.userId, targetId)) return res.status(403).json({ error: 'Connection unavailable' });
  if (!sharedAffiliations(req.userId, targetId).length) {
    return res.status(403).json({ error: 'You need a shared institution, organization or workplace to connect' });
  }

  const relationship = colleagueRelationship(req.userId, targetId);
  if (relationship.status === 'connected') return res.status(409).json({ error: 'Already connected' });
  if (relationship.status === 'outgoing') return res.json({ status: 'outgoing', requestId: relationship.requestId });
  if (relationship.status === 'incoming') {
    return res.status(409).json({ error: 'This person already sent you a request — accept it instead' });
  }

  const request = { id: nano(), senderId: req.userId, receiverId: targetId, createdAt: now() };
  db.prepare(
    `INSERT INTO colleague_requests (id, sender_id, receiver_id, status, created_at)
     VALUES (?,?,?,?,?)`
  ).run(request.id, request.senderId, request.receiverId, 'pending', request.createdAt);
  emitToUser(targetId, 'colleague:updated', { type: 'request', requestId: request.id, user: publicUser(getUser(req.userId)) });
  push.notifyColleagueRequest({ targetId, sender: getUser(req.userId) });
  res.json({ status: 'outgoing', requestId: request.id });
});

app.post('/api/colleagues/requests/:id/respond', requireAuth, (req, res) => {
  const action = String(req.body?.action || '');
  if (!['accept', 'decline'].includes(action)) return res.status(400).json({ error: 'Action must be accept or decline' });
  const request = db.prepare('SELECT * FROM colleague_requests WHERE id = ? AND status = ?').get(req.params.id, 'pending');
  if (!request) return res.status(404).json({ error: 'Pending request not found' });
  if (request.receiver_id !== req.userId) return res.status(403).json({ error: 'This request is not yours' });
  if (blockedEitherWay(request.sender_id, request.receiver_id)) return res.status(403).json({ error: 'Connection unavailable' });

  const t = now();
  if (action === 'accept') {
    const [userA, userB] = colleaguePair(request.sender_id, request.receiver_id);
    db.transaction(() => {
      db.prepare('UPDATE colleague_requests SET status = ?, responded_at = ? WHERE id = ?').run('accepted', t, request.id);
      db.prepare('INSERT OR IGNORE INTO colleague_connections (user_a, user_b, created_at) VALUES (?,?,?)').run(userA, userB, t);
    })();
  } else {
    db.prepare('UPDATE colleague_requests SET status = ?, responded_at = ? WHERE id = ?').run('declined', t, request.id);
  }

  const event = { type: action, requestId: request.id, userId: req.userId };
  emitToUser(request.sender_id, 'colleague:updated', event);
  emitToUser(request.receiver_id, 'colleague:updated', event);
  res.json({ status: action === 'accept' ? 'connected' : 'declined' });
});

/** Cancel an outgoing request. */
app.delete('/api/colleagues/requests/:id', requireAuth, (req, res) => {
  const request = db.prepare('SELECT * FROM colleague_requests WHERE id = ? AND status = ?').get(req.params.id, 'pending');
  if (!request) return res.status(404).json({ error: 'Pending request not found' });
  if (request.sender_id !== req.userId) return res.status(403).json({ error: 'This request is not yours' });
  db.prepare('UPDATE colleague_requests SET status = ?, responded_at = ? WHERE id = ?').run('cancelled', now(), request.id);
  emitToUser(request.receiver_id, 'colleague:updated', { type: 'cancelled', requestId: request.id });
  res.json({ ok: true });
});

/** Remove an accepted colleague connection without deleting chats or messages. */
app.delete('/api/colleagues/:userId', requireAuth, (req, res) => {
  const [userA, userB] = colleaguePair(req.userId, req.params.userId);
  const result = db.prepare('DELETE FROM colleague_connections WHERE user_a = ? AND user_b = ?').run(userA, userB);
  if (!result.changes) return res.status(404).json({ error: 'Connection not found' });
  emitToUser(req.params.userId, 'colleague:updated', { type: 'removed', userId: req.userId });
  res.json({ ok: true });
});

/* ------------------------------------------------------------------ */
/* Phase 2: follow, "I'm around", Today at your place                  */
/* ------------------------------------------------------------------ */

/** Follow someone from the Network — one-way, no approval, feeds the
 *  "Following" filter. */
app.post('/api/users/:id/follow', requireAuth, (req, res) => {
  const targetId = req.params.id;
  const target = getUser(targetId);
  if (!target) return res.status(404).json({ error: 'User not found' });
  if (targetId === req.userId) return res.status(400).json({ error: "You can't follow yourself" });
  if (blockedEitherWay(req.userId, targetId)) return res.status(403).json({ error: 'Unavailable' });
  const result = db
    .prepare('INSERT OR IGNORE INTO follows (follower_id, followed_id, created_at) VALUES (?,?,?)')
    .run(req.userId, targetId, now());
  if (!result.changes) return res.status(409).json({ error: 'Already following' });
  res.json({ following: true });
});

/** Unfollow. Idempotent — unfollowing someone you don't follow is fine. */
app.delete('/api/users/:id/follow', requireAuth, (req, res) => {
  db.prepare('DELETE FROM follows WHERE follower_id = ? AND followed_id = ?').run(req.userId, req.params.id);
  res.json({ following: false });
});

/** Flip the 12-hour "I'm around" flag at your shared places. Setting it
 *  again extends the window ("still around"). Clearing it deletes the row. */
app.post('/api/me/around', requireAuth, (req, res) => {
  const around = req.body?.around !== false; // default true
  if (around) {
    const t = now();
    db.prepare(
      `INSERT INTO around_status (user_id, expires_at, created_at) VALUES (?,?,?)
       ON CONFLICT(user_id) DO UPDATE SET expires_at = excluded.expires_at, created_at = excluded.created_at`
    ).run(req.userId, t + AROUND_TTL_MS, t);
    const sharers = usersSharingPlaces(req.userId).filter((id) => id !== req.userId);
    push.notifyAround({ userIds: sharers.slice(0, 100), actor: getUser(req.userId) });
  } else {
    db.prepare('DELETE FROM around_status WHERE user_id = ?').run(req.userId);
  }
  const row = aroundRowFor(req.userId);
  res.json({ around: !!row, expiresAt: row?.expires_at || null });
});

/** Today at your place — who's around / online from your places, and what
 *  they posted today. `since` (ms) is the client's local midnight so "today"
 *  follows the viewer's day, not UTC's. */
app.get('/api/today', requireAuth, (req, res) => {
  const since = Math.min(Number(req.query.since) || now() - 24 * 3600 * 1000, now());
  aroundRowFor(req.userId); // sweep expired flags
  const sharerIds = usersSharingPlaces(req.userId);

  const aroundRows = sharerIds.length
    ? db
        .prepare(
          `SELECT a.user_id, a.created_at, a.expires_at, u.is_online, u.last_seen
           FROM around_status a JOIN users u ON u.id = a.user_id
           WHERE a.user_id IN (${sharerIds.map(() => '?').join(',')}) AND a.expires_at > ?
           ORDER BY a.created_at DESC LIMIT 24`
        )
        .all(...sharerIds, now())
    : [];
  const around = aroundRows.map((r) => ({
    user: publicUser(getUser(r.user_id)),
    since: r.created_at,
    expiresAt: r.expires_at,
  }));

  const onlineRows = sharerIds.length
    ? db
        .prepare(
          `SELECT id FROM users WHERE is_online = 1 AND id IN (${sharerIds.map(() => '?').join(',')})
           ORDER BY last_seen DESC LIMIT 24`
        )
        .all(...sharerIds)
    : [];
  const aroundIds = new Set(around.map((a) => a.user.id));
  const online = onlineRows.map((r) => publicUser(getUser(r.id))).filter((u) => !aroundIds.has(u.id));

  // Today's posts from place-sharers, audience-filtered for this viewer.
  const postRows = sharerIds.length
    ? db
        .prepare(
          `SELECT * FROM posts WHERE deleted = 0 AND user_id IN (${sharerIds.map(() => '?').join(',')})
           AND created_at > ? ORDER BY created_at DESC LIMIT 60`
        )
        .all(...sharerIds, since)
    : [];
  const placesPosts = [];
  const posters = new Set();
  postRows.forEach((r) => {
    if (canViewPost(r.id, r.user_id, r.audience || 'public', req.userId)) {
      if (placesPosts.length < 12) placesPosts.push(hydratePost(r, req.userId));
      posters.add(r.user_id);
    }
  });

  const mine = aroundRowFor(req.userId);
  res.json({
    places: affiliationsForUser(req.userId),
    around,
    online,
    posts: placesPosts,
    postsCount: placesPosts.length,
    postersCount: posters.size,
    me: { around: !!mine, expiresAt: mine?.expires_at || null },
    placeLabel: placeLabelFor(req.userId),
    generatedAt: now(),
  });
});

/* ------------------------------------------------------------------ */
/* blocking — real enforcement, not cosmetic                          */
/* ------------------------------------------------------------------ */

app.get('/api/blocked', requireAuth, (req, res) => {
  const rows = db
    .prepare(
      `SELECT u.* FROM blocked_users b JOIN users u ON u.id = b.blocked_id
       WHERE b.blocker_id = ? ORDER BY b.created_at DESC`
    )
    .all(req.userId);
  res.json({ users: rows.map(publicUser) });
});

app.post('/api/blocked/:userId', requireAuth, (req, res) => {
  const target = getUser(req.params.userId);
  if (!target) return res.status(404).json({ error: 'User not found' });
  if (target.id === req.userId) return res.status(400).json({ error: "You can't block yourself" });
  db.prepare('INSERT OR IGNORE INTO blocked_users (blocker_id, blocked_id, created_at) VALUES (?,?,?)').run(req.userId, target.id, now());
  // Blocking also severs the colleague relationship and closes any pending
  // request in either direction. Existing chat history is left intact.
  const [userA, userB] = colleaguePair(req.userId, target.id);
  db.prepare('DELETE FROM colleague_connections WHERE user_a = ? AND user_b = ?').run(userA, userB);
  db.prepare(
    `UPDATE colleague_requests SET status = 'cancelled', responded_at = ?
     WHERE status = 'pending' AND ((sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?))`
  ).run(now(), req.userId, target.id, target.id, req.userId);
  const pendingChats = db.prepare(
    `SELECT chat_id FROM chat_requests WHERE status = 'pending'
     AND ((sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?))`
  ).all(req.userId, target.id, target.id, req.userId);
  pendingChats.forEach(({ chat_id }) => {
    db.prepare('DELETE FROM chats WHERE id = ?').run(chat_id);
    emitToUser(target.id, 'chat:removed', { chatId: chat_id, action: 'block' });
    emitToUser(req.userId, 'chat:request:resolved', { chatId: chat_id, action: 'block' });
  });
  emitToUser(target.id, 'colleague:updated', { type: 'blocked', userId: req.userId });
  res.json({ ok: true });
});

app.delete('/api/blocked/:userId', requireAuth, (req, res) => {
  db.prepare('DELETE FROM blocked_users WHERE blocker_id = ? AND blocked_id = ?').run(req.userId, req.params.userId);
  res.json({ ok: true });
});

/* ------------------------------------------------------------------ */
/* Operational Transformation — collaborative documents                */
/* ------------------------------------------------------------------ */

// List documents for a chat (collaborative notes)
app.get('/api/chats/:id/documents', requireAuth, (req, res) => {
  const isMember = db.prepare('SELECT 1 FROM chat_members WHERE chat_id = ? AND user_id = ?').get(req.params.id, req.userId);
  if (!isMember) return res.status(403).json({ error: 'Not a member of this chat' });
  const docs = otStore.listDocumentsForChat(req.params.id);
  res.json({ documents: docs });
});

// Get single document with full content and version
app.get('/api/documents/:id', requireAuth, (req, res) => {
  const doc = otStore.getDocument(req.params.id);
  if (!doc) return res.status(404).json({ error: 'Document not found' });
  if (doc.chatId) {
    const isMember = db.prepare('SELECT 1 FROM chat_members WHERE chat_id = ? AND user_id = ?').get(doc.chatId, req.userId);
    if (!isMember) return res.status(403).json({ error: 'Not a member' });
  }
  if (doc.communityId) {
    const role = communityRole(doc.communityId, req.userId);
    if (!role) return res.status(403).json({ error: 'Not a member of this community' });
  }
  const ops = db.prepare('SELECT * FROM document_operations WHERE document_id = ? ORDER BY version ASC LIMIT 100').all(req.params.id);
  res.json({
    document: doc,
    operations: ops.map(r => ({
      userId: r.user_id,
      operation: JSON.parse(r.operation),
      baseVersion: r.base_version,
      version: r.version,
      createdAt: r.created_at
    }))
  });
});

// Create document (collaborative note in chat)
app.post('/api/chats/:id/documents', requireAuth, (req, res) => {
  const chat = db.prepare('SELECT * FROM chats WHERE id = ?').get(req.params.id);
  if (!chat) return res.status(404).json({ error: 'Chat not found' });
  const isMember = db.prepare('SELECT 1 FROM chat_members WHERE chat_id = ? AND user_id = ?').get(chat.id, req.userId);
  if (!isMember) return res.status(403).json({ error: 'Not a member' });
  const { title = '', content = '' } = req.body || {};
  if (String(title).length > 120) return res.status(400).json({ error: 'Title too long' });
  if (String(content).length > 50000) return res.status(400).json({ error: 'Content too long (50k max)' });
  const doc = otStore.createDocument({
    chatId: chat.id,
    title: String(title).trim(),
    content: String(content),
    createdBy: req.userId,
    meta: { createdByName: getUser(req.userId)?.name }
  });
  // Notify chat members about new doc
  memberIds(chat.id).forEach(uid => emitToUser(uid, 'doc:created', { chatId: chat.id, document: doc }));
  insertSystemMessage(chat.id, `${getUser(req.userId).name} created a collaborative note: \"${doc.title || 'Untitled'}\"`);
  res.json({ document: doc });
});

// Update document title (non-OT, simple)
app.patch('/api/documents/:id', requireAuth, (req, res) => {
  const doc = otStore.getDocument(req.params.id);
  if (!doc) return res.status(404).json({ error: 'Document not found' });
  if (doc.chatId) {
    const isMember = db.prepare('SELECT 1 FROM chat_members WHERE chat_id = ? AND user_id = ?').get(doc.chatId, req.userId);
    if (!isMember) return res.status(403).json({ error: 'Not a member' });
  }
  const { title } = req.body || {};
  if (title != null) {
    if (String(title).length > 120) return res.status(400).json({ error: 'Title too long' });
    db.prepare('UPDATE documents SET title = ?, updated_at = ? WHERE id = ?').run(String(title).trim(), now(), doc.id);
  }
  const updated = otStore.getDocument(req.params.id);
  if (updated.chatId) {
    memberIds(updated.chatId).forEach(uid => emitToUser(uid, 'doc:updated', { documentId: updated.id, title: updated.title }));
  }
  res.json({ document: updated });
});

// Delete document
app.delete('/api/documents/:id', requireAuth, (req, res) => {
  const doc = otStore.getDocument(req.params.id);
  if (!doc) return res.status(404).json({ error: 'Document not found' });
  const chat = doc.chatId ? db.prepare('SELECT * FROM chats WHERE id = ?').get(doc.chatId) : null;
  if (chat) {
    const me = db.prepare('SELECT role FROM chat_members WHERE chat_id = ? AND user_id = ?').get(chat.id, req.userId);
    if (!me) return res.status(403).json({ error: 'Not a member' });
    // Only creator or admin can delete
    if (doc.createdBy !== req.userId && me.role !== 'admin') {
      return res.status(403).json({ error: 'Only creator or admin can delete' });
    }
  } else if (doc.createdBy !== req.userId) {
    return res.status(403).json({ error: 'Only creator can delete' });
  }
  db.prepare('DELETE FROM documents WHERE id = ?').run(doc.id);
  otStore.docManager.delete(doc.id);
  if (doc.chatId) {
    memberIds(doc.chatId).forEach(uid => emitToUser(uid, 'doc:deleted', { documentId: doc.id, chatId: doc.chatId }));
  }
  res.json({ ok: true });
});

// OT operation REST fallback (when socket not available, e.g. offline sync)
app.post('/api/documents/:id/operation', requireAuth, (req, res) => {
  const doc = otStore.getDocument(req.params.id);
  if (!doc) return res.status(404).json({ error: 'Document not found' });
  if (doc.chatId) {
    const isMember = db.prepare('SELECT 1 FROM chat_members WHERE chat_id = ? AND user_id = ?').get(doc.chatId, req.userId);
    if (!isMember) return res.status(403).json({ error: 'Not a member' });
  }
  const { operation, baseVersion } = req.body || {};
  if (!operation) return res.status(400).json({ error: 'Missing operation' });
  try {
    const op = TextOperation.fromJSON(operation);
    const result = otStore.submitDocumentOperation(doc.id, op, req.userId, baseVersion != null ? Number(baseVersion) : undefined);
    // Broadcast to chat members
    if (doc.chatId) {
      memberIds(doc.chatId).filter(id => id !== req.userId).forEach(uid => {
        emitToUser(uid, 'doc:operation', {
          documentId: doc.id,
          operation: result.operation.operation.toJSON(),
          version: result.snapshot.version,
          userId: req.userId,
          userName: getUser(req.userId)?.name
        });
      });
    }
    res.json({ version: result.snapshot.version, content: result.snapshot.content, operation: result.operation.operation.toJSON() });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Message edit OT history
app.get('/api/messages/:id/edits', requireAuth, (req, res) => {
  const m = db.prepare('SELECT * FROM messages WHERE id = ?').get(req.params.id);
  if (!m) return res.status(404).json({ error: 'Message not found' });
  const isMember = db.prepare('SELECT 1 FROM chat_members WHERE chat_id = ? AND user_id = ?').get(m.chat_id, req.userId);
  if (!isMember) return res.status(403).json({ error: 'Not a member' });
  const history = otStore.getMessageEditHistory(req.params.id);
  res.json({
    messageId: req.params.id,
    version: history.length,
    edits: history.map(h => ({
      userId: h.userId,
      operation: h.operation.toJSON(),
      version: h.version,
      baseVersion: h.baseVersion,
      createdAt: h.createdAt
    }))
  });
});

/* ------------------------------------------------------------------ */
/* uploads                                                             */
/* ------------------------------------------------------------------ */

app.post('/api/upload', requireAuth, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  try {
    const url = await storage.save(
      req.file.buffer,
      req.file.originalname || 'upload.bin',
      req.file.mimetype || 'application/octet-stream'
    );
    res.json({ url });
  } catch (e) {
    console.error('[upload]', e.message);
    res.status(500).json({ error: 'Upload failed' });
  }
});

/* ------------------------------------------------------------------ */
/* chats                                                               */
/* ------------------------------------------------------------------ */

app.get('/api/chats', requireAuth, (req, res) => res.json({ chats: userChats(req.userId) }));

app.post('/api/chats/direct', requireAuth, (req, res) => {
  const { userId } = req.body || {};
  if (!userId || !getUser(userId)) return res.status(400).json({ error: 'Unknown user' });
  if (blockedEitherWay(req.userId, userId)) {
    return res.status(403).json({ error: "You can't message this person" });
  }

  const existing = db
    .prepare(
      `SELECT c.id FROM chats c
       JOIN chat_members a ON a.chat_id = c.id AND a.user_id = ?
       JOIN chat_members b ON b.chat_id = c.id AND b.user_id = ?
       WHERE c.type = 'direct'`
    )
    .get(req.userId, userId);

  if (existing) {
    // Opening the composer — or tapping a username — is not consent.
    // Incoming requests stay pending until Accept in Activity, or until
    // the receiver sends their own first message after accepting.
    return res.json({ chat: chatSummary(existing.id, req.userId) });
  }

  // Capture contact state before adding shared chat_members; otherwise the
  // new direct chat itself would incorrectly make a stranger a contact.
  const knownContact = areContacts(req.userId, userId);
  const id = nano();
  const t = now();
  db.prepare('INSERT INTO chats (id, type, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(
    id, 'direct', req.userId, t, t
  );
  const addMember = db.prepare('INSERT INTO chat_members (chat_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)');
  addMember.run(id, req.userId, 'member', t);
  addMember.run(id, userId, 'member', t);

  if (knownContact) {
    [req.userId, userId].forEach((uid) => emitToUser(uid, 'chat:new', chatSummary(id, uid)));
  } else {
    // Do not insert a chat_request until the first real message is sent.
    // Tapping a user id / opening the composer is only a private draft.
    emitToUser(req.userId, 'chat:new', chatSummary(id, req.userId));
  }
  res.json({ chat: chatSummary(id, req.userId) });
});

/**
 * Explicit +one connect request from find +ones. Tapping a row still only
 * opens a private draft; this is the action that notifies the other person.
 */
app.post('/api/connect/:userId', requireAuth, (req, res) => {
  const targetId = req.params.userId;
  const target = getUser(targetId);
  if (!target) return res.status(404).json({ error: 'User not found' });
  if (targetId === req.userId) return res.status(400).json({ error: "You can't connect with yourself" });
  if (blockedEitherWay(req.userId, targetId)) return res.status(403).json({ error: 'Connection unavailable' });

  if (areContacts(req.userId, targetId)) {
    const existing = db.prepare(
      `SELECT c.id FROM chats c
       JOIN chat_members a ON a.chat_id = c.id AND a.user_id = ?
       JOIN chat_members b ON b.chat_id = c.id AND b.user_id = ?
       WHERE c.type = 'direct'`
    ).get(req.userId, targetId);
    return res.json({ status: 'connected', chatId: existing?.id || null });
  }

  let chatId = db.prepare(
    `SELECT c.id FROM chats c
     JOIN chat_members a ON a.chat_id = c.id AND a.user_id = ?
     JOIN chat_members b ON b.chat_id = c.id AND b.user_id = ?
     WHERE c.type = 'direct'`
  ).get(req.userId, targetId)?.id;

  const t = now();
  if (!chatId) {
    chatId = nano();
    db.prepare('INSERT INTO chats (id, type, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(
      chatId, 'direct', req.userId, t, t
    );
    const addMember = db.prepare('INSERT INTO chat_members (chat_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)');
    addMember.run(chatId, req.userId, 'member', t);
    addMember.run(chatId, targetId, 'member', t);
    emitToUser(req.userId, 'chat:new', chatSummary(chatId, req.userId));
  }

  const pending = pendingChatRequest(chatId);
  if (pending && pending.sender_id === req.userId) {
    return res.json({ status: 'outgoing', chatId, requestId: pending.chat_id });
  }
  if (pending && pending.receiver_id === req.userId) {
    return res.status(409).json({ error: 'This person already sent you a request — accept it in Activity' });
  }
  if (!pending) {
    db.prepare(
      `INSERT INTO chat_requests (chat_id, sender_id, receiver_id, status, created_at)
       VALUES (?,?,?,?,?)`
    ).run(chatId, req.userId, targetId, 'pending', t);
  }

  const request = pendingChatRequest(chatId);
  emitToUser(req.userId, 'chat:updated', chatSummary(chatId, req.userId));
  emitToUser(targetId, 'chat:request', hydrateChatRequest(request, targetId));
  push.notifyChatRequest({ request, senderId: req.userId, chatId });
  res.json({ status: 'outgoing', chatId, requestId: chatId });
});

/** WhatsApp-style inbox for first messages from people outside contacts. */
app.get('/api/chat-requests', requireAuth, (req, res) => {
  const rows = db
    .prepare(
      `SELECT cr.* FROM chat_requests cr
       WHERE cr.receiver_id = ? AND cr.status = 'pending'
         AND EXISTS (SELECT 1 FROM messages m WHERE m.chat_id = cr.chat_id)
       ORDER BY cr.created_at DESC`
    )
    .all(req.userId);
  res.json({ requests: rows.map((row) => hydrateChatRequest(row, req.userId)).filter(Boolean) });
});


/** Instagram-style activity: message requests, likes, comments, calls, colleague/community requests. */
app.get('/api/activity', requireAuth, (req, res) => {
  const blockedSql = `NOT EXISTS (
    SELECT 1 FROM blocked_users b
    WHERE (b.blocker_id = ? AND b.blocked_id = u.id) OR (b.blocker_id = u.id AND b.blocked_id = ?)
  )`;
  const items = [];

  db.prepare(
    `SELECT cr.* FROM chat_requests cr
     WHERE cr.receiver_id = ? AND cr.status = 'pending'`
  ).all(req.userId).forEach((row) => {
    const hydrated = hydrateChatRequest(row, req.userId);
    if (!hydrated) return;
    const message = hydrated.chat?.lastMessage;
    const hasMessage = !!message && !message.deleted && (message.body || message.mediaUrl);
    items.push({
      id: `${hasMessage ? 'message' : 'connect'}_request:${row.chat_id}`,
      type: hasMessage ? 'message_request' : 'connect_request',
      createdAt: row.created_at,
      user: hydrated.requester,
      chatId: row.chat_id,
      preview: hasMessage
        ? (message?.deleted ? 'This message was deleted.' : (message?.body || 'Started a conversation with you.'))
        : 'wants to connect',
    });
  });

  db.prepare(
    `SELECT r.id, r.created_at, r.sender_id FROM colleague_requests r
     JOIN users u ON u.id = r.sender_id
     WHERE r.receiver_id = ? AND r.status = 'pending' AND ${blockedSql}
     ORDER BY r.created_at DESC`
  ).all(req.userId, req.userId, req.userId).forEach((row) => {
    items.push({
      id: `colleague_request:${row.id}`,
      type: 'colleague_request',
      createdAt: row.created_at,
      requestId: row.id,
      user: hydrateColleague(getUser(row.sender_id), req.userId),
    });
  });

  db.prepare(
    `SELECT r.community_id, r.user_id, r.requested_at, c.name community_name
     FROM community_requests r
     JOIN community_members me ON me.community_id = r.community_id AND me.user_id = ? AND me.role = 'admin'
     JOIN communities c ON c.id = r.community_id
     JOIN users u ON u.id = r.user_id
     WHERE ${blockedSql}
     ORDER BY r.requested_at DESC`
  ).all(req.userId, req.userId, req.userId).forEach((row) => {
    items.push({
      id: `community_request:${row.community_id}:${row.user_id}`,
      type: 'community_request',
      createdAt: row.requested_at,
      communityId: row.community_id,
      communityName: row.community_name,
      user: publicUser(getUser(row.user_id)),
    });
  });

  // Likes grouped per post ("3 people liked your post") so a popular post
  // is one row, not forty. Users list is capped to the 5 most recent faces;
  // count carries the truth.
  const LIKE_WINDOW = now() - 7 * 24 * 3600 * 1000;
  db.prepare(
    `SELECT pl.post_id, MAX(pl.at) latest_at, COUNT(*) c, p.body, p.media_url, p.title
     FROM post_likes pl
     JOIN posts p ON p.id = pl.post_id
     JOIN users u ON u.id = pl.user_id
     WHERE p.user_id = ? AND pl.user_id != ? AND p.deleted = 0 AND pl.at > ? AND ${blockedSql}
     GROUP BY pl.post_id
     ORDER BY latest_at DESC LIMIT 12`
  ).all(req.userId, req.userId, LIKE_WINDOW, req.userId, req.userId).forEach((row) => {
    const users = db
      .prepare(
        `SELECT u.* FROM post_likes pl JOIN users u ON u.id = pl.user_id
         WHERE pl.post_id = ? AND pl.user_id != ? ORDER BY pl.at DESC LIMIT 5`
      )
      .all(row.post_id, req.userId)
      .map((u) => publicUser(u));
    items.push({
      id: `like_group:${row.post_id}`,
      type: 'like_group',
      createdAt: row.latest_at,
      postId: row.post_id,
      preview: row.title || row.body || (row.media_url ? 'Photo' : 'your post'),
      users,
      count: row.c,
      user: users[0] || null,
    });
  });

  // Comments grouped per post the same way — one row per post, latest
  // comment as the preview, distinct commenters as the faces.
  db.prepare(
    `SELECT pc.post_id, MAX(pc.created_at) latest_at, COUNT(DISTINCT pc.user_id) c, p.body, p.media_url, p.title
     FROM post_comments pc
     JOIN posts p ON p.id = pc.post_id
     JOIN users u ON u.id = pc.user_id
     WHERE p.user_id = ? AND pc.user_id != ? AND p.deleted = 0 AND pc.created_at > ? AND ${blockedSql}
     GROUP BY pc.post_id
     ORDER BY latest_at DESC LIMIT 12`
  ).all(req.userId, req.userId, LIKE_WINDOW, req.userId, req.userId).forEach((row) => {
    const users = db
      .prepare(
        `SELECT u.*, MAX(pc.created_at) at2, (SELECT body FROM post_comments latest WHERE latest.post_id = pc.post_id AND latest.user_id = u.id ORDER BY latest.created_at DESC LIMIT 1) latest_body
         FROM post_comments pc JOIN users u ON u.id = pc.user_id
         WHERE pc.post_id = ? AND pc.user_id != ?
         GROUP BY u.id ORDER BY at2 DESC LIMIT 5`
      )
      .all(row.post_id, req.userId)
      .map((u) => publicUser(u));
    const latest = db
      .prepare('SELECT body FROM post_comments WHERE post_id = ? AND user_id != ? ORDER BY created_at DESC LIMIT 1')
      .get(row.post_id, req.userId);
    items.push({
      id: `comment_group:${row.post_id}`,
      type: 'comment_group',
      createdAt: row.latest_at,
      postId: row.post_id,
      preview: latest?.body || row.title || row.body || (row.media_url ? 'Photo' : 'your post'),
      postPreview: row.title || row.body || (row.media_url ? 'Photo' : 'your post'),
      users,
      count: row.c,
      user: users[0] || null,
    });
  });

  db.prepare(
    `SELECT * FROM calls WHERE caller_id = ? OR callee_id = ?
     ORDER BY started_at DESC LIMIT 25`
  ).all(req.userId, req.userId).forEach((row) => {
    const otherId = row.caller_id === req.userId ? row.callee_id : row.caller_id;
    items.push({
      id: `call:${row.id}`,
      type: 'call',
      createdAt: row.started_at,
      callId: row.id,
      chatId: row.chat_id,
      callType: row.type,
      status: row.status,
      direction: row.caller_id === req.userId ? 'outgoing' : 'incoming',
      user: publicUser(getUser(otherId)),
    });
  });

  items.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  const unread = items.filter((item) => (
    item.type === 'message_request'
    || item.type === 'colleague_request'
    || item.type === 'community_request'
    || (item.type === 'call' && item.status === 'missed' && item.direction === 'incoming')
  )).length;

  res.json({ activity: items.slice(0, 80), unread });
});

app.post('/api/chat-requests/:chatId/respond', requireAuth, (req, res) => {
  const request = pendingChatRequest(req.params.chatId);
  if (!request) return res.status(404).json({ error: 'Message request not found' });
  if (request.receiver_id !== req.userId) return res.status(403).json({ error: 'This request is not yours' });
  const action = String(req.body?.action || '');
  if (!['accept', 'delete', 'block'].includes(action)) {
    return res.status(400).json({ error: 'Action must be accept, delete or block' });
  }

  if (action === 'accept') {
    db.prepare("UPDATE chat_requests SET status = 'accepted', responded_at = ? WHERE chat_id = ?").run(now(), request.chat_id);
    const receiverChat = chatSummary(request.chat_id, request.receiver_id);
    emitToUser(request.receiver_id, 'chat:new', receiverChat);
    emitToUser(request.sender_id, 'chat:request:resolved', {
      chatId: request.chat_id, action: 'accept', chat: chatSummary(request.chat_id, request.sender_id),
    });
    return res.json({ status: 'accepted', chat: receiverChat });
  }

  if (action === 'block') {
    db.prepare('INSERT OR IGNORE INTO blocked_users (blocker_id, blocked_id, created_at) VALUES (?,?,?)')
      .run(req.userId, request.sender_id, now());
    const [userA, userB] = colleaguePair(req.userId, request.sender_id);
    db.prepare('DELETE FROM colleague_connections WHERE user_a = ? AND user_b = ?').run(userA, userB);
    db.prepare(
      `UPDATE colleague_requests SET status = 'cancelled', responded_at = ?
       WHERE status = 'pending' AND ((sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?))`
    ).run(now(), req.userId, request.sender_id, request.sender_id, req.userId);
  }

  // Deleting or blocking tears up the unaccepted conversation, including its
  // messages, via SQLite cascades. Accepted/existing conversations are never
  // affected by this endpoint.
  db.prepare('DELETE FROM chats WHERE id = ?').run(request.chat_id);
  const payload = { chatId: request.chat_id, action };
  emitToUser(request.sender_id, 'chat:removed', payload);
  emitToUser(request.receiver_id, 'chat:request:resolved', payload);
  res.json({ status: action === 'block' ? 'blocked' : 'deleted' });
});

app.post('/api/chats/group', requireAuth, (req, res) => {
  const { name, memberIds: ids = [], avatar } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'Group name is required' });

  const id = nano();
  const t = now();
  db.prepare('INSERT INTO chats (id, type, name, avatar, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?)').run(
    id, 'group', String(name).trim(), avatar || null, req.userId, t, t
  );
  const addMember = db.prepare('INSERT OR IGNORE INTO chat_members (chat_id, user_id, role, joined_at) VALUES (?,?,?,?)');
  addMember.run(id, req.userId, 'admin', t);
  ids.filter((x) => x !== req.userId).forEach((uid) => { if (getUser(uid)) addMember.run(id, uid, 'member', t); });

  const creator = getUser(req.userId);
  insertSystemMessage(id, `${creator.name} created group "${name}"`);

  memberIds(id).forEach((uid) => emitToUser(uid, 'chat:new', chatSummary(id, uid)));
  res.json({ chat: chatSummary(id, req.userId) });
});

/** Delete a chat for the current user without destroying it for others. */
app.delete('/api/chats/:id', requireAuth, (req, res) => {
  const chat = db.prepare('SELECT * FROM chats WHERE id = ?').get(req.params.id);
  if (!chat) return res.status(404).json({ error: 'Chat not found' });
  const membership = db.prepare('SELECT 1 FROM chat_members WHERE chat_id = ? AND user_id = ?')
    .get(chat.id, req.userId);
  if (!membership) return res.status(403).json({ error: 'Not a member of this chat' });

  const clearedAt = now();
  db.prepare('UPDATE chat_members SET cleared_at = ?, pinned_at = NULL WHERE chat_id = ? AND user_id = ?')
    .run(clearedAt, chat.id, req.userId);
  db.prepare(
    `DELETE FROM starred_messages WHERE user_id = ?
     AND message_id IN (SELECT id FROM messages WHERE chat_id = ?)`
  ).run(req.userId, chat.id);

  const archived = new Set((chat.archived_by || '').split(',').filter(Boolean));
  archived.delete(req.userId);
  db.prepare('UPDATE chats SET archived_by = ? WHERE id = ?').run([...archived].join(','), chat.id);

  emitToUser(req.userId, 'chat:removed', { chatId: chat.id, clearedAt });
  res.json({ ok: true, chatId: chat.id, clearedAt });
});

app.post('/api/chats/:id/archive', requireAuth, (req, res) => {
  const chat = db.prepare('SELECT * FROM chats WHERE id = ?').get(req.params.id);
  if (!chat) return res.status(404).json({ error: 'Chat not found' });
  const set = new Set((chat.archived_by || '').split(',').filter(Boolean));
  if (req.body.archived) set.add(req.userId); else set.delete(req.userId);
  db.prepare('UPDATE chats SET archived_by = ? WHERE id = ?').run([...set].join(','), chat.id);
  res.json({ chat: chatSummary(chat.id, req.userId) });
});

app.post('/api/chats/:id/mute', requireAuth, (req, res) => {
  db.prepare('UPDATE chat_members SET muted = ? WHERE chat_id = ? AND user_id = ?').run(
    req.body.muted ? 1 : 0, req.params.id, req.userId
  );
  res.json({ chat: chatSummary(req.params.id, req.userId) });
});

/** Pin / unpin a chat for the current user (pinned chats sort to the top). */
app.post('/api/chats/:id/pin', requireAuth, (req, res) => {
  const isMember = db.prepare('SELECT 1 FROM chat_members WHERE chat_id = ? AND user_id = ?').get(req.params.id, req.userId);
  if (!isMember) return res.status(403).json({ error: 'Not a member of this chat' });
  db.prepare('UPDATE chat_members SET pinned_at = ? WHERE chat_id = ? AND user_id = ?').run(
    req.body.pinned ? now() : null, req.params.id, req.userId
  );
  res.json({ chat: chatSummary(req.params.id, req.userId) });
});

/** Edit a group's name/avatar (admins only). */
app.patch('/api/chats/:id', requireAuth, (req, res) => {
  const chat = db.prepare('SELECT * FROM chats WHERE id = ?').get(req.params.id);
  if (!chat) return res.status(404).json({ error: 'Chat not found' });
  if (!['group', 'gc'].includes(chat.type)) return res.status(400).json({ error: 'Only group and GC chats can be renamed here' });
  const me = db.prepare('SELECT role FROM chat_members WHERE chat_id = ? AND user_id = ?').get(chat.id, req.userId);
  if (!me) return res.status(403).json({ error: 'Not a member of this chat' });
  if (me.role !== 'admin') return res.status(403).json({ error: 'Only group admins can edit this group' });

  const { name, avatar } = req.body || {};
  if (name !== undefined && !String(name).trim()) return res.status(400).json({ error: 'Group name cannot be empty' });
  const nextName = name !== undefined ? String(name).trim().slice(0, 60) : chat.name;
  const nextAvatar = avatar !== undefined ? (avatar || null) : chat.avatar;

  db.prepare('UPDATE chats SET name = ?, avatar = ?, updated_at = ? WHERE id = ?').run(nextName, nextAvatar, now(), chat.id);
  if (name !== undefined && String(name).trim() !== chat.name) {
    const editor = getUser(req.userId);
    insertSystemMessage(chat.id, `${editor.name} changed the group name to "${String(name).trim()}"`);
  }
  memberIds(chat.id).forEach((uid) => emitToUser(uid, 'chat:updated', chatSummary(chat.id, uid)));
  res.json({ chat: chatSummary(chat.id, req.userId) });
});

/** Set the chat-wide default disappearing-message timer (seconds; 0 = off). */
app.post('/api/chats/:id/disappear', requireAuth, (req, res) => {
  const isMember = db.prepare('SELECT 1 FROM chat_members WHERE chat_id = ? AND user_id = ?').get(req.params.id, req.userId);
  if (!isMember) return res.status(403).json({ error: 'Not a member of this chat' });
  const seconds = clampDisappear(req.body.seconds);
  db.prepare('UPDATE chats SET disappear_seconds = ? WHERE id = ?').run(seconds, req.params.id);
  res.json({ chat: chatSummary(req.params.id, req.userId) });
});

/**
 * Set the per-conversation chat theme. The theme lives on the conversation,
 * not the user: changing it here changes it for every participant, and a
 * theme change in one chat never touches another.
 *
 * - theme_id is validated against the server-side allow-list before anything
 *   is persisted — arbitrary ids/colors/objects from clients are rejected.
 * - A subtle system message is recorded in the chat ("✨ <name> changed the
 *   chat theme to <Theme>") and broadcast live alongside chat:updated and the
 *   dedicated chat:theme event, so everyone currently viewing the chat
 *   updates instantly without a reload, and late joiners read the persisted
 *   theme from the chat summary.
 */
app.post('/api/chats/:id/theme', requireAuth, (req, res) => {
  const chat = db.prepare('SELECT * FROM chats WHERE id = ?').get(req.params.id);
  if (!chat) return res.status(404).json({ error: 'Chat not found' });
  const membership = db.prepare('SELECT 1 FROM chat_members WHERE chat_id = ? AND user_id = ?').get(chat.id, req.userId);
  if (!membership) return res.status(403).json({ error: 'Not a member of this chat' });

  const themeId = String(req.body?.themeId || '');
  if (!ALLOWED_THEME_IDS.has(themeId)) {
    return res.status(400).json({ error: 'Unknown chat theme' });
  }
  if ((chat.theme_id || 'graphite') === themeId) {
    // Idempotent re-apply: no system-message spam, still return current state.
    return res.json({ ok: true, chat: chatSummary(chat.id, req.userId), themeId, themeUpdatedBy: chat.theme_updated_by, themeUpdatedAt: chat.theme_updated_at });
  }

  const t = now();
  db.prepare('UPDATE chats SET theme_id = ?, theme_updated_by = ?, theme_updated_at = ? WHERE id = ?')
    .run(themeId, req.userId, t, chat.id);

  const changer = getUser(req.userId);
  const themeMsg = insertSystemMessage(chat.id, `✨ ${changer.name} changed the chat theme to ${CHAT_THEMES[themeId]}`);

  memberIds(chat.id).forEach((uid) => {
    // The theme-change notice appears inline, like any other system message.
    emitToUser(uid, 'message:new', { message: hydrateMessage(themeMsg, uid) });
    // Full summary keeps lists + late-opening clients in sync.
    emitToUser(uid, 'chat:updated', chatSummary(chat.id, uid));
    // Targeted event lets open chats swap the active ChatTheme immediately.
    emitToUser(uid, 'chat:theme', {
      chatId: chat.id, themeId, themeUpdatedBy: req.userId, themeUpdatedAt: t, updatedByName: changer.name,
    });
  });

  res.json({ ok: true, chat: chatSummary(chat.id, req.userId), themeId, themeUpdatedBy: req.userId, themeUpdatedAt: t });
});

/* ---- group admin controls ---- */

/** Promote / demote a group member (admins only). */
app.post('/api/chats/:id/group/members/:userId/role', requireAuth, (req, res) => {
  const chat = db.prepare('SELECT * FROM chats WHERE id = ?').get(req.params.id);
  if (!chat || !['group', 'gc'].includes(chat.type)) return res.status(404).json({ error: 'Group not found' });
  const actor = db.prepare('SELECT role FROM chat_members WHERE chat_id = ? AND user_id = ?').get(chat.id, req.userId);
  const target = db.prepare('SELECT * FROM chat_members WHERE chat_id = ? AND user_id = ?').get(chat.id, req.params.userId);
  if (!actor) return res.status(403).json({ error: 'Not a member of this group' });
  if (actor.role !== 'admin') return res.status(403).json({ error: 'Only group admins can change roles' });
  if (!target) return res.status(404).json({ error: 'Not a member of this group' });
  if (target.user_id === chat.created_by) return res.status(400).json({ error: "The group creator's role cannot be changed" });
  if (target.user_id === req.userId) return res.status(400).json({ error: "You can't change your own role" });

  const { role } = req.body || {};
  if (!['admin', 'member'].includes(role)) return res.status(400).json({ error: 'Invalid role' });

  db.prepare('UPDATE chat_members SET role = ? WHERE chat_id = ? AND user_id = ?').run(role, chat.id, target.user_id);
  const targetUser = getUser(target.user_id);
  insertSystemMessage(chat.id, `${targetUser.name} is now a group ${role === 'admin' ? 'admin' : 'member'}`);
  memberIds(chat.id).forEach((uid) => emitToUser(uid, 'chat:updated', chatSummary(chat.id, uid)));
  res.json({ chat: chatSummary(chat.id, req.userId) });
});

/** Admin removes a member from the group. */
app.delete('/api/chats/:id/group/members/:userId', requireAuth, (req, res) => {
  const chat = db.prepare('SELECT * FROM chats WHERE id = ?').get(req.params.id);
  if (!chat || !['group', 'gc'].includes(chat.type)) return res.status(404).json({ error: 'Group not found' });
  const actor = db.prepare('SELECT role FROM chat_members WHERE chat_id = ? AND user_id = ?').get(chat.id, req.userId);
  const target = db.prepare('SELECT * FROM chat_members WHERE chat_id = ? AND user_id = ?').get(chat.id, req.params.userId);
  if (!actor || actor.role !== 'admin') return res.status(403).json({ error: 'Only group admins can remove members' });
  if (!target) return res.status(404).json({ error: 'Not a member of this group' });
  if (target.user_id === req.userId) return res.status(400).json({ error: 'Use “Leave group” to leave' });
  if (target.user_id === chat.created_by) return res.status(400).json({ error: 'The group creator cannot be removed' });
  if (target.role === 'admin') {
    const admins = db.prepare(`SELECT COUNT(*) c FROM chat_members WHERE chat_id = ? AND role = 'admin'`).get(chat.id).c;
    if (admins <= 1) return res.status(400).json({ error: 'Cannot remove the only admin — demote or remove them last' });
  }

  db.prepare('DELETE FROM chat_members WHERE chat_id = ? AND user_id = ?').run(chat.id, target.user_id);
  const targetUser = getUser(target.user_id);
  insertSystemMessage(chat.id, `${targetUser.name} was removed by ${getUser(req.userId).name}`);
  emitToUser(target.user_id, 'chat:removed', { chatId: chat.id });
  // GC-specific removal: the removed member's GC environment tears down and
  // leaves the gc:{id} room immediately (normal chats are untouched). The
  // client leaves its room on gc:removed; server-side the removed user is no
  // longer in memberIds so no further gc:* event can reach them anyway.
  if (chat.type === 'gc') {
    emitToUser(target.user_id, 'gc:removed', { chatId: chat.id });
  }
  memberIds(chat.id).forEach((uid) => emitToUser(uid, 'chat:updated', chatSummary(chat.id, uid)));
  res.json({ ok: true });
});

/** Leave a group (last admin must promote someone first). */
app.post('/api/chats/:id/group/leave', requireAuth, (req, res) => {
  const chat = db.prepare('SELECT * FROM chats WHERE id = ?').get(req.params.id);
  if (!chat || !['group', 'gc'].includes(chat.type)) return res.status(404).json({ error: 'Group not found' });
  const me = db.prepare('SELECT role FROM chat_members WHERE chat_id = ? AND user_id = ?').get(chat.id, req.userId);
  if (!me) return res.status(400).json({ error: 'Not a member' });
  if (me.role === 'admin') {
    const admins = db.prepare(`SELECT COUNT(*) c FROM chat_members WHERE chat_id = ? AND role = 'admin'`).get(chat.id).c;
    if (admins <= 1) return res.status(400).json({ error: 'You are the only admin — promote someone else first' });
  }

  db.prepare('DELETE FROM chat_members WHERE chat_id = ? AND user_id = ?').run(chat.id, req.userId);
  const meUser = getUser(req.userId);
  insertSystemMessage(chat.id, `${meUser.name} left the group`);
  emitToUser(req.userId, 'chat:removed', { chatId: chat.id });
  // Leaving a GC removes it from the leaver's GC environment exclusively —
  // their direct chats are never affected.
  if (chat.type === 'gc') {
    emitToUser(req.userId, 'gc:removed', { chatId: chat.id });
  }
  memberIds(chat.id).forEach((uid) => emitToUser(uid, 'chat:updated', chatSummary(chat.id, uid)));
  res.json({ ok: true });
});

/* ------------------------------------------------------------------ */
/* GCs — Instagram-style group chats                                   */
/*                                                                     */
/* A GC is a real chat (type='gc'), so messages, receipts, typing,      */
/* themes, polls and moderation all work through the existing chat      */
/* endpoints. Two differences: the Chats inbox never lists them         */
/* (userChats excludes type='gc' — they live in the GC section), and    */
/* anyone can discover a GC and join it — instantly when privacy is     */
/* 'open', or through an admin-approved request when it's 'request'.    */
/* ------------------------------------------------------------------ */

const GC_PRIVACIES = ['open', 'request'];

function gcMetaRow(chatId) {
  return db.prepare('SELECT * FROM gcs WHERE chat_id = ?').get(chatId);
}

function gcRole(chatId, userId) {
  const row = db.prepare('SELECT role FROM chat_members WHERE chat_id = ? AND user_id = ?').get(chatId, userId);
  return row ? row.role : null;
}

/** Public GC card — everything Discover shows, plus admin request counts. */
function hydrateGC(chat, viewerId) {
  const meta = gcMetaRow(chat.id);
  if (!meta) return null;
  const memberCount = db.prepare('SELECT COUNT(*) c FROM chat_members WHERE chat_id = ?').get(chat.id).c;
  const role = gcRole(chat.id, viewerId);
  const pendingRequest = !role
    ? !!db.prepare("SELECT 1 FROM gc_requests WHERE chat_id = ? AND user_id = ? AND status = 'pending'").get(chat.id, viewerId)
    : false;
  const requestCount = role === 'admin'
    ? db.prepare("SELECT COUNT(*) c FROM gc_requests WHERE chat_id = ? AND status = 'pending'").get(chat.id).c
    : 0;
  const creator = getUser(chat.created_by);
  return {
    id: chat.id,
    name: chat.name,
    avatar: chat.avatar,
    description: meta.description || '',
    privacy: meta.privacy,
    createdAt: meta.created_at,
    createdBy: chat.created_by,
    createdByName: creator ? creator.name : null,
    memberCount,
    role,
    isMember: !!role,
    pendingRequest,
    requestCount,
    updatedAt: chat.updated_at,
  };
}

app.post('/api/gc', requireAuth, (req, res) => {
  const { name, description = '', privacy = 'request', memberIds: ids = [] } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'Give your GC a name' });
  if (!GC_PRIVACIES.includes(privacy)) return res.status(400).json({ error: 'Invalid privacy' });

  const id = nano();
  const t = now();
  db.prepare('INSERT INTO chats (id, type, name, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?)')
    .run(id, 'gc', String(name).trim().slice(0, 60), req.userId, t, t);
  db.prepare('INSERT INTO gcs (chat_id, description, privacy, created_at) VALUES (?,?,?,?)')
    .run(id, String(description || '').trim().slice(0, 300), privacy, t);
  const addMember = db.prepare('INSERT OR IGNORE INTO chat_members (chat_id, user_id, role, joined_at) VALUES (?,?,?,?)');
  addMember.run(id, req.userId, 'admin', t);
  ids.filter((x) => x !== req.userId).forEach((uid) => { if (getUser(uid)) addMember.run(id, uid, 'member', t); });

  const creator = getUser(req.userId);
  insertSystemMessage(id, `${creator.name} created the GC "${String(name).trim()}"`);
  memberIds(id).forEach((uid) => emitToUser(uid, 'chat:new', chatSummary(id, uid)));
  res.json({ gc: hydrateGC(db.prepare('SELECT * FROM chats WHERE id = ?').get(id), req.userId), chat: chatSummary(id, req.userId) });
});

/** My GCs — the GC inbox. Same chat-summary shape as /api/chats (plus a
 *  `gc` block) so the client can feed them through the identical live store. */
app.get('/api/gc', requireAuth, (req, res) => {
  const rows = db.prepare(
    `SELECT c.id FROM chats c
     JOIN chat_members cm ON cm.chat_id = c.id
     JOIN gcs g ON g.chat_id = c.id
     WHERE cm.user_id = ? ORDER BY c.updated_at DESC`
  ).all(req.userId);
  res.json({
    chats: rows.map((r) => {
      const summary = chatSummary(r.id, req.userId);
      if (!summary) return null;
      const meta = gcMetaRow(r.id);
      const requestCount = summary.role === 'admin'
        ? db.prepare("SELECT COUNT(*) c FROM gc_requests WHERE chat_id = ? AND status = 'pending'").get(r.id).c
        : 0;
      return { ...summary, gc: { description: meta?.description || '', privacy: meta?.privacy || 'request', requestCount } };
    }).filter(Boolean),
  });
});

/** Discover — GCs I haven't joined yet. */
app.get('/api/gc/discover', requireAuth, (req, res) => {
  const rows = db.prepare(
    `SELECT c.* FROM chats c
     JOIN gcs g ON g.chat_id = c.id
     WHERE c.id NOT IN (SELECT chat_id FROM chat_members WHERE user_id = ?)
     ORDER BY c.updated_at DESC LIMIT 100`
  ).all(req.userId);
  res.json({ gcs: rows.map((r) => hydrateGC(r, req.userId)).filter(Boolean) });
});

/** One GC's full card (members via the chat summary; pending requests for admins). */
app.get('/api/gc/:id', requireAuth, (req, res) => {
  const chat = db.prepare('SELECT * FROM chats WHERE id = ?').get(req.params.id);
  if (!chat || chat.type !== 'gc') return res.status(404).json({ error: 'GC not found' });
  const role = gcRole(chat.id, req.userId);
  if (!role) return res.status(403).json({ error: 'Join this GC to see more' });
  const gc = hydrateGC(chat, req.userId);
  if (role === 'admin') {
    gc.pendingRequests = db.prepare(
      `SELECT u.id, u.username, u.name, u.avatar, r.created_at FROM gc_requests r
       JOIN users u ON u.id = r.user_id
       WHERE r.chat_id = ? AND r.status = 'pending' ORDER BY r.created_at ASC`
    ).all(chat.id);
  }
  res.json({ gc, chat: chatSummary(chat.id, req.userId) });
});

/** Join a GC — instant when open, queued for admin approval when request-only. */
app.post('/api/gc/:id/join', requireAuth, (req, res) => {
  const chat = db.prepare('SELECT * FROM chats WHERE id = ?').get(req.params.id);
  if (!chat || chat.type !== 'gc') return res.status(404).json({ error: 'GC not found' });
  const meta = gcMetaRow(chat.id);
  if (!meta) return res.status(404).json({ error: 'GC not found' });
  if (gcRole(chat.id, req.userId)) return res.status(400).json({ error: 'You are already in this GC' });
  if (blockedEitherWay(chat.created_by, req.userId)) {
    return res.status(403).json({ error: 'You cannot join this GC' });
  }

  const me = getUser(req.userId);
  if (meta.privacy === 'open') {
    const t = now();
    db.prepare('INSERT INTO chat_members (chat_id, user_id, role, joined_at) VALUES (?,?,?,?)')
      .run(chat.id, req.userId, 'member', t);
    db.prepare('DELETE FROM gc_requests WHERE chat_id = ? AND user_id = ?').run(chat.id, req.userId);
    insertSystemMessage(chat.id, `${me.name} joined the GC`);
    db.prepare('UPDATE chats SET updated_at = ? WHERE id = ?').run(t, chat.id);
    emitToUser(req.userId, 'chat:new', chatSummary(chat.id, req.userId));
    memberIds(chat.id).forEach((uid) => {
      if (uid !== req.userId) emitToUser(uid, 'chat:updated', chatSummary(chat.id, uid));
    });
    return res.json({ joined: true, gc: hydrateGC(db.prepare('SELECT * FROM chats WHERE id = ?').get(chat.id), req.userId) });
  }

  db.prepare(
    `INSERT INTO gc_requests (chat_id, user_id, status, created_at) VALUES (?,?,'pending',?)
     ON CONFLICT(chat_id, user_id) DO UPDATE SET status = 'pending', created_at = excluded.created_at`
  ).run(chat.id, req.userId, now());
  db.prepare("SELECT user_id FROM chat_members WHERE chat_id = ? AND role = 'admin'").all(chat.id)
    .forEach(({ user_id: adminId }) => {
      if (blockedEitherWay(adminId, req.userId)) return;
      emitToUser(adminId, 'gc:request', { chatId: chat.id, gcName: chat.name, user: publicUser(me) });
    });
  res.json({ joined: false, requested: true, gc: hydrateGC(chat, req.userId) });
});

/** Withdraw my pending join request. */
app.delete('/api/gc/:id/join', requireAuth, (req, res) => {
  const chat = db.prepare('SELECT * FROM chats WHERE id = ?').get(req.params.id);
  if (!chat || chat.type !== 'gc') return res.status(404).json({ error: 'GC not found' });
  db.prepare('DELETE FROM gc_requests WHERE chat_id = ? AND user_id = ?').run(chat.id, req.userId);
  res.json({ ok: true, gc: hydrateGC(chat, req.userId) });
});

/** Pending join requests (admins only). */
app.get('/api/gc/:id/requests', requireAuth, (req, res) => {
  const chat = db.prepare('SELECT * FROM chats WHERE id = ?').get(req.params.id);
  if (!chat || chat.type !== 'gc') return res.status(404).json({ error: 'GC not found' });
  if (gcRole(chat.id, req.userId) !== 'admin') return res.status(403).json({ error: 'Only GC admins can see requests' });
  res.json({
    requests: db.prepare(
      `SELECT u.id, u.username, u.name, u.avatar, r.created_at FROM gc_requests r
       JOIN users u ON u.id = r.user_id
       WHERE r.chat_id = ? AND r.status = 'pending' ORDER BY r.created_at ASC`
    ).all(chat.id),
  });
});

/** Approve / decline a join request. Approving seats the member and drops
 *  the GC straight into their GC inbox (chat:new) — exactly the Instagram
 *  "request → you're in" flow. */
app.post('/api/gc/:id/requests/:userId', requireAuth, (req, res) => {
  const chat = db.prepare('SELECT * FROM chats WHERE id = ?').get(req.params.id);
  if (!chat || chat.type !== 'gc') return res.status(404).json({ error: 'GC not found' });
  if (gcRole(chat.id, req.userId) !== 'admin') return res.status(403).json({ error: 'Only GC admins can manage requests' });
  const { action } = req.body || {};
  if (!['approve', 'decline'].includes(action)) return res.status(400).json({ error: 'Invalid action' });
  const row = db.prepare("SELECT * FROM gc_requests WHERE chat_id = ? AND user_id = ? AND status = 'pending'")
    .get(chat.id, req.params.userId);
  if (!row) return res.status(404).json({ error: 'No pending request from this person' });

  if (action === 'approve') {
    const t = now();
    db.prepare('INSERT OR IGNORE INTO chat_members (chat_id, user_id, role, joined_at) VALUES (?,?,?,?)')
      .run(chat.id, row.user_id, 'member', t);
    const who = getUser(row.user_id);
    if (who) insertSystemMessage(chat.id, `${who.name} joined the GC`);
    db.prepare('UPDATE chats SET updated_at = ? WHERE id = ?').run(t, chat.id);
    emitToUser(row.user_id, 'chat:new', chatSummary(chat.id, row.user_id));
    memberIds(chat.id).forEach((uid) => {
      if (uid !== row.user_id) emitToUser(uid, 'chat:updated', chatSummary(chat.id, uid));
    });
  }
  db.prepare('DELETE FROM gc_requests WHERE chat_id = ? AND user_id = ?').run(chat.id, row.user_id);
  emitToUser(row.user_id, 'gc:requestUpdate', { chatId: chat.id, gcName: chat.name, approved: action === 'approve' });
  res.json({ ok: true, gc: hydrateGC(chat, req.userId) });
});

/* ---- GC messages — dedicated, membership-enforced chat API ----------
   GC conversations are real chats underneath (shared messaging machinery:
   receipts, reactions, edits, polls, disappearing messages all still work),
   but they are fetched/stored/updated through GC-only endpoints and events
   so a GC message can NEVER be confused with, or merged into, a direct
   chat. `GET /api/chats` and `/api/sync/messages` exclude type='gc' rows. */

/** Paginated GC messages. Membership verified on every page — a removed
 *  member instantly loses read access even while a stale client is open. */
app.get('/api/gc/:id/messages', requireAuth, (req, res) => {
  const chat = db.prepare('SELECT * FROM chats WHERE id = ?').get(req.params.id);
  if (!chat || chat.type !== 'gc') return res.status(404).json({ error: 'GC not found' });
  const page = chatMessagesPage(chat.id, req.userId, req.query);
  if (page.error) return res.status(page.status).json({ error: page.error });
  res.json(page);
});

/** Send a message into a GC. Same idempotent send path as direct chats
 *  (clientId dedupe), but only after a GC + membership check. */
app.post('/api/gc/:id/messages', requireAuth, (req, res) => {
  try {
    const chat = db.prepare('SELECT * FROM chats WHERE id = ?').get(req.params.id);
    if (!chat || chat.type !== 'gc') return res.status(404).json({ error: 'GC not found' });
    const outcome = deliverUserMessage(req.userId, { ...(req.body || {}), chatId: chat.id });
    if (outcome.error) return res.status(outcome.status || 400).json({ error: outcome.error });
    fanoutNewMessage(outcome, req.userId, req.body?.tempId || req.body?.clientId || null);
    res.json({
      message: hydrateMessage(outcome.row, req.userId),
      duplicate: !!outcome.duplicate,
    });
  } catch (error) {
    console.error('[gc messages send]', error);
    res.status(500).json({ error: 'Could not send message' });
  }
});

/* ---- starred messages ---- */

/** All starred messages across the user's chats, newest first. */
app.get('/api/starred', requireAuth, (req, res) => {
  const rows = db
    .prepare(
      `SELECT sm.*, m.chat_id, m.sender_id, m.type, m.body, m.media_url, m.duration, m.created_at, m.deleted
       FROM starred_messages sm
       JOIN messages m ON m.id = sm.message_id
       JOIN chat_members cm ON cm.chat_id = m.chat_id AND cm.user_id = sm.user_id
       WHERE sm.user_id = ? ORDER BY sm.at DESC LIMIT 200`
    )
    .all(req.userId);
  res.json({
    messages: rows.map((r) => ({
      ...hydrateMessage(db.prepare('SELECT * FROM messages WHERE id = ?').get(r.message_id), req.userId),
      chatName: chatSummary(r.chat_id, req.userId)?.name,
      chatId: r.chat_id,
    })),
  });
});

/** Star a message (must be a member of its chat). */
app.post('/api/messages/:id/star', requireAuth, (req, res) => {
  const m = db.prepare('SELECT * FROM messages WHERE id = ?').get(req.params.id);
  if (!m || m.deleted) return res.status(404).json({ error: 'Message not found' });
  const isMember = db.prepare('SELECT 1 FROM chat_members WHERE chat_id = ? AND user_id = ?').get(m.chat_id, req.userId);
  if (!isMember) return res.status(403).json({ error: 'Not a member of this chat' });
  db.prepare('INSERT OR IGNORE INTO starred_messages (message_id, user_id, at) VALUES (?,?,?)').run(m.id, req.userId, now());
  res.json({ starred: true });
});

app.delete('/api/messages/:id/star', requireAuth, (req, res) => {
  db.prepare('DELETE FROM starred_messages WHERE message_id = ? AND user_id = ?').run(req.params.id, req.userId);
  res.json({ starred: false });
});

/** Per-message disappearing timer override (seconds; 0 = never). */
app.post('/api/messages/:id/disappear', requireAuth, (req, res) => {
  const m = db.prepare('SELECT * FROM messages WHERE id = ?').get(req.params.id);
  if (!m || m.deleted) return res.status(404).json({ error: 'Message not found' });
  if (m.sender_id !== req.userId) return res.status(403).json({ error: 'Only the sender can set a timer on a message' });
  const seconds = clampDisappear(req.body.seconds);
  const expiresAt = seconds ? now() + seconds * 1000 : null;
  db.prepare('UPDATE messages SET expires_at = ?, updated_at = ? WHERE id = ?').run(expiresAt, now(), m.id);
  const fresh = db.prepare('SELECT * FROM messages WHERE id = ?').get(m.id);
  emitToChat(m.chat_id, 'message:updated', (viewer) => hydrateMessage(fresh, viewer));
  emitToChat(m.chat_id, 'chat:updated', (viewer) => chatSummary(m.chat_id, viewer));
  res.json({ expiresAt });
});

/* ---- forwarding ---- */

/** Copy a message into one or more of the user's chats. */
app.post('/api/messages/forward', requireAuth, (req, res) => {
  const gate = moderation.moderationGate(req.userId);
  if (gate.blocked) return res.status(403).json({ error: gate.error });
  const { messageId, chatIds = [] } = req.body || {};
  const src = db.prepare('SELECT * FROM messages WHERE id = ?').get(messageId);
  if (!src || src.deleted) return res.status(404).json({ error: 'Message not found' });
  if (src.type === 'system') return res.status(400).json({ error: 'System messages cannot be forwarded' });
  if (src.type === 'poll') return res.status(400).json({ error: 'Polls cannot be forwarded — create a new one' });
  const isSrcMember = db.prepare('SELECT 1 FROM chat_members WHERE chat_id = ? AND user_id = ?').get(src.chat_id, req.userId);
  if (!isSrcMember) return res.status(403).json({ error: 'Not a member of the source chat' });

  const targets = [...new Set(chatIds.map((x) => String(x)))];
  let forwarded = 0;
  targets.forEach((chatId) => {
    const chat = db.prepare('SELECT * FROM chats WHERE id = ?').get(chatId);
    if (!chat) return;
    if (chat.type === 'direct') {
      const otherId = memberIds(chatId).find((x) => x !== req.userId);
      if (otherId && blockedEitherWay(req.userId, otherId)) return;
    }
    const isMember = db.prepare('SELECT 1 FROM chat_members WHERE chat_id = ? AND user_id = ?').get(chatId, req.userId);
    if (!isMember) return;

    const msg = {
      id: nano(),
      chat_id: chatId,
      sender_id: req.userId,
      type: src.type,
      body: src.body,
      media_url: src.media_url,
      duration: src.duration,
      reply_to: null,
      forwarded_from: src.id,
      expires_at: chat.disappear_seconds ? now() + chat.disappear_seconds * 1000 : null,
      created_at: now(),
    };
    persistMessage(msg, chatId);
    const row = db.prepare('SELECT * FROM messages WHERE id = ?').get(msg.id);
    emitToChat(chatId, 'message:new', (viewer) => ({ message: hydrateMessage(row, viewer) }));
    emitToChat(chatId, 'chat:updated', (viewer) => chatSummary(chatId, viewer));
    push.notifyMessage({ chatId, chat, message: row, senderId: req.userId });
    forwarded += 1;
  });

  res.json({ ok: true, forwarded });
});

/* ------------------------------------------------------------------ */
/* messages                                                            */
/* ------------------------------------------------------------------ */

/** Shared paginated page of `chatId` for `viewerId` (membership + message
 *  request rules enforced). Used by BOTH the normal chat endpoint and the
 *  GC chat endpoint so direct and GC pages behave identically. */
function chatMessagesPage(chatId, viewerId, query = {}) {
  const membership = db.prepare('SELECT cleared_at FROM chat_members WHERE chat_id = ? AND user_id = ?').get(chatId, viewerId);
  if (!membership) return { error: 'Not a member of this chat', status: 403 };
  const request = pendingChatRequest(chatId);
  if (request && request.receiver_id === viewerId) {
    return { error: 'Accept this message request before opening the chat', status: 403 };
  }

  const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 200);
  const clearedAt = membership.cleared_at || 0;
  const after = query.after != null && query.after !== '' ? Number(query.after) : null;
  const afterId = String(query.afterId || '');
  const before = query.before != null && query.before !== '' ? Number(query.before) : null;
  const beforeId = String(query.beforeId || '');
  // Hide messages this user removed via "Delete for me" (row stays for everyone else).
  const [notHiddenSql, notHiddenParam] = notHiddenFor(viewerId, 'messages');

  let rows;
  let hasMore = false;
  if (after != null && Number.isFinite(after)) {
    rows = db.prepare(
      `SELECT * FROM messages
       WHERE chat_id = ? AND created_at > ?
         AND (created_at > ? OR (created_at = ? AND id > ?))
         AND ${notHiddenSql}
       ORDER BY created_at ASC, id ASC
       LIMIT ?`
    ).all(chatId, clearedAt, after, after, afterId, notHiddenParam, limit + 1);
    hasMore = rows.length > limit;
    if (hasMore) rows = rows.slice(0, limit);
  } else if (before != null && Number.isFinite(before)) {
    rows = db.prepare(
      `SELECT * FROM messages
       WHERE chat_id = ? AND created_at > ?
         AND (created_at < ? OR (created_at = ? AND id < ?))
         AND ${notHiddenSql}
       ORDER BY created_at DESC, id DESC
       LIMIT ?`
    ).all(chatId, clearedAt, before, before, beforeId, notHiddenParam, limit + 1);
    hasMore = rows.length > limit;
    if (hasMore) rows = rows.slice(0, limit);
    rows.reverse();
  } else {
    rows = db.prepare(
      `SELECT * FROM messages WHERE chat_id = ? AND created_at > ?
         AND ${notHiddenSql}
       ORDER BY created_at DESC, id DESC LIMIT ?`
    ).all(chatId, clearedAt, notHiddenParam, limit + 1);
    hasMore = rows.length > limit;
    if (hasMore) rows = rows.slice(0, limit);
    rows.reverse();
  }

  const newest = rows[rows.length - 1];
  const oldest = rows[0];
  return {
    messages: rows.map((m) => hydrateMessage(m, viewerId)).filter(Boolean),
    hasMore,
    cursor: {
      after: newest ? newest.created_at : after,
      afterId: newest ? newest.id : afterId || null,
      before: oldest ? oldest.created_at : before,
      beforeId: oldest ? oldest.id : beforeId || null,
    },
  };
}

app.get('/api/chats/:id/messages', requireAuth, (req, res) => {
  const page = chatMessagesPage(req.params.id, req.userId, req.query);
  if (page.error) return res.status(page.status).json({ error: page.error });
  res.json(page);
});

app.post('/api/chats/:id/messages', requireAuth, (req, res) => {
  try {
    const outcome = deliverUserMessage(req.userId, { ...(req.body || {}), chatId: req.params.id });
    if (outcome.error) return res.status(outcome.status || 400).json({ error: outcome.error });
    fanoutNewMessage(outcome, req.userId, req.body?.tempId || req.body?.clientId || null);
    res.json({
      message: hydrateMessage(outcome.row, req.userId),
      duplicate: !!outcome.duplicate,
    });
  } catch (error) {
    console.error('[messages send]', error);
    res.status(500).json({ error: 'Could not send message' });
  }
});

app.get('/api/sync/messages', requireAuth, (req, res) => {
  const after = Number(req.query.after) || 0;
  const limit = Math.min(Math.max(Number(req.query.limit) || 200, 1), 500);
  const [notHiddenSql, notHiddenParam] = notHiddenFor(req.userId, 'm');
  const rows = db.prepare(
    `SELECT m.* FROM messages m
     JOIN chat_members cm ON cm.chat_id = m.chat_id AND cm.user_id = ?
     JOIN chats sync_chat ON sync_chat.id = m.chat_id
     LEFT JOIN chat_requests cr ON cr.chat_id = m.chat_id
     WHERE ${notHiddenSql}
       AND COALESCE(m.updated_at, m.created_at) > ?
       AND m.created_at > COALESCE(cm.cleared_at, 0)
       /* GCs have their own environment/endpoints/events — they never ride
          the direct-chat catch-up sync. */
       AND sync_chat.type != 'gc'
       AND (cr.chat_id IS NULL OR cr.status != 'pending' OR cr.receiver_id != ?)
     ORDER BY COALESCE(m.updated_at, m.created_at) ASC, m.id ASC
     LIMIT ?`
  ).all(req.userId, notHiddenParam, after, req.userId, limit + 1);
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const cursor = page.length
    ? page.reduce((max, row) => Math.max(max, row.updated_at || row.created_at || 0), after)
    : after;
  res.json({
    messages: page.map((m) => hydrateMessage(m, req.userId)).filter(Boolean),
    cursor,
    hasMore,
  });
});

app.get('/api/search', requireAuth, (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) return res.json({ messages: [] });
  const chatId = String(req.query.chatId || '');
  let clearedAt = 0;
  // In-chat search: restrict to one chat (and verify membership).
  if (chatId) {
    const membership = db.prepare('SELECT cleared_at FROM chat_members WHERE chat_id = ? AND user_id = ?').get(chatId, req.userId);
    if (!membership) return res.status(403).json({ error: 'Not a member of this chat' });
    clearedAt = membership.cleared_at || 0;
    const request = pendingChatRequest(chatId);
    if (request && request.receiver_id === req.userId) {
      return res.status(403).json({ error: 'Accept this message request before searching it' });
    }
  }
  const [notHiddenSql, notHiddenParam] = notHiddenFor(req.userId, 'm');
  const sql = chatId
    ? `SELECT m.* FROM messages m
       WHERE m.chat_id = ? AND m.created_at > ? AND m.deleted = 0 AND m.body LIKE ?
         AND ${notHiddenSql}
       ORDER BY m.created_at DESC LIMIT 100`
    : `SELECT m.* FROM messages m
       JOIN chat_members cm ON cm.chat_id = m.chat_id AND cm.user_id = ?
       JOIN chats search_chat ON search_chat.id = m.chat_id
       LEFT JOIN chat_requests cr ON cr.chat_id = m.chat_id
       WHERE m.deleted = 0 AND m.body LIKE ?
         AND m.created_at > COALESCE(cm.cleared_at, 0)
         AND ${notHiddenSql}
         /* GC messages are searched inside GC chat only. */
         AND search_chat.type != 'gc'
         AND (cr.chat_id IS NULL OR cr.status != 'pending' OR cr.receiver_id != ?)
       ORDER BY m.created_at DESC LIMIT 50`;
  const rows = chatId
    ? db.prepare(sql).all(chatId, clearedAt, `%${q}%`, notHiddenParam)
    : db.prepare(sql).all(req.userId, `%${q}%`, notHiddenParam, req.userId);
  res.json({
    messages: rows.map((m) => ({
      ...hydrateMessage(m, req.userId),
      chatName: chatSummary(m.chat_id, req.userId)?.name,
    })).filter((m) => m.id),
  });
});

/* ------------------------------------------------------------------ */
/* calls — history + REST helpers (live signaling is over Socket.IO)   */
/* ------------------------------------------------------------------ */

app.get('/api/calls', requireAuth, (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 100);
  const rows = db
    .prepare(
      `SELECT * FROM calls WHERE caller_id = ? OR callee_id = ?
       ORDER BY started_at DESC LIMIT ?`
    )
    .all(req.userId, req.userId, limit);
  res.json({ calls: rows.map((r) => hydrateCall(r, req.userId)) });
});

app.delete('/api/calls/:id', requireAuth, (req, res) => {
  const row = db.prepare('SELECT * FROM calls WHERE id = ?').get(req.params.id);
  if (!row || (row.caller_id !== req.userId && row.callee_id !== req.userId)) {
    return res.status(404).json({ error: 'Call not found' });
  }
  db.prepare('DELETE FROM calls WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

function insertSystemMessage(chatId, body) {
  const msg = { id: nano(), chat_id: chatId, sender_id: 'system', type: 'system', body, media_url: null, duration: 0, reply_to: null, created_at: now() };
  db.prepare(
    `INSERT INTO messages (id, chat_id, sender_id, type, body, media_url, duration, reply_to, created_at)
     VALUES (@id, @chat_id, @sender_id, @type, @body, @media_url, @duration, @reply_to, @created_at)`
  ).run(msg);
  db.prepare('UPDATE chats SET updated_at = ? WHERE id = ?').run(msg.created_at, chatId);
  return msg;
}

/**
 * Persist a real (non-system) message with all feature columns, bump the
 * chat's recency timestamp, and hand online members an instant delivered
 * receipt. `msg` may carry expires_at / forwarded_from / poll_id / edited.
 */
function persistMessage(msg, chatId) {
  return persistMessageTx(msg, chatId);
}

const persistMessageTx = db.transaction((msg, chatId) => {
  const payload = {
    ...msg,
    expires_at: msg.expires_at ?? null,
    edited: msg.edited ?? 0,
    forwarded_from: msg.forwarded_from ?? null,
    poll_id: msg.poll_id ?? null,
    status_id: msg.status_id ?? null,
    status_snapshot: msg.status_snapshot ?? null,
    media_thumb_url: msg.media_thumb_url ?? null,
    client_id: msg.client_id ?? msg.id,
    client_created_at: msg.client_created_at ?? msg.created_at,
    updated_at: msg.updated_at ?? msg.created_at,
  };

  if (payload.client_id) {
    const existing = db.prepare('SELECT * FROM messages WHERE client_id = ?').get(payload.client_id);
    if (existing) return { duplicate: true, row: existing };
  }
  const existingId = db.prepare('SELECT * FROM messages WHERE id = ?').get(payload.id);
  if (existingId) return { duplicate: true, row: existingId };

  try {
    db.prepare(
      `INSERT INTO messages (id, chat_id, sender_id, type, body, media_url, media_thumb_url, duration, reply_to, expires_at, edited, forwarded_from, poll_id, status_id, status_snapshot, client_id, client_created_at, updated_at, created_at)
       VALUES (@id, @chat_id, @sender_id, @type, @body, @media_url, @media_thumb_url, @duration, @reply_to, @expires_at, @edited, @forwarded_from, @poll_id, @status_id, @status_snapshot, @client_id, @client_created_at, @updated_at, @created_at)`
    ).run(payload);
  } catch (error) {
    if (String(error.message || '').includes('UNIQUE')) {
      const existing = db.prepare('SELECT * FROM messages WHERE id = ? OR client_id = ?').get(payload.id, payload.client_id);
      if (existing) return { duplicate: true, row: existing };
    }
    throw error;
  }

  db.prepare('UPDATE chats SET updated_at = ? WHERE id = ?').run(payload.created_at, chatId);
  memberIds(chatId).filter((x) => x !== payload.sender_id && sockets.has(x)).forEach((x) => {
    db.prepare('INSERT OR IGNORE INTO receipts (message_id, user_id, state, at) VALUES (?,?,?,?)').run(payload.id, x, 'delivered', now());
  });
  return { duplicate: false, row: db.prepare('SELECT * FROM messages WHERE id = ?').get(payload.id) };
});

const CLIENT_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function normalizeClientId(raw) {
  const value = String(raw || '').trim();
  return CLIENT_ID_RE.test(value) ? value.toLowerCase() : null;
}

function touchMessage(id) {
  db.prepare('UPDATE messages SET updated_at = ? WHERE id = ?').run(now(), id);
}

/** Shared send path for Socket.IO and REST. Idempotent on clientId. */
function deliverUserMessage(uid, data) {
  // Enforcement gate (banned/suspended/restricted) — checked on EVERY write
  // path, not just login, so an existing socket or HTTP session cannot post
  // after a moderation action takes effect.
  const gate = moderation.moderationGate(uid);
  if (gate.blocked) return { error: gate.error, status: 403 };

  const {
    chatId, type = 'text', body = '', mediaUrl = null, mediaThumbUrl = null,
    duration = 0, replyTo = null, tempId, pollId = null, disappearAt = null,
    clientId = null, clientCreatedAt = null,
  } = data || {};
  if (!chatId) return { error: 'Missing chat', status: 400 };

  const isMember = db.prepare('SELECT 1 FROM chat_members WHERE chat_id = ? AND user_id = ?').get(chatId, uid);
  if (!isMember) return { error: 'Not a member', status: 403 };

  const chat = db.prepare('SELECT * FROM chats WHERE id = ?').get(chatId);
  if (!chat) return { error: 'Chat not found', status: 404 };
  if (chat.type === 'direct') {
    const otherId = memberIds(chatId).find((x) => x !== uid);
    if (otherId && blockedEitherWay(uid, otherId)) return { error: "You can't message this person", status: 403 };
  }

  let request = pendingChatRequest(chatId);
  if (request && request.receiver_id === uid) {
    return { error: 'Accept this message request before replying', status: 403 };
  }
  if (!request && chat.type === 'direct') {
    const otherId = memberIds(chatId).find((x) => x !== uid);
    if (otherId && !areContacts(uid, otherId)) {
      const tReq = now();
      db.prepare(
        `INSERT INTO chat_requests (chat_id, sender_id, receiver_id, status, created_at)
         VALUES (?,?,?,?,?)`
      ).run(chatId, uid, otherId, 'pending', tReq);
      request = pendingChatRequest(chatId);
    }
  }

  let expiresAt = null;
  if (disappearAt && Number(disappearAt) > now()) expiresAt = Number(disappearAt);
  else if (chat.disappear_seconds) expiresAt = now() + chat.disappear_seconds * 1000;

  let replyToId = replyTo || null;
  if (replyToId) {
    const quoted = db.prepare('SELECT id FROM messages WHERE id = ? AND chat_id = ?').get(replyToId, chatId);
    if (!quoted) replyToId = null;
  }

  const created = now();
  const normalizedId = normalizeClientId(clientId) || normalizeClientId(tempId);
  const id = normalizedId || nano();
  let clientCreated = Number(clientCreatedAt);
  if (!Number.isFinite(clientCreated) || clientCreated <= 0 || clientCreated > created + 120000) {
    clientCreated = created;
  }

  const msg = {
    id,
    chat_id: chatId,
    sender_id: uid,
    type,
    body: String(body || '').slice(0, 5000),
    media_url: mediaUrl || null,
    media_thumb_url: mediaThumbUrl || null,
    duration: Number(duration) || 0,
    reply_to: replyToId,
    expires_at: expiresAt,
    edited: 0,
    forwarded_from: null,
    poll_id: pollId || null,
    client_id: normalizedId || id,
    client_created_at: clientCreated,
    updated_at: created,
    created_at: created,
  };

  const persisted = persistMessage(msg, chatId);
  return { ...persisted, chatId, request, chat };
}

function fanoutNewMessage(outcome, uid, tempId) {
  const { row, duplicate, chatId, request, chat } = outcome;
  if (duplicate || !row) return;

  if (chat?.type === 'gc') {
    // Dedicated GC realtime path: gc:message + gc:updated touch ONLY the
    // GC environment. The legacy message:new/chat:updated are still emitted
    // below for older clients, but every client routes type='gc' payloads
    // into the GC store — never the direct chat store.
    memberIds(chatId).forEach((memberId) => {
      const hydrated = hydrateMessage(row, memberId);
      if (!hydrated) return;
      emitToUser(memberId, 'gc:message', {
        message: hydrated,
        tempId: memberId === uid ? tempId : undefined,
      });
      emitToUser(memberId, 'gc:updated', { chat: chatSummary(chatId, memberId) });
    });
  }

  emitToChat(chatId, 'message:new', (viewer) => {
    const hydrated = hydrateMessage(row, viewer);
    if (!hydrated) return null;
    return { message: hydrated, tempId: viewer === uid ? tempId : undefined };
  });
  if (request) {
    emitToUser(request.sender_id, 'chat:updated', chatSummary(chatId, request.sender_id));
    emitToUser(request.receiver_id, 'chat:request', hydrateChatRequest(request, request.receiver_id));
    push.notifyChatRequest({ request, senderId: uid, chatId, message: row });
  } else {
    emitToChat(chatId, 'chat:updated', (viewer) => chatSummary(chatId, viewer));
    push.notifyMessage({ chatId, chat, message: row, senderId: uid });
  }

  // Safety analysis runs AFTER delivery — messaging is never blocked or
  // delayed by moderation. Text messages only, with a little recent
  // context for the spam/repetition detector.
  if (row.type === 'text' && row.body) {
    setImmediate(() => {
      try {
        const recent = db
          .prepare('SELECT sender_id, body FROM messages WHERE chat_id = ? AND type != ? ORDER BY created_at DESC LIMIT 8')
          .all(chatId, 'system')
          .reverse();
        moderation.recordAutoDetection(
          { userId: uid, chatId, messageId: row.id, text: row.body, recentMessages: recent },
          moderationIO
        );
      } catch {}
    });
  }
}

/** Hard-delete a message row plus its sidecar rows (reactions/receipts/stars/poll). */
function hardDeleteMessage(messageId) {
  const m = db.prepare('SELECT * FROM messages WHERE id = ?').get(messageId);
  if (m && m.type === 'poll' && m.poll_id) db.prepare('DELETE FROM polls WHERE id = ?').run(m.poll_id); // cascades poll_votes
  db.prepare('DELETE FROM reactions WHERE message_id = ?').run(messageId);
  db.prepare('DELETE FROM receipts WHERE message_id = ?').run(messageId);
  db.prepare('DELETE FROM starred_messages WHERE message_id = ?').run(messageId);
  db.prepare('DELETE FROM messages WHERE id = ?').run(messageId);
}

/* ------------------------------------------------------------------ */
/* status / stories                                                    */
/* ------------------------------------------------------------------ */

/** Can `viewerId` see a status posted by `authorId` with the given audience? */
function canViewStatus(statusId, authorId, audience, viewerId) {
  if (authorId === viewerId) return true;
  if (blockedEitherWay(authorId, viewerId)) return false;
  if (audience === 'public') return true;
  if (audience === 'contacts') return contactIds(authorId).includes(viewerId);
  if (audience === 'contacts_except') {
    if (!contactIds(authorId).includes(viewerId)) return false;
    return !db.prepare('SELECT 1 FROM status_recipients WHERE status_id = ? AND user_id = ?').get(statusId, viewerId);
  }
  if (audience === 'selected') {
    return !!db.prepare('SELECT 1 FROM status_recipients WHERE status_id = ? AND user_id = ?').get(statusId, viewerId);
  }
  return false;
}

/** Can `viewerId` see a Network post authored by `authorId` with the given audience? */
function canViewPost(postId, authorId, audience, viewerId) {
  if (authorId === viewerId) return true;
  if (blockedEitherWay(authorId, viewerId)) return false;
  if (audience === 'public') return true;
  if (audience === 'places') return usersSharingPlaces(authorId).includes(viewerId);
  if (audience === 'contacts') return contactIds(authorId).includes(viewerId);
  if (audience === 'selected') {
    return !!db.prepare('SELECT 1 FROM post_recipients WHERE post_id = ? AND user_id = ?').get(postId, viewerId);
  }
  return false;
}

/** Every userId allowed to see a post with the given audience (for realtime fan-out), minus anyone blocked either way. */
function postAudienceIds(postId, authorId, audience) {
  let ids;
  if (audience === 'public') ids = [...sockets.keys()];
  else if (audience === 'places') ids = [authorId, ...usersSharingPlaces(authorId)];
  else if (audience === 'contacts') ids = [...new Set([authorId, ...contactIds(authorId)])];
  else if (audience === 'selected') {
    const rows = db.prepare('SELECT user_id FROM post_recipients WHERE post_id = ?').all(postId);
    ids = [...new Set([authorId, ...rows.map((r) => r.user_id)])];
  } else ids = [authorId];
  return ids.filter((id) => id === authorId || !blockedEitherWay(authorId, id));
}

function hydrateStatus(s, viewerId) {
  return {
    id: s.id, type: s.type, body: s.body, mediaUrl: s.media_url, mediaAspect: s.media_aspect || null, bg: s.bg,
    song: s.song ? JSON.parse(s.song) : null,
    audience: s.audience || 'public',
    createdAt: s.created_at,
    viewed: !!db.prepare('SELECT 1 FROM status_views WHERE status_id = ? AND user_id = ?').get(s.id, viewerId),
  };
}

app.get('/api/status', requireAuth, (req, res) => {
  db.prepare('DELETE FROM statuses WHERE expires_at < ?').run(now());
  const rows = db.prepare('SELECT * FROM statuses ORDER BY created_at ASC').all();
  const visible = rows.filter((s) => canViewStatus(s.id, s.user_id, s.audience || 'public', req.userId));

  const byUser = {};
  visible.forEach((s) => {
    (byUser[s.user_id] ||= []).push(hydrateStatus(s, req.userId));
  });
  const groups = Object.entries(byUser).map(([userId, items]) => ({
    user: publicUser(getUser(userId)),
    items,
    allViewed: items.every((i) => i.viewed),
    latestAt: Math.max(...items.map((i) => i.createdAt)),
  })).filter(g => g.user);
  res.json({
    mine: groups.find((g) => g.user.id === req.userId) || null,
    others: groups.filter((g) => g.user.id !== req.userId).sort((a, b) => b.latestAt - a.latestAt),
  });
});

app.post('/api/status', requireAuth, (req, res) => {
  const {
    type = 'text', body = '', mediaUrl = null, mediaAspect = null, bg = '#075E54',
    song = null, audience = 'public', recipientIds = [],
  } = req.body || {};
  const statusGate = moderation.moderationGate(req.userId);
  if (statusGate.blocked) return res.status(403).json({ error: statusGate.error });

  const allowedAudiences = ['public', 'contacts', 'contacts_except', 'selected'];
  if (!allowedAudiences.includes(audience)) {
    return res.status(400).json({ error: 'Invalid status privacy option.' });
  }
  const aud = audience;
  const statusContacts = new Set(contactIds(req.userId));
  const recipients = [...new Set(
    (Array.isArray(recipientIds) ? recipientIds : [])
      .map((id) => String(id))
      .filter((id) => id !== req.userId && getUser(id) && statusContacts.has(id))
  )];
  if (aud === 'selected' && !recipients.length) {
    return res.status(400).json({ error: 'Pick at least one person for a private status.' });
  }

  const cleanBody = String(body || '').trim().slice(0, 700);
  const cleanMediaUrl = mediaUrl ? String(mediaUrl) : null;
  const cleanType = type === 'image' && cleanMediaUrl ? 'image' : 'text';
  if (!cleanBody && !cleanMediaUrl && !song) {
    return res.status(400).json({ error: 'Write something, or attach a photo or a song.' });
  }

  const s = {
    id: nano(), user_id: req.userId, type: cleanType, body: cleanBody, media_url: cleanMediaUrl,
    media_aspect: mediaAspect != null && Number.isFinite(Number(mediaAspect))
      ? Math.max(0.4, Math.min(2.5, Number(mediaAspect)))
      : null,
    bg: String(bg || '#075E54').slice(0, 32),
    song: song ? JSON.stringify(song) : null, audience: aud,
    created_at: now(), expires_at: now() + 24 * 3600 * 1000,
  };
  db.prepare(
    `INSERT INTO statuses (id, user_id, type, body, media_url, media_aspect, bg, song, audience, created_at, expires_at)
     VALUES (@id, @user_id, @type, @body, @media_url, @media_aspect, @bg, @song, @audience, @created_at, @expires_at)`
  ).run(s);

  if (aud === 'selected' || aud === 'contacts_except') {
    const stmt = db.prepare('INSERT OR IGNORE INTO status_recipients (status_id, user_id) VALUES (?, ?)');
    recipients.forEach((id) => stmt.run(s.id, id));
  }

  // Only notify sockets that are allowed to see it (and never someone
  // blocked either way, regardless of audience).
  const excluded = new Set(recipients);
  const targets = (aud === 'public'
    ? [...sockets.keys()]
    : aud === 'contacts' || aud === 'contacts_except'
      ? contactIds(req.userId).filter((id) => aud !== 'contacts_except' || !excluded.has(id))
      : recipients
  ).filter((id) => !blockedEitherWay(req.userId, id));
  targets.forEach((uid) => emitToUser(uid, 'status:new', { userId: req.userId }));
  emitToUser(req.userId, 'status:new', { userId: req.userId });

  res.json({ ok: true, status: hydrateStatus(s, req.userId) });
});

app.post('/api/status/:id/view', requireAuth, (req, res) => {
  const s = db.prepare('SELECT * FROM statuses WHERE id = ?').get(req.params.id);
  if (!s || !canViewStatus(s.id, s.user_id, s.audience || 'public', req.userId)) {
    return res.status(404).json({ error: 'Status not found' });
  }
  db.prepare('INSERT OR IGNORE INTO status_views (status_id, user_id, at) VALUES (?,?,?)').run(req.params.id, req.userId, now());
  res.json({ ok: true });
});

// ── gentle update (not a rebuild): status replies ──────────────────
// Anyone who can view a status can reply to it. The reply is delivered
// as a normal direct chat message with a frozen status preview, so the
// existing chat inbox, push/socket plumbing and disappearing-message
// machinery handle it without a new standalone inbox or a native rebuild.
app.post('/api/status/:id/reply', requireAuth, (req, res) => {
  const statusGate = moderation.moderationGate(req.userId);
  if (statusGate.blocked) return res.status(403).json({ error: statusGate.error });
  const statusId = String(req.params.id || '');
  const s = db.prepare('SELECT * FROM statuses WHERE id = ?').get(statusId);
  if (!s) return res.status(404).json({ error: 'Status not found' });
  if (s.user_id === req.userId) return res.status(400).json({ error: "You can't reply to your own status" });
  if (!canViewStatus(s.id, s.user_id, s.audience || 'public', req.userId)) {
    return res.status(404).json({ error: 'Status not found' });
  }
  if (blockedEitherWay(s.user_id, req.userId)) {
    return res.status(403).json({ error: "You can't reply to this status" });
  }
  const body = String(req.body?.body || req.body?.text || '').trim().slice(0, 700);
  if (!body) return res.status(400).json({ error: 'Write a reply first' });

  // Ensure there is a direct chat between the viewer and the author.
  // Reuse the existing one if it exists; otherwise create it on the fly.
  // Updating a pending request to 'accepted' guarantees the reply is
  // immediately visible in the main Chats list (mirrors WhatsApp status
  // reply behaviour) even if the two users have never chatted before.
  let chatId = db.prepare(
    `SELECT c.id FROM chats c
     JOIN chat_members a ON a.chat_id = c.id AND a.user_id = ?
     JOIN chat_members b ON b.chat_id = c.id AND b.user_id = ?
     WHERE c.type = 'direct'`
  ).get(req.userId, s.user_id)?.id;

  const t = now();
  let isNewChat = false;
  if (!chatId) {
    chatId = nano();
    db.prepare('INSERT INTO chats (id, type, created_by, created_at, updated_at) VALUES (?,?,?,?,?)')
      .run(chatId, 'direct', req.userId, t, t);
    const add = db.prepare('INSERT INTO chat_members (chat_id, user_id, role, joined_at) VALUES (?,?,?,?)');
    add.run(chatId, req.userId, 'member', t);
    add.run(chatId, s.user_id, 'member', t);
    isNewChat = true;
  } else {
    // If a pending request exists in either direction, accept it so the
    // reply lands in the main inbox, not the Requests panel.
    const pending = db.prepare("SELECT * FROM chat_requests WHERE chat_id = ? AND status = 'pending'").get(chatId);
    if (pending) {
      db.prepare("UPDATE chat_requests SET status = 'accepted', responded_at = ? WHERE chat_id = ?").run(t, chatId);
    }
    // Clear a stale cleared_at so the chat reappears if one side deleted it.
    db.prepare('UPDATE chat_members SET cleared_at = NULL WHERE chat_id = ? AND user_id IN (?,?)')
      .run(chatId, req.userId, s.user_id);
  }

  const author = getUser(s.user_id);
  const snapshot = {
    id: s.id,
    type: s.type,
    body: s.body,
    mediaUrl: s.media_url,
    mediaAspect: s.media_aspect || null,
    bg: s.bg,
    song: s.song ? JSON.parse(s.song) : null,
    audience: s.audience || 'public',
    createdAt: s.created_at,
    author: author ? { id: author.id, name: author.name, avatar: author.avatar, username: author.username } : null,
  };

  const chat = db.prepare('SELECT * FROM chats WHERE id = ?').get(chatId);
  const expiresAt = chat?.disappear_seconds ? t + chat.disappear_seconds * 1000 : null;

  const msg = {
    id: nano(),
    chat_id: chatId,
    sender_id: req.userId,
    type: 'text',
    body,
    media_url: null,
    duration: 0,
    reply_to: null,
    status_id: s.id,
    status_snapshot: JSON.stringify(snapshot),
    expires_at: expiresAt,
    edited: 0,
    forwarded_from: null,
    poll_id: null,
    created_at: t,
  };
  persistMessage(msg, chatId);
  const row = db.prepare('SELECT * FROM messages WHERE id = ?').get(msg.id);

  // Fan-out to both sides. Use per-viewer hydration so each side sees its
  // own read-receipt state, and include the frozen preview.
  memberIds(chatId).forEach((uid) => {
    const hydrated = hydrateMessage(row, uid);
    emitToUser(uid, 'message:new', { message: hydrated });
    emitToUser(uid, 'chat:updated', chatSummary(chatId, uid));
  });
  // A status reply is a real message to the author — it pushes like one.
  push.notifyMessage({ chatId, message: row, senderId: req.userId });
  if (isNewChat) {
    // Ensure the receiver that has never chatted before gets a chat:new too
    // (chat:updated already covers it, but belt-and-braces for older clients).
    emitToUser(s.user_id, 'chat:new', chatSummary(chatId, s.user_id));
  }
  emitToUser(s.user_id, 'status:reply', {
    statusId: s.id,
    chatId,
    messageId: msg.id,
    from: publicUser(getUser(req.userId)),
    preview: body.slice(0, 80),
  });

  res.json({ ok: true, chatId, message: hydrateMessage(row, req.userId) });
});

/** Song search for status composer — proxies Jamendo's public track search API. */
app.get('/api/songs/search', requireAuth, async (req, res) => {
  if (!jamendo.isConfigured()) return res.json({ tracks: [], configured: false });
  const q = String(req.query.q || '').trim();
  if (!q) return res.json({ tracks: [], configured: true });
  try {
    const tracks = await jamendo.searchTracks(q);
    res.json({ tracks, configured: true });
  } catch (e) {
    console.error('[jamendo]', e.message);
    // Surface a 200 with an explanatory message instead of a hard error —
    // song attachment is optional, the rest of the status composer must
    // keep working even if the song search API has a hiccup.
    res.json({ tracks: [], configured: true, error: e.message });
  }
});

// Backwards-compatible alias for the older Spotify-named route.
app.get('/api/spotify/search', requireAuth, (req, res) => {
  res.redirect(307, `/api/songs/search?q=${encodeURIComponent(req.query.q || '')}`);
});

/* ------------------------------------------------------------------ */
/* The Network — public worldwide posts                                */
/* ------------------------------------------------------------------ */

function hydratePost(row, viewerId) {
  if (!row) return null;
  const author = getUser(row.user_id);
  const likes = db.prepare('SELECT COUNT(*) c FROM post_likes WHERE post_id = ?').get(row.id).c;
  const comments = db.prepare('SELECT COUNT(*) c FROM post_comments WHERE post_id = ?').get(row.id).c;
  const liked = viewerId
    ? !!db.prepare('SELECT 1 FROM post_likes WHERE post_id = ? AND user_id = ?').get(row.id, viewerId)
    : false;
  return {
    id: row.id,
    userId: row.user_id,
    author: author ? { id: author.id, name: author.name, avatar: author.avatar, username: author.username } : { id: row.user_id, name: 'Unknown', avatar: null, username: null },
    title: row.title || '',
    body: row.body,
    mediaUrl: row.media_url,
    mediaAspect: row.media_aspect || null,
    song: row.song ? JSON.parse(row.song) : null,
    tag: row.tag,
    audience: row.audience || 'public',
    createdAt: row.created_at,
    likes,
    comments,
    liked,
    mine: row.user_id === viewerId,
    // Phase 2: does the viewer follow this author (for Following feed + the
    // Follow button state)? Author's own posts never show a follow button.
    following: viewerId && row.user_id !== viewerId ? isFollowing(viewerId, row.user_id) : undefined,
  };
}

function hydrateCall(row, viewerId) {
  if (!row) return null;
  const otherId = row.caller_id === viewerId ? row.callee_id : row.caller_id;
  const other = getUser(otherId);
  const duration = row.answered_at && row.ended_at ? Math.max(0, row.ended_at - row.answered_at) : 0;
  return {
    id: row.id,
    chatId: row.chat_id,
    type: row.type,
    status: row.status,
    direction: row.caller_id === viewerId ? 'outgoing' : 'incoming',
    with: other ? publicUser(other) : { id: otherId, name: 'Unknown', avatar: null, username: null },
    startedAt: row.started_at,
    answeredAt: row.answered_at,
    endedAt: row.ended_at,
    endedReason: row.ended_reason,
    durationMs: duration,
  };
}

/** GET /api/posts?before=<ts>&limit=20&tag=process&userId=…&filter=worldwide|places|following */
app.get('/api/posts', requireAuth, (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 20, 50);
  const { tag, userId } = req.query;
  let before = Number(req.query.before) || Date.now() + 1;

  // Phase 2 feed filters: worldwide (default) | places (people who share my
  // college/workplace) | following (people I follow). Own posts stay visible
  // in every filter.
  const filter = String(req.query.filter || 'worldwide');
  let authorFilter = null;
  if (filter === 'places') authorFilter = new Set([req.userId, ...usersSharingPlaces(req.userId)]);
  else if (filter === 'following') authorFilter = new Set([req.userId, ...followingIds(req.userId)]);

  let sql = 'SELECT * FROM posts WHERE deleted = 0 AND created_at < ?';
  const baseParams = [];
  if (tag) { sql += ' AND tag = ?'; baseParams.push(String(tag).replace(/^#/, '')); }
  if (userId) { sql += ' AND user_id = ?'; baseParams.push(userId); }
  sql += ' ORDER BY created_at DESC LIMIT ?';

  // Audience filtering happens in JS, so a raw page of `limit` rows can come
  // up short after filtering. Keep fetching further pages (moving the
  // cursor back) until we have enough visible posts or run out of rows.
  const batchSize = Math.max(limit * 2, 20);
  const visible = [];
  let exhausted = false;
  for (let i = 0; i < 5 && visible.length < limit; i++) {
    const rows = db.prepare(sql).all(before, ...baseParams, batchSize);
    if (!rows.length) { exhausted = true; break; }
    rows.forEach((r) => {
      if (visible.length >= limit) return;
      if (authorFilter && !authorFilter.has(r.user_id)) return;
      if (canViewPost(r.id, r.user_id, r.audience || 'public', req.userId)) {
        visible.push(r);
      }
    });
    before = rows[rows.length - 1].created_at;
    if (rows.length < batchSize) { exhausted = true; break; }
  }

  res.json({
    posts: visible.map((r) => hydratePost(r, req.userId)),
    // `before` has already been advanced past every row we've examined
    // (visible or filtered-out), so resuming from it never skips a post.
    nextBefore: !exhausted && visible.length === limit ? before : null,
  });
});

/** GET /api/posts/:id — one post, for deep links from Activity ("liked your
 *  post") and pushes. Audience rules apply exactly like the feed. */
app.get('/api/posts/:id', requireAuth, (req, res) => {
  const row = db.prepare('SELECT * FROM posts WHERE id = ? AND deleted = 0').get(req.params.id);
  if (!row || !canViewPost(row.id, row.user_id, row.audience || 'public', req.userId)) {
    return res.status(404).json({ error: 'Post not found' });
  }
  res.json({ post: hydratePost(row, req.userId) });
});

app.post('/api/posts', requireAuth, (req, res) => {
  const {
    body = '', title = '', mediaUrl = null, mediaAspect = null, tag = null,
    song = null, audience = 'public', recipientIds = [],
  } = req.body || {};
  const text = String(body).trim();
  if (!text && !mediaUrl && !song) return res.status(400).json({ error: 'Write something, or attach a photo or a song' });
  if (text.length > 2000) return res.status(400).json({ error: 'Post is too long (2000 characters max)' });

  const gate = moderation.moderationGate(req.userId);
  if (gate.blocked) return res.status(403).json({ error: gate.error });
  const aud = ['public', 'places', 'contacts', 'selected'].includes(audience) ? audience : 'public';
  if (aud === 'selected' && !recipientIds.length) {
    return res.status(400).json({ error: 'Pick at least one person for a targeted post.' });
  }
  if (aud === 'places' && !affiliationsForUser(req.userId).length) {
    return res.status(400).json({ error: 'Join a college or workplace first to post to your places.' });
  }

  const post = {
    id: nano(),
    user_id: req.userId,
    title: String(title).trim().slice(0, 120),
    body: text.slice(0, 2000),
    media_url: mediaUrl,
    media_aspect: Number.isFinite(Number(mediaAspect))
      ? Math.max(0.4, Math.min(2.5, Number(mediaAspect)))
      : null,
    song: song ? JSON.stringify(song) : null,
    tag: tag ? String(tag).replace(/^#/, '').toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 24) || null : null,
    audience: aud,
    created_at: now(),
  };
  db.prepare(
    `INSERT INTO posts (id, user_id, title, body, media_url, media_aspect, song, tag, audience, created_at)
     VALUES (@id, @user_id, @title, @body, @media_url, @media_aspect, @song, @tag, @audience, @created_at)`
  ).run(post);

  if (aud === 'selected') {
    const stmt = db.prepare('INSERT OR IGNORE INTO post_recipients (post_id, user_id) VALUES (?, ?)');
    recipientIds.filter((id) => getUser(id)).forEach((id) => stmt.run(post.id, id));
  }

  const row = db.prepare('SELECT * FROM posts WHERE id = ?').get(post.id);

  // Only notify sockets that are allowed to see it.
  const targets = aud === 'public'
    ? [...sockets.keys()]
    : aud === 'places'
      ? postAudienceIds(row.id, req.userId, 'places')
      : aud === 'contacts'
        ? contactIds(req.userId)
        : recipientIds;
  targets.forEach((uid) => emitToUser(uid, 'post:new', hydratePost(row, uid)));
  emitToUser(req.userId, 'post:new', hydratePost(row, req.userId));

  // Phase 2 pushes — campus loop + followers. Capped so a viral poster can't
  // stampede Expo; settings (notifications.network) + quiet hours are
  // enforced inside pushToUser as for every other push.
  const author = getUser(req.userId);
  if (aud === 'places') {
    push.notifyPlacePost({
      userIds: usersSharingPlaces(req.userId).slice(0, 100),
      actor: author,
      post: row,
      placeLabel: placeLabelFor(req.userId),
    });
  }
  if (author) {
    const followerTargets = db
      .prepare('SELECT follower_id id FROM follows WHERE followed_id = ?')
      .all(req.userId)
      .map((r) => r.id)
      .filter((id) => canViewPost(row.id, req.userId, aud, id))
      .slice(0, 100);
    push.notifyFollowerPost({ userIds: followerTargets, actor: author, post: row });
  }

  res.json({ post: hydratePost(row, req.userId) });
});

app.delete('/api/posts/:id', requireAuth, (req, res) => {
  const row = db.prepare('SELECT * FROM posts WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Post not found' });
  if (row.user_id !== req.userId) return res.status(403).json({ error: 'Not your post' });
  db.prepare('UPDATE posts SET deleted = 1 WHERE id = ?').run(req.params.id);
  postAudienceIds(row.id, row.user_id, row.audience || 'public').forEach((uid) => emitToUser(uid, 'post:deleted', { id: req.params.id }));
  res.json({ ok: true });
});

app.post('/api/posts/:id/like', requireAuth, (req, res) => {
  const row = db.prepare('SELECT * FROM posts WHERE id = ? AND deleted = 0').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Post not found' });
  if (!canViewPost(row.id, row.user_id, row.audience || 'public', req.userId)) {
    return res.status(403).json({ error: 'Not visible to you' });
  }

  const existing = db.prepare('SELECT 1 FROM post_likes WHERE post_id = ? AND user_id = ?').get(row.id, req.userId);
  if (existing) db.prepare('DELETE FROM post_likes WHERE post_id = ? AND user_id = ?').run(row.id, req.userId);
  else {
    db.prepare('INSERT INTO post_likes (post_id, user_id, at) VALUES (?,?,?)').run(row.id, req.userId, now());
    // Notify the author on the like itself (never the unlike).
    push.notifyPostLike({ ownerId: row.user_id, actor: getUser(req.userId), post: row });
  }

  const likes = db.prepare('SELECT COUNT(*) c FROM post_likes WHERE post_id = ?').get(row.id).c;
  postAudienceIds(row.id, row.user_id, row.audience || 'public').forEach((uid) => emitToUser(uid, 'post:likes', { id: row.id, likes }));
  res.json({ liked: !existing, likes });
});

app.get('/api/posts/:id/comments', requireAuth, (req, res) => {
  const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(req.params.id);
  if (!post || !canViewPost(post.id, post.user_id, post.audience || 'public', req.userId)) {
    return res.status(404).json({ error: 'Post not found' });
  }
  const rows = db
    .prepare('SELECT * FROM post_comments WHERE post_id = ? ORDER BY created_at ASC LIMIT 200')
    .all(req.params.id);
  res.json({
    comments: rows.map((c) => {
      const u = getUser(c.user_id);
      return {
        id: c.id,
        body: c.body,
        createdAt: c.created_at,
        userId: c.user_id,
        author: u ? { id: u.id, name: u.name, avatar: u.avatar, username: u.username } : { id: c.user_id, name: 'Unknown', avatar: null, username: null },
        mine: c.user_id === req.userId,
      };
    }),
  });
});

app.post('/api/posts/:id/comments', requireAuth, (req, res) => {
  const post = db.prepare('SELECT * FROM posts WHERE id = ? AND deleted = 0').get(req.params.id);
  if (!post || !canViewPost(post.id, post.user_id, post.audience || 'public', req.userId)) {
    return res.status(404).json({ error: 'Post not found' });
  }
  const text = String(req.body?.body || '').trim();
  if (!text) return res.status(400).json({ error: 'Comment cannot be empty' });
  const gate = moderation.moderationGate(req.userId);
  if (gate.blocked) return res.status(403).json({ error: gate.error });

  const c = { id: nano(), post_id: post.id, user_id: req.userId, body: text.slice(0, 600), created_at: now() };
  db.prepare('INSERT INTO post_comments (id, post_id, user_id, body, created_at) VALUES (@id,@post_id,@user_id,@body,@created_at)').run(c);
  if (post.user_id !== req.userId) {
    push.notifyPostComment({ ownerId: post.user_id, actor: getUser(req.userId), post, body: c.body });
  }

  const count = db.prepare('SELECT COUNT(*) c FROM post_comments WHERE post_id = ?').get(post.id).c;
  postAudienceIds(post.id, post.user_id, post.audience || 'public').forEach((uid) => emitToUser(uid, 'post:comments', { id: post.id, comments: count }));

  const u = getUser(req.userId);
  res.json({
    comment: {
      id: c.id, body: c.body, createdAt: c.created_at, userId: c.user_id,
      author: { id: u.id, name: u.name, avatar: u.avatar, username: u.username }, mine: true,
    },
  });
});

/** Trending tags, for the sidebar/chips. */
app.get('/api/posts-tags', requireAuth, (req, res) => {
  const rows = db
    .prepare(`SELECT tag, COUNT(*) c FROM posts WHERE deleted = 0 AND tag IS NOT NULL
              GROUP BY tag ORDER BY c DESC LIMIT 12`)
    .all();
  res.json({ tags: rows.map((r) => ({ tag: r.tag, count: r.c })) });
});

/* ------------------------------------------------------------------ */
/* communities — purpose-based groups on The Network                  */
/* (club nights, house parties, chai chats, trip planning, running…)  */
/* ------------------------------------------------------------------ */

const COMMUNITY_CATEGORIES = ['club', 'party', 'chai', 'trip', 'run', 'game', 'study', 'custom'];
const JOIN_POLICIES = ['open', 'request', 'invite'];

function communityMemberIds(communityId) {
  return db.prepare('SELECT user_id FROM community_members WHERE community_id = ?').all(communityId).map((r) => r.user_id);
}

function communityRole(communityId, userId) {
  const row = db.prepare('SELECT role FROM community_members WHERE community_id = ? AND user_id = ?').get(communityId, userId);
  return row ? row.role : null;
}

function hydrateCommunity(row, viewerId) {
  if (!row) return null;
  const members = db
    .prepare(
      `SELECT u.id, u.username, u.name, u.avatar, cm.role FROM community_members cm
       JOIN users u ON u.id = cm.user_id WHERE cm.community_id = ? ORDER BY cm.role = 'admin' DESC, cm.joined_at ASC`
    )
    .all(row.id);
  const me = members.find((m) => m.id === viewerId);
  const pendingRequest = !me
    ? !!db.prepare('SELECT 1 FROM community_requests WHERE community_id = ? AND user_id = ?').get(row.id, viewerId)
    : false;
  const requestCount =
    me && me.role === 'admin'
      ? db.prepare('SELECT COUNT(*) c FROM community_requests WHERE community_id = ?').get(row.id).c
      : 0;

  return {
    id: row.id,
    name: row.name,
    description: row.description || '',
    category: row.category,
    avatar: row.avatar,
    chatId: row.chat_id,
    createdBy: row.created_by,
    joinPolicy: row.join_policy,
    visibility: row.visibility,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    memberCount: members.length,
    members: members.map((m) => ({ id: m.id, username: m.username, name: m.name, avatar: m.avatar, role: m.role })),
    role: me ? me.role : null,
    isMember: !!me,
    pendingRequest,
    requestCount,
    // Invite links: only admins see the code (so members can't leak it by
    // just opening the detail screen).
    inviteCode: me && me.role === 'admin' ? row.invite_code || null : null,
  };
}

/** Everyone gets to see public communities in the discover list; unlisted ones only show to members. */
app.get('/api/communities', requireAuth, (req, res) => {
  const { category, mine } = req.query;
  let rows;
  if (mine === '1' || mine === 'true') {
    rows = db
      .prepare(
        `SELECT c.* FROM communities c
         JOIN community_members cm ON cm.community_id = c.id
         WHERE cm.user_id = ? ORDER BY c.updated_at DESC`
      )
      .all(req.userId);
  } else {
    rows = db
      .prepare(
        `SELECT * FROM communities WHERE visibility = 'public'
         ${category ? 'AND category = ?' : ''} ORDER BY updated_at DESC`
      )
      .all(...(category ? [category] : []));
  }
  res.json({ communities: rows.map((r) => hydrateCommunity(r, req.userId)) });
});

app.get('/api/communities/categories', requireAuth, (req, res) => {
  res.json({ categories: COMMUNITY_CATEGORIES });
});

app.get('/api/communities/:id', requireAuth, (req, res) => {
  const row = db.prepare('SELECT * FROM communities WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Community not found' });
  const isMember = !!communityRole(row.id, req.userId);
  if (row.visibility === 'unlisted' && !isMember) return res.status(404).json({ error: 'Community not found' });
  res.json({ community: hydrateCommunity(row, req.userId) });
});

app.post('/api/communities', requireAuth, (req, res) => {
  const { name, description = '', category = 'custom', avatar, joinPolicy = 'request', visibility = 'public' } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'Community name is required' });
  if (!COMMUNITY_CATEGORIES.includes(category)) return res.status(400).json({ error: 'Invalid category' });
  if (!JOIN_POLICIES.includes(joinPolicy)) return res.status(400).json({ error: 'Invalid join policy' });
  if (!['public', 'unlisted'].includes(visibility)) return res.status(400).json({ error: 'Invalid visibility' });

  const id = nano();
  const t = now();
  const trimmedName = String(name).trim();

  // A community always owns a backing group chat, so members can actually
  // talk — reuses all existing messaging/typing/receipts/reactions machinery
  // instead of duplicating it.
  const chatId = nano();
  db.prepare('INSERT INTO chats (id, type, name, avatar, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?)').run(
    chatId, 'group', trimmedName, avatar || null, req.userId, t, t
  );
  db.prepare('INSERT INTO chat_members (chat_id, user_id, role, joined_at) VALUES (?,?,?,?)').run(chatId, req.userId, 'admin', t);

  db.prepare(
    `INSERT INTO communities (id, name, description, category, avatar, chat_id, created_by, join_policy, visibility, invite_code, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
  ).run(id, trimmedName, String(description || '').trim(), category, avatar || null, chatId, req.userId, joinPolicy, visibility, communityInviteCode(), t, t);
  db.prepare('INSERT INTO community_members (community_id, user_id, role, joined_at) VALUES (?,?,?,?)').run(id, req.userId, 'admin', t);

  const creator = getUser(req.userId);
  insertSystemMessage(chatId, `${creator.name} started the community "${trimmedName}"`);

  const row = db.prepare('SELECT * FROM communities WHERE id = ?').get(id);
  res.json({ community: hydrateCommunity(row, req.userId) });
});

app.patch('/api/communities/:id', requireAuth, (req, res) => {
  const row = db.prepare('SELECT * FROM communities WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Community not found' });
  if (communityRole(row.id, req.userId) !== 'admin') return res.status(403).json({ error: 'Only admins can edit this community' });

  const { name, description, category, avatar, joinPolicy, visibility } = req.body || {};
  if (category !== undefined && !COMMUNITY_CATEGORIES.includes(category)) return res.status(400).json({ error: 'Invalid category' });
  if (joinPolicy !== undefined && !JOIN_POLICIES.includes(joinPolicy)) return res.status(400).json({ error: 'Invalid join policy' });
  if (visibility !== undefined && !['public', 'unlisted'].includes(visibility)) return res.status(400).json({ error: 'Invalid visibility' });

  db.prepare(
    `UPDATE communities SET
       name = COALESCE(?, name), description = COALESCE(?, description), category = COALESCE(?, category),
       avatar = COALESCE(?, avatar), join_policy = COALESCE(?, join_policy), visibility = COALESCE(?, visibility),
       updated_at = ? WHERE id = ?`
  ).run(
    name ? String(name).trim() : null, description != null ? String(description).trim() : null, category || null,
    avatar || null, joinPolicy || null, visibility || null, now(), row.id
  );

  const updated = db.prepare('SELECT * FROM communities WHERE id = ?').get(row.id);
  communityMemberIds(row.id).forEach((uid) => emitToUser(uid, 'community:updated', hydrateCommunity(updated, uid)));
  res.json({ community: hydrateCommunity(updated, req.userId) });
});

app.delete('/api/communities/:id', requireAuth, (req, res) => {
  const row = db.prepare('SELECT * FROM communities WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Community not found' });
  if (row.created_by !== req.userId) return res.status(403).json({ error: 'Only the creator can disband this community' });
  const members = communityMemberIds(row.id);
  db.prepare('DELETE FROM communities WHERE id = ?').run(row.id);
  if (row.chat_id) db.prepare('DELETE FROM chats WHERE id = ?').run(row.chat_id); // cascades chat_members/messages
  members.forEach((uid) => emitToUser(uid, 'community:deleted', { id: row.id }));
  res.json({ ok: true });
});

/** Join (or request to join) a community — behaviour depends on join_policy. */
/** Short, unambiguous invite code (8 chars, no 0/o/1/l). */
function communityInviteCode() {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  let code;
  do {
    code = Array.from({ length: 8 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');
  } while (db.prepare('SELECT 1 FROM communities WHERE invite_code = ?').get(code));
  return code;
}

/** Join a community via invite link (`https://…/c/<code>`). A valid code
 *  joins directly regardless of join_policy — the link IS the approval. */
app.post('/api/communities/join-by-code', requireAuth, (req, res) => {
  const code = String(req.body?.code || '').trim().toLowerCase();
  if (!code) return res.status(400).json({ error: 'Missing invite code' });
  const row = db.prepare('SELECT * FROM communities WHERE invite_code = ?').get(code);
  if (!row) return res.status(404).json({ error: 'This invite link is not valid' });
  if (blockedEitherWay(req.userId, row.created_by) && communityRole(row.id, req.userId) === null) {
    return res.status(403).json({ error: 'This invite is unavailable' });
  }

  if (communityRole(row.id, req.userId)) {
    return res.json({ community: hydrateCommunity(row, req.userId), alreadyMember: true });
  }

  const t = now();
  db.prepare('INSERT INTO community_members (community_id, user_id, role, joined_at) VALUES (?,?,?,?)').run(row.id, req.userId, 'member', t);
  if (row.chat_id) {
    db.prepare('INSERT OR IGNORE INTO chat_members (chat_id, user_id, role, joined_at) VALUES (?,?,?,?)').run(row.chat_id, req.userId, 'member', t);
    const joiner = getUser(req.userId);
    insertSystemMessage(row.chat_id, `${joiner.name} joined via invite link`);
    memberIds(row.chat_id).forEach((uid) => emitToUser(uid, 'chat:new', chatSummary(row.chat_id, uid)));
  }
  db.prepare('UPDATE communities SET updated_at = ? WHERE id = ?').run(t, row.id);
  db.prepare('DELETE FROM community_requests WHERE community_id = ? AND user_id = ?').run(row.id, req.userId);
  const updated = db.prepare('SELECT * FROM communities WHERE id = ?').get(row.id);
  communityMemberIds(row.id).forEach((uid) => emitToUser(uid, 'community:updated', hydrateCommunity(updated, uid)));
  res.json({ community: hydrateCommunity(updated, req.userId), alreadyMember: false });
});

/** Admin: rotate the invite code (revokes the old link). */
app.post('/api/communities/:id/invite/rotate', requireAuth, (req, res) => {
  const row = db.prepare('SELECT * FROM communities WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Community not found' });
  if (communityRole(row.id, req.userId) !== 'admin') return res.status(403).json({ error: 'Admins only' });
  const code = communityInviteCode();
  db.prepare('UPDATE communities SET invite_code = ?, updated_at = ? WHERE id = ?').run(code, now(), row.id);
  res.json({ inviteCode: code });
});

app.post('/api/communities/:id/join', requireAuth, (req, res) => {
  const row = db.prepare('SELECT * FROM communities WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Community not found' });
  if (communityRole(row.id, req.userId)) return res.status(400).json({ error: 'Already a member' });

  const t = now();

  if (row.join_policy === 'invite') {
    return res.status(403).json({ error: 'This community is invite-only — ask an admin to add you' });
  }

  if (row.join_policy === 'request') {
    db.prepare('INSERT OR IGNORE INTO community_requests (community_id, user_id, requested_at) VALUES (?,?,?)').run(row.id, req.userId, t);
    const requester = getUser(req.userId);
    const admins = db.prepare('SELECT user_id FROM community_members WHERE community_id = ? AND role = ?').all(row.id, 'admin');
    admins.forEach((a) => emitToUser(a.user_id, 'community:request', { communityId: row.id, user: publicUser(requester) }));
    push.notifyCommunityRequest({ adminIds: admins.map((a) => a.user_id), requester, community: row });
    return res.json({ status: 'requested' });
  }

  // open — join immediately, and join the backing chat too
  db.prepare('INSERT INTO community_members (community_id, user_id, role, joined_at) VALUES (?,?,?,?)').run(row.id, req.userId, 'member', t);
  if (row.chat_id) {
    db.prepare('INSERT OR IGNORE INTO chat_members (chat_id, user_id, role, joined_at) VALUES (?,?,?,?)').run(row.chat_id, req.userId, 'member', t);
    const joiner = getUser(req.userId);
    insertSystemMessage(row.chat_id, `${joiner.name} joined the community`);
    memberIds(row.chat_id).forEach((uid) => emitToUser(uid, 'chat:new', chatSummary(row.chat_id, uid)));
  }
  db.prepare('UPDATE communities SET updated_at = ? WHERE id = ?').run(t, row.id);
  const updated = db.prepare('SELECT * FROM communities WHERE id = ?').get(row.id);
  communityMemberIds(row.id).forEach((uid) => emitToUser(uid, 'community:updated', hydrateCommunity(updated, uid)));
  res.json({ status: 'joined', community: hydrateCommunity(updated, req.userId) });
});

/** Leave a community you're a member of (admins must transfer/disband instead of leaving into zero-admin state). */
app.post('/api/communities/:id/leave', requireAuth, (req, res) => {
  const row = db.prepare('SELECT * FROM communities WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Community not found' });
  const role = communityRole(row.id, req.userId);
  if (!role) return res.status(400).json({ error: 'Not a member' });

  const admins = db.prepare(`SELECT COUNT(*) c FROM community_members WHERE community_id = ? AND role = 'admin'`).get(row.id).c;
  if (role === 'admin' && admins <= 1) {
    return res.status(400).json({ error: 'You are the only admin — promote someone else first or disband the community' });
  }

  db.prepare('DELETE FROM community_members WHERE community_id = ? AND user_id = ?').run(row.id, req.userId);
  if (row.chat_id) {
    db.prepare('DELETE FROM chat_members WHERE chat_id = ? AND user_id = ?').run(row.chat_id, req.userId);
    const leaver = getUser(req.userId);
    insertSystemMessage(row.chat_id, `${leaver.name} left the community`);
  }
  emitToUser(req.userId, 'community:left', { id: row.id });
  const updated = db.prepare('SELECT * FROM communities WHERE id = ?').get(row.id);
  communityMemberIds(row.id).forEach((uid) => emitToUser(uid, 'community:updated', hydrateCommunity(updated, uid)));
  res.json({ ok: true });
});

/** Admin-only: list pending join requests. */
app.get('/api/communities/:id/requests', requireAuth, (req, res) => {
  const row = db.prepare('SELECT * FROM communities WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Community not found' });
  if (communityRole(row.id, req.userId) !== 'admin') return res.status(403).json({ error: 'Admins only' });
  const rows = db
    .prepare(
      `SELECT u.id, u.username, u.name, u.avatar, r.requested_at FROM community_requests r
       JOIN users u ON u.id = r.user_id WHERE r.community_id = ? ORDER BY r.requested_at ASC`
    )
    .all(row.id);
  res.json({ requests: rows.map((r) => ({ user: { id: r.id, username: r.username, name: r.name, avatar: r.avatar }, requestedAt: r.requested_at })) });
});

/** Admin-only: approve or decline a join request. */
app.post('/api/communities/:id/requests/:userId', requireAuth, (req, res) => {
  const row = db.prepare('SELECT * FROM communities WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Community not found' });
  if (communityRole(row.id, req.userId) !== 'admin') return res.status(403).json({ error: 'Admins only' });

  const { action } = req.body || {}; // 'approve' | 'decline'
  const targetId = req.params.userId;
  const hasRequest = db.prepare('SELECT 1 FROM community_requests WHERE community_id = ? AND user_id = ?').get(row.id, targetId);
  if (!hasRequest) return res.status(404).json({ error: 'No pending request from this user' });

  db.prepare('DELETE FROM community_requests WHERE community_id = ? AND user_id = ?').run(row.id, targetId);

  if (action === 'approve') {
    const t = now();
    db.prepare('INSERT OR IGNORE INTO community_members (community_id, user_id, role, joined_at) VALUES (?,?,?,?)').run(row.id, targetId, 'member', t);
    if (row.chat_id) {
      db.prepare('INSERT OR IGNORE INTO chat_members (chat_id, user_id, role, joined_at) VALUES (?,?,?,?)').run(row.chat_id, targetId, 'member', t);
      const joiner = getUser(targetId);
      insertSystemMessage(row.chat_id, `${joiner.name} joined the community`);
      memberIds(row.chat_id).forEach((uid) => emitToUser(uid, 'chat:new', chatSummary(row.chat_id, uid)));
    }
    db.prepare('UPDATE communities SET updated_at = ? WHERE id = ?').run(t, row.id);
    emitToUser(targetId, 'community:approved', { id: row.id });
    push.notifyCommunityApproved({ userId: targetId, community: row });
  } else {
    emitToUser(targetId, 'community:declined', { id: row.id });
  }

  const updated = db.prepare('SELECT * FROM communities WHERE id = ?').get(row.id);
  communityMemberIds(row.id).forEach((uid) => emitToUser(uid, 'community:updated', hydrateCommunity(updated, uid)));
  res.json({ ok: true });
});

/** Admin-only: directly add a member (invite-only communities, or shortcutting a request). */
app.post('/api/communities/:id/members', requireAuth, (req, res) => {
  const row = db.prepare('SELECT * FROM communities WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Community not found' });
  if (communityRole(row.id, req.userId) !== 'admin') return res.status(403).json({ error: 'Admins only' });
  const { userId: targetId } = req.body || {};
  if (!targetId || !getUser(targetId)) return res.status(400).json({ error: 'Unknown user' });
  if (communityRole(row.id, targetId)) return res.status(400).json({ error: 'Already a member' });

  const t = now();
  db.prepare('INSERT INTO community_members (community_id, user_id, role, joined_at) VALUES (?,?,?,?)').run(row.id, targetId, 'member', t);
  db.prepare('DELETE FROM community_requests WHERE community_id = ? AND user_id = ?').run(row.id, targetId);
  if (row.chat_id) {
    db.prepare('INSERT OR IGNORE INTO chat_members (chat_id, user_id, role, joined_at) VALUES (?,?,?,?)').run(row.chat_id, targetId, 'member', t);
    const added = getUser(targetId);
    insertSystemMessage(row.chat_id, `${added.name} was added to the community`);
    memberIds(row.chat_id).forEach((uid) => emitToUser(uid, 'chat:new', chatSummary(row.chat_id, uid)));
  }
  db.prepare('UPDATE communities SET updated_at = ? WHERE id = ?').run(t, row.id);
  emitToUser(targetId, 'community:added', { id: row.id });
  const updated = db.prepare('SELECT * FROM communities WHERE id = ?').get(row.id);
  communityMemberIds(row.id).forEach((uid) => emitToUser(uid, 'community:updated', hydrateCommunity(updated, uid)));
  res.json({ community: hydrateCommunity(updated, req.userId) });
});

/** Admin-only: remove a member, or promote/demote a member's role. */
app.patch('/api/communities/:id/members/:userId', requireAuth, (req, res) => {
  const row = db.prepare('SELECT * FROM communities WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Community not found' });
  if (communityRole(row.id, req.userId) !== 'admin') return res.status(403).json({ error: 'Admins only' });
  const targetId = req.params.userId;
  const targetRole = communityRole(row.id, targetId);
  if (!targetRole) return res.status(404).json({ error: 'Not a member' });

  const { role } = req.body || {};
  if (role && ['admin', 'member'].includes(role)) {
    db.prepare('UPDATE community_members SET role = ? WHERE community_id = ? AND user_id = ?').run(role, row.id, targetId);
    if (row.chat_id) db.prepare('UPDATE chat_members SET role = ? WHERE chat_id = ? AND user_id = ?').run(role, row.chat_id, targetId);
  }

  const updated = db.prepare('SELECT * FROM communities WHERE id = ?').get(row.id);
  communityMemberIds(row.id).forEach((uid) => emitToUser(uid, 'community:updated', hydrateCommunity(updated, uid)));
  res.json({ community: hydrateCommunity(updated, req.userId) });
});

app.delete('/api/communities/:id/members/:userId', requireAuth, (req, res) => {
  const row = db.prepare('SELECT * FROM communities WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Community not found' });
  const targetId = req.params.userId;
  const isSelf = targetId === req.userId;
  if (!isSelf && communityRole(row.id, req.userId) !== 'admin') return res.status(403).json({ error: 'Admins only' });
  const targetRole = communityRole(row.id, targetId);
  if (!targetRole) return res.status(404).json({ error: 'Not a member' });

  const admins = db.prepare(`SELECT COUNT(*) c FROM community_members WHERE community_id = ? AND role = 'admin'`).get(row.id).c;
  if (targetRole === 'admin' && admins <= 1) return res.status(400).json({ error: 'Cannot remove the only admin' });

  db.prepare('DELETE FROM community_members WHERE community_id = ? AND user_id = ?').run(row.id, targetId);
  if (row.chat_id) {
    db.prepare('DELETE FROM chat_members WHERE chat_id = ? AND user_id = ?').run(row.chat_id, targetId);
    const target = getUser(targetId);
    insertSystemMessage(row.chat_id, isSelf ? `${target.name} left the community` : `${target.name} was removed from the community`);
  }
  emitToUser(targetId, 'community:removed', { id: row.id });
  const updated = db.prepare('SELECT * FROM communities WHERE id = ?').get(row.id);
  communityMemberIds(row.id).forEach((uid) => emitToUser(uid, 'community:updated', hydrateCommunity(updated, uid)));
  res.json({ ok: true });
});

/* ------------------------------------------------------------------ */
/* Safety & Moderation — user reports + admin-only center             */
/* ------------------------------------------------------------------ */

/** Report a message. Reporters may only report messages in chats they
 *  belong to (no probing arbitrary ids), are rate-limited, and duplicates
 *  never double-count. Reports merge into the same cases as automated
 *  detection. */
app.post('/api/moderation/report', requireAuth, (req, res) => {
  const { messageId, reason, note } = req.body || {};
  if (!moderation.REPORT_REASONS[reason]) return res.status(400).json({ error: 'Pick a valid reason' });
  const rate = moderation.checkReportRate(req.userId);
  if (!rate.allowed) return res.status(429).json({ error: 'Too many reports — please wait a bit.', retryAfter: rate.retryAfter });

  const message = db.prepare('SELECT * FROM messages WHERE id = ?').get(messageId);
  if (!message || message.deleted) return res.status(404).json({ error: 'Message not found' });
  const isMember = db.prepare('SELECT 1 FROM chat_members WHERE chat_id = ? AND user_id = ?').get(message.chat_id, req.userId);
  if (!isMember) return res.status(404).json({ error: 'Message not found' });
  if (message.sender_id === req.userId) return res.status(400).json({ error: "You can't report your own message" });

  const dup = db.prepare('SELECT 1 FROM moderation_reports WHERE reporter_id = ? AND message_id = ?').get(req.userId, messageId);
  if (dup) return res.json({ ok: true, duplicate: true });

  const { caseId } = moderation.recordUserReport(
    { reporterId: req.userId, messageRow: message, reason, note },
    moderationIO
  );
  res.json({ ok: true, caseId });
});

/* ---- Admin Safety Center API — every route re-verifies the admin role ---- */

function caseSummary(row) {
  const user = getUser(row.user_id);
  return {
    id: row.id,
    userId: row.user_id,
    username: user?.username || null,
    name: user?.name || 'Unknown',
    category: row.category,
    severity: row.severity,
    confidence: row.confidence,
    source: row.source,
    signals: row.signals,
    reason: row.reason,
    snapshot: row.snapshot,
    status: row.status,
    chatId: row.chat_id,
    messageId: row.message_id,
    actionTaken: row.action_taken,
    reviewedBy: row.reviewed_by,
    reviewedAt: row.reviewed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    userModeration: user?.moderation || 'active',
  };
}

app.get('/api/admin/moderation/overview', requireAuth, requireAdmin, (req, res) => {
  moderation.retentionSweep();
  const counts = {};
  moderation.SEVERITIES.forEach((sev) => {
    counts[sev.toLowerCase()] = db
      .prepare("SELECT COUNT(*) c FROM moderation_cases WHERE severity = ? AND status IN ('OPEN','UNDER_REVIEW','ESCALATED')")
      .get(sev).c;
  });
  const openCases = db.prepare("SELECT COUNT(*) c FROM moderation_cases WHERE status IN ('OPEN','UNDER_REVIEW','ESCALATED')").get().c;
  const recent = db
    .prepare("SELECT * FROM moderation_cases WHERE status IN ('OPEN','UNDER_REVIEW','ESCALATED') ORDER BY (CASE severity WHEN 'CRITICAL' THEN 4 WHEN 'HIGH' THEN 3 WHEN 'MEDIUM' THEN 2 ELSE 1 END) DESC, updated_at DESC LIMIT 12")
    .all()
    .map(caseSummary);
  res.json({ counts, openCases, recent, settings: moderation.getModerationSettings() });
});

app.get('/api/admin/moderation/cases', requireAuth, requireAdmin, (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 25, 100);
  const { severity, category, status, source, q } = req.query;
  const sort = String(req.query.sort || 'new');

  let sql = 'SELECT * FROM moderation_cases WHERE 1=1';
  const params = [];
  if (severity && moderation.SEVERITIES.includes(severity.toUpperCase())) { sql += ' AND severity = ?'; params.push(severity.toUpperCase()); }
  if (category && moderation.CATEGORIES.includes(category)) { sql += ' AND category = ?'; params.push(category); }
  if (status && moderation.CASE_STATUSES.includes(status.toUpperCase())) { sql += ' AND status = ?'; params.push(status.toUpperCase()); }
  if (source && ['auto', 'user', 'mixed'].includes(source)) { sql += ' AND source = ?'; params.push(source); }
  if (sort === 'unreviewed') sql += " AND status = 'OPEN'";
  if (q) {
    const clean = String(q).trim().replace(/^[@#\s]+/, '');
    const term = `%${clean}%`;
    const like = `%${clean.toLowerCase()}%`;
    sql += ` AND (
      CAST(id AS TEXT) LIKE ? OR message_id LIKE ? OR (chat_id IS NOT NULL AND chat_id LIKE ?)
      OR user_id IN (SELECT id FROM users WHERE username_key LIKE ? OR name LIKE ?)
    )`;
    params.push(term, term, term, like, term);
  }
  sql += sort === 'old'
    ? ' ORDER BY created_at ASC'
    : sort === 'severity'
      ? " ORDER BY (CASE severity WHEN 'CRITICAL' THEN 4 WHEN 'HIGH' THEN 3 WHEN 'MEDIUM' THEN 2 WHEN 'LOW' THEN 1 ELSE 0 END) DESC, updated_at DESC"
      : sort === 'confidence'
        ? ' ORDER BY confidence DESC, updated_at DESC'
        : ' ORDER BY updated_at DESC';
  sql += ` LIMIT ${Number(limit) + 1}`;

  const rows = db.prepare(sql).all(...params);
  const hasMore = rows.length > limit;
  res.json({ cases: rows.slice(0, limit).map(caseSummary), hasMore });
});

app.get('/api/admin/moderation/cases/:id', requireAuth, requireAdmin, (req, res) => {
  const row = db.prepare('SELECT * FROM moderation_cases WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Case not found' });
  const user = getUser(row.user_id);
  const reports = db
    .prepare(`SELECT r.*, u.username reporter_username, u.name reporter_name FROM moderation_reports r
              LEFT JOIN users u ON u.id = r.reporter_id WHERE r.case_id = ? ORDER BY r.created_at DESC LIMIT 25`)
    .all(row.id)
    .map((r) => ({ id: r.id, reporter: r.reporter_username ? { id: r.reporter_id, username: r.reporter_username, name: r.reporter_name } : null, reason: r.reason, note: r.note, createdAt: r.created_at }));
  const actions = db
    .prepare(`SELECT a.*, u.username admin_username FROM moderation_actions a
              LEFT JOIN users u ON u.id = a.admin_id WHERE a.case_id = ? ORDER BY a.created_at DESC LIMIT 25`)
    .all(row.id)
    .map((a) => ({ id: a.id, admin: a.admin_username, action: a.action, reason: a.reason, createdAt: a.created_at }));
  const message = row.message_id ? db.prepare('SELECT id, chat_id, sender_id, type, body, deleted, created_at FROM messages WHERE id = ?').get(row.message_id) : null;
  const chat = row.chat_id ? db.prepare('SELECT id, type, name FROM chats WHERE id = ?').get(row.chat_id) : null;
  const history = db
    .prepare('SELECT * FROM moderation_cases WHERE user_id = ? AND id != ? ORDER BY created_at DESC LIMIT 10')
    .all(row.user_id, row.id)
    .map(caseSummary);
  res.json({
    case: caseSummary(row),
    user: user ? { id: user.id, username: user.username, name: user.name, avatar: user.avatar, moderation: user.moderation, role: user.role, createdAt: user.created_at } : null,
    reports,
    actions,
    message: message ? { id: message.id, body: message.body, type: message.type, deleted: !!message.deleted, createdAt: message.created_at } : null,
    conversation: chat ? { id: chat.id, type: chat.type, name: chat.type !== 'direct' ? chat.name : 'Private Chat' } : null,
    userHistory: history,
  });
});

const REVIEW_ACTIONS = {
  confirm: 'CONFIRMED',
  dismiss: 'CLOSED',
  escalate: 'ESCALATED',
  false_positive: 'FALSE_POSITIVE',
  under_review: 'UNDER_REVIEW',
  close: 'CLOSED',
  no_action: 'CLOSED',
};

app.post('/api/admin/moderation/cases/:id/review', requireAuth, requireAdmin, (req, res) => {
  const row = db.prepare('SELECT * FROM moderation_cases WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Case not found' });
  const { action, reason } = req.body || {};
  const nextStatus = REVIEW_ACTIONS[action];
  if (!nextStatus) return res.status(400).json({ error: 'Invalid review action' });
  if ((action === 'ban' || action === 'remove_content') && !reason) {
    return res.status(400).json({ error: 'A reason is required for this action' });
  }

  const t = now();
  const admin = getUser(req.userId);
  db.prepare('UPDATE moderation_cases SET status = ?, reviewed_by = ?, reviewed_at = ?, action_taken = ?, updated_at = ? WHERE id = ?')
    .run(nextStatus, req.userId, t, action, t, row.id);
  db.prepare('INSERT INTO moderation_actions (case_id, admin_id, action, target_user_id, reason, created_at) VALUES (?,?,?,?,?,?)')
    .run(row.id, req.userId, action, row.user_id, String(reason || '').slice(0, 500) || null, t);
  const target = getUser(row.user_id);
  moderation.writeAudit({
    adminId: req.userId, adminName: admin?.username,
    action: `case:${action}`, target: target ? `@${target.username}` : row.user_id,
    caseId: row.id, detail: reason,
  });
  // A confirmed false positive is feedback for the rules — recorded, never
  // an automatic punishment, and never auto-training anything.
  if (action === 'false_positive' && row.category !== 'other') {
    db.prepare('INSERT OR IGNORE INTO moderation_settings (key, value) VALUES (?, ?)')
      .run(`fp:${row.category}:${row.message_id || 'x'}`, String(t));
  }
  moderationIO.emitToUser(req.userId, 'moderation:update', { caseId: row.id, status: nextStatus, at: t });
  res.json({ case: caseSummary(db.prepare('SELECT * FROM moderation_cases WHERE id = ?').get(row.id)) });
});

/** Remove the flagged content (soft-delete, like a sender's own delete). */
app.post('/api/admin/moderation/cases/:id/remove-content', requireAuth, requireAdmin, (req, res) => {
  const row = db.prepare('SELECT * FROM moderation_cases WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Case not found' });
  const { reason } = req.body || {};
  if (!row.message_id) return res.status(400).json({ error: 'No message attached to this case' });
  const message = db.prepare('SELECT * FROM messages WHERE id = ?').get(row.message_id);
  if (message && !message.deleted) {
    db.prepare('UPDATE messages SET deleted = 1 WHERE id = ?').run(message.id);
    emitToChat(message.chat_id, 'message:updated', (viewer) => hydrateMessage(db.prepare('SELECT * FROM messages WHERE id = ?').get(message.id), viewer));
  }
  const t = now();
  const admin = getUser(req.userId);
  db.prepare('UPDATE moderation_cases SET status = ?, action_taken = ?, updated_at = ? WHERE id = ?').run('ACTION_TAKEN', 'remove_content', t, row.id);
  db.prepare('INSERT INTO moderation_actions (case_id, admin_id, action, target_user_id, reason, created_at) VALUES (?,?,?,?,?,?)')
    .run(row.id, req.userId, 'remove_content', row.user_id, String(reason || '').slice(0, 500) || null, t);
  moderation.writeAudit({
    adminId: req.userId, adminName: admin?.username,
    action: 'content:removed', target: `@${getUser(row.user_id)?.username || row.user_id}`,
    caseId: row.id, detail: reason,
  });
  res.json({ ok: true });
});

app.get('/api/admin/moderation/users', requireAuth, requireAdmin, (req, res) => {
  const q = String(req.query.q || '').trim().replace(/^@/, '').toLowerCase();
  if (q.length < 1) return res.json({ users: [] });
  const term = `%${q.replace(/[%_\\]/g, '\\$&')}%`;
  const users = db.prepare(`SELECT id, username, name, avatar, role, moderation, gold_tick
    FROM users WHERE username_key LIKE ? OR lower(name) LIKE ? ORDER BY username_key LIMIT 30`).all(term, term)
    .map((u) => ({ id: u.id, username: u.username, name: u.name, avatar: u.avatar, role: u.role, moderation: u.moderation, goldTick: !!u.gold_tick }));
  res.json({ users });
});

app.put('/api/admin/moderation/users/:id/gold-tick', requireAuth, requireAdmin, (req, res) => {
  const target = getUser(req.params.id);
  if (!target) return res.status(404).json({ error: 'User not found' });
  const enabled = req.body?.enabled === true;
  db.prepare('UPDATE users SET gold_tick = ? WHERE id = ?').run(enabled ? 1 : 0, target.id);
  const admin = getUser(req.userId);
  moderation.writeAudit({
    adminId: req.userId, adminName: admin?.username, action: enabled ? 'user:gold_tick_granted' : 'user:gold_tick_revoked',
    target: `@${target.username}`, detail: enabled ? 'Verification badge granted' : 'Verification badge revoked',
  });
  // Refresh live clients immediately; every normal user payload also carries goldTick.
  moderationIO.emitToUser(target.id, 'profile:updated', { user: publicUser(getUser(target.id)) });
  res.json({ ok: true, user: { id: target.id, goldTick: enabled } });
});

app.get('/api/admin/moderation/users/:id', requireAuth, requireAdmin, (req, res) => {
  const u = getUser(req.params.id);
  if (!u) return res.status(404).json({ error: 'User not found' });
  const cases = db.prepare('SELECT * FROM moderation_cases WHERE user_id = ? ORDER BY created_at DESC LIMIT 25').all(u.id).map(caseSummary);
  res.json({
    user: { id: u.id, username: u.username, name: u.name, avatar: u.avatar, role: u.role, goldTick: !!u.gold_tick, moderation: u.moderation, suspendedUntil: u.suspended_until, createdAt: u.created_at, lastSeen: u.last_seen, isOnline: u.is_online },
    cases,
    counts: {
      total: cases.length,
      confirmed: cases.filter((c) => c.status === 'CONFIRMED' || c.status === 'ACTION_TAKEN').length,
      falsePositives: cases.filter((c) => c.status === 'FALSE_POSITIVE').length,
    },
  });
});

app.post('/api/admin/moderation/users/:id/action', requireAuth, requireAdmin, (req, res) => {
  const { action, reason, days, caseId, confirmIrreversible } = req.body || {};
  if (!moderation.USER_ACTIONS.includes(action)) return res.status(400).json({ error: 'Invalid action' });
  if (['ban', 'suspend'].includes(action) && confirmIrreversible !== true) {
    return res.status(400).json({ error: 'This action requires explicit confirmation (confirmIrreversible: true)' });
  }
  try {
    const result = moderation.applyUserAction({
      adminId: req.userId, targetId: req.params.id, action, reason, days, caseId, io: moderationIO,
    });
    const admin = getUser(req.userId);
    const target = getUser(req.params.id);
    moderation.writeAudit({
      adminId: req.userId, adminName: admin?.username,
      action: `user:${action}`, target: `@${target?.username || req.params.id}`,
      caseId: caseId || null, detail: reason,
    });
    if (caseId) {
      db.prepare('UPDATE moderation_cases SET status = ?, action_taken = ?, updated_at = ? WHERE id = ?')
        .run('ACTION_TAKEN', action, now(), caseId);
    }
    // Enforcement takes effect immediately on live sessions.
    if (['banned', 'suspended'].includes(result.state)) {
      const ids = sockets.get(req.params.id);
      ids?.forEach((socketId) => io.sockets.sockets.get(socketId)?.disconnect(true));
      sockets.delete(req.params.id);
    }
    res.json({ ok: true, state: result.state });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.get('/api/admin/moderation/audit', requireAuth, requireAdmin, (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const before = Number(req.query.before) || Date.now() + 1;
  const rows = db
    .prepare('SELECT * FROM moderation_audit_log WHERE created_at < ? ORDER BY created_at DESC LIMIT ?')
    .all(before, limit + 1);
  res.json({
    entries: rows.slice(0, limit).map((r) => ({
      id: r.id, admin: r.admin_name || r.admin_id, action: r.action, target: r.target,
      caseId: r.case_id, detail: r.detail, createdAt: r.created_at,
    })),
    hasMore: rows.length > limit,
  });
});

app.get('/api/admin/moderation/settings', requireAuth, requireAdmin, (req, res) => {
  res.json({ settings: moderation.getModerationSettings() });
});

app.put('/api/admin/moderation/settings', requireAuth, requireAdmin, (req, res) => {
  const { alertPushLevel, caseLevel, lowAggregationMinutes, retentionDays } = req.body || {};
  const changes = [];
  const current = moderation.getModerationSettings();
  const apply = (key, value) => {
    if (value === undefined || value === null || String(value) === String(current[key])) return;
    moderation.setModerationSetting(key, value);
    changes.push(`${key}: ${current[key]} → ${value}`);
  };
  if (alertPushLevel !== undefined) {
    if (!moderation.SEVERITIES.includes(alertPushLevel) && alertPushLevel !== 'NONE') return res.status(400).json({ error: 'Invalid alertPushLevel' });
    apply('alertPushLevel', alertPushLevel);
  }
  if (caseLevel !== undefined) {
    if (!['LOW', 'MEDIUM', 'HIGH'].includes(caseLevel)) return res.status(400).json({ error: 'Invalid caseLevel' });
    apply('caseLevel', caseLevel);
  }
  if (lowAggregationMinutes !== undefined) {
    const v = Math.max(5, Math.min(24 * 60, Number(lowAggregationMinutes) || 60));
    apply('lowAggregationMinutes', v);
  }
  if (retentionDays !== undefined) {
    const v = Math.max(30, Math.min(3650, Number(retentionDays) || 180));
    apply('retentionDays', v);
  }
  if (changes.length) {
    const admin = getUser(req.userId);
    moderation.writeAudit({ adminId: req.userId, adminName: admin?.username, action: 'settings:update', detail: changes.join('; ') });
  }
  res.json({ settings: moderation.getModerationSettings() });
});

/* ------------------------------------------------------------------ */
/* socket.io realtime                                                  */
/* ------------------------------------------------------------------ */

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' }, maxHttpBufferSize: 3e7 });

const sockets = new Map(); // userId -> Set<socketId>
const activeCalls = new Map(); // userId -> callId, for busy-detection and cleanup on disconnect

function emitToUser(userId, event, payload) {
  // A null payload (e.g. a message the target hid via "Delete for me")
  // means "don't send anything to this user".
  if (payload == null) return;
  const set = sockets.get(userId);
  if (!set) return;
  set.forEach((sid) => io.to(sid).emit(event, payload));
}

/* Adapter the moderation engine uses for realtime + pushes (kept tiny so
   moderation.js stays free of socket/push imports). */
const moderationIO = {
  emitToUser: (userId, event, payload) => emitToUser(userId, event, payload),
  pushAdminSafety: (adminId, { severity, category, source, caseId }) => {
    push.notifySafetyAlert({
      userId: adminId,
      title: severity === 'CRITICAL' ? '🚨 CRITICAL Safety Alert' : '🚨 Safety Alert',
      body: `${severity} · ${category.replace(/_/g, ' ')} · ${source === 'user' ? 'user report' : source === 'mixed' ? 'multiple signals' : 'automated detection'} — open the Safety Center to review.`,
      caseId,
    }).catch(() => {});
  },
  pushSafetyWarning: (targetId, reason) => {
    push.notifySafetyWarning({ userId: targetId, reason }).catch(() => {});
  },
};

function emitToChat(chatId, event, payloadFor) {
  memberIds(chatId).forEach((uid) => {
    const payload = typeof payloadFor === 'function' ? payloadFor(uid) : payloadFor;
    emitToUser(uid, event, payload);
  });
}

io.use((socket, next) => {
  const payload = verify(socket.handshake.auth?.token);
  if (!payload) return next(new Error('Unauthorized'));
  socket.userId = payload.id;
  next();
});

/** Map an unexpected socket-handler exception to a user-safe ack.
 *  Deliberate validation errors are short human phrases and pass through;
 *  system/technical failures are logged and replaced so the UI never shows
 *  raw SQL/SQLite/stack text. */
function socketFailure(e) {
  const msg = String(e?.message || '');
  if (msg) console.error('[socket handler]', msg);
  const technical = /SQLITE|database|ECONN|ETIMEDOUT|ENOTFOUND|EHOSTUNREACH|at .*\.js:|Operation apply failed|Cannot read|is not a function|undefined is not/i.test(msg);
  if (msg && !technical && msg.length <= 120 && !/^\s*\{/.test(msg)) return { error: msg };
  return { error: 'Something went wrong. Please try again.' };
}

io.on('connection', (socket) => {
  const uid = socket.userId;
  if (!sockets.has(uid)) sockets.set(uid, new Set());
  sockets.get(uid).add(socket.id);

  db.prepare('UPDATE users SET is_online = 1, last_seen = ? WHERE id = ?').run(now(), uid);
  io.emit('presence', { userId: uid, isOnline: true, lastSeen: now() });

  // deliver receipts for anything pending
  const pending = db
    .prepare(
      `SELECT m.id, m.chat_id FROM messages m
       JOIN chat_members cm ON cm.chat_id = m.chat_id AND cm.user_id = ?
       WHERE m.sender_id != ? AND NOT EXISTS
         (SELECT 1 FROM receipts r WHERE r.message_id = m.id AND r.user_id = ? AND r.state = 'delivered')`
    )
    .all(uid, uid, uid);
  pending.forEach(({ id, chat_id }) => {
    db.prepare('INSERT OR IGNORE INTO receipts (message_id, user_id, state, at) VALUES (?,?,?,?)').run(id, uid, 'delivered', now());
    const m = db.prepare('SELECT * FROM messages WHERE id = ?').get(id);
    emitToChat(chat_id, 'message:updated', () => hydrateMessage(m, uid));
  });

  socket.on('message:send', (data, ack) => {
    try {
      const outcome = deliverUserMessage(uid, data || {});
      if (outcome.error) return ack?.({ error: outcome.error });
      const tempId = data?.tempId || data?.clientId || null;
      fanoutNewMessage(outcome, uid, tempId);
      ack?.({ message: hydrateMessage(outcome.row, uid), tempId, duplicate: !!outcome.duplicate });
    } catch (e) {
      ack?.(socketFailure(e));
    }
  });

  // Legacy edit (full body replacement) — now converted to OT operation for consistency
  socket.on('message:edit', ({ messageId, body, baseVersion, operation }, ack) => {
    try {
      const gate = moderation.moderationGate(uid);
      if (gate.blocked) return ack?.({ error: gate.error });
      const m = db.prepare('SELECT * FROM messages WHERE id = ?').get(messageId);
      if (!m || m.deleted) return ack?.({ error: 'Message not found' });
      if (m.sender_id !== uid) return ack?.({ error: "You can only edit your own messages" });
      if (m.type !== 'text') return ack?.({ error: 'Only text messages can be edited' });

      let result;
      if (operation) {
        // OT path: operation provided
        const op = TextOperation.fromJSON(operation);
        result = otStore.submitMessageEditOperation(messageId, op, uid, baseVersion != null ? Number(baseVersion) : undefined);
      } else {
        // Legacy path: full body — convert to OT diff
        const text = String(body || '').trim();
        if (!text) return ack?.({ error: 'Message cannot be empty' });
        if (text.length > 5000) return ack?.({ error: 'Message too long' });
        result = otStore.submitMessageEditLegacy(messageId, m.body, text, uid, baseVersion != null ? Number(baseVersion) : undefined);
      }

      const fresh = db.prepare('SELECT * FROM messages WHERE id = ?').get(messageId);
      emitToChat(m.chat_id, 'message:updated', (viewer) => {
        const hydrated = hydrateMessage(fresh, viewer);
        if (!hydrated) return null;
        return { ...hydrated, otVersion: result.version, otOperation: result.operation.toJSON() };
      });
      emitToChat(m.chat_id, 'chat:updated', (viewer) => chatSummary(m.chat_id, viewer));
      ack?.({ message: hydrateMessage(fresh, uid), version: result.version, operation: result.operation.toJSON() });
    } catch (e) {
      ack?.(socketFailure(e));
    }
  });

  // New OT-specific message edit event (explicit OT)
  socket.on('message:edit:ot', ({ messageId, operation, baseVersion, body }, ack) => {
    try {
      const gate = moderation.moderationGate(uid);
      if (gate.blocked) return ack?.({ error: gate.error });
      const m = db.prepare('SELECT * FROM messages WHERE id = ?').get(messageId);
      if (!m || m.deleted) return ack?.({ error: 'Message not found' });
      if (m.sender_id !== uid) return ack?.({ error: "Only sender can edit" });
      if (m.type !== 'text') return ack?.({ error: 'Only text messages' });

      let result;
      if (operation) {
        const op = TextOperation.fromJSON(operation);
        result = otStore.submitMessageEditOperation(messageId, op, uid, baseVersion != null ? Number(baseVersion) : undefined);
      } else if (body != null) {
        result = otStore.submitMessageEditLegacy(messageId, m.body, String(body), uid, baseVersion != null ? Number(baseVersion) : undefined);
      } else {
        return ack?.({ error: 'Missing operation or body' });
      }

      const fresh = db.prepare('SELECT * FROM messages WHERE id = ?').get(messageId);
      // Broadcast OT edit
      emitToChat(m.chat_id, 'message:edit:ot', {
        messageId,
        operation: result.operation.toJSON(),
        version: result.version,
        body: result.body,
        userId: uid
      });
      emitToChat(m.chat_id, 'message:updated', (viewer) => {
        const hydrated = hydrateMessage(fresh, viewer);
        if (!hydrated) return null;
        return { ...hydrated, otVersion: result.version };
      });
      ack?.({ message: hydrateMessage(fresh, uid), version: result.version, operation: result.operation.toJSON(), body: result.body });
    } catch (e) {
      ack?.(socketFailure(e));
    }
  });

  // OT Document collaboration
  socket.on('doc:join', ({ documentId, chatId }, ack) => {
    try {
      let doc;
      if (documentId) {
        doc = otStore.getDocument(documentId);
        if (!doc) return ack?.({ error: 'Document not found' });
        if (doc.chatId) {
          const isMember = db.prepare('SELECT 1 FROM chat_members WHERE chat_id = ? AND user_id = ?').get(doc.chatId, uid);
          if (!isMember) return ack?.({ error: 'Not a member' });
          socket.join(`doc:${doc.id}`);
          socket.join(`chat:${doc.chatId}`);
        }
      } else if (chatId) {
        const isMember = db.prepare('SELECT 1 FROM chat_members WHERE chat_id = ? AND user_id = ?').get(chatId, uid);
        if (!isMember) return ack?.({ error: 'Not a member' });
        const docs = otStore.listDocumentsForChat(chatId);
        // Return list if no specific doc requested
        return ack?.({ documents: docs });
      } else {
        return ack?.({ error: 'Missing documentId or chatId' });
      }

      const docSnap = otStore.docManager.getOrCreate(doc.id, doc.content, doc.meta).getSnapshot();
      ack?.({ content: docSnap.content, version: docSnap.version, document: doc, id: doc.id });

      // Notify others that user joined
      if (doc.chatId) {
        memberIds(doc.chatId).filter(id => id !== uid).forEach(otherId => {
          emitToUser(otherId, 'doc:user:joined', { documentId: doc.id, userId: uid, userName: getUser(uid)?.name });
        });
      }
    } catch (e) {
      ack?.(socketFailure(e));
    }
  });

  socket.on('doc:operation', ({ documentId, operation, baseVersion, selection }, ack) => {
    try {
      const doc = otStore.getDocument(documentId);
      if (!doc) return ack?.({ error: 'Document not found' });
      if (doc.chatId) {
        const isMember = db.prepare('SELECT 1 FROM chat_members WHERE chat_id = ? AND user_id = ?').get(doc.chatId, uid);
        if (!isMember) return ack?.({ error: 'Not a member' });
      }

      const op = TextOperation.fromJSON(operation);
      const result = otStore.submitDocumentOperation(documentId, op, uid, baseVersion != null ? Number(baseVersion) : undefined);

      // Ack to sender
      ack?.({ version: result.snapshot.version, operation: result.operation.operation.toJSON() });

      // Broadcast to others in same chat/doc
      const payload = {
        documentId,
        operation: result.operation.operation.toJSON(),
        version: result.snapshot.version,
        baseVersion: result.operation.meta.baseVersion,
        userId: uid,
        userName: getUser(uid)?.name,
        selection: selection || null
      };

      if (doc.chatId) {
        memberIds(doc.chatId).filter(id => id !== uid).forEach(otherId => {
          emitToUser(otherId, 'doc:operation', payload);
        });
      } else {
        socket.broadcast.emit('doc:operation', payload);
      }

      // Update doc updated_at for ordering
      db.prepare('UPDATE documents SET updated_at = ? WHERE id = ?').run(now(), documentId);
    } catch (e) {
      ack?.(socketFailure(e));
    }
  });

  socket.on('doc:selection', ({ documentId, selection, cursor }) => {
    try {
      const doc = otStore.getDocument(documentId);
      if (!doc) return;
      if (doc.chatId) {
        const isMember = db.prepare('SELECT 1 FROM chat_members WHERE chat_id = ? AND user_id = ?').get(doc.chatId, uid);
        if (!isMember) return;
        memberIds(doc.chatId).filter(id => id !== uid).forEach(otherId => {
          emitToUser(otherId, 'doc:selection', {
            documentId,
            userId: uid,
            userName: getUser(uid)?.name,
            selection,
            cursor
          });
        });
      }
    } catch {}
  });

  socket.on('doc:leave', ({ documentId }) => {
    try {
      socket.leave(`doc:${documentId}`);
      const doc = otStore.getDocument(documentId);
      if (doc?.chatId) {
        memberIds(doc.chatId).filter(id => id !== uid).forEach(otherId => {
          emitToUser(otherId, 'doc:user:left', { documentId, userId: uid });
        });
      }
    } catch {}
  });

  socket.on('poll:create', (data, ack) => {
    try {
      const gate = moderation.moderationGate(uid);
      if (gate.blocked) return ack?.({ error: gate.error });
      const { chatId, question, options = [] } = data || {};
      const isMember = db.prepare('SELECT 1 FROM chat_members WHERE chat_id = ? AND user_id = ?').get(chatId, uid);
      if (!isMember) return ack?.({ error: 'Not a member' });
      const chat = db.prepare('SELECT * FROM chats WHERE id = ?').get(chatId);
      if (!chat || !['group', 'gc'].includes(chat.type)) return ack?.({ error: 'Polls are only available in group and GC chats' });
      const q = String(question || '').trim();
      const opts = options.map((o) => String(o).trim()).filter(Boolean);
      if (!q) return ack?.({ error: 'Write a question for the poll' });
      if (opts.length < 2) return ack?.({ error: 'Add at least two options' });
      if (opts.length > 6) return ack?.({ error: 'Maximum 6 options' });
      if ([...new Set(opts.map((o) => o.toLowerCase()))].length !== opts.length) {
        return ack?.({ error: 'Options must be different' });
      }

      const pollId = nano();
      const t = now();
      db.prepare('INSERT INTO polls (id, chat_id, created_by, question, options, created_at) VALUES (?,?,?,?,?,?)').run(
        pollId, chatId, uid, q.slice(0, 240), JSON.stringify(opts.slice(0, 6)), t
      );
      const msg = {
        id: nano(), chat_id: chatId, sender_id: uid, type: 'poll',
        body: q.slice(0, 240), media_url: null, duration: 0, reply_to: null,
        expires_at: chat.disappear_seconds ? t + chat.disappear_seconds * 1000 : null,
        edited: 0, forwarded_from: null, poll_id: pollId, created_at: t,
      };
      persistMessage(msg, chatId);
      const row = db.prepare('SELECT * FROM messages WHERE id = ?').get(msg.id);
      emitToChat(chatId, 'message:new', (viewer) => ({ message: hydrateMessage(row, viewer) }));
      emitToChat(chatId, 'chat:updated', (viewer) => chatSummary(chatId, viewer));
      push.notifyMessage({ chatId, chat, message: row, senderId: uid });
      ack?.({ message: hydrateMessage(row, uid) });
    } catch (e) {
      ack?.(socketFailure(e));
    }
  });

  socket.on('poll:vote', ({ messageId, pollId, optionIndex }, ack) => {
    try {
      const m = db.prepare('SELECT * FROM messages WHERE id = ?').get(messageId);
      if (!m || m.deleted || m.type !== 'poll' || m.poll_id !== pollId) return ack?.({ error: 'Poll not found' });
      const isMember = db.prepare('SELECT 1 FROM chat_members WHERE chat_id = ? AND user_id = ?').get(m.chat_id, uid);
      if (!isMember) return ack?.({ error: 'Not a member' });
      const poll = db.prepare('SELECT * FROM polls WHERE id = ?').get(pollId);
      let opts = [];
      try { opts = JSON.parse(poll.options || '[]'); } catch { opts = []; }
      const idx = Number(optionIndex);
      if (!Number.isInteger(idx) || idx < 0 || idx >= opts.length) return ack?.({ error: 'Invalid option' });
      db.prepare('INSERT OR REPLACE INTO poll_votes (poll_id, user_id, option_index, at) VALUES (?,?,?,?)').run(pollId, uid, idx, now());
      const fresh = db.prepare('SELECT * FROM messages WHERE id = ?').get(messageId);
      emitToChat(m.chat_id, 'message:updated', (viewer) => hydrateMessage(fresh, viewer));
      ack?.({ message: hydrateMessage(fresh, uid) });
    } catch (e) {
      ack?.(socketFailure(e));
    }
  });

  socket.on('message:read', ({ chatId }) => {
    // Real "read receipts" toggle: if I've turned mine off, I still get
    // marked as having "seen" it for my own unread badge (delivered), but I
    // never write a 'read' receipt — so nobody else ever sees a blue tick
    // from me, matching the WhatsApp trade-off (turn it off for others,
    // lose seeing it from others too).
    const myReadReceiptsOn = getSettings(getUser(uid)).privacy.readReceipts;
    const rows = db
      .prepare(
        `SELECT * FROM messages WHERE chat_id = ? AND sender_id != ?
         AND NOT EXISTS (SELECT 1 FROM receipts r WHERE r.message_id = messages.id AND r.user_id = ? AND r.state='read')`
      )
      .all(chatId, uid, uid);
    rows.forEach((m) => {
      db.prepare('INSERT OR IGNORE INTO receipts (message_id, user_id, state, at) VALUES (?,?,?,?)').run(m.id, uid, 'delivered', now());
      if (myReadReceiptsOn) {
        db.prepare('INSERT OR IGNORE INTO receipts (message_id, user_id, state, at) VALUES (?,?,?,?)').run(m.id, uid, 'read', now());
      }
    });
    if (rows.length) {
      rows.forEach((m) => {
        const fresh = db.prepare('SELECT * FROM messages WHERE id = ?').get(m.id);
        emitToChat(chatId, 'message:updated', (viewer) => {
          // Never re-push a message this viewer hid via "Delete for me".
          if (isHiddenForMe(fresh, viewer)) return null;
          return hydrateMessage(fresh, viewer);
        });
      });
    }
    emitToChat(chatId, 'chat:updated', (viewer) => chatSummary(chatId, viewer));
  });

  socket.on('typing', ({ chatId, isTyping }) => {
    const me = getUser(uid);
    memberIds(chatId).filter((x) => x !== uid).forEach((x) =>
      emitToUser(x, 'typing', { chatId, userId: uid, name: me?.name, isTyping: !!isTyping })
    );
  });

  /* ---------------- GC rooms + GC-scoped realtime events ------------
     Each GC owns a dedicated socket room (gc:{id}). A client joins only
     after the server re-validates GC membership, and leaves when its chat
     closes. GC messages/typing use gc:message / gc:typing and never touch
     the direct-chat path on the receiving client. */
  socket.on('gc:join', ({ gcId }, ack) => {
    try {
      const chat = db.prepare('SELECT * FROM chats WHERE id = ?').get(String(gcId || ''));
      if (!chat || chat.type !== 'gc') return ack?.({ error: 'GC not found' });
      const membership = db.prepare('SELECT 1 FROM chat_members WHERE chat_id = ? AND user_id = ?').get(chat.id, uid);
      if (!membership) return ack?.({ error: 'You are not a member of this GC' });
      socket.join('gc:' + chat.id);
      ack?.({ ok: true, chat: chatSummary(chat.id, uid) });
    } catch (e) {
      ack?.(socketFailure(e));
    }
  });

  socket.on('gc:leave', ({ gcId }, ack) => {
    try {
      socket.leave('gc:' + String(gcId || ''));
      ack?.({ ok: true });
    } catch (e) {
      ack?.(socketFailure(e));
    }
  });

  socket.on('gc:send', (data, ack) => {
    try {
      const chat = db.prepare('SELECT * FROM chats WHERE id = ?').get(String(data?.gcId || data?.chatId || ''));
      if (!chat || chat.type !== 'gc') return ack?.({ error: 'GC not found' });
      const outcome = deliverUserMessage(uid, { ...(data || {}), chatId: chat.id });
      if (outcome.error) return ack?.({ error: outcome.error });
      const tempId = data?.tempId || data?.clientId || null;
      fanoutNewMessage(outcome, uid, tempId);
      ack?.({ message: hydrateMessage(outcome.row, uid), tempId, duplicate: !!outcome.duplicate });
    } catch (e) {
      ack?.(socketFailure(e));
    }
  });

  socket.on('gc:typing', ({ gcId, isTyping }) => {
    try {
      const chat = db.prepare('SELECT * FROM chats WHERE id = ?').get(String(gcId || ''));
      if (!chat || chat.type !== 'gc') return;
      const me = getUser(uid);
      memberIds(chat.id).filter((x) => x !== uid).forEach((x) =>
        emitToUser(x, 'gc:typing', { gcId: chat.id, userId: uid, name: me?.name, isTyping: !!isTyping })
      );
    } catch { /* presence events are best-effort */ }
  });

  socket.on('message:react', ({ messageId, emoji }) => {
    const m = db.prepare('SELECT * FROM messages WHERE id = ?').get(messageId);
    if (!m) return;
    const existing = db.prepare('SELECT emoji FROM reactions WHERE message_id = ? AND user_id = ?').get(messageId, uid);
    if (existing && existing.emoji === emoji) db.prepare('DELETE FROM reactions WHERE message_id = ? AND user_id = ?').run(messageId, uid);
    else db.prepare('INSERT OR REPLACE INTO reactions (message_id, user_id, emoji) VALUES (?,?,?)').run(messageId, uid, emoji);
    emitToChat(m.chat_id, 'message:updated', (viewer) => hydrateMessage(m, viewer));
  });

  // Delete a message. `scope`:
  //   'everyone' (default) — sender-only, hides the message for all participants.
  //   'me'               — any member, removes it only on the requester's devices.
  socket.on('message:delete', ({ messageId, scope }, ack) => {
    const m = db.prepare('SELECT * FROM messages WHERE id = ?').get(messageId);
    if (!m) return ack?.({ error: 'Message not found' });
    const isMember = db.prepare('SELECT 1 FROM chat_members WHERE chat_id = ? AND user_id = ?').get(m.chat_id, uid);
    if (!isMember) return ack?.({ error: 'Not a member of this chat' });

    if (scope === 'me') {
      // Add this user to the per-message hide list (csv), mirroring
      // chats.archived_by. The row (and everyone else's view) is untouched.
      const hidden = new Set((m.hidden_for || '').split(',').filter(Boolean));
      hidden.add(uid);
      db.prepare('UPDATE messages SET hidden_for = ?, updated_at = ? WHERE id = ?')
        .run([...hidden].join(','), now(), messageId);
      // Only the requester's devices drop the message — no tombstone.
      emitToUser(uid, 'message:hidden', { chatId: m.chat_id, messageId });
      emitToUser(uid, 'chat:updated', chatSummary(m.chat_id, uid));
      return ack?.({ ok: true, scope: 'me' });
    }

    // "Delete for everyone" — sender only.
    if (m.sender_id !== uid) return ack?.({ error: 'You can only delete your own messages for everyone' });
    db.prepare('UPDATE messages SET deleted = 1, updated_at = ? WHERE id = ?').run(now(), messageId);
    // A poll "deleted for everyone" takes its votes with it.
    if (m.type === 'poll' && m.poll_id) db.prepare('DELETE FROM polls WHERE id = ?').run(m.poll_id);
    const fresh = db.prepare('SELECT * FROM messages WHERE id = ?').get(messageId);
    emitToChat(m.chat_id, 'message:updated', (viewer) => hydrateMessage(fresh, viewer));
    emitToChat(m.chat_id, 'chat:updated', (viewer) => chatSummary(m.chat_id, viewer));
    ack?.({ ok: true, scope: 'everyone' });
  });

  /* ------------------------------------------------------------------ */
  /* calls — real 1:1 WebRTC voice/video, signalled peer-to-peer here    */
  /* ------------------------------------------------------------------ */

  // Track at most one active call per user so we can reject/clean up
  // properly (busy signal, stale calls on disconnect) without a DB lookup
  // on every signaling message.
  const activeCallId = () => activeCalls.get(uid);

  function endCall(callId, reason, endedByUid) {
    const call = db.prepare('SELECT * FROM calls WHERE id = ?').get(callId);
    if (!call || call.status === 'ended' || call.status === 'missed' || call.status === 'declined') return;
    const t = now();
    const status = reason === 'declined' ? 'declined' : reason === 'missed' ? 'missed' : reason === 'busy' ? 'busy' : 'ended';
    db.prepare('UPDATE calls SET status = ?, ended_at = ?, ended_reason = ? WHERE id = ?').run(status, t, reason, callId);
    [call.caller_id, call.callee_id].forEach((id) => activeCalls.delete(id));
    const fresh = db.prepare('SELECT * FROM calls WHERE id = ?').get(callId);
    [call.caller_id, call.callee_id].forEach((id) => emitToUser(id, 'call:ended', hydrateCall(fresh, id)));
  }

  // Caller starts a call. Blocked-either-way and busy checks mirror the
  // same enforcement as direct messaging (see message:send above).
  socket.on('call:invite', ({ chatId, calleeId, type: callType = 'audio' }, ack) => {
    try {
      if (!calleeId || !getUser(calleeId)) return ack?.({ error: 'Unknown user' });
      const callGate = moderation.moderationGate(uid);
      if (callGate.blocked) return ack?.({ error: callGate.error });
      if (blockedEitherWay(uid, calleeId)) return ack?.({ error: "You can't call this person" });
      if (activeCallId()) return ack?.({ error: 'You are already on a call' });
      if (activeCalls.get(calleeId)) {
        const id = nano();
        const t = now();
        db.prepare(
          `INSERT INTO calls (id, chat_id, caller_id, callee_id, type, status, started_at, ended_at, ended_reason)
           VALUES (?,?,?,?,?,?,?,?,?)`
        ).run(id, chatId, uid, calleeId, callType, 'busy', t, t, 'busy');
        return ack?.({ error: `${getUser(calleeId).name} is on another call`, busy: true });
      }

      const id = nano();
      const t = now();
      db.prepare(
        `INSERT INTO calls (id, chat_id, caller_id, callee_id, type, status, started_at) VALUES (?,?,?,?,?,?,?)`
      ).run(id, chatId, uid, calleeId, callType, 'ringing', t);
      activeCalls.set(uid, id);
      activeCalls.set(calleeId, id);

      const call = db.prepare('SELECT * FROM calls WHERE id = ?').get(id);
      const caller = getUser(uid);
      emitToUser(calleeId, 'call:incoming', { ...hydrateCall(call, calleeId), caller: publicUser(caller) });
      push.notifyIncomingCall({ calleeId, caller, call, chatId });
      ack?.({ call: hydrateCall(call, uid) });

      // Auto-miss after 45s of no answer, same as most messengers.
      setTimeout(() => {
        const c = db.prepare('SELECT * FROM calls WHERE id = ?').get(id);
        if (c && c.status === 'ringing') endCall(id, 'missed');
      }, 45000);
    } catch (e) {
      ack?.(socketFailure(e));
    }
  });

  socket.on('call:accept', ({ callId }, ack) => {
    const call = db.prepare('SELECT * FROM calls WHERE id = ?').get(callId);
    if (!call || call.callee_id !== uid) return ack?.({ error: 'Call not found' });
    if (call.status !== 'ringing') return ack?.({ error: 'Call is no longer ringing' });
    db.prepare('UPDATE calls SET status = ?, answered_at = ? WHERE id = ?').run('ongoing', now(), callId);
    const fresh = db.prepare('SELECT * FROM calls WHERE id = ?').get(callId);
    emitToUser(call.caller_id, 'call:accepted', hydrateCall(fresh, call.caller_id));
    ack?.({ call: hydrateCall(fresh, uid) });
  });

  socket.on('call:decline', ({ callId }) => {
    const call = db.prepare('SELECT * FROM calls WHERE id = ?').get(callId);
    if (!call || call.callee_id !== uid) return;
    endCall(callId, 'declined');
  });

  socket.on('call:hangup', ({ callId }) => {
    const call = db.prepare('SELECT * FROM calls WHERE id = ?').get(callId);
    if (!call || (call.caller_id !== uid && call.callee_id !== uid)) return;
    endCall(callId, 'hangup');
  });

  // WebRTC SDP offer/answer + ICE candidate relay — the server never
  // inspects the payload, it's purely a signaling relay between the two
  // participants; the actual audio/video is peer-to-peer once connected.
  ['call:offer', 'call:answer', 'call:ice-candidate'].forEach((ev) => {
    socket.on(ev, ({ callId, ...payload }) => {
      const call = db.prepare('SELECT * FROM calls WHERE id = ?').get(callId);
      if (!call) return;
      const otherId = call.caller_id === uid ? call.callee_id : call.caller_id;
      if (otherId !== uid) emitToUser(otherId, ev, { callId, ...payload });
    });
  });

  socket.on('disconnect', () => {
    const set = sockets.get(uid);
    if (set) {
      set.delete(socket.id);
      if (!set.size) {
        sockets.delete(uid);
        db.prepare('UPDATE users SET is_online = 0, last_seen = ? WHERE id = ?').run(now(), uid);
        io.emit('presence', { userId: uid, isOnline: false, lastSeen: now() });
        // Hang up any in-progress call for a user whose last tab just closed —
        // otherwise the other side rings/talks into a call that's already gone.
        const callId = activeCalls.get(uid);
        if (callId) endCall(callId, 'hangup');
      }
    }
  });
});

/* ------------------------------------------------------------------ */
/* disappearing messages — sweep for expired messages every 15s         */
/* ------------------------------------------------------------------ */

setInterval(() => {
  try {
    const expired = db
      .prepare('SELECT id, chat_id, poll_id FROM messages WHERE expires_at IS NOT NULL AND expires_at <= ?')
      .all(now());
    if (!expired.length) return;
    const byChat = {};
    expired.forEach(({ id, chat_id, poll_id }) => {
      if (poll_id) db.prepare('DELETE FROM polls WHERE id = ?').run(poll_id); // cascades poll_votes
      (byChat[chat_id] ||= []).push(id);
    });
    expired.forEach(({ id }) => hardDeleteMessage(id));
    Object.entries(byChat).forEach(([chatId, ids]) => {
      emitToChat(chatId, 'message:expired', { chatId, messageIds: ids });
      emitToChat(chatId, 'chat:updated', (viewer) => chatSummary(chatId, viewer));
    });
  } catch (e) {
    console.error('[disappear sweep]', e.message);
  }
}, 15000);

/* ------------------------------------------------------------------ */
/* automatic safety backups — no data loss on updates/redeploys         */
/* ------------------------------------------------------------------ */

const { backupNow, BACKUP_DIR } = require('./backup');
console.log(`[backup] automatic backups enabled → ${BACKUP_DIR} (every 6h + on shutdown)`);

// Every 6 hours.
setInterval(() => {
  backupNow().catch((e) => console.error('[backup]', e.message));
}, 6 * 3600 * 1000);

// On graceful shutdown (SIGTERM = redeploy/stop, SIGINT = Ctrl+C): take a
// final backup before exiting so the latest state is always on disk.
let shuttingDown = false;
function shutdownWithBackup(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[shutdown] ${signal} received — backing up before exit…`);
  (async () => {
    try {
      await backupNow();
    } catch (e) {
      console.error('[backup]', e.message);
    } finally {
      process.exit(0);
    }
  })();
}
process.on('SIGTERM', () => shutdownWithBackup('SIGTERM'));
process.on('SIGINT', () => shutdownWithBackup('SIGINT'));

/* ------------------------------------------------------------------ */
/* single-host mode: serve the built web app from this same server      */
/* ------------------------------------------------------------------ */

// `npm run build` exports the Expo web bundle to server/public
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

if (fs.existsSync(path.join(PUBLIC_DIR, 'index.html'))) {
  // hashed assets are immutable -> cache hard; index.html must never be cached
  app.use(
    express.static(PUBLIC_DIR, {
      setHeaders: (res, filePath) => {
        if (filePath.includes(`${path.sep}_expo${path.sep}`)) {
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        } else if (filePath.endsWith('index.html')) {
          res.setHeader('Cache-Control', 'no-cache');
        }
      },
    })
  );

  // SPA fallback for client-side routes — must not swallow API/socket/uploads
  app.get(/^(?!\/(api|uploads|socket\.io)\/).*/, (req, res, next) => {
    if (req.method !== 'GET') return next();
    res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
  });

  console.log('Serving web app from', PUBLIC_DIR);
} else {
  app.get('/', (req, res) =>
    res.json({
      name: '+one API',
      status: 'ok',
      hint: 'No web build found. Run `npm run build` to serve the app from this server.',
    })
  );
}

const PORT = process.env.PORT || 4000;
server.listen(PORT, '0.0.0.0', async () => {
  console.log(`+one server listening on http://0.0.0.0:${PORT}`);
  console.log(`[storage] ${storage.describe()}`);
  await storage.ensureBucket();
});

