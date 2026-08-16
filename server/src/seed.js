/**
 * DEV-ONLY sample data generator — NOT run automatically anywhere (not in
 * `build`, `start`, `postinstall`, or any deploy config). It exists purely
 * so a fresh local checkout has something to look at; the deployed app is
 * expected to run entirely on real accounts created via Sign Up.
 *
 * WARNING — THIS WIPES EVERY USER, CHAT, MESSAGE, STATUS, POST AND
 * COMMUNITY FIRST. Never run this against a database with real user data,
 * local or deployed. Guarded below: it refuses to run unless you pass
 * `--yes-wipe-real-data` or set `ALLOW_SEED_WIPE=1`, specifically so it
 * can't be triggered by a copy-pasted command against production without
 * a second, explicit confirmation.
 */
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { customAlphabet } = require('nanoid');
const db = require('./db');

const confirmed = process.argv.includes('--yes-wipe-real-data') || process.env.ALLOW_SEED_WIPE === '1';
if (!confirmed) {
  console.error(
    '\n✖ Refusing to run: this script DELETES every user, chat, message, status,\n' +
    '  post and community in the database before inserting sample data.\n\n' +
    '  This is a dev-only convenience for a fresh local checkout — it is not\n' +
    '  meant to run against any database with real accounts in it (local or\n' +
    '  deployed).\n\n' +
    '  If you are certain this database only has throwaway data, re-run with:\n' +
    '    node src/seed.js --yes-wipe-real-data\n' +
    '  or set ALLOW_SEED_WIPE=1 in the environment.\n'
  );
  process.exit(1);
}

const nano = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 16);
const now = Date.now();
const mins = (n) => n * 60 * 1000;

db.exec(`DELETE FROM community_requests; DELETE FROM community_members; DELETE FROM communities;
         DELETE FROM status_views; DELETE FROM statuses; DELETE FROM reactions; DELETE FROM receipts;
         DELETE FROM messages; DELETE FROM chat_members; DELETE FROM chats; DELETE FROM users;`);

const people = [
  { name: 'You (Demo)', username: 'you', phone: '+919000000001', about: 'Building things on Arena.' },
  { name: 'Ananya Sharma', username: 'ananya', phone: '+919000000002', about: 'Busy' },
  { name: 'Rohit Verma', username: 'rohit', phone: '+919000000003', about: 'At the gym 🏋️' },
  { name: 'Priya Nair', username: 'priya', phone: '+919000000004', about: 'Available' },
  { name: 'Karan Mehta', username: 'karan', phone: '+919000000005', about: 'Sleeping 😴' },
];

const insertUser = db.prepare(
  `INSERT INTO users (id, username, phone, name, about, avatar, password_hash, last_seen, is_online, created_at)
   VALUES (@id, @username, @phone, @name, @about, @avatar, @password_hash, @last_seen, @is_online, @created_at)`
);

const ids = {};
people.forEach((p, i) => {
  const id = nano();
  ids[p.name] = id;
  insertUser.run({
    id, username: p.username, phone: p.phone, name: p.name, about: p.about, avatar: null,
    password_hash: bcrypt.hashSync('1234', 8),
    last_seen: now - mins(i * 7), is_online: 0, created_at: now - mins(10000),
  });
});

const me = ids['You (Demo)'];

function makeChat(type, name, members, updatedAt) {
  const id = nano();
  db.prepare('INSERT INTO chats (id, type, name, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?)')
    .run(id, type, name, me, now - mins(5000), updatedAt);
  const add = db.prepare('INSERT INTO chat_members (chat_id, user_id, role, joined_at) VALUES (?,?,?,?)');
  members.forEach((uid, i) => add.run(id, uid, i === 0 ? 'admin' : 'member', now - mins(5000)));
  return id;
}

const insertMsg = db.prepare(
  `INSERT INTO messages (id, chat_id, sender_id, type, body, media_url, duration, reply_to, created_at)
   VALUES (@id, @chat_id, @sender_id, @type, @body, @media_url, @duration, @reply_to, @created_at)`
);
const insertReceipt = db.prepare('INSERT OR IGNORE INTO receipts (message_id, user_id, state, at) VALUES (?,?,?,?)');

function say(chatId, senderId, body, minsAgo, extra = {}) {
  const id = nano();
  insertMsg.run({
    id, chat_id: chatId, sender_id: senderId, type: extra.type || 'text', body,
    media_url: extra.mediaUrl || null, duration: extra.duration || 0, reply_to: extra.replyTo || null,
    created_at: now - mins(minsAgo),
  });
  db.prepare('SELECT user_id FROM chat_members WHERE chat_id = ?').all(chatId)
    .map((r) => r.user_id).filter((u) => u !== senderId)
    .forEach((u) => {
      insertReceipt.run(id, u, 'delivered', now - mins(minsAgo));
      if (!extra.unread) insertReceipt.run(id, u, 'read', now - mins(minsAgo));
    });
  return id;
}

