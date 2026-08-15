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

const nano = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 16);
const now = () => Date.now();

const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '25mb' }));

const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
app.use('/uploads', express.static(UPLOAD_DIR));

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename: (req, file, cb) => cb(null, nano() + path.extname(file.originalname || '.bin')),
  }),
  limits: { fileSize: 25 * 1024 * 1024 },
});

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

const publicUser = (u) =>
  u && {
    id: u.id,
    phone: u.phone,
    name: u.name,
    about: u.about,
    avatar: u.avatar,
    lastSeen: u.last_seen,
    isOnline: !!u.is_online,
  };

const getUser = (id) => db.prepare('SELECT * FROM users WHERE id = ?').get(id);

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

app.post('/api/auth/register', (req, res) => {
  const { phone, name, password } = req.body || {};
  if (!phone || !name || !password) return res.status(400).json({ error: 'phone, name and password are required' });
  if (String(password).length < 4) return res.status(400).json({ error: 'Password must be at least 4 characters' });

  const exists = db.prepare('SELECT id FROM users WHERE phone = ?').get(phone);
  if (exists) return res.status(409).json({ error: 'That phone number is already registered' });

  const user = {
    id: nano(),
    phone: String(phone).trim(),
    name: String(name).trim(),
    about: 'Hey there! I am using BROSKIE.',
    avatar: null,
    password_hash: bcrypt.hashSync(String(password), 8),
    last_seen: now(),
    is_online: 0,
    created_at: now(),
  };
  db.prepare(
    `INSERT INTO users (id, phone, name, about, avatar, password_hash, last_seen, is_online, created_at)
     VALUES (@id, @phone, @name, @about, @avatar, @password_hash, @last_seen, @is_online, @created_at)`
  ).run(user);

  res.json({ token: sign(user), user: publicUser(user) });
});

app.post('/api/auth/login', (req, res) => {
  const { phone, password } = req.body || {};
  const user = db.prepare('SELECT * FROM users WHERE phone = ?').get(String(phone || '').trim());
  if (!user || !bcrypt.compareSync(String(password || ''), user.password_hash))
    return res.status(401).json({ error: 'Invalid phone number or password' });
  res.json({ token: sign(user), user: publicUser(user) });
});

app.get('/api/me', requireAuth, (req, res) => res.json({ user: publicUser(getUser(req.userId)) }));

app.patch('/api/me', requireAuth, (req, res) => {
  const { name, about, avatar } = req.body || {};
  const u = getUser(req.userId);
  db.prepare('UPDATE users SET name = ?, about = ?, avatar = ? WHERE id = ?').run(
    name ?? u.name,
    about ?? u.about,
    avatar ?? u.avatar,
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
    ? all.filter((u) => u.name.toLowerCase().includes(q) || u.phone.includes(q))
    : all;
  res.json({ users: filtered.map(publicUser) });
});

/* ------------------------------------------------------------------ */
/* uploads                                                             */
/* ------------------------------------------------------------------ */

app.post('/api/upload', requireAuth, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  res.json({ url: `/uploads/${req.file.filename}` });
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

app.get('/api/status', requireAuth, (req, res) => {
  db.prepare('DELETE FROM statuses WHERE expires_at < ?').run(now());
  const rows = db.prepare('SELECT * FROM statuses ORDER BY created_at ASC').all();
  const byUser = {};
  rows.forEach((s) => {
    (byUser[s.user_id] ||= []).push({
      id: s.id, type: s.type, body: s.body, mediaUrl: s.media_url, bg: s.bg,
      createdAt: s.created_at,
      viewed: !!db.prepare('SELECT 1 FROM status_views WHERE status_id = ? AND user_id = ?').get(s.id, req.userId),
    });
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
  const { type = 'text', body = '', mediaUrl = null, bg = '#075E54' } = req.body || {};
  const s = { id: nano(), user_id: req.userId, type, body, media_url: mediaUrl, bg, created_at: now(), expires_at: now() + 24 * 3600 * 1000 };
  db.prepare(
    `INSERT INTO statuses (id, user_id, type, body, media_url, bg, created_at, expires_at)
     VALUES (@id, @user_id, @type, @body, @media_url, @bg, @created_at, @expires_at)`
  ).run(s);
  io.emit('status:new', { userId: req.userId });
  res.json({ ok: true });
});

app.post('/api/status/:id/view', requireAuth, (req, res) => {
  db.prepare('INSERT OR IGNORE INTO status_views (status_id, user_id, at) VALUES (?,?,?)').run(req.params.id, req.userId, now());
  res.json({ ok: true });
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
      name: 'BROSKIE API',
      status: 'ok',
      hint: 'No web build found. Run `npm run build` to serve the app from this server.',
    })
  );
}

const PORT = process.env.PORT || 4000;
server.listen(PORT, '0.0.0.0', () => console.log(`BROSKIE server listening on http://0.0.0.0:${PORT}`));
