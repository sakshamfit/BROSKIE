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
const spotify = require('./spotify');

const nano = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 16);
const now = () => Date.now();

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
    replyTo,
    status,
    reactions: reactions.map((r) => ({ userId: r.user_id, emoji: r.emoji })),
  };
}

function chatSummary(chatId, viewerId) {
  const chat = db.prepare('SELECT * FROM chats WHERE id = ?').get(chatId);
  if (!chat) return null;
  const members = db
    .prepare(
      `SELECT u.*, cm.role, cm.muted FROM chat_members cm
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

  return {
    id: chat.id,
    type: chat.type,
    name: chat.type === 'group' ? chat.name : other ? other.name : 'Unknown',
    username: chat.type === 'direct' && other ? other.username : null,
    avatar: chat.type === 'group' ? chat.avatar : other ? other.avatar : null,
    about: other ? other.about : null,
    otherUserId: other ? other.id : null,
    isOnline: other ? !!other.is_online : false,
    lastSeen: other ? other.last_seen : 0,
    muted: me ? !!me.muted : false,
    archived,
    role: me ? me.role : 'member',
    members: members.map((m) => ({ ...publicUser(m), role: m.role })),
    lastMessage: last ? hydrateMessage(last, viewerId) : null,
    unread,
    updatedAt: chat.updated_at,
  };
}

/** Everyone who shares a chat (direct or group) with this user — the "contacts" audience. */
function contactIds(userId) {
  const rows = db
    .prepare(
      `SELECT DISTINCT cm2.user_id FROM chat_members cm1
       JOIN chat_members cm2 ON cm2.chat_id = cm1.chat_id AND cm2.user_id != cm1.user_id
       WHERE cm1.user_id = ?`
    )
    .all(userId);
  return rows.map((r) => r.user_id);
}

function userChats(userId) {
  const rows = db
    .prepare(
      `SELECT c.id FROM chats c
       JOIN chat_members cm ON cm.chat_id = c.id
       WHERE cm.user_id = ? ORDER BY c.updated_at DESC`
    )
    .all(userId);
  return rows.map((r) => chatSummary(r.id, userId)).filter(Boolean);
}

/* ------------------------------------------------------------------ */
/* auth routes                                                         */
/* ------------------------------------------------------------------ */

app.get('/api/health', (req, res) => res.json({ ok: true, time: now() }));

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
  if (String(password).length < 4) return res.status(400).json({ error: 'Password must be at least 4 characters' });

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
    about: 'Hey there! I am using 友達.',
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

  res.json({ token: sign(user), user: publicUser(user) });
});

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body || {};
  const user = getUserByUsername(username);
  if (!user || !bcrypt.compareSync(String(password || ''), user.password_hash))
    return res.status(401).json({ error: 'Invalid username or password' });
  res.json({ token: sign(user), user: publicUser(user) });
});

app.get('/api/me', requireAuth, (req, res) => res.json({ user: publicUser(getUser(req.userId)) }));

app.patch('/api/me', requireAuth, (req, res) => {
  const { name, about, avatar, username } = req.body || {};
  const u = getUser(req.userId);

  let nextUsername = u.username;
  if (username !== undefined && normalizeUsername(username) !== u.username) {
    const err = validateUsername(username);
    if (err) return res.status(400).json({ error: err });
    const taken = getUserByUsername(username);
    if (taken && taken.id !== req.userId) return res.status(409).json({ error: 'That username is already taken' });
    nextUsername = normalizeUsername(username);
  }

  db.prepare('UPDATE users SET name = ?, about = ?, avatar = ?, username = ? WHERE id = ?').run(
    name ?? u.name,
    about ?? u.about,
    avatar ?? u.avatar,
    nextUsername,
    req.userId
  );
  const updated = publicUser(getUser(req.userId));
  io.emit('user:updated', updated);
  res.json({ user: updated });
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
  res.json({ users: filtered.map(publicUser) });
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
  const rows = db
    .prepare(
      `SELECT m.* FROM messages m
       JOIN chat_members cm ON cm.chat_id = m.chat_id AND cm.user_id = ?
       WHERE m.deleted = 0 AND m.body LIKE ? ORDER BY m.created_at DESC LIMIT 50`
    )
    .all(req.userId, `%${q}%`);
  res.json({
    messages: rows.map((m) => ({
      ...hydrateMessage(m, req.userId),
      chatName: chatSummary(m.chat_id, req.userId)?.name,
    })),
  });
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

/* ------------------------------------------------------------------ */
/* status / stories                                                    */
/* ------------------------------------------------------------------ */

/** Can `viewerId` see a status posted by `authorId` with the given audience? */
function canViewStatus(statusId, authorId, audience, viewerId) {
  if (authorId === viewerId) return true;
  if (audience === 'public') return true;
  if (audience === 'contacts') return contactIds(authorId).includes(viewerId);
  if (audience === 'selected') {
    return !!db.prepare('SELECT 1 FROM status_recipients WHERE status_id = ? AND user_id = ?').get(statusId, viewerId);
  }
  return false;
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

  // Only notify sockets that are allowed to see it.
  const targets = aud === 'public'
    ? [...sockets.keys()]
    : aud === 'contacts'
      ? contactIds(req.userId)
      : recipientIds;
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

/** Song search for status composer — proxies Spotify's Client Credentials API. */
app.get('/api/spotify/search', requireAuth, async (req, res) => {
  if (!spotify.isConfigured()) return res.json({ tracks: [], configured: false });
  const q = String(req.query.q || '').trim();
  if (!q) return res.json({ tracks: [], configured: true });
  try {
    const tracks = await spotify.searchTracks(q);
    res.json({ tracks, configured: true });
  } catch (e) {
    console.error('[spotify]', e.message);
    // Surface a 200 with an explanatory message instead of a hard error —
    // song attachment is optional, the rest of the status composer must
    // keep working even if Spotify's API rejects this app/account.
    res.json({ tracks: [], configured: true, error: e.message });
  }
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
    tag: row.tag,
    createdAt: row.created_at,
    likes,
    comments,
    liked,
    mine: row.user_id === viewerId,
  };
}

/** GET /api/posts?before=<ts>&limit=20&tag=process&userId=… */
app.get('/api/posts', requireAuth, (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 20, 50);
  const before = Number(req.query.before) || Date.now() + 1;
  const { tag, userId } = req.query;

  let sql = 'SELECT * FROM posts WHERE deleted = 0 AND created_at < ?';
  const params = [before];
  if (tag) { sql += ' AND tag = ?'; params.push(String(tag).replace(/^#/, '')); }
  if (userId) { sql += ' AND user_id = ?'; params.push(userId); }
  sql += ' ORDER BY created_at DESC LIMIT ?';
  params.push(limit);

  const rows = db.prepare(sql).all(...params);
  res.json({
    posts: rows.map((r) => hydratePost(r, req.userId)),
    nextBefore: rows.length === limit ? rows[rows.length - 1].created_at : null,
  });
});

app.post('/api/posts', requireAuth, (req, res) => {
  const { body = '', title = '', mediaUrl = null, tag = null } = req.body || {};
  const text = String(body).trim();
  if (!text && !mediaUrl) return res.status(400).json({ error: 'Write something or attach an image' });
  if (text.length > 2000) return res.status(400).json({ error: 'Post is too long (2000 characters max)' });

  const post = {
    id: nano(),
    user_id: req.userId,
    title: String(title).trim().slice(0, 120),
    body: text.slice(0, 2000),
    media_url: mediaUrl,
    tag: tag ? String(tag).replace(/^#/, '').toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 24) || null : null,
    created_at: now(),
  };
  db.prepare(
    `INSERT INTO posts (id, user_id, title, body, media_url, tag, created_at)
     VALUES (@id, @user_id, @title, @body, @media_url, @tag, @created_at)`
  ).run(post);

  const row = db.prepare('SELECT * FROM posts WHERE id = ?').get(post.id);
  // everyone online sees new posts appear live
  io.emit('post:new', hydratePost(row, null));
  res.json({ post: hydratePost(row, req.userId) });
});

app.delete('/api/posts/:id', requireAuth, (req, res) => {
  const row = db.prepare('SELECT * FROM posts WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Post not found' });
  if (row.user_id !== req.userId) return res.status(403).json({ error: 'Not your post' });
  db.prepare('UPDATE posts SET deleted = 1 WHERE id = ?').run(req.params.id);
  io.emit('post:deleted', { id: req.params.id });
  res.json({ ok: true });
});

app.post('/api/posts/:id/like', requireAuth, (req, res) => {
  const row = db.prepare('SELECT * FROM posts WHERE id = ? AND deleted = 0').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Post not found' });

  const existing = db.prepare('SELECT 1 FROM post_likes WHERE post_id = ? AND user_id = ?').get(row.id, req.userId);
  if (existing) db.prepare('DELETE FROM post_likes WHERE post_id = ? AND user_id = ?').run(row.id, req.userId);
  else db.prepare('INSERT INTO post_likes (post_id, user_id, at) VALUES (?,?,?)').run(row.id, req.userId, now());

  const likes = db.prepare('SELECT COUNT(*) c FROM post_likes WHERE post_id = ?').get(row.id).c;
  io.emit('post:likes', { id: row.id, likes });
  res.json({ liked: !existing, likes });
});

app.get('/api/posts/:id/comments', requireAuth, (req, res) => {
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
  if (!post) return res.status(404).json({ error: 'Post not found' });
  const text = String(req.body?.body || '').trim();
  if (!text) return res.status(400).json({ error: 'Comment cannot be empty' });

  const c = { id: nano(), post_id: post.id, user_id: req.userId, body: text.slice(0, 600), created_at: now() };
  db.prepare('INSERT INTO post_comments (id, post_id, user_id, body, created_at) VALUES (@id,@post_id,@user_id,@body,@created_at)').run(c);

  const count = db.prepare('SELECT COUNT(*) c FROM post_comments WHERE post_id = ?').get(post.id).c;
  io.emit('post:comments', { id: post.id, comments: count });

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
/* socket.io realtime                                                  */
/* ------------------------------------------------------------------ */

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' }, maxHttpBufferSize: 3e7 });

const sockets = new Map(); // userId -> Set<socketId>

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
      const { chatId, type = 'text', body = '', mediaUrl = null, duration = 0, replyTo = null, tempId } = data || {};
      const isMember = db.prepare('SELECT 1 FROM chat_members WHERE chat_id = ? AND user_id = ?').get(chatId, uid);
      if (!isMember) return ack?.({ error: 'Not a member' });

      const msg = {
        id: nano(), chat_id: chatId, sender_id: uid, type,
        body: String(body).slice(0, 5000), media_url: mediaUrl,
        duration: Number(duration) || 0, reply_to: replyTo, created_at: now(),
      };
      db.prepare(
        `INSERT INTO messages (id, chat_id, sender_id, type, body, media_url, duration, reply_to, created_at)
         VALUES (@id, @chat_id, @sender_id, @type, @body, @media_url, @duration, @reply_to, @created_at)`
      ).run(msg);
      db.prepare('UPDATE chats SET updated_at = ? WHERE id = ?').run(msg.created_at, chatId);

      // online members get instant delivered receipt
      memberIds(chatId).filter((x) => x !== uid && sockets.has(x)).forEach((x) => {
        db.prepare('INSERT OR IGNORE INTO receipts (message_id, user_id, state, at) VALUES (?,?,?,?)').run(msg.id, x, 'delivered', now());
      });

      const row = db.prepare('SELECT * FROM messages WHERE id = ?').get(msg.id);
      emitToChat(chatId, 'message:new', (viewer) => ({ message: hydrateMessage(row, viewer), tempId: viewer === uid ? tempId : undefined }));
      emitToChat(chatId, 'chat:updated', (viewer) => chatSummary(chatId, viewer));
      ack?.({ message: hydrateMessage(row, uid), tempId });
    } catch (e) {
      ack?.({ error: e.message });
    }
  });

  socket.on('message:read', ({ chatId }) => {
    const rows = db
      .prepare(
        `SELECT * FROM messages WHERE chat_id = ? AND sender_id != ?
         AND NOT EXISTS (SELECT 1 FROM receipts r WHERE r.message_id = messages.id AND r.user_id = ? AND r.state='read')`
      )
      .all(chatId, uid, uid);
    rows.forEach((m) => {
      db.prepare('INSERT OR IGNORE INTO receipts (message_id, user_id, state, at) VALUES (?,?,?,?)').run(m.id, uid, 'delivered', now());
      db.prepare('INSERT OR IGNORE INTO receipts (message_id, user_id, state, at) VALUES (?,?,?,?)').run(m.id, uid, 'read', now());
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
    const fresh = db.prepare('SELECT * FROM messages WHERE id = ?').get(messageId);
    emitToChat(m.chat_id, 'message:updated', (viewer) => hydrateMessage(fresh, viewer));
    emitToChat(m.chat_id, 'chat:updated', (viewer) => chatSummary(m.chat_id, viewer));
  });

  socket.on('disconnect', () => {
    const set = sockets.get(uid);
    if (set) {
      set.delete(socket.id);
      if (!set.size) {
        sockets.delete(uid);
        db.prepare('UPDATE users SET is_online = 0, last_seen = ? WHERE id = ?').run(now(), uid);
        io.emit('presence', { userId: uid, isOnline: false, lastSeen: now() });
      }
    }
  });
});

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
      name: '友達 API',
      status: 'ok',
      hint: 'No web build found. Run `npm run build` to serve the app from this server.',
    })
  );
}

const PORT = process.env.PORT || 4000;
server.listen(PORT, '0.0.0.0', async () => {
  console.log(`友達 server listening on http://0.0.0.0:${PORT}`);
  console.log(`[storage] ${storage.describe()}`);
  await storage.ensureBucket();
});
