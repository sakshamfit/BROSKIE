/*
 * Destructive only to its own temporary database.
 * Covers idempotent send, cursor pagination, REST send, and incremental sync.
 */
const { spawn } = require('child_process');
const { once } = require('events');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { io } = require('socket.io-client');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plusone-offline-msg-'));
const port = 4400 + (process.pid % 1000);
const origin = `http://127.0.0.1:${port}`;
let server;
let sockets = [];
let passed = 0;

function pass(message, condition) {
  if (!condition) throw new Error(message);
  passed += 1;
  console.log(`  ✓ ${message}`);
}

function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.floor(Math.random() * 16);
    const v = c === 'x' ? r : ((r & 0x3) | 0x8);
    return v.toString(16);
  });
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
  const deadline = Date.now() + 20000;
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
      JWT_SECRET: 'offline-messaging-test-only',
      PORT: String(port),
      NODE_ENV: 'test',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stderr.on('data', (chunk) => {
    const text = String(chunk);
    if (/error|Error|UNIQUE/i.test(text)) process.stderr.write(text);
  });
  await waitForServer();

  const stamp = Date.now();
  const [a, b] = await Promise.all([
    request('/api/auth/register', { method: 'POST', body: { username: `off_a_${stamp}`, name: 'Offline A', password: 'password1' } }),
    request('/api/auth/register', { method: 'POST', body: { username: `off_b_${stamp}`, name: 'Offline B', password: 'password1' } }),
  ]);
  const socketA = await connect(a.token);
  await connect(b.token);

  const direct = await request('/api/chats/direct', { method: 'POST', token: a.token, body: { userId: b.user.id } });
  const chatId = direct.chat.id;

  const clientId = uuid();
  const first = await request(`/api/chats/${chatId}/messages`, {
    method: 'POST',
    token: a.token,
    body: { type: 'text', body: 'hello offline', clientId, clientCreatedAt: Date.now() - 500 },
  });
  pass('REST send stores the client UUID as the message id', first.message.id === clientId);
  pass('REST send echoes clientCreatedAt', !!first.message.clientCreatedAt);

  const retry = await request(`/api/chats/${chatId}/messages`, {
    method: 'POST',
    token: a.token,
    body: { type: 'text', body: 'hello offline DUPLICATE', clientId, clientCreatedAt: Date.now() },
  });
  pass('retry with the same clientId is idempotent', retry.duplicate === true && retry.message.id === clientId);
  pass('retry does not overwrite the original body', retry.message.body === 'hello offline');

  const socketDup = await new Promise((resolve, reject) => {
    socketA.emit('message:send', { chatId, type: 'text', body: 'via socket', clientId, tempId: clientId }, (res) => {
      if (res?.error) reject(new Error(res.error));
      else resolve(res);
    });
  });
  pass('socket retry with the same clientId does not create a second row', socketDup.duplicate === true && socketDup.message.id === clientId);

  const ids = [];
  for (let i = 0; i < 12; i += 1) {
    const sent = await request(`/api/chats/${chatId}/messages`, {
      method: 'POST',
      token: a.token,
      body: { type: 'text', body: `page-${i}`, clientId: uuid() },
    });
    ids.push(sent.message.id);
  }

  const latest = await request(`/api/chats/${chatId}/messages?limit=5`, { token: a.token });
  pass('opening a chat returns a bounded page, not the full history', latest.messages.length === 5);
  pass('latest page includes hasMore when history exists', latest.hasMore === true);

  const after = latest.cursor.after;
  const afterId = latest.cursor.afterId;
  const extra = await request(`/api/chats/${chatId}/messages`, {
    method: 'POST',
    token: a.token,
    body: { type: 'text', body: 'after-cursor', clientId: uuid() },
  });
  const incremental = await request(
    `/api/chats/${chatId}/messages?after=${after}&afterId=${encodeURIComponent(afterId)}&limit=20`,
    { token: a.token },
  );
  pass('incremental fetch returns only messages after the cursor', incremental.messages.some((m) => m.id === extra.message.id));
  pass('incremental fetch does not rewind the whole conversation', incremental.messages.length <= 5);

  const older = await request(
    `/api/chats/${chatId}/messages?before=${latest.messages[0].createdAt}&beforeId=${encodeURIComponent(latest.messages[0].id)}&limit=5`,
    { token: a.token },
  );
  pass('before-cursor page returns older messages', older.messages.length > 0);
  pass('older page does not include the newest message', !older.messages.some((m) => m.id === extra.message.id));

  const synced = await request(`/api/sync/messages?after=${after}&limit=50`, { token: a.token });
  pass('sync endpoint returns messages newer than the cursor', synced.messages.some((m) => m.id === extra.message.id));
  pass('sync endpoint returns a cursor', typeof synced.cursor === 'number' && synced.cursor >= after);

  const page = await request(`/api/chats/${chatId}/messages?limit=50`, { token: a.token });
  const copies = page.messages.filter((m) => m.id === clientId);
  pass('conversation contains exactly one copy of the retried message', copies.length === 1);

  console.log(`\n${passed} offline-messaging checks passed.`);
  await stopServer();
  fs.rmSync(tempDir, { recursive: true, force: true });
})().catch(async (error) => {
  console.error(`\nFAIL: ${error.stack || error}`);
  await stopServer();
  fs.rmSync(tempDir, { recursive: true, force: true });
  process.exit(1);
});
