/*
 * Inbox filter acceptance: Recent / Archived / Request Chat stay isolated
 * views over the existing chat system. Switching a filter is a display
 * concern only. GCs never appear in any of the three lists.
 */
const { spawn } = require('child_process');
const { once } = require('events');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { io } = require('socket.io-client');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plusone-chat-inbox-'));
const port = 4500 + (process.pid % 400);
const origin = `http://127.0.0.1:${port}`;
let server;
let sockets = [];
let passed = 0;

function pass(message, condition) {
  if (!condition) throw new Error(message);
  passed += 1;
  console.log(`  ✓ ${message}`);
}

async function request(route, { method = 'GET', token, body } = {}) {
  const response = await fetch(origin + route, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(`${method} ${route}: ${response.status} ${data.error || ''}`);
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return data;
}

async function waitForServer() {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${origin}/api/health`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Test server did not start');
}

function connect(token) {
  return new Promise((resolve, reject) => {
    const socket = io(origin, { auth: { token }, transports: ['websocket'] });
    sockets.push(socket);
    socket.once('connect', () => resolve(socket));
    socket.once('connect_error', reject);
  });
}

function send(socket, chatId, body) {
  return new Promise((resolve, reject) => {
    socket.emit('message:send', { chatId, type: 'text', body }, (result) => {
      if (result?.error) reject(new Error(result.error));
      else resolve(result.message);
    });
  });
}

async function stopServer() {
  sockets.forEach((socket) => socket.disconnect());
  sockets = [];
  if (server && server.exitCode == null) {
    server.kill('SIGTERM');
    await Promise.race([once(server, 'exit'), new Promise((resolve) => setTimeout(resolve, 5000))]);
    if (server.exitCode == null) server.kill('SIGKILL');
  }
}

(async () => {
  server = spawn(process.execPath, ['src/index.js'], {
    cwd: __dirname,
    env: {
      ...process.env,
      DATA_DIR: tempDir,
      BACKUP_DIR: path.join(tempDir, 'backups'),
      JWT_SECRET: 'chat-inbox-test-only',
      PORT: String(port),
      NODE_ENV: 'test',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await waitForServer();

  const stamp = Date.now();
  const [a, b, c] = await Promise.all([
    request('/api/auth/register', { method: 'POST', body: { username: `inbox_a_${stamp}`, name: 'Inbox A', password: 'password1' } }),
    request('/api/auth/register', { method: 'POST', body: { username: `inbox_b_${stamp}`, name: 'Inbox B', password: 'password1' } }),
    request('/api/auth/register', { method: 'POST', body: { username: `inbox_c_${stamp}`, name: 'Inbox C', password: 'password1' } }),
  ]);
  const socketA = await connect(a.token);
  const socketB = await connect(b.token);

  const direct = await request('/api/chats/direct', { method: 'POST', token: a.token, body: { userId: b.user.id } });
  await send(socketA, direct.chat.id, 'first hello');

  const recentA = (await request('/api/chats?inbox=recent', { token: a.token })).chats;
  const recentB = (await request('/api/chats?inbox=recent', { token: b.token })).chats;
  const requestsB = (await request('/api/chat-requests', { token: b.token })).requests;
  pass('sender keeps the pending thread in Recent Chat', recentA.some((chat) => chat.id === direct.chat.id));
  pass('incoming pending request is not a Recent Chat for the receiver', !recentB.some((chat) => chat.id === direct.chat.id));
  pass('incoming pending request appears only in Request Chat', requestsB.some((row) => row.chatId === direct.chat.id));

  const outsiderRequests = (await request('/api/chat-requests', { token: c.token })).requests;
  pass('another user cannot see someone else\'s chat requests', !outsiderRequests.some((row) => row.chatId === direct.chat.id));

  let denied = null;
  try {
    await request(`/api/chat-requests/${direct.chat.id}/respond`, { method: 'POST', token: c.token, body: { action: 'accept' } });
  } catch (error) { denied = error; }
  pass('another user cannot accept someone else\'s request', !!denied && (denied.status === 403 || denied.status === 404));

  denied = null;
  try {
    await request(`/api/chats/${direct.chat.id}/archive`, { method: 'POST', token: c.token, body: { archived: true } });
  } catch (error) { denied = error; }
  pass('another user cannot archive a private chat', !!denied && denied.status === 403);

  const accepted = await request(`/api/chat-requests/${direct.chat.id}/respond`, {
    method: 'POST', token: b.token, body: { action: 'accept' },
  });
  pass('accepting preserves the same conversation', accepted.chat.id === direct.chat.id);
  const afterAcceptB = await request('/api/chats', { token: b.token });
  const afterAcceptRequests = (await request('/api/chat-requests', { token: b.token })).requests;
  pass('accepted chat leaves Request Chat', !afterAcceptRequests.some((row) => row.chatId === direct.chat.id));
  pass('accepted chat appears in Recent Chat', afterAcceptB.chats.some((chat) => chat.id === direct.chat.id && !chat.archived));

  const archived = await request(`/api/chats/${direct.chat.id}/archive`, {
    method: 'POST', token: b.token, body: { archived: true },
  });
  pass('archive action sets archived without creating a new chat', archived.chat.id === direct.chat.id && archived.chat.archived === true);
  const recentAfterArchive = (await request('/api/chats?inbox=recent', { token: b.token })).chats;
  const archivedAfter = (await request('/api/chats?inbox=archived', { token: b.token })).chats;
  const allAfter = await request('/api/chats', { token: b.token });
  pass('archived chat disappears from Recent Chat', !recentAfterArchive.some((chat) => chat.id === direct.chat.id));
  pass('archived chat appears in Archived Chat', archivedAfter.some((chat) => chat.id === direct.chat.id));
  pass('listing Recent does not unarchive the chat', allAfter.chats.find((chat) => chat.id === direct.chat.id)?.archived === true);
  pass('counts come from real archive state', allAfter.counts.archived >= 1 && allAfter.counts.recent === recentAfterArchive.length);

  const unarchived = await request(`/api/chats/${direct.chat.id}/archive`, {
    method: 'POST', token: b.token, body: { archived: false },
  });
  pass('unarchive returns the same conversation to Recent Chat', unarchived.chat.archived === false);
  const recentRestored = (await request('/api/chats?inbox=recent', { token: b.token })).chats;
  const archivedRestored = (await request('/api/chats?inbox=archived', { token: b.token })).chats;
  pass('unarchived chat is gone from Archived Chat', !archivedRestored.some((chat) => chat.id === direct.chat.id));
  pass('unarchived chat is back in Recent Chat', recentRestored.some((chat) => chat.id === direct.chat.id));

  const gc = await request('/api/gc', {
    method: 'POST',
    token: a.token,
    body: { name: `Inbox GC ${stamp}`, privacy: 'open', memberIds: [b.user.id] },
  });
  const chatsAfterGc = (await request('/api/chats', { token: a.token })).chats;
  const requestsAfterGc = (await request('/api/chat-requests', { token: a.token })).requests;
  const gcsA = (await request('/api/gc', { token: a.token })).chats;
  pass('GC lives in the GC section', gcsA.some((chat) => chat.id === gc.chat.id && chat.type === 'gc'));
  pass('GC never appears in Recent or Archived Chat', !chatsAfterGc.some((chat) => chat.id === gc.chat.id));
  pass('GC never appears in Request Chat', !requestsAfterGc.some((row) => row.chatId === gc.chat.id));
  const stillRecent = chatsAfterGc.find((chat) => chat.id === direct.chat.id);
  pass('opening/creating a GC does not archive or remove the normal chat', stillRecent && stillRecent.archived === false);

  console.log(`\n${passed} chat-inbox acceptance checks passed.`);
  await stopServer();
  fs.rmSync(tempDir, { recursive: true, force: true });
})().catch(async (error) => {
  console.error(`\nFAIL: ${error.stack || error}`);
  await stopServer();
  fs.rmSync(tempDir, { recursive: true, force: true });
  process.exit(1);
});
