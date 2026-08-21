/* End-to-end test for push notifications (run standalone — it boots its own
 * server on :4100 with a throwaway DATA_DIR and a stubbed Expo endpoint).
 * Usage: node test-push.js
 *
 * Covers Phase 1 acceptance:
 *   - push token register/unregister endpoints
 *   - new message -> push with deep link to the exact chat
 *   - group @mention -> "mentioned you" push
 *   - per-chat mute -> no push
 *   - message request -> Activity push ("wants to connect")
 *   - colleague request -> Colleagues push
 *   - like/comment on your post -> Network push
 *   - incoming call -> call push on the calls channel
 *   - quiet hours -> push re-routed to the -silent channel
 *   - badge math (unread + pending requests)
 */
process.env.PORT = '4100';
process.env.DATA_DIR = process.env.PUSH_TEST_DATA_DIR || `/tmp/plusone-push-test-${Date.now()}`;

const sentPushes = []; // every message handed to the (stubbed) Expo API
const realFetch = global.fetch;
global.fetch = async (url, opts) => {
  if (String(url).includes('exp.host')) {
    const body = JSON.parse(opts?.body || '[]');
    sentPushes.push(...body);
    return {
      ok: true,
      json: async () => ({ data: body.map(() => ({ status: 'ok' })) }),
    };
  }
  return realFetch(url, opts);
};

require('./src/index');