// 1:1 with Ananya
const c1 = makeChat('direct', null, [me, ids['Ananya Sharma']], now - mins(2));
say(c1, ids['Ananya Sharma'], 'Hey! Are we still on for the demo tomorrow?', 60);
say(c1, me, 'Yes! I just finished the realtime layer 🎉', 55);
const q = say(c1, ids['Ananya Sharma'], 'Amazing. Does it have read receipts?', 40);
say(c1, me, 'Blue ticks, typing indicators, the works.', 35, { replyTo: q });
say(c1, ids['Ananya Sharma'], 'You are unstoppable 😄', 2, { unread: true });

// 1:1 with Rohit
const c2 = makeChat('direct', null, [me, ids['Rohit Verma']], now - mins(180));
say(c2, ids['Rohit Verma'], 'Bhai, gym at 6?', 240);
say(c2, me, 'Make it 6:30, standup runs late', 200);
say(c2, ids['Rohit Verma'], 'Done 💪', 180);

// 1:1 with Priya
const c3 = makeChat('direct', null, [me, ids['Priya Nair']], now - mins(600));
say(c3, ids['Priya Nair'], 'Sent you the design files', 620);
say(c3, me, 'Got them, the green is perfect', 600);

// Group chat
const g1 = makeChat('group', 'Weekend Trip 🏔️', [me, ids['Ananya Sharma'], ids['Rohit Verma'], ids['Priya Nair'], ids['Karan Mehta']], now - mins(25));
say(g1, me, 'Okay who is actually coming to Rishikesh?', 300);
say(g1, ids['Karan Mehta'], 'Me! Booking cabs now', 290);
say(g1, ids['Priya Nair'], 'Count me in 🙋‍♀️', 270);
say(g1, ids['Rohit Verma'], 'I will drive, 5 seats free', 120);
say(g1, ids['Ananya Sharma'], 'Perfect. Leaving Friday 7am sharp!', 25, { unread: true });

// Statuses
const insertStatus = db.prepare(
  `INSERT INTO statuses (id, user_id, type, body, media_url, bg, created_at, expires_at)
   VALUES (@id, @user_id, @type, @body, @media_url, @bg, @created_at, @expires_at)`
);
[
  { user: 'Ananya Sharma', body: 'Shipping day 🚀', bg: '#075E54', minsAgo: 45 },
  { user: 'Rohit Verma', body: 'Leg day never ends', bg: '#7F66FF', minsAgo: 120 },
  { user: 'Priya Nair', body: 'New design system is live!', bg: '#E4572E', minsAgo: 300 },
].forEach((s) => {
  insertStatus.run({
    id: nano(), user_id: ids[s.user], type: 'text', body: s.body, media_url: null,
    bg: s.bg, created_at: now - mins(s.minsAgo), expires_at: now + mins(1440 - s.minsAgo),
  });
});

console.log('Seeded 友達 demo data.');
console.log('Login with any of these (password: 1234):');
people.forEach((p) => console.log(`  ${p.username}  ->  ${p.name}`));

/* ---- The Network: seed public posts ---- */
const insertPost = db.prepare(
  `INSERT INTO posts (id, user_id, title, body, media_url, tag, created_at)
   VALUES (@id, @user_id, @title, @body, @media_url, @tag, @created_at)`
);
const insertLike = db.prepare('INSERT OR IGNORE INTO post_likes (post_id, user_id, at) VALUES (?,?,?)');
const insertComment = db.prepare(
  'INSERT INTO post_comments (id, post_id, user_id, body, created_at) VALUES (?,?,?,?,?)'
);

