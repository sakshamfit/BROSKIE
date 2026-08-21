/* End-to-end test for Phase 3 (standalone; boots its own server on :4300
 * with a throwaway DATA_DIR, a stubbed Expo endpoint, and a stubbed
 * web-push module). Usage: node test-phase3.js
 *
 * Covers:
 *   - community invite links: code minted on create, join-by-code works
 *     across every join policy (incl. invite-only), rotation revokes,
 *     invalid codes 404, code only exposed to admins
 *   - Activity grouping: N likes on one post = ONE "like_group" row with
 *     count + faces; comments likewise; old flat types gone
 *   - Web push parity: browser subscriptions register/unregister, a message
 *     push reaches BOTH the Expo stub and the web stub with the same
 *     deep-link payload, 410 responses prune the subscription
 */
process.env.PORT = '4300';
process.env.DATA_DIR = process.env.PHASE3_TEST_DATA_DIR || `/tmp/plusone-phase3-test-${Date.now()}`;

const sentPushes = [];
const sentWebPushes = [];
const realFetch = global.fetch;
global.fetch = async (url, opts) => {
  if (String(url).includes('exp.host')) {
    const body = JSON.parse(opts?.body || '[]');
    sentPushes.push(...body);
    return { ok: true, json: async () => ({ data: body.map(() => ({ status: 'ok' })) }) };
  }
  return realFetch(url, opts);
};

// Stub web-push BEFORE the server loads (push.js shares the module instance).
const webpush = require('web-push');
webpush.sendNotification = async (subscription, payload) => {
  if (String(subscription.endpoint).includes('/gone')) {
    throw Object.assign(new Error('410 Gone'), { statusCode: 410 });
  }
  sentWebPushes.push({ endpoint: subscription.endpoint, payload: JSON.parse(payload) });
  return { statusCode: 201 };
};

require('./src/index');

const { io } = require('socket.io-client');
const API = 'http://localhost:4300';

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

const emit = (s, ev, payload) =>
  new Promise((resolve) => {
    const t = setTimeout(() => resolve(undefined), 2000);
    s.emit(ev, payload, (...args) => { clearTimeout(t); resolve(args[0]); });
  });

