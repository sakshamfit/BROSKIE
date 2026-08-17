/* End-to-end test for the six new features (run against a local server on :4000).
 * Usage: node test-features.js   (server must already be running) */
const { io } = require('socket.io-client');
const API = 'http://localhost:4000';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name} ${extra}`); }
};

async function req(path, { method = 'GET', token, body } = {}) {
  const res = await fetch(API + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `HTTP ${res.status}`), { status: res.status, data });
  return data;
}

const connect = (token) =>
  new Promise((resolve, reject) => {
    const s = io(API, { auth: { token }, transports: ['websocket'] });
    s.on('connect', () => resolve(s));
    s.on('connect_error', reject);
  });

const once = (s, ev, timeout = 8000) =>
  new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout waiting for ${ev}`)), timeout);
    s.on(ev, function h(p) { clearTimeout(t); s.off(ev, h); resolve(p); });
  });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const stamp = Date.now();
  const [A, B, C] = await Promise.all([
    req('/api/auth/register', { method: 'POST', body: { username: `alice_${stamp}`, phone: `+91${stamp}1`, name: 'Alice', password: 'pass1234' } }),
    req('/api/auth/register', { method: 'POST', body: { username: `bob_${stamp}`, phone: `+91${stamp}2`, name: 'Bob', password: 'pass1234' } }),
    req('/api/auth/register', { method: 'POST', body: { username: `carol_${stamp}`, phone: `+91${stamp}3`, name: 'Carol', password: 'pass1234' } }),
  ]);
  const ta = A.token, tb = B.token, tc = C.token;
  const ua = A.user, ub = B.user, uc = C.user;
  console.log(`users: ${ua.username} / ${ub.username} / ${uc.username}`);

  const sa = await connect(ta);
  const sb = await connect(tb);
  const sc = await connect(tc);
  console.log('sockets connected');

  // ---------- direct chat + messaging + edit + star + pin + forward ----------
  const direct = await req('/api/chats/direct', { method: 'POST', token: ta, body: { userId: ub.id } });
  const chatId = direct.chat.id;
  ok('direct chat created', !!chatId);

  const sendMsg = (s, chat, body) => new Promise((res, rej) =>
    s.emit('message:send', { chatId: chat, type: 'text', body }, (r) => (r?.error ? rej(new Error(r.error)) : res(r.message))));

  const m1 = await sendMsg(sa, chatId, 'hello bob 👋');
  ok('message sent', m1.id && m1.body === 'hello bob 👋');

  const edited = await new Promise((res, rej) =>
    sa.emit('message:edit', { messageId: m1.id, body: 'hello bob, edited!' }, (r) => (r?.error ? rej(new Error(r.error)) : res(r.message))));
  ok('message edited', edited.edited === true && edited.body === 'hello bob, edited!');

  // star
  const star1 = await req(`/api/messages/${m1.id}/star`, { method: 'POST', token: ta });
  ok('message starred', star1.starred === true);
  const starredList = await req('/api/starred', { token: ta });
  ok('starred list shows it', starredList.messages.some((m) => m.id === m1.id && m.chatName === 'Bob'));

  // pin
  const pinned = await req(`/api/chats/${chatId}/pin`, { method: 'POST', token: ta, body: { pinned: true } });
  ok('chat pinned', pinned.chat.pinned === true);
  const chatsA = await req('/api/chats', { token: ta });
  ok('pinned chat sorts first', chatsA.chats[0].id === chatId && chatsA.chats[0].pinned === true);

  // in-chat search
  const searchRes = await req(`/api/search?q=edited&chatId=${chatId}`, { token: ta });
  ok('in-chat search finds message', searchRes.messages.some((m) => m.id === m1.id));

  // forward into a group later; first build the group
  const group = await req('/api/chats/group', { method: 'POST', token: ta, body: { name: 'Trip Planning', memberIds: [ub.id, uc.id] } });
  const gid = group.chat.id;
  ok('group created with 3 members', group.chat.members.length === 3);

  // forward m1 into group
  const fwd = await req('/api/messages/forward', { method: 'POST', token: ta, body: { messageId: m1.id, chatIds: [gid] } });
  ok('message forwarded', fwd.forwarded === 1);
  await sleep(300);
  const gmsgs = await req(`/api/chats/${gid}/messages`, { token: ta });
  const fwdMsg = gmsgs.messages.find((m) => m.forwarded);
  ok('forwarded copy exists with forwarded flag', !!fwdMsg && fwdMsg.body === 'hello bob, edited!');

  // ---------- group admin powers ----------
  const renamed = await req(`/api/chats/${gid}`, { method: 'PATCH', token: ta, body: { name: 'Goa Trip 🏖' } });
  ok('group renamed by admin', renamed.chat.name === 'Goa Trip 🏖');

  let err = null;
  try { await req(`/api/chats/${gid}`, { method: 'PATCH', token: tb, body: { name: 'hacked' } }); } catch (e) { err = e; }
  ok('non-admin cannot rename', !!err && err.status === 403);

  const promoted = await req(`/api/chats/${gid}/group/members/${ub.id}/role`, { method: 'POST', token: ta, body: { role: 'admin' } });
  ok('member promoted to admin', promoted.chat.members.find((m) => m.id === ub.id).role === 'admin');

  const removedC = await req(`/api/chats/${gid}/group/members/${uc.id}`, { method: 'DELETE', token: ta });
  ok('admin removed a member', removedC.ok === true);
  await sleep(200);
  const gmsgs2 = await req(`/api/chats/${gid}/messages`, { token: ta });
  ok('system message for removal', gmsgs2.messages.some((m) => m.type === 'system' && m.body.includes('Carol')));

  // carol was removed — she should have received chat:removed. she can't read it:
  err = null;
  try { await req(`/api/chats/${gid}/messages`, { token: tc }); } catch (e) { err = e; }
  ok('removed member loses access', !!err && err.status === 403);

  const addedBack = await req('/api/chats/group', { method: 'POST', token: ta, body: { name: 'Re-add test', memberIds: [ub.id, uc.id] } });
  // bob leaves
  const left = await req(`/api/chats/${addedBack.chat.id}/group/leave`, { method: 'POST', token: tb });
  ok('bob left the group', left.ok === true);

  // only-admin can't leave
  const lone = await req('/api/chats/group', { method: 'POST', token: ta, body: { name: 'Lone group', memberIds: [uc.id] } });
  err = null;
  try { await req(`/api/chats/${lone.chat.id}/group/leave`, { method: 'POST', token: ta }); } catch (e) { err = e; }
  ok('only admin cannot leave', !!err && err.message.includes('only admin'));

  // ---------- polls ----------
  const poll = await new Promise((res, rej) =>
    sa.emit('poll:create', { chatId: gid, question: 'Where for dinner?', options: ['Chai tapri', 'Dosa joint', 'Kebab stand'] }, (r) => (r?.error ? rej(new Error(r.error)) : res(r.message))));
  ok('poll created', poll.type === 'poll' && !!poll.poll && poll.poll.options.length === 3);

  const voted = await new Promise((res, rej) =>
    sb.emit('poll:vote', { messageId: poll.id, pollId: poll.poll.id, optionIndex: 1 }, (r) => (r?.error ? rej(new Error(r.error)) : res(r.message))));
  ok('bob voted', voted.poll.myVote === 1 && voted.poll.totalVotes === 1 && voted.poll.options[1].votes === 1);

  const votedA = await new Promise((res, rej) =>
    sa.emit('poll:vote', { messageId: poll.id, pollId: poll.poll.id, optionIndex: 1 }, (r) => (r?.error ? rej(new Error(r.error)) : res(r.message))));
  ok('alice changed vote', votedA.poll.myVote === 1 && votedA.poll.totalVotes === 2);

  // ---------- disappearing messages ----------
  await req(`/api/chats/${gid}/disappear`, { method: 'POST', token: ta, body: { seconds: 30 } });
  const disappeared = await new Promise((res, rej) =>
    sa.emit('message:send', { chatId: gid, type: 'text', body: 'this will vanish' }, (r) => (r?.error ? rej(new Error(r.error)) : res(r.message))));
  ok('chat timer applied to new message', !!disappeared.expiresAt && disappeared.expiresAt > Date.now());

  const expiryPromise = once(sb, 'message:expired', 45000);
  console.log('  ⏳ waiting for the 30s disappear sweep…');
  const exp = await expiryPromise;
  ok('message:expired emitted to other member', exp.chatId === gid && exp.messageIds.includes(disappeared.id));
  const gmsgs3 = await req(`/api/chats/${gid}/messages`, { token: ta });
  ok('expired message hard-deleted', !gmsgs3.messages.some((m) => m.id === disappeared.id));

  // per-message timer on existing message
  const timer = await req(`/api/messages/${m1.id}/disappear`, { method: 'POST', token: ta, body: { seconds: 30 } });
  ok('per-message timer set', !!timer.expiresAt);
  const otherErr = null;

  // ---------- realtime fan-out checks ----------
  const livePromise = once(sb, 'message:new', 8000);
  await sa.emit('message:send', { chatId, type: 'text', body: 'live check' });
  const live = await livePromise;
  ok('realtime message:new received', live.message.body === 'live check');

  sa.disconnect(); sb.disconnect(); sc.disconnect();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', e.message, e.stack?.split('\n')[1]); process.exit(1); });
