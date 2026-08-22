/**
 * Tiny in-memory stand-in for the +one backend.
 *
 * The real server needs a native SQLite build that this environment cannot
 * compile, but the UI only needs *shapes*: a user, some chats, some posts.
 * This serves exactly enough of the API for the app to boot logged in so
 * the headless smoke test can exercise the feed, the chat list, sheets and
 * the tab bar — the surfaces the motion work actually touches.
 *
 * Not used by the app in development or production.
 */
const http = require('http');

const now = Date.now();
const me = {
  id: 'u1', username: 'ada', name: 'Ada Lovelace', phone: '', avatar: null,
  about: 'Testing motion', goldTick: true, settings: {},
};
const other = { id: 'u2', username: 'grace', name: 'Grace Hopper', avatar: null };

const post = (i) => ({
  id: `p${i}`,
  author: i % 2 ? other : me,
  title: i === 0 ? 'First light' : '',
  body: `Post number ${i} — checking how the feed feels while it moves.`,
  createdAt: now - i * 3600_000,
  likes: i * 3,
  liked: i % 3 === 0,
  comments: i,
  mine: i % 2 === 0,
  following: i % 2 === 1,
  audience: 'public',
  tag: i % 2 ? 'motion' : null,
  mediaUrl: null,
  song: null,
});

const chat = (i) => ({
  id: `c${i}`,
  type: 'direct',
  name: i % 2 ? 'Grace Hopper' : 'Katherine Johnson',
  avatar: null,
  otherUserId: i % 2 ? 'u2' : 'u3',
  members: [me, other],
  unread: i === 1 ? 3 : 0,
  pinned: i === 0,
  muted: false,
  archived: false,
  updatedAt: now - i * 600_000,
  lastMessage: {
    id: `m${i}`, chatId: `c${i}`, senderId: i % 2 ? 'u2' : 'u1',
    body: 'How does this transition feel now?', type: 'text',
    createdAt: now - i * 600_000, status: 'read',
  },
});

const messages = (chatId) => [0, 1, 2].map((i) => ({
  id: `${chatId}-m${i}`,
  chatId,
  senderId: i % 2 ? 'u2' : 'u1',
  body: i === 1 ? 'Try long-pressing this bubble.' : `Message ${i} in ${chatId}.`,
  type: 'text',
  conversationType: chatId.startsWith('gc') ? 'gc' : 'direct',
  gcId: chatId.startsWith('gc') ? chatId : null,
  createdAt: now - (3 - i) * 60_000,
  status: 'read',
  reactions: [],
  starred: false,
  deleted: false,
}));

/** A GC chat summary — same shape as /api/gc returns, type 'gc'. */
const gcChat = (i) => ({
  id: `gc${i}`,
  type: 'gc',
  name: i === 0 ? 'Gaming Hub' : 'College Friends',
  avatar: null,
  role: 'member',
  members: [me, other, { id: 'u3', username: 'katherine', name: 'Katherine Johnson', avatar: null, role: 'member' }],
  unread: i === 0 ? 2 : 0,
  pinned: false,
  muted: false,
  archived: false,
  updatedAt: now - i * 300_000,
  gc: { description: i === 0 ? 'Everyone plays here' : 'College squad', privacy: 'open', requestCount: 0 },
  lastMessage: {
    id: `gc${i}-last`, chatId: `gc${i}`, senderId: 'u2', type: 'text',
    body: i === 0 ? 'Anyone up for a match tonight?' : 'See you all at the canteen',
    conversationType: 'gc', gcId: `gc${i}`,
    createdAt: now - i * 300_000, status: 'read',
  },
});

const gcMessages = (gcId) => [0, 1, 2].map((i) => ({
  id: `${gcId}-gm${i}`,
  chatId: gcId,
  gcId,
  conversationType: 'gc',
  senderId: i % 2 ? 'u2' : 'u1',
  body: i === 1 ? 'GC-only message check.' : `GC message ${i} in ${gcId}.`,
  type: 'text',
  createdAt: now - (3 - i) * 60_000,
  status: 'read',
  reactions: [],
  starred: false,
  deleted: false,
}));

const ROUTES = {
  'POST /api/auth/login': () => ({ token: 'test-token', user: me }),
  'POST /api/auth/register': () => ({ token: 'test-token', user: me }),
  'GET /api/me': () => ({ user: me }),
  // Find One (find +ones) directory — one row per connect state so the smoke
  // test can assert the +one indicator's position for each of them.
  'GET /api/users': () => ({ users: [
    { ...other, phone: '555-0002', isOnline: true, connectStatus: 'none' },
    { id: 'u3', username: 'katherine', name: 'Katherine Johnson', phone: '555-0003', avatar: null, isOnline: false, connectStatus: 'outgoing' },
    { id: 'u4', username: 'annie', name: 'Annie Easley', phone: '555-0004', avatar: null, isOnline: false, connectStatus: 'connected' },
  ] }),
  'GET /api/chats': () => ({ chats: [chat(0), chat(1), chat(2)] }),
  'GET /api/posts': () => ({ posts: [post(0), post(1), post(2), post(3)], nextBefore: null }),
  'GET /api/posts-tags': () => ({ tags: [{ tag: 'motion', count: 4 }, { tag: 'ink', count: 2 }] }),
  'GET /api/today': () => ({ around: [], online: [], places: [], posts: [], me: { around: false } }),
  'GET /api/activity': () => ({ activity: [] }),
  'GET /api/sync/messages': () => ({ messages: [], chats: [] }),
  'GET /api/chat-requests': () => ({ requests: [] }),
  'GET /api/colleagues': () => ({ colleagues: [] }),
  'GET /api/colleagues/requests': () => ({ requests: [], incoming: [], outgoing: [] }),
  'GET /api/affiliations': () => ({ affiliations: [] }),
  'GET /api/status': () => ({ mine: null, others: [] }),
  'GET /api/communities': () => ({ communities: [] }),
  'GET /api/blocked': () => ({ blocked: [] }),
  'GET /api/greeting-summary': () => ({ summary: null }),
  'GET /api/push/info': () => ({ enabled: false }),
  'GET /api/push/web-config': () => ({ publicKey: null }),
  // GC environment — must NEVER appear in /api/chats.
  'GET /api/gc': () => ({ chats: [gcChat(0), gcChat(1)] }),
  'GET /api/gc/discover': () => ({ gcs: [] }),
};

/** /api/chats/<id>/messages, /api/gc/<id>/messages and other id-bearing paths. */
function dynamicRoute(method, pathname) {
  let m = pathname.match(/^\/api\/chats\/([^/]+)\/messages$/);
  if (m && method === 'GET') return { messages: messages(m[1]) };
  if (m && method === 'POST') return { message: messages(m[1])[0] };
  m = pathname.match(/^\/api\/gc\/([^/]+)\/messages$/);
  if (m && method === 'GET') return { messages: gcMessages(m[1]), hasMore: false };
  if (m && method === 'POST') return { message: gcMessages(m[1])[0] };
  m = pathname.match(/^\/api\/chats\/([^/]+)$/);
  if (m && method === 'GET') return { chat: chat(0) };
  return null;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const key = `${req.method} ${url.pathname}`;
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Allow-Methods', '*');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    const handler = ROUTES[key];
    const payload = handler ? handler(url, body) : (dynamicRoute(req.method, url.pathname) || {});
    res.writeHead(handler ? 200 : 200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(payload));
  });
});

const port = Number(process.env.PORT || 4000);
server.listen(port, '0.0.0.0', () => console.log(`mock api on :${port}`));