const POSTS = [
  {
    user: 'Ananya Sharma', tag: 'process', title: 'The myth of the blank page', minsAgo: 45,
    body: "Staring at a blank canvas is intimidating because it demands perfection. Start by making a mess. Draw a terrible line. Smudge some ink. Once the page is ruined, you're free to actually create.",
    likes: ['Rohit Verma', 'Priya Nair', 'Karan Mehta', 'You (Demo)'],
    comments: [['Karan Mehta', 'Needed this today, honestly.'], ['Priya Nair', 'Ruining the page first is the whole trick 🙌']],
  },
  {
    user: 'Priya Nair', tag: 'texture', title: '', minsAgo: 120,
    body: 'Just found the perfect grain texture for the new sketchbook series. The imperfections are what make it feel alive.',
    likes: ['Ananya Sharma', 'You (Demo)'],
    comments: [['Ananya Sharma', 'Which paper stock is that?']],
  },
  {
    user: 'Rohit Verma', tag: 'sketching', title: '', minsAgo: 400,
    body: 'Cityscapes always feel too rigid when done digitally. Trying to capture the chaos with loose charcoal strokes today.',
    likes: ['Priya Nair', 'Karan Mehta'],
    comments: [['You (Demo)', 'The smudging really sells it.']],
  },
  {
    user: 'Karan Mehta', tag: 'typography', title: 'Letterforms that breathe', minsAgo: 900,
    body: 'Spent the morning redrawing the same lowercase g eleven times. Ten were technically correct. The eleventh had a wobble I actually liked.',
    likes: ['Ananya Sharma', 'Rohit Verma', 'Priya Nair'],
    comments: [],
  },
  {
    user: 'You (Demo)', tag: 'process', title: '', minsAgo: 1500,
    body: 'Shipping something imperfect today beats polishing something invisible forever.',
    likes: ['Rohit Verma'],
    comments: [['Rohit Verma', '💯']],
  },
];

POSTS.forEach((p) => {
  const id = nano();
  const created = now - mins(p.minsAgo);
  insertPost.run({
    id, user_id: ids[p.user], title: p.title || '', body: p.body,
    media_url: null, tag: p.tag || null, created_at: created,
  });
  (p.likes || []).forEach((n) => insertLike.run(id, ids[n], created + 1000));
  (p.comments || []).forEach(([n, text], i) =>
    insertComment.run(nano(), id, ids[n], text, created + (i + 1) * 60000)
  );
});

console.log(`Seeded ${POSTS.length} public posts on The Network.`);

/* ---- Communities: purpose-based groups ---- */
function makeCommunity({ name, description, category, createdBy, joinPolicy = 'request', visibility = 'public', members = [], minsAgo = 0 }) {
  const id = nano();
  const chatId = nano();
  const t = now - mins(minsAgo);
  db.prepare('INSERT INTO chats (id, type, name, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?)')
    .run(chatId, 'group', name, createdBy, t, t);
  const addChatMember = db.prepare('INSERT INTO chat_members (chat_id, user_id, role, joined_at) VALUES (?,?,?,?)');
  const addCommunityMember = db.prepare('INSERT INTO community_members (community_id, user_id, role, joined_at) VALUES (?,?,?,?)');
  addChatMember.run(chatId, createdBy, 'admin', t);
  members.filter((uid) => uid !== createdBy).forEach((uid) => addChatMember.run(chatId, uid, 'member', t));

  db.prepare(
    `INSERT INTO communities (id, name, description, category, avatar, chat_id, created_by, join_policy, visibility, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`
  ).run(id, name, description, category, null, chatId, createdBy, joinPolicy, visibility, t, t);

  addCommunityMember.run(id, createdBy, 'admin', t);
  members.filter((uid) => uid !== createdBy).forEach((uid) => addCommunityMember.run(id, uid, 'member', t));
  return id;
}

makeCommunity({
  name: 'Rishikesh Weekend Trip',
  description: 'Planning the Rishikesh getaway — cabs, camping spot, and who is bringing the speaker.',
  category: 'trip',
  createdBy: me,
  joinPolicy: 'open',
  members: [ids['Ananya Sharma'], ids['Rohit Verma'], ids['Priya Nair'], ids['Karan Mehta']],
  minsAgo: 300,
});

makeCommunity({
  name: 'Saturday Club Night',
  description: 'Whoever is up for going out this Saturday — venue TBD, drop your vibe.',
  category: 'club',
  createdBy: ids['Ananya Sharma'],
  joinPolicy: 'request',
  members: [ids['Priya Nair']],
  minsAgo: 120,
});

makeCommunity({
  name: 'Morning Runners',
  description: '6 AM runs around the lake, all paces welcome. Chai afterwards, non-negotiable.',
  category: 'run',
  createdBy: ids['Rohit Verma'],
  joinPolicy: 'open',
  members: [me, ids['Karan Mehta']],
  minsAgo: 1000,
});

makeCommunity({
  name: 'Chai & Sketchbooks',
  description: 'Casual hangout — bring a sketchbook, we bring the chai. No plans, just vibes.',
  category: 'chai',
  createdBy: ids['Priya Nair'],
  joinPolicy: 'request',
  members: [],
  minsAgo: 60,
});

console.log('Seeded 4 communities.');
