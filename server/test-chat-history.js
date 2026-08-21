/*
 * Destructive only to its own temporary database. Never points at DATA_DIR.
 * End-to-end acceptance coverage for conversation-history preservation.
 */
const { spawn } = require('child_process');
const { once } = require('events');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const { io } = require('socket.io-client');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plusone-chat-history-'));
const port = 4300 + (process.pid % 1000);
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
  if (!response.ok) throw new Error(`${method} ${route}: ${response.status} ${data.error || ''}`);
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

function send(socket, chatId, body, replyTo = null) {
  return new Promise((resolve, reject) => {
    socket.emit('message:send', { chatId, type: 'text', body, replyTo }, (result) => {
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
      JWT_SECRET: 'chat-history-test-only',
      PORT: String(port),
      NODE_ENV: 'test',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let serverErrors = '';
  server.stderr.on('data', (chunk) => { serverErrors += chunk; });
  await waitForServer();

  const stamp = Date.now();
  const [a, b, c] = await Promise.all([
    request('/api/auth/register', { method: 'POST', body: { username: `history_a_${stamp}`, name: 'History A', password: 'password1' } }),
    request('/api/auth/register', { method: 'POST', body: { username: `history_b_${stamp}`, name: 'History B', password: 'password1' } }),
    request('/api/auth/register', { method: 'POST', body: { username: `history_c_${stamp}`, name: 'History C', password: 'password1' } }),
  ]);
  const socketA = await connect(a.token);
  const socketB = await connect(b.token);

  const direct = await request('/api/chats/direct', { method: 'POST', token: a.token, body: { userId: b.user.id } });
  const chatId = direct.chat.id;
  let chatsA = (await request('/api/chats', { token: a.token })).chats;
  let chatsB = (await request('/api/chats', { token: b.token })).chats;
  pass('a blank draft is visible only to its creator', chatsA.some((chat) => chat.id === chatId) && !chatsB.some((chat) => chat.id === chatId));

  const first = await send(socketA, chatId, 'persistent first message');
  chatsA = (await request('/api/chats', { token: a.token })).chats;
  chatsB = (await request('/api/chats', { token: b.token })).chats;
  pass('sender history remains visible while incoming request stays in Activity', chatsA.some((chat) => chat.id === chatId) && !chatsB.some((chat) => chat.id === chatId));

  const accepted = await request(`/api/chat-requests/${chatId}/respond`, { method: 'POST', token: b.token, body: { action: 'accept' } });
  pass('accepting preserves the existing conversation id', accepted.chat.id === chatId);
  chatsB = (await request('/api/chats', { token: b.token })).chats;
  pass('accepted conversation appears in recipient history', chatsB.some((chat) => chat.id === chatId));

  socketB.emit('message:read', { chatId });
  await new Promise((resolve) => setTimeout(resolve, 75));
  chatsB = (await request('/api/chats', { token: b.token })).chats;
  pass('zero-unread conversation remains in Chats', chatsB.find((chat) => chat.id === chatId)?.unread === 0);

  const reopened = await request('/api/chats/direct', { method: 'POST', token: a.token, body: { userId: b.user.id } });
  pass('opening an old conversation does not create a duplicate id', reopened.chat.id === chatId);

  const themed = await request(`/api/chats/${chatId}/theme`, { method: 'POST', token: a.token, body: { themeId: 'ocean' } });
  pass('theme change only updates the existing conversation', themed.chat.id === chatId && themed.chat.themeId === 'ocean');

  const reply = await send(socketB, chatId, 'replying to original', first.id);
  const messages = (await request(`/api/chats/${chatId}/messages`, { token: a.token })).messages;
  pass('reply_to references the original message id', reply.replyTo?.id === first.id);
  pass('theme/reply leave old and new message ids intact', messages.some((message) => message.id === first.id) && messages.some((message) => message.id === reply.id));

  // Simulate a legacy conversation whose disappearing messages have all
  // expired. This deletes only isolated test rows, never user/production data.
  const legacy = await request('/api/chats/direct', { method: 'POST', token: a.token, body: { userId: c.user.id } });
  await send(socketA, legacy.chat.id, 'legacy history');
  const fixtureDb = new Database(path.join(tempDir, 'tomodachi.db'));
  fixtureDb.prepare('DELETE FROM chat_requests WHERE chat_id = ?').run(legacy.chat.id);
  fixtureDb.prepare('DELETE FROM messages WHERE chat_id = ?').run(legacy.chat.id);
  fixtureDb.close();
  chatsA = (await request('/api/chats', { token: a.token })).chats;
  const retainedLegacy = chatsA.find((chat) => chat.id === legacy.chat.id);
  pass('legacy relationship remains discoverable after all messages expire', retainedLegacy?.lastMessage === null);
  pass('expired history keeps the original conversation id', retainedLegacy?.id === legacy.chat.id);

  await request(`/api/chats/${chatId}`, { method: 'DELETE', token: a.token });
  chatsA = (await request('/api/chats', { token: a.token })).chats;
  chatsB = (await request('/api/chats', { token: b.token })).chats;
  pass('explicit per-user delete hides history only for that user', !chatsA.some((chat) => chat.id === chatId) && chatsB.some((chat) => chat.id === chatId));
  const dbAfterClear = new Database(path.join(tempDir, 'tomodachi.db'), { readonly: true });
  const storedChat = dbAfterClear.prepare('SELECT id FROM chats WHERE id = ?').get(chatId);
  const storedMessage = dbAfterClear.prepare('SELECT id FROM messages WHERE id = ?').get(first.id);
  dbAfterClear.close();
  pass('per-user delete does not destroy conversation/message rows', storedChat?.id === chatId && storedMessage?.id === first.id);

  await send(socketB, chatId, 'same thread after clear');
  chatsA = (await request('/api/chats', { token: a.token })).chats;
  pass('new activity restores the same cleared conversation at the top', chatsA[0]?.id === chatId && chatsA.filter((chat) => chat.id === chatId).length === 1);

  console.log(`\n${passed} chat-history acceptance checks passed.`);
  await stopServer();
  fs.rmSync(tempDir, { recursive: true, force: true });
})().catch(async (error) => {
  console.error(`\nFAIL: ${error.stack || error}`);
  await stopServer();
  fs.rmSync(tempDir, { recursive: true, force: true });
  process.exit(1);
});
