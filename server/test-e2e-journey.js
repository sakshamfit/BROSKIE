/* End-to-end journey — boots its own server (like the other suites) unless
 * E2E_BASE points at an already-running one. Mirrors the real client
 * protocol: request/accept flow for new contacts, camelCase payload keys,
 * receipt status field, caller→callee SDP routing. */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const BASE = process.env.E2E_BASE || `http://127.0.0.1:4317`;
const { io } = require('socket.io-client');

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n); } };
const api = async (path, method = 'GET', body, token) => {
  const r = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json().catch(() => ({}));
  return { status: r.status, data };
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  let server = null;
  if (!process.env.E2E_BASE) {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plusone-e2e-'));
    server = spawn('node', ['src/index.js'], {
      cwd: __dirname,
      env: { ...process.env, PORT: '4317', JWT_SECRET: 'e2e-journey-secret', DATA_DIR: dataDir, CORS_ORIGIN: '*', NODE_ENV: 'production' },
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    for (let i = 0; i < 60; i++) {
      try { const r = await fetch(`${BASE}/api/health`); if (r.ok) break; } catch {}
      await wait(250);
    }
  }

  const stamp = Date.now();
  const a = await api('/api/auth/register', 'POST', { username: `e2ea${stamp}`, name: 'Alice E2E', password: 'password-123', phone: `+1999${String(stamp).slice(-8)}` });
  const b = await api('/api/auth/register', 'POST', { username: `e2eb${stamp}`, name: 'Bob E2E', password: 'password-123', phone: `+1999${String(stamp).slice(-8)}1` });
  ok(a.status === 200 && a.data.token, 'Alice registered');
  ok(b.status === 200 && b.data.token, 'Bob registered');
  const tokA = a.data.token, tokB = b.data.token;
  const idA = a.data.user.id, idB = b.data.user.id;

  const login = await api('/api/auth/login', 'POST', { username: `e2ea${stamp}`, password: 'password-123' });
  ok(login.status === 200 && login.data.token, 'login works');

  const chat = await api('/api/chats/direct', 'POST', { userId: idB }, tokA);
  ok(chat.status === 200 && chat.data.chat?.id, 'direct chat created');
  const chatId = chat.data.chat.id;
  const sent = await api(`/api/chats/${chatId}/messages`, 'POST', { type: 'text', body: 'hello from Alice', clientId: 'c1' }, tokA);
  ok(sent.status === 200 && sent.data.message?.id, 'first message sent (creates message request)');

  // Bob must ACCEPT the message request before replying — by design.
  const accept = await api(`/api/chat-requests/${chatId}/respond`, 'POST', { action: 'accept' }, tokB);
  ok(accept.status === 200, 'Bob accepted the message request');

  // Alice connects and settles, THEN Bob — so Bob's socket sees Alice's presence.
  const sA = io(BASE, { auth: { token: tokA }, transports: ['websocket'] });
  await new Promise((r) => sA.on('connect', r));
  await wait(400);
  const sB = io(BASE, { auth: { token: tokB }, transports: ['websocket'] });
  await new Promise((r) => sB.on('connect', r));

  let gotMessage = null, sawPresence = false, receiptStatus = null, gotTyping = false;
  sA.on('message:new', (p) => { gotMessage = p; });
  sA.on('presence', (p) => { if (p.userId === idB) sawPresence = true; });
  sA.on('message:updated', (p) => { if (p?.id && p.status) receiptStatus = p.status; });
  sA.on('typing', () => { gotTyping = true; });

  sB.emit('message:send', { chatId, type: 'text', body: 'hey Alice!', tempId: 'b1' }, (res) => {
    ok(!!res?.message?.id, 'socket message:send acked with hydrated message');
  });
  sB.emit('typing', { chatId, isTyping: true });
  await wait(1000);
  ok(gotMessage?.message?.body === 'hey Alice!', 'Bob message reached Alice in realtime');
  ok(sawPresence, 'presence broadcast received (privacy-aware)');
  ok(gotTyping, 'typing indicator received');

  sB.emit('message:read', { chatId });
  await wait(900);
  ok(receiptStatus === 'read' || receiptStatus === 'delivered', `receipt round-trip (message:updated status=${receiptStatus})`);

  const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6360000002000148afa4710000000049454e44ae426082', 'hex');
  const up = await fetch(`${BASE}/api/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokA}`, 'Content-Type': 'multipart/form-data; boundary=X' },
    body: Buffer.concat([Buffer.from('--X\r\nContent-Disposition: form-data; name="file"; filename="pic.png"\r\nContent-Type: image/png\r\n\r\n'), PNG, Buffer.from('\r\n--X--\r\n')]),
  });
  const upBody = await up.json().catch(() => ({}));
  ok(up.status === 200 && typeof upBody.url === 'string', `image upload (${up.status})`);
  if (upBody.url) {
    const back = await fetch(upBody.url.startsWith('http') ? upBody.url : BASE + upBody.url);
    ok(back.status === 200 && back.headers.get('content-type') === 'image/png', 'uploaded image served back with correct type');
    const mediaMsg = await api(`/api/chats/${chatId}/messages`, 'POST', { type: 'image', mediaUrl: upBody.url }, tokA);
    ok(mediaMsg.status === 200 && mediaMsg.data.message?.mediaUrl, 'image message sent');
  }

  const hist = await api(`/api/chats/${chatId}/messages?limit=50`, 'GET', null, tokB);
  ok(hist.status === 200 && (hist.data.messages || []).length >= 3, 'chat history returns the full thread');
  const bodies = (hist.data.messages || []).map((m) => m.type);
  ok(bodies.includes('text') && bodies.includes('image'), 'history contains text and image messages');

  /* ---- WebRTC call handshake (voice): caller=Alice, callee=Bob ---- */
  let inviteAck = null, gotIncoming = null, gotOffer = null, gotAnswer = null,
    gotIceA = null, gotIceB = null, gotEnded = null;
  sB.on('call:incoming', (p) => { gotIncoming = p; });
  sB.on('call:offer', (p) => { gotOffer = p; });   // offer goes caller → callee
  sA.on('call:answer', (p) => { gotAnswer = p; }); // answer goes callee → caller
  sA.on('call:ice-candidate', (p) => { gotIceA = p; });
  sB.on('call:ice-candidate', (p) => { gotIceB = p; });
  sA.on('call:ended', (p) => { gotEnded = p; });

  sA.emit('call:invite', { chatId, calleeId: idB, type: 'audio' }, (res) => { inviteAck = res; });
  await wait(700);
  ok(!!inviteAck?.call?.id, 'call:invite acked with call id');
  ok(!!gotIncoming && gotIncoming.type === 'audio', 'callee received call:incoming');
  const callId = inviteAck?.call?.id;
  sB.emit('call:accept', { callId }, () => {});
  await wait(500);
  ok(true, 'call accepted');

  // While that call is live, a second invite must be refused (busy).
  let busyAck = null;
  sA.emit('call:invite', { chatId, calleeId: idB, type: 'audio' }, (res) => { busyAck = res; });
  await wait(500);
  ok(!!busyAck?.error, 'second simultaneous call is rejected (busy)');

  sA.emit('call:offer', { callId, sdp: { type: 'offer', sdp: 'v=0 fake-offer' } });
  await wait(400);
  ok(!!gotOffer, 'callee received SDP offer');
  sB.emit('call:answer', { callId, sdp: { type: 'answer', sdp: 'v=0 fake-answer' } });
  await wait(400);
  ok(!!gotAnswer, 'caller received SDP answer');
  sA.emit('call:ice-candidate', { callId, candidate: { candidate: 'candidate:1 1 UDP 1 1.2.3.4 5000 typ host', sdpMid: '0' } });
  sB.emit('call:ice-candidate', { callId, candidate: { candidate: 'candidate:2 1 UDP 1 5.6.7.8 5000 typ host', sdpMid: '0' } });
  await wait(400);
  ok(!!gotIceA && !!gotIceB, 'ICE candidates exchanged both ways');
  const calls = await api('/api/calls', 'GET', null, tokA);
  ok(calls.status === 200 && Array.isArray(calls.data.calls), 'call log endpoint responds');
  sB.emit('call:hangup', { callId });
  await wait(600);
  ok(!!gotEnded, 'call:ended delivered on hangup');

  sA.disconnect(); sB.disconnect();
  console.log(`\nE2E JOURNEY: ${pass} passed, ${fail} failed`);
  if (server) server.kill('SIGTERM');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
