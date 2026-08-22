/* GC isolation end-to-end test.
 *
 * Verifies the critical invariant of the GC/normal-chat separation:
 *   - /api/chats returns ONLY direct/private conversations (never GCs)
 *   - /api/gc returns GCs in the GC environment
 *   - GC messages are only reachable through /api/gc/:id/messages +
 *     gc:* socket events, and never leak into another GC or a direct chat
 *   - removed members lose read/send access to the GC immediately while
 *     their direct chats stay completely untouched
 *   - /api/sync/messages excludes GC traffic
 *   - gc:join/gc:leave rooms + gc:message/gc:typing events work
 *
 * Standalone: boots its own server on :4310 with a throwaway DATA_DIR.
 * Usage: node test-gc-isolation.js
 */
process.env.PORT = '4310';
process.env.DATA_DIR = process.env.GC_TEST_DATA_DIR || `/tmp/plusone-gc-test-${Date.now()}`;

require('./src/index');

const { io } = require('socket.io-client');
const API = 'http://localhost:4310';

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

async function reqStatus(path, { method = 'GET', token, body } = {}) {
  const res = await fetch(API + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
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
  const [A, B, C, D] = await Promise.all([
    req('/api/auth/register', { method: 'POST', body: { username: `gca_${stamp}`, phone: `+91${stamp}1`, name: 'Alice', password: 'Pass!1234' } }),
    req('/api/auth/register', { method: 'POST', body: { username: `gcb_${stamp}`, phone: `+91${stamp}2`, name: 'Bob', password: 'Pass!1234' } }),
    req('/api/auth/register', { method: 'POST', body: { username: `gcc_${stamp}`, phone: `+91${stamp}3`, name: 'Carol', password: 'Pass!1234' } }),
    req('/api/auth/register', { method: 'POST', body: { username: `gcd_${stamp}`, phone: `+91${stamp}4`, name: 'Dave', password: 'Pass!1234' } }),
  ]);
  const ta = A.token, tb = B.token, tc = C.token, td = D.token;
  const ua = A.user, ub = B.user, uc = C.user, ud = D.user;
  console.log('registered users');

  // Direct chats: A↔B and A↔C with real messages.
  const directAB = (await req('/api/chats/direct', { method: 'POST', token: ta, body: { userId: ub.id } })).chat;
  const directAC = (await req('/api/chats/direct', { method: 'POST', token: ta, body: { userId: uc.id } })).chat;
  await req(`/api/chats/${directAB.id}/messages`, { method: 'POST', token: ta, body: { type: 'text', body: 'direct hello B' } });
  await req(`/api/chats/${directAC.id}/messages`, { method: 'POST', token: ta, body: { type: 'text', body: 'direct hello C' } });
  // Both receivers accept so the private chats are in their Chats inboxes
  // (exactly like the product's message-request flow).
  await req(`/api/chat-requests/${directAB.id}/respond`, { method: 'POST', token: tb, body: { action: 'accept' } });
  await req(`/api/chat-requests/${directAC.id}/respond`, { method: 'POST', token: tc, body: { action: 'accept' } });
  // Archive one direct chat so we can prove GC activity never un-archives it.
  await req(`/api/chats/${directAC.id}/archive`, { method: 'POST', token: ta, body: { archived: true } });
  console.log('direct chats set up');

  // GC A (A+B+C) and GC B (A+B) — separate conversations.
  const gcA = (await req('/api/gc', { method: 'POST', token: ta, body: { name: 'Gaming Hub', privacy: 'open', memberIds: [ub.id, uc.id] } })).chat;
  const gcB = (await req('/api/gc', { method: 'POST', token: ta, body: { name: 'College Friends', privacy: 'open', memberIds: [ub.id] } })).chat;
  console.log(`GCs: ${gcA.id} / ${gcB.id}`);

  // ---- 1) Normal chat query excludes EVERYTHING GC ----
  const chatsA = (await req('/api/chats', { token: ta })).chats;
  const idsA = new Set(chatsA.map((c) => c.id));
  ok('normal chats contain the direct A↔B chat', idsA.has(directAB.id));
  ok('normal chats contain the (archived) direct A↔C chat', idsA.has(directAC.id));
  ok('normal chats NEVER contain GC A', !idsA.has(gcA.id));
  ok('normal chats NEVER contain GC B', !idsA.has(gcB.id));
  ok('normal chats contain no gc rows at all', chatsA.every((c) => c.type !== 'gc'));

  const gcRows = (await req('/api/gc', { token: ta })).chats;
  ok('GC endpoint returns GC A', gcRows.some((c) => c.id === gcA.id));
  ok('GC endpoint returns GC B', gcRows.some((c) => c.id === gcB.id));

  // ---- 2) GC messages only via GC endpoints; direct chats untouched ----
  const gMsg = await req(`/api/gc/${gcA.id}/messages`, { method: 'POST', token: tb, body: { type: 'text', body: 'hello from Gaming Hub', clientId: `gc-msg-${stamp}-a` } });
  const gMsgB = await req(`/api/gc/${gcB.id}/messages`, { method: 'POST', token: tb, body: { type: 'text', body: 'hello from College Friends', clientId: `gc-msg-${stamp}-b` } });
  ok('GC message carries conversationType gc', gMsg.message.conversationType === 'gc');
  ok('GC message carries gcId', gMsg.message.gcId === gcA.id);

  const gMsgsA = (await req(`/api/gc/${gcA.id}/messages`, { token: ta })).messages;
  const gMsgsB = (await req(`/api/gc/${gcB.id}/messages`, { token: ta })).messages;
  ok('GC A shows only its own message', gMsgsA.some((m) => m.body === 'hello from Gaming Hub') && !gMsgsA.some((m) => m.body === 'hello from College Friends'));
  ok('GC B shows only its own message', gMsgsB.some((m) => m.body === 'hello from College Friends') && !gMsgsB.some((m) => m.body === 'hello from Gaming Hub'));

  const directABAfter = (await req(`/api/chats/${directAB.id}/messages`, { token: ta })).messages;
  ok('direct chat A↔B has no GC messages', !directABAfter.some((m) => m.conversationType === 'gc'));

  const chatsAAfter = (await req('/api/chats', { token: ta })).chats;
  ok('GC activity did not reorder/remove direct chats', chatsAAfter.some((c) => c.id === directAB.id) && chatsAAfter.some((c) => c.id === directAC.id));
  ok('archived direct chat stays archived', chatsAAfter.find((c) => c.id === directAC.id).archived === true);

  // ---- 3) Sync excludes GC messages ----
  const sync = await req('/api/sync/messages', { token: ta, }, );
  ok('sync/messages excludes GC traffic', !sync.messages.some((m) => m.conversationType === 'gc' || m.gcId));

  // ---- 4) Authorization: non-member cannot read/send ----
  const dRead = await reqStatus(`/api/gc/${gcA.id}/messages`, { token: td });
  ok('non-member cannot read GC messages (403)', dRead.status === 403);
  const dSend = await reqStatus(`/api/gc/${gcA.id}/messages`, { method: 'POST', token: td, body: { type: 'text', body: 'intrusion' } });
  ok('non-member cannot send GC messages (403)', dSend.status === 403);

  // ---- 5) Removed member: loses access instantly; direct chats intact ----
  await req(`/api/chats/${gcA.id}/group/members/${uc.id}`, { method: 'DELETE', token: ta });
  const cRead = await reqStatus(`/api/gc/${gcA.id}/messages`, { token: tc });
  ok('removed member cannot read GC messages (403)', cRead.status === 403);
  const cSend = await reqStatus(`/api/gc/${gcA.id}/messages`, { method: 'POST', token: tc, body: { type: 'text', body: 'still here?' } });
  ok('removed member cannot send GC messages (403)', cSend.status === 403);
  const chatsC = (await req('/api/chats', { token: tc })).chats;
  ok('removed member keeps their direct chats', chatsC.some((c) => c.id === directAC.id));
  ok('removed member has no GC A in Chats', !chatsC.some((c) => c.id === gcA.id));

  // ---- 6) Socket rooms: gc:join → gc:message / gc:typing ----
  const socketA = await connect(ta);
  const socketB = await connect(tb);
  const socketD = await connect(td);
  const joinRes = await new Promise((resolve) => socketA.emit('gc:join', { gcId: gcA.id }, resolve));
  ok('gc:join validates membership and acks', !!joinRes?.ok && joinRes.chat?.id === gcA.id);

  const msgPromise = once(socketA, 'gc:message');
  socketB.emit('gc:send', { gcId: gcA.id, type: 'text', body: 'realtime GC hello', clientId: `gc-rt-${stamp}` });
  const rtMsg = await msgPromise;
  ok('gc:send → gc:message reaches GC room member', rtMsg?.message?.body === 'realtime GC hello');
  ok('gc:message payload is GC-typed', rtMsg?.message?.conversationType === 'gc');

  const typingPromise = once(socketA, 'gc:typing');
  socketB.emit('gc:typing', { gcId: gcA.id, isTyping: true });
  const typingMsg = await typingPromise;
  ok('gc:typing reaches GC room member', typingMsg?.gcId === gcA.id && typingMsg?.isTyping === true);

  const leaveRes = await new Promise((resolve) => socketA.emit('gc:leave', { gcId: gcA.id }, resolve));
  ok('gc:leave acks', !!leaveRes?.ok);

  const joinDenied = await new Promise((resolve) => socketD.emit('gc:join', { gcId: gcA.id }, resolve));
  ok('gc:join denies non-members', !!joinDenied?.error);

  socketA.disconnect();
  socketB.disconnect();
  socketD.disconnect();

  // ---- 7) Direct chat regression after everything ----
  const finalChatsA = (await req('/api/chats', { token: ta })).chats;
  ok('final: normal chats unchanged (A↔B present)', finalChatsA.some((c) => c.id === directAB.id && c.type === 'direct'));
  ok('final: archived A↔C intact', finalChatsA.find((c) => c.id === directAC.id)?.archived === true);
  ok('final: no GC appears as a normal chat', finalChatsA.every((c) => c.type !== 'gc'));

  console.log(`\nGC ISOLATION: ${fail === 0 ? 'PASS' : 'FAIL'} (${pass} passed, ${fail} failed)`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