(async () => {
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
  const [asha, bilal, chen, dev] = await Promise.all(
    [mk('Asha'), mk('Bilal'), mk('Chen'), mk('Dev')].map((u) => req('/api/auth/register', { method: 'POST', body: u }))
  );
  ok('registered four users', !!(asha.token && bilal.token && chen.token && dev.token));

  // ---------------- invite links ----------------
  const { community } = await req('/api/communities', {
    method: 'POST', token: asha.token,
    body: { name: `Invite Club ${stamp}`, joinPolicy: 'invite' },
  });
  ok('community created', !!community.id);
  ok('invite code minted for admin', /^[a-hjkmnp-z2-9]{8}$/.test(community.inviteCode || ''), String(community.inviteCode));

  // An invite-only community cannot be joined directly…
  const blockedJoin = await req(`/api/communities/${community.id}/join`, { method: 'POST', token: bilal.token })
    .then(() => 'joined').catch((e) => e.status);
  ok('invite-only blocks direct join (403)', blockedJoin === 403, String(blockedJoin));

  // …but the invite link IS the approval.
  const joined = await req('/api/communities/join-by-code', { method: 'POST', token: bilal.token, body: { code: community.inviteCode } });
  ok('invite code joins an invite-only community', joined.alreadyMember === false && joined.community.isMember === true);
  const again = await req('/api/communities/join-by-code', { method: 'POST', token: bilal.token, body: { code: community.inviteCode } });
  ok('re-using the link is a friendly no-op', again.alreadyMember === true);

  const badCode = await req('/api/communities/join-by-code', { method: 'POST', token: chen.token, body: { code: 'nope1234' } })
    .then(() => null, (e) => e.status);
  ok('invalid code is 404', badCode === 404);

  // Non-admins never see the code.
  const asAdmin = await req(`/api/communities/${community.id}`, { token: asha.token });
  const asMember = await req(`/api/communities/${community.id}`, { token: bilal.token });
  ok('code visible to admin only', !!asAdmin.community.inviteCode && asMember.community.inviteCode === null);

  // Rotation revokes the old link.
  const oldCode = community.inviteCode;
  const rotated = await req(`/api/communities/${community.id}/invite/rotate`, { method: 'POST', token: asha.token });
  ok('rotation issues a new code', rotated.inviteCode && rotated.inviteCode !== oldCode);
  const revoked = await req('/api/communities/join-by-code', { method: 'POST', token: chen.token, body: { code: oldCode } })
    .then(() => null, (e) => e.status);
  ok('old code no longer works (404)', revoked === 404);
  const chenJoined = await req('/api/communities/join-by-code', { method: 'POST', token: chen.token, body: { code: rotated.inviteCode } });
  ok('new code works', chenJoined.community.isMember === true);
  const notAdmin = await req(`/api/communities/${community.id}/invite/rotate`, { method: 'POST', token: chen.token })
    .then(() => null, (e) => e.status);
  ok('non-admin cannot rotate (403)', notAdmin === 403);

  // ---------------- activity grouping ----------------
  const post = await req('/api/posts', { method: 'POST', token: asha.token, body: { body: 'group my reactions please' } });
  await req(`/api/posts/${post.post.id}/like`, { method: 'POST', token: bilal.token });
  await req(`/api/posts/${post.post.id}/like`, { method: 'POST', token: chen.token });
  await req(`/api/posts/${post.post.id}/like`, { method: 'POST', token: dev.token });
  await req(`/api/posts/${post.post.id}/comments`, { method: 'POST', token: bilal.token, body: { body: 'first!' } });
  await req(`/api/posts/${post.post.id}/comments`, { method: 'POST', token: chen.token, body: { body: 'second!' } });

  const activity = await req('/api/activity', { token: asha.token });
  const likeRows = activity.activity.filter((i) => i.type === 'like_group' && i.postId === post.post.id);
  const flatLikes = activity.activity.filter((i) => i.type === 'like');
  ok('3 likes collapse into ONE row', likeRows.length === 1 && flatLikes.length === 0, JSON.stringify(activity.activity.map((i) => i.type)));
  ok('like row carries count + faces', likeRows[0]?.count === 3 && likeRows[0]?.users?.length === 3);
  const commentRows = activity.activity.filter((i) => i.type === 'comment_group' && i.postId === post.post.id);
  ok('2 comments collapse into ONE row', commentRows.length === 1 && commentRows[0]?.count === 2);
  ok('comment row previews the latest comment', /second!/.test(commentRows[0]?.preview || ''), commentRows[0]?.preview);

  // ---------------- web push parity ----------------
  const webConfig = await req('/api/push/web-config', { token: bilal.token });
  ok('web push config exposes a VAPID public key', webConfig.enabled === true && /^B[A-Za-z0-9_-]{80,}$/.test(webConfig.publicKey || ''), String(webConfig.publicKey)?.slice(0, 12));

  const fakeSub = {
    endpoint: 'https://fcm.googleapis.com/fcm/send/dXPhase3-bilal',
    expirationTime: null,
    keys: { p256dh: 'BEl62iUY4UvlXV6ysYxDtQK-3KS2LcLXhSvAauq1U3yC0xJSTQbNBGzQ2Y8TLQ0Vn', auth: 'Unit Tests Auth Key' },
  };
  const subRes = await req('/api/push/web-subscription', { method: 'POST', token: bilal.token, body: { subscription: fakeSub } });
  ok('browser subscription registered', subRes.ok === true);
  const badSub = await req('/api/push/web-subscription', { method: 'POST', token: bilal.token, body: { subscription: { endpoint: 'x' } } })
    .then(() => null, (e) => e.status);
  ok('malformed subscription rejected (400)', badSub === 400);

  // Expo (android) + web (browser) both get the same push for one message.
  // (A and B are already contacts — the invite join made them community
  // co-members, which counts — so no request accept dance is needed.)
  await req('/api/push/token', { method: 'POST', token: bilal.token, body: { token: 'ExpoPushToken[phase3-b]', platform: 'android' } });
  const { chat } = await req('/api/chats/direct', { method: 'POST', token: asha.token, body: { userId: bilal.user.id } });

  sentPushes.length = 0; sentWebPushes.length = 0;
  const sockA = await new Promise((resolve, reject) => {
    const s = io(API, { auth: { token: asha.token }, transports: ['websocket'] });
    s.on('connect', () => resolve(s));
    s.on('connect_error', reject);
  });
  await emit(sockA, 'message:send', { chatId: chat.id, body: 'hello on every platform' });
  await sleep(500);

  const expoPush = sentPushes.find((p) => p.to === 'ExpoPushToken[phase3-b]');
  const webPush = sentWebPushes.find((w) => w.endpoint === fakeSub.endpoint);
  ok('android device got the push', !!expoPush);
  ok('browser got the push too (parity!)', !!webPush, JSON.stringify(sentWebPushes.map((w) => w.payload.body)));
  ok('web push carries the same deep link', webPush?.payload?.data?.route === 'chat' && webPush?.payload?.data?.chatId === chat.id);
  ok('web push carries title/body/badge', webPush?.payload?.title === 'Asha' && /every platform/.test(webPush?.payload?.body || '') && Number.isFinite(webPush?.payload?.badge));

  // Unregister stops browser pushes; a dead endpoint (410) is pruned.
  await req('/api/push/web-subscription', { method: 'DELETE', token: bilal.token, body: { endpoint: fakeSub.endpoint } });
  const goneSub = { ...fakeSub, endpoint: 'https://fcm.googleapis.com/fcm/send/gone-endpoint' };
  await req('/api/push/web-subscription', { method: 'POST', token: bilal.token, body: { subscription: goneSub } });
  // A second, healthy browser subscription that must survive the 410 prune.
  await req('/api/push/web-subscription', {
    method: 'POST', token: bilal.token,
    body: { subscription: { ...fakeSub, endpoint: 'https://fcm.googleapis.com/fcm/send/live-endpoint' } },
  });
  sentWebPushes.length = 0;
  await emit(sockA, 'message:send', { chatId: chat.id, body: 'after unsubscribe' });
  await sleep(500);
  ok('unregistered browser gets nothing', !sentWebPushes.some((w) => w.endpoint === fakeSub.endpoint));
  ok('dead endpoint (410) is dropped silently', !sentWebPushes.some((w) => w.endpoint === goneSub.endpoint));
  const db = require('./src/db');
  ok('dead endpoint pruned from the table', !db.prepare('SELECT 1 FROM web_push_subscriptions WHERE endpoint = ?').get(goneSub.endpoint));
  ok('live endpoint kept', !!db.prepare('SELECT 1 FROM web_push_subscriptions WHERE endpoint = ?').get('https://fcm.googleapis.com/fcm/send/live-endpoint'));

  sockA.disconnect();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error('test crashed:', e);
  process.exit(1);
});