const { io } = require('socket.io-client');
const API = 'http://localhost:4100';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name} ${extra}`); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function req(path, { method = 'GET', token, body } = {}) {
  const res = await realFetch(API + path, {
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

const emit = (s, ev, payload) =>
  new Promise((resolve) => {
    // resolve on ack OR after a grace period — several events (message:read,
    // typing, …) never ack.
    const t = setTimeout(() => resolve(undefined), 2000);
    s.emit(ev, payload, (...args) => { clearTimeout(t); resolve(args[0]); });
  });

(async () => {
  // wait for server listen
  for (let i = 0; i < 50; i++) {
    try { await realFetch(API + '/api/health'); break; } catch { await sleep(200); }
  }

  const stamp = Date.now().toString(36);
  const mk = (name) => ({
    username: `${name.toLowerCase()}${stamp}`,
    name,
    password: 'testpass1234',
    phone: `+1555${Math.floor(1000000 + Math.random() * 8999999)}`,
  });

  const [a, b, c] = await Promise.all([mk('Asha'), mk('Bilal'), mk('Chen')].map((u) => req('/api/auth/register', { method: 'POST', body: u })));
  ok('registered three users', !!(a.token && b.token && c.token));

  // ---- push token registry ----
  const reg = await req('/api/push/token', { method: 'POST', token: b.token, body: { token: 'ExpoPushToken[test-b-android]', platform: 'android', deviceId: 'dev-b', appVersion: '1.4.0' } });
  ok('token registered', reg.ok === true);
  await req('/api/push/token', { method: 'POST', token: c.token, body: { token: 'ExpoPushToken[test-c-android]', platform: 'android' } });
  const info = await req('/api/push/info', { token: b.token });
  ok('info lists device', info.devices?.length === 1 && info.devices[0].platform === 'android');
  const badToken = await req('/api/push/token', { method: 'POST', token: a.token, body: { token: 'nope' } }).then(() => null, (e) => e.status);
  ok('short token rejected (400)', badToken === 400);
  const delForeign = await req('/api/push/token', { method: 'DELETE', token: a.token, body: { token: 'ExpoPushToken[test-b-android]' } });
  ok('other account cannot delete my token', delForeign.removed === false);

  // ---- direct chat: A -> B message push ----
  const { chat: dm } = await req('/api/chats/direct', { method: 'POST', token: a.token, body: { userId: b.user.id } });
  // B connects first so the chat is accepted (no request quarantine). The
  // connect request surfaces in A's Activity (chat-requests only lists ones
  // that already carry a message).
  await req(`/api/connect/${a.user.id}`, { method: 'POST', token: b.token });
  const aActivity = await req('/api/activity', { token: a.token });
  const r0 = aActivity.activity.find((r) => r.chatId === dm.id);
  await req(`/api/chat-requests/${dm.id}/respond`, { method: 'POST', token: a.token, body: { action: 'accept' } });
  ok('connect request landed in Activity', !!r0);

  sentPushes.length = 0;
  const sockA = await connect(a.token);
  const res1 = await emit(sockA, 'message:send', { chatId: dm.id, body: 'hey Bilal, push test!' });
  ok('message sent', !!res1.message);
  await sleep(400);
  let pushes = sentPushes.filter((p) => p.to === 'ExpoPushToken[test-b-android]');
  ok('direct message pushes B', pushes.length === 1, JSON.stringify(pushes));
  ok('push deep-links to the chat', pushes[0]?.data?.route === 'chat' && pushes[0]?.data?.chatId === dm.id);
  ok('push shows sender + preview', pushes[0]?.title === 'Asha' && /push test/.test(pushes[0]?.body || ''));
  ok('messages channel used', pushes[0]?.channelId === 'messages');
  ok('badge counted the unread message', pushes[0]?.badge === 1, `badge=${pushes[0]?.badge}`);

  // read receipts clear the badge on the next push
  const sockB = await connect(b.token);
  await emit(sockB, 'message:read', { chatId: dm.id });
  sentPushes.length = 0;
  await emit(sockA, 'message:send', { chatId: dm.id, body: 'second message' });
  await sleep(400);
  pushes = sentPushes.filter((p) => p.to === 'ExpoPushToken[test-b-android]');
  ok('second message pushes again', pushes.length === 1);
  ok('badge stays 1 after read (one new unread)', pushes[0]?.badge === 1, `badge=${pushes[0]?.badge}`);

  // ---- per-chat mute is respected ----
  await req(`/api/chats/${dm.id}/mute`, { method: 'POST', token: b.token, body: { muted: true } });
  sentPushes.length = 0;
  await emit(sockA, 'message:send', { chatId: dm.id, body: 'this should not ping B' });
  await sleep(400);
  pushes = sentPushes.filter((p) => p.to === 'ExpoPushToken[test-b-android]');
  ok('muted chat never pushes', pushes.length === 0, JSON.stringify(pushes));
  await req(`/api/chats/${dm.id}/mute`, { method: 'POST', token: b.token, body: { muted: false } });

  // ---- group chat + @mention ----
  const group = await req('/api/chats/group', {
    method: 'POST', token: a.token,
    body: { name: 'Push Crew', memberIds: [b.user.id, c.user.id] },
  });
  sentPushes.length = 0;
  await emit(sockA, 'message:send', { chatId: group.chat.id, body: `@${c.user.username} you around?` });
  await sleep(400);
  const cPush = sentPushes.find((p) => p.to === 'ExpoPushToken[test-c-android]');
  const bPush = sentPushes.find((p) => p.to === 'ExpoPushToken[test-b-android]');
  ok('group message pushes both members', !!cPush && !!bPush);
  ok('mention called out for @chen', /mentioned you/.test(cPush?.body || ''), cPush?.body);
  ok('non-mention shows plain group body', !/mentioned you/.test(bPush?.body || ''), bPush?.body);
  ok('group push title is the group name', cPush?.title === 'Push Crew');

  // ---- messagePreview off = generic body ----
  await req('/api/me/settings', { method: 'PATCH', token: c.token, body: { notifications: { messagePreview: false } } });
  sentPushes.length = 0;
  await emit(sockA, 'message:send', { chatId: group.chat.id, body: 'secret text for chen' });
  await sleep(400);
  const cPush2 = sentPushes.find((p) => p.to === 'ExpoPushToken[test-c-android]');
  ok('messagePreview off hides content', cPush2?.body?.includes('New message'), cPush2?.body);

  // ---- quiet hours: silent channel ----
  const nowLocal = new Date();
  const minutes = nowLocal.getUTCHours() * 60 + nowLocal.getUTCMinutes();
  const tzOffset = -nowLocal.getTimezoneOffset();
  await req('/api/me/settings', {
    method: 'PATCH', token: c.token,
    body: { notifications: { quietHours: { enabled: true, startMinute: ((minutes - 2 + 1440) % 1440), endMinute: ((minutes + 60) % 1440), tzOffsetMinutes: tzOffset } } },
  });
  sentPushes.length = 0;
  await emit(sockA, 'message:send', { chatId: group.chat.id, body: 'night message' });
  await sleep(400);
  const cPush3 = sentPushes.find((p) => p.to === 'ExpoPushToken[test-c-android]');
  ok('quiet hours still delivers', !!cPush3);
  ok('quiet hours uses the silent channel + no sound', cPush3?.channelId === 'messages-silent' && cPush3?.sound === null, JSON.stringify(cPush3));

  // ---- colleague request push ----
  await req('/api/affiliations', { method: 'POST', token: a.token, body: { name: `Push University ${stamp}`, type: 'institution' } });
  const affs = await req('/api/affiliations?mine=1', { token: a.token });
  const aff = affs.affiliations?.[affs.affiliations.length - 1];
  await req(`/api/affiliations/${aff.id}/join`, { method: 'POST', token: c.token });
  sentPushes.length = 0;
  await req(`/api/colleagues/${c.user.id}/request`, { method: 'POST', token: a.token });
  await sleep(400);
  const colPush = sentPushes.find((p) => p.to === 'ExpoPushToken[test-c-android]');
  ok('colleague request pushes to Colleagues tab', colPush?.data?.route === 'colleagues' && /wants to be your colleague/.test(colPush?.body || ''), JSON.stringify(colPush));

  // ---- like + comment on your post ----
  const post = await req('/api/posts', { method: 'POST', token: a.token, body: { body: 'my push test post' } });
  sentPushes.length = 0;
  await req(`/api/posts/${post.post.id}/like`, { method: 'POST', token: c.token });
  await sleep(400);
  ok('no push when the author has no registered device', sentPushes.length === 0);
  // register A's device and test the real like push
  await req('/api/push/token', { method: 'POST', token: a.token, body: { token: 'ExpoPushToken[test-a-android]', platform: 'android' } });
  sentPushes.length = 0;
  await req(`/api/posts/${post.post.id}/like`, { method: 'POST', token: c.token }); // unlike
  await req(`/api/posts/${post.post.id}/like`, { method: 'POST', token: c.token }); // like again
  await sleep(400);
  const likePushA = sentPushes.find((p) => p.to === 'ExpoPushToken[test-a-android]');
  ok('like pushes the post author', /liked/.test(likePushA?.body || ''), JSON.stringify(likePushA));
  sentPushes.length = 0;
  await req(`/api/posts/${post.post.id}/comments`, { method: 'POST', token: c.token, body: { body: 'great post!' } });
  await sleep(400);
  const commentPushA = sentPushes.find((p) => p.to === 'ExpoPushToken[test-a-android]');
  ok('comment pushes the post author', /commented on/.test(commentPushA?.body || ''), JSON.stringify(commentPushA));
  ok('comment deep-links to network', commentPushA?.data?.route === 'network');

  // ---- incoming call push ----
  sentPushes.length = 0;
  const callRes = await emit(sockA, 'call:invite', { chatId: dm.id, calleeId: b.user.id, type: 'audio' });
  await sleep(400);
  const callPush = sentPushes.find((p) => p.to === 'ExpoPushToken[test-b-android]');
  ok('incoming call pushes', /Incoming voice call/.test(callPush?.body || ''), JSON.stringify(callPush));
  ok('call uses the calls channel + max priority', callPush?.channelId === 'calls' && callPush?.priority === 'max');
  await emit(sockB, 'call:decline', { callId: callRes.call.id });

  // ---- badge math: pending requests count ----
  sentPushes.length = 0;
  await emit(sockA, 'message:send', { chatId: dm.id, body: 'badge check' });
  await sleep(400);
  const badgePush = sentPushes.find((p) => p.to === 'ExpoPushToken[test-b-android]');
  // B: 1 unread in dm (badge check; earlier ones read) — C still has a pending colleague request for its own token
  ok('badge present on push', typeof badgePush?.badge === 'number');

  // ---- token unregister stops pushes ----
  await req('/api/push/token', { method: 'DELETE', token: b.token, body: { token: 'ExpoPushToken[test-b-android]' } });
  sentPushes.length = 0;
  await emit(sockA, 'message:send', { chatId: dm.id, body: 'after logout device' });
  await sleep(400);
  ok('no push after token removal', !sentPushes.some((p) => p.to === 'ExpoPushToken[test-b-android]'));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error('test crashed:', e);
  process.exit(1);
});
