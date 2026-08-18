require('dotenv').config();
const express = require('express');
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

const nano = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 16);
const now = () => Date.now();


// Production password policy: long enough to resist trivial guessing and
// diverse enough that a short numeric or dictionary password cannot pass.
const PASSWORD_RULE = 'Password must be at least 8 characters and include uppercase, lowercase, a number, and a special character.';
function passwordError(value) {
  const password = String(value || '');
  if (password.length < 8) return PASSWORD_RULE;
  if (!/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/[0-9]/.test(password) || !/[^A-Za-z0-9\s]/.test(password)) return PASSWORD_RULE;
  return null;
}

const app = express();
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
    status: true,          // someone posted to See
    network: true,         // new Network posts from people you follow-ish (public feed)
    communityActivity: true, // join requests / approvals / added-to-community
    sound: true,
  },
  privacy: {
    lastSeen: 'everyone',   // everyone | contacts | nobody — who sees your last-seen/online dot
    readReceipts: true,     // off = you don't send blue ticks AND you don't see others' either (mirrors WhatsApp)
  },
};

function sanitizeSettings(input, base = DEFAULT_SETTINGS) {
  const out = { notifications: { ...base.notifications }, privacy: { ...base.privacy } };
  if (input && typeof input === 'object') {
    if (input.notifications && typeof input.notifications === 'object') {
      Object.keys(DEFAULT_SETTINGS.notifications).forEach((k) => {
        if (typeof input.notifications[k] === 'boolean') out.notifications[k] = input.notifications[k];
      });
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

function areContacts(idA, idB) {
  const [userA, userB] = [idA, idB].sort();
  const colleagues = !!db
    .prepare('SELECT 1 FROM colleague_connections WHERE user_a = ? AND user_b = ?')
    .get(userA, userB);
  if (colleagues) return true;
  return !!db
    .prepare(
      `SELECT 1 FROM chat_members a JOIN chat_members b ON a.chat_id = b.chat_id
       WHERE a.user_id = ? AND b.user_id = ? LIMIT 1`
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
  };

const USERNAME_RE = /^[a-z0-9](?:[a-z0-9._]{1,22})[a-z0-9]$/;

function normalizeUsername(raw) {
  return String(raw || '').trim().toLowerCase();
}

function validateUsername(raw) {
  const u = normalizeUsername(raw);
  if (!u) return 'Username is required';
  if (u.length < 3 || u.length > 24) return 'Username must be 3–24 characters';
  if (!USERNAME_RE.test(u)) {
    return 'Username can only contain letters, numbers, "." and "_", and must start/end with a letter or number';
  }
  if (/[._]{2,}/.test(u)) return 'Username cannot have consecutive "." or "_"';
  return null;
}

const getUser = (id) => db.prepare('SELECT * FROM users WHERE id = ?').get(id);
const getUserByUsername = (username) =>
  db.prepare('SELECT * FROM users WHERE username = ?').get(normalizeUsername(username));

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
  return u ? { ...publicUser(u), settings: getSettings(u), affiliations: affiliationsForUser(u.id) } : null;
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

function hydrateMessage(m, viewerId) {
  if (!m) return null;
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

  return {
    id: m.id,
    chatId: m.chat_id,
    senderId: m.sender_id,
    type: m.type,
    body: m.deleted ? '' : m.body,
    mediaUrl: m.deleted ? null : m.media_url,
    duration: m.duration,
    deleted: !!m.deleted,
    createdAt: m.created_at,
    expiresAt: m.expires_at || null,
    edited: !!m.edited,
    forwarded: !!m.forwarded_from,
    starred,
    poll: !m.deleted && m.type === 'poll' ? hydratePoll(m.poll_id, viewerId) : null,
    replyTo,
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
      `SELECT u.*, cm.role, cm.muted, cm.pinned_at FROM chat_members cm
       JOIN users u ON u.id = cm.user_id WHERE cm.chat_id = ?`
    )
    .all(chatId);

  const me = members.find((m) => m.id === viewerId);
  const other = chat.type === 'direct' ? members.find((m) => m.id !== viewerId) : null;

  const last = db
    .prepare('SELECT * FROM messages WHERE chat_id = ? ORDER BY created_at DESC LIMIT 1')
    .get(chatId);

  const unread = db
    .prepare(
      `SELECT COUNT(*) c FROM messages m
       WHERE m.chat_id = ? AND m.sender_id != ?
         AND NOT EXISTS (SELECT 1 FROM receipts r WHERE r.message_id = m.id AND r.user_id = ? AND r.state='read')`
    )
    .get(chatId, viewerId, viewerId).c;

  const archived = (chat.archived_by || '').split(',').filter(Boolean).includes(viewerId);
  const otherPresence = other ? presenceFor(other, viewerId) : { isOnline: false, lastSeen: 0 };

  return {
    id: chat.id,
    type: chat.type,
    name: chat.type === 'group' ? chat.name : other ? other.name : 'Unknown',
    username: chat.type === 'direct' && other ? other.username : null,
    avatar: chat.type === 'group' ? chat.avatar : other ? other.avatar : null,
    about: other ? other.about : null,
    otherUserId: other ? other.id : null,
    isOnline: otherPresence.isOnline,
    lastSeen: otherPresence.lastSeen,
    muted: me ? !!me.muted : false,
    archived,
    pinned: me ? !!me.pinned_at : false,
    disappearSeconds: chat.disappear_seconds || 0,
    role: me ? me.role : 'member',
    members: members.map((m) => ({ ...publicUser(m), role: m.role })),
    lastMessage: last ? hydrateMessage(last, viewerId) : null,
    unread,
    updatedAt: chat.updated_at,
  };
}

/** Everyone who shares a chat or has accepted a colleague connection — the "contacts" audience. */
function contactIds(userId) {
  const chatRows = db
    .prepare(
      `SELECT DISTINCT cm2.user_id FROM chat_members cm1
       JOIN chat_members cm2 ON cm2.chat_id = cm1.chat_id AND cm2.user_id != cm1.user_id
       WHERE cm1.user_id = ?`
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
       WHERE cm.user_id = ? ORDER BY c.updated_at DESC`
    )
    .all(userId);
  // Pinned chats float to the top; within each group keep recency order.
  return rows
    .map((r) => chatSummary(r.id, userId))
    .filter(Boolean)
    .sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));
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
  if (!name || !password) return res.status(400).json({ error: 'name and password are required' });
  const passwordValidationError = passwordError(password);
  if (passwordValidationError) return res.status(400).json({ error: passwordValidationError });

  const usernameErr = validateUsername(username);
  if (usernameErr) return res.status(400).json({ error: usernameErr });
  const normalizedUsername = normalizeUsername(username);

  if (getUserByUsername(normalizedUsername)) {
    return res.status(409).json({ error: 'That username is already taken' });
  }

  const trimmedPhone = phone ? String(phone).trim() : null;
  if (trimmedPhone) {
    const phoneExists = db.prepare('SELECT id FROM users WHERE phone = ?').get(trimmedPhone);
    if (phoneExists) return res.status(409).json({ error: 'That phone number is already registered' });
  }

  const user = {
    id: nano(),
    username: normalizedUsername,
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
    `INSERT INTO users (id, username, phone, name, about, avatar, password_hash, last_seen, is_online, created_at)
     VALUES (@id, @username, @phone, @name, @about, @avatar, @password_hash, @last_seen, @is_online, @created_at)`
  ).run(user);

  res.json({ token: sign(user), user: accountUser(user) });
});

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body || {};
  const user = getUserByUsername(username);
  if (!user || !bcrypt.compareSync(String(password || ''), user.password_hash))
    return res.status(401).json({ error: 'Invalid username or password' });
  res.json({ token: sign(user), user: accountUser(user) });
});

app.get('/api/me', requireAuth, (req, res) => {
  const u = getUser(req.userId);
  res.json({ user: accountUser(u) });
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
  res.json({ settings: merged });
});

app.patch('/api/me', requireAuth, (req, res) => {
  const { name, about, avatar, username, phone } = req.body || {};
  const u = getUser(req.userId);

  let nextUsername = u.username;
  if (username !== undefined && normalizeUsername(username) !== u.username) {
    const err = validateUsername(username);
    if (err) return res.status(400).json({ error: err });
    const taken = getUserByUsername(username);
    if (taken && taken.id !== req.userId) return res.status(409).json({ error: 'That username is already taken' });
    nextUsername = normalizeUsername(username);
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

  db.prepare('UPDATE users SET name = ?, about = ?, avatar = ?, username = ?, phone = ? WHERE id = ?').run(
    name ?? u.name,
    about ?? u.about,
    nextAvatar,
    nextUsername,
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
  const all = db.prepare('SELECT * FROM users WHERE id != ? ORDER BY name').all(req.userId);
  const filtered = q
    ? all.filter((u) =>
        u.name.toLowerCase().includes(q) ||
        (u.username && u.username.includes(q)) ||
        u.phone.includes(q))
    : all;
  res.json({
    users: filtered.map((u) => ({
      ...publicUser(u),
      ...presenceFor(u, req.userId),
      blocked: isBlocked(req.userId, u.id),
    })),
  });
});

/* ------------------------------------------------------------------ */
/* affiliations + colleagues                                          */
/* ------------------------------------------------------------------ */

/** Discover registered colleges/institutions, organizations and workplaces. */
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
  emitToUser(target.id, 'colleague:updated', { type: 'blocked', userId: req.userId });
  res.json({ ok: true });
});

app.delete('/api/blocked/:userId', requireAuth, (req, res) => {
  db.prepare('DELETE FROM blocked_users WHERE blocker_id = ? AND blocked_id = ?').run(req.userId, req.params.userId);
  res.json({ ok: true });
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

  if (existing) return res.json({ chat: chatSummary(existing.id, req.userId) });

  const id = nano();
  const t = now();
  db.prepare('INSERT INTO chats (id, type, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(
    id, 'direct', req.userId, t, t
  );
  const addMember = db.prepare('INSERT INTO chat_members (chat_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)');
  addMember.run(id, req.userId, 'member', t);
  addMember.run(id, userId, 'member', t);

  [req.userId, userId].forEach((uid) => emitToUser(uid, 'chat:new', chatSummary(id, uid)));
  res.json({ chat: chatSummary(id, req.userId) });
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
  if (chat.type !== 'group') return res.status(400).json({ error: 'Only group chats can be renamed here' });
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

/* ---- group admin controls ---- */

/** Promote / demote a group member (admins only). */
app.post('/api/chats/:id/group/members/:userId/role', requireAuth, (req, res) => {
  const chat = db.prepare('SELECT * FROM chats WHERE id = ?').get(req.params.id);
  if (!chat || chat.type !== 'group') return res.status(404).json({ error: 'Group not found' });
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
  if (!chat || chat.type !== 'group') return res.status(404).json({ error: 'Group not found' });
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
  memberIds(chat.id).forEach((uid) => emitToUser(uid, 'chat:updated', chatSummary(chat.id, uid)));
  res.json({ ok: true });
});

/** Leave a group (last admin must promote someone first). */
app.post('/api/chats/:id/group/leave', requireAuth, (req, res) => {
  const chat = db.prepare('SELECT * FROM chats WHERE id = ?').get(req.params.id);
  if (!chat || chat.type !== 'group') return res.status(404).json({ error: 'Group not found' });
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
  memberIds(chat.id).forEach((uid) => emitToUser(uid, 'chat:updated', chatSummary(chat.id, uid)));
  res.json({ ok: true });
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
  db.prepare('UPDATE messages SET expires_at = ? WHERE id = ?').run(expiresAt, m.id);
  const fresh = db.prepare('SELECT * FROM messages WHERE id = ?').get(m.id);
  emitToChat(m.chat_id, 'message:updated', (viewer) => hydrateMessage(fresh, viewer));
  emitToChat(m.chat_id, 'chat:updated', (viewer) => chatSummary(m.chat_id, viewer));
  res.json({ expiresAt });
});

/* ---- forwarding ---- */

/** Copy a message into one or more of the user's chats. */
app.post('/api/messages/forward', requireAuth, (req, res) => {
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
    forwarded += 1;
  });

  res.json({ ok: true, forwarded });
});

/* ------------------------------------------------------------------ */
/* messages                                                            */
/* ------------------------------------------------------------------ */

app.get('/api/chats/:id/messages', requireAuth, (req, res) => {
  const isMember = db.prepare('SELECT 1 FROM chat_members WHERE chat_id = ? AND user_id = ?').get(req.params.id, req.userId);
  if (!isMember) return res.status(403).json({ error: 'Not a member of this chat' });

  const limit = Math.min(Number(req.query.limit) || 100, 300);
  const rows = db
    .prepare('SELECT * FROM messages WHERE chat_id = ? ORDER BY created_at DESC LIMIT ?')
    .all(req.params.id, limit)
    .reverse();
  res.json({ messages: rows.map((m) => hydrateMessage(m, req.userId)) });
});

app.get('/api/search', requireAuth, (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) return res.json({ messages: [] });
  const chatId = String(req.query.chatId || '');
  // In-chat search: restrict to one chat (and verify membership).
  if (chatId) {
    const isMember = db.prepare('SELECT 1 FROM chat_members WHERE chat_id = ? AND user_id = ?').get(chatId, req.userId);
    if (!isMember) return res.status(403).json({ error: 'Not a member of this chat' });
  }
  const sql = chatId
    ? `SELECT m.* FROM messages m
       WHERE m.chat_id = ? AND m.deleted = 0 AND m.body LIKE ?
       ORDER BY m.created_at DESC LIMIT 100`
    : `SELECT m.* FROM messages m
       JOIN chat_members cm ON cm.chat_id = m.chat_id AND cm.user_id = ?
       WHERE m.deleted = 0 AND m.body LIKE ? ORDER BY m.created_at DESC LIMIT 50`;
  const rows = chatId
    ? db.prepare(sql).all(chatId, `%${q}%`)
    : db.prepare(sql).all(req.userId, `%${q}%`);
  res.json({
    messages: rows.map((m) => ({
      ...hydrateMessage(m, req.userId),
      chatName: chatSummary(m.chat_id, req.userId)?.name,
    })),
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
  db.prepare(
    `INSERT INTO messages (id, chat_id, sender_id, type, body, media_url, duration, reply_to, expires_at, edited, forwarded_from, poll_id, created_at)
     VALUES (@id, @chat_id, @sender_id, @type, @body, @media_url, @duration, @reply_to, @expires_at, @edited, @forwarded_from, @poll_id, @created_at)`
  ).run({
    ...msg,
    expires_at: msg.expires_at ?? null,
    edited: msg.edited ?? 0,
    forwarded_from: msg.forwarded_from ?? null,
    poll_id: msg.poll_id ?? null,
  });
  db.prepare('UPDATE chats SET updated_at = ? WHERE id = ?').run(msg.created_at, chatId);
  memberIds(chatId).filter((x) => x !== msg.sender_id && sockets.has(x)).forEach((x) => {
    db.prepare('INSERT OR IGNORE INTO receipts (message_id, user_id, state, at) VALUES (?,?,?,?)').run(msg.id, x, 'delivered', now());
  });
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
  else if (audience === 'contacts') ids = [...new Set([authorId, ...contactIds(authorId)])];
  else if (audience === 'selected') {
    const rows = db.prepare('SELECT user_id FROM post_recipients WHERE post_id = ?').all(postId);
    ids = [...new Set([authorId, ...rows.map((r) => r.user_id)])];
  } else ids = [authorId];
  return ids.filter((id) => id === authorId || !blockedEitherWay(authorId, id));
}

function hydrateStatus(s, viewerId) {
  return {
    id: s.id, type: s.type, body: s.body, mediaUrl: s.media_url, bg: s.bg,
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
    type = 'text', body = '', mediaUrl = null, bg = '#075E54',
    song = null, audience = 'public', recipientIds = [],
  } = req.body || {};

  const aud = ['public', 'contacts', 'selected'].includes(audience) ? audience : 'public';
  if (aud === 'selected' && !recipientIds.length) {
    return res.status(400).json({ error: 'Pick at least one person for a private status.' });
  }

  const s = {
    id: nano(), user_id: req.userId, type, body, media_url: mediaUrl, bg,
    song: song ? JSON.stringify(song) : null, audience: aud,
    created_at: now(), expires_at: now() + 24 * 3600 * 1000,
  };
  db.prepare(
    `INSERT INTO statuses (id, user_id, type, body, media_url, bg, song, audience, created_at, expires_at)
     VALUES (@id, @user_id, @type, @body, @media_url, @bg, @song, @audience, @created_at, @expires_at)`
  ).run(s);

  if (aud === 'selected') {
    const stmt = db.prepare('INSERT OR IGNORE INTO status_recipients (status_id, user_id) VALUES (?, ?)');
    recipientIds.filter((id) => getUser(id)).forEach((id) => stmt.run(s.id, id));
  }

  // Only notify sockets that are allowed to see it (and never someone
  // blocked either way, regardless of audience).
  const targets = (aud === 'public'
    ? [...sockets.keys()]
    : aud === 'contacts'
      ? contactIds(req.userId)
      : recipientIds
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
    song: row.song ? JSON.parse(row.song) : null,
    tag: row.tag,
    audience: row.audience || 'public',
    createdAt: row.created_at,
    likes,
    comments,
    liked,
    mine: row.user_id === viewerId,
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

/** GET /api/posts?before=<ts>&limit=20&tag=process&userId=… */
app.get('/api/posts', requireAuth, (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 20, 50);
  const { tag, userId } = req.query;
  let before = Number(req.query.before) || Date.now() + 1;

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
      if (visible.length < limit && canViewPost(r.id, r.user_id, r.audience || 'public', req.userId)) {
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

app.post('/api/posts', requireAuth, (req, res) => {
  const {
    body = '', title = '', mediaUrl = null, tag = null,
    song = null, audience = 'public', recipientIds = [],
  } = req.body || {};
  const text = String(body).trim();
  if (!text && !mediaUrl && !song) return res.status(400).json({ error: 'Write something, or attach a photo or a song' });
  if (text.length > 2000) return res.status(400).json({ error: 'Post is too long (2000 characters max)' });

  const aud = ['public', 'contacts', 'selected'].includes(audience) ? audience : 'public';
  if (aud === 'selected' && !recipientIds.length) {
    return res.status(400).json({ error: 'Pick at least one person for a targeted post.' });
  }

  const post = {
    id: nano(),
    user_id: req.userId,
    title: String(title).trim().slice(0, 120),
    body: text.slice(0, 2000),
    media_url: mediaUrl,
    song: song ? JSON.stringify(song) : null,
    tag: tag ? String(tag).replace(/^#/, '').toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 24) || null : null,
    audience: aud,
    created_at: now(),
  };
  db.prepare(
    `INSERT INTO posts (id, user_id, title, body, media_url, song, tag, audience, created_at)
     VALUES (@id, @user_id, @title, @body, @media_url, @song, @tag, @audience, @created_at)`
  ).run(post);

  if (aud === 'selected') {
    const stmt = db.prepare('INSERT OR IGNORE INTO post_recipients (post_id, user_id) VALUES (?, ?)');
    recipientIds.filter((id) => getUser(id)).forEach((id) => stmt.run(post.id, id));
  }

  const row = db.prepare('SELECT * FROM posts WHERE id = ?').get(post.id);

  // Only notify sockets that are allowed to see it.
  const targets = aud === 'public'
    ? [...sockets.keys()]
    : aud === 'contacts'
      ? contactIds(req.userId)
      : recipientIds;
  targets.forEach((uid) => emitToUser(uid, 'post:new', hydratePost(row, uid)));
  emitToUser(req.userId, 'post:new', hydratePost(row, req.userId));

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
  else db.prepare('INSERT INTO post_likes (post_id, user_id, at) VALUES (?,?,?)').run(row.id, req.userId, now());

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

  const c = { id: nano(), post_id: post.id, user_id: req.userId, body: text.slice(0, 600), created_at: now() };
  db.prepare('INSERT INTO post_comments (id, post_id, user_id, body, created_at) VALUES (@id,@post_id,@user_id,@body,@created_at)').run(c);

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
    `INSERT INTO communities (id, name, description, category, avatar, chat_id, created_by, join_policy, visibility, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`
  ).run(id, trimmedName, String(description || '').trim(), category, avatar || null, chatId, req.userId, joinPolicy, visibility, t, t);
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
    db.prepare('SELECT user_id FROM community_members WHERE community_id = ? AND role = ?').all(row.id, 'admin')
      .forEach((a) => emitToUser(a.user_id, 'community:request', { communityId: row.id, user: publicUser(requester) }));
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
/* socket.io realtime                                                  */
/* ------------------------------------------------------------------ */

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' }, maxHttpBufferSize: 3e7 });

const sockets = new Map(); // userId -> Set<socketId>
const activeCalls = new Map(); // userId -> callId, for busy-detection and cleanup on disconnect

function emitToUser(userId, event, payload) {
  const set = sockets.get(userId);
  if (!set) return;
  set.forEach((sid) => io.to(sid).emit(event, payload));
}

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
      const { chatId, type = 'text', body = '', mediaUrl = null, duration = 0, replyTo = null, tempId, pollId = null, disappearAt = null } = data || {};
      const isMember = db.prepare('SELECT 1 FROM chat_members WHERE chat_id = ? AND user_id = ?').get(chatId, uid);
      if (!isMember) return ack?.({ error: 'Not a member' });

      // Blocking is enforced here (not just at chat-creation time) so it
      // also stops messages in an already-existing direct chat.
      const chat = db.prepare('SELECT * FROM chats WHERE id = ?').get(chatId);
      if (chat && chat.type === 'direct') {
        const otherId = memberIds(chatId).find((x) => x !== uid);
        if (otherId && blockedEitherWay(uid, otherId)) return ack?.({ error: "You can't message this person" });
      }

      // Disappearing messages: per-message override wins, otherwise the
      // chat's default timer applies. Both are clamped to known presets.
      let expiresAt = null;
      if (disappearAt && Number(disappearAt) > now()) expiresAt = Number(disappearAt);
      else if (chat.disappear_seconds) expiresAt = now() + chat.disappear_seconds * 1000;

      const msg = {
        id: nano(), chat_id: chatId, sender_id: uid, type,
        body: String(body).slice(0, 5000), media_url: mediaUrl,
        duration: Number(duration) || 0, reply_to: replyTo,
        expires_at: expiresAt, edited: 0, forwarded_from: null, poll_id: pollId,
        created_at: now(),
      };
      persistMessage(msg, chatId);

      const row = db.prepare('SELECT * FROM messages WHERE id = ?').get(msg.id);
      emitToChat(chatId, 'message:new', (viewer) => ({ message: hydrateMessage(row, viewer), tempId: viewer === uid ? tempId : undefined }));
      emitToChat(chatId, 'chat:updated', (viewer) => chatSummary(chatId, viewer));
      ack?.({ message: hydrateMessage(row, uid), tempId });
    } catch (e) {
      ack?.({ error: e.message });
    }
  });

  socket.on('message:edit', ({ messageId, body }, ack) => {
    try {
      const m = db.prepare('SELECT * FROM messages WHERE id = ?').get(messageId);
      if (!m || m.deleted) return ack?.({ error: 'Message not found' });
      if (m.sender_id !== uid) return ack?.({ error: "You can only edit your own messages" });
      if (m.type !== 'text') return ack?.({ error: 'Only text messages can be edited' });
      const text = String(body || '').trim();
      if (!text) return ack?.({ error: 'Message cannot be empty' });
      db.prepare('UPDATE messages SET body = ?, edited = 1 WHERE id = ?').run(text.slice(0, 5000), messageId);
      const fresh = db.prepare('SELECT * FROM messages WHERE id = ?').get(messageId);
      emitToChat(m.chat_id, 'message:updated', (viewer) => hydrateMessage(fresh, viewer));
      emitToChat(m.chat_id, 'chat:updated', (viewer) => chatSummary(m.chat_id, viewer));
      ack?.({ message: hydrateMessage(fresh, uid) });
    } catch (e) {
      ack?.({ error: e.message });
    }
  });

  socket.on('poll:create', (data, ack) => {
    try {
      const { chatId, question, options = [] } = data || {};
      const isMember = db.prepare('SELECT 1 FROM chat_members WHERE chat_id = ? AND user_id = ?').get(chatId, uid);
      if (!isMember) return ack?.({ error: 'Not a member' });
      const chat = db.prepare('SELECT * FROM chats WHERE id = ?').get(chatId);
      if (!chat || chat.type !== 'group') return ack?.({ error: 'Polls are only available in group chats' });
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
      ack?.({ message: hydrateMessage(row, uid) });
    } catch (e) {
      ack?.({ error: e.message });
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
      ack?.({ error: e.message });
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
        emitToChat(chatId, 'message:updated', (viewer) => hydrateMessage(fresh, viewer));
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

  socket.on('message:react', ({ messageId, emoji }) => {
    const m = db.prepare('SELECT * FROM messages WHERE id = ?').get(messageId);
    if (!m) return;
    const existing = db.prepare('SELECT emoji FROM reactions WHERE message_id = ? AND user_id = ?').get(messageId, uid);
    if (existing && existing.emoji === emoji) db.prepare('DELETE FROM reactions WHERE message_id = ? AND user_id = ?').run(messageId, uid);
    else db.prepare('INSERT OR REPLACE INTO reactions (message_id, user_id, emoji) VALUES (?,?,?)').run(messageId, uid, emoji);
    emitToChat(m.chat_id, 'message:updated', (viewer) => hydrateMessage(m, viewer));
  });

  socket.on('message:delete', ({ messageId }) => {
    const m = db.prepare('SELECT * FROM messages WHERE id = ?').get(messageId);
    if (!m || m.sender_id !== uid) return;
    db.prepare('UPDATE messages SET deleted = 1 WHERE id = ?').run(messageId);
    // A poll "deleted for everyone" takes its votes with it.
    if (m.type === 'poll' && m.poll_id) db.prepare('DELETE FROM polls WHERE id = ?').run(m.poll_id);
    const fresh = db.prepare('SELECT * FROM messages WHERE id = ?').get(messageId);
    emitToChat(m.chat_id, 'message:updated', (viewer) => hydrateMessage(fresh, viewer));
    emitToChat(m.chat_id, 'chat:updated', (viewer) => chatSummary(m.chat_id, viewer));
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
      ack?.({ call: hydrateCall(call, uid) });

      // Auto-miss after 45s of no answer, same as most messengers.
      setTimeout(() => {
        const c = db.prepare('SELECT * FROM calls WHERE id = ?').get(id);
        if (c && c.status === 'ringing') endCall(id, 'missed');
      }, 45000);
    } catch (e) {
      ack?.({ error: e.message });
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
  backupNow()
    .catch((e) => console.error('[backup]', e.message))
    .finally(() => process.exit(0));
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
