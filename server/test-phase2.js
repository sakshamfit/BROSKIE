/* End-to-end test for Phase 2 — the daily campus loop (standalone; boots its
 * own server on :4200 with a throwaway DATA_DIR and a stubbed Expo endpoint).
 * Usage: node test-phase2.js
 *
 * Covers:
 *   - follow / unfollow (incl. self-follow 400, double-follow 409)
 *   - Network feed filters: worldwide / my places / following
 *   - post audience "places" (My college / My workplace): visibility + likes
 *   - "I'm around": 12h flag, Today payload, push to place-sharers, expiry sweep
 *   - Today at your place: around + online + today's posts from sharers only
 *   - greeter summary: placesPostersToday / aroundNow
 *   - pushes: "from your college posted" (sharers) and "posted:" (followers)
 */
process.env.PORT = '4200';
process.env.DATA_DIR = process.env.PHASE2_TEST_DATA_DIR || `/tmp/plusone-phase2-test-${Date.now()}`;

const sentPushes = [];
const realFetch = global.fetch;
global.fetch = async (url, opts) => {
  if (String(url).includes('exp.host')) {
    const body = JSON.parse(opts?.body || '[]');
    sentPushes.push(...body);
    return { ok: true, json: async () => ({ data: body.map(() => ({ status: 'ok' })) }) };
  }
  return realFetch(url, opts);
};

require('./src/index');

const { io } = require('socket.io-client');
const API = 'http://localhost:4200';

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

  // Register push tokens up front so the push assertions have real recipients.
  await Promise.all([
    ['b', bilal], ['c', chen], ['d', dev],
  ].map(([suffix, u]) => req('/api/push/token', {
    method: 'POST', token: u.token,
    body: { token: `ExpoPushToken[test-${suffix}]`, platform: 'android' },
  })));
  ok('push tokens registered', true);

  // ---- shared place: A, B, C join the same college; D is an outsider ----
  const { affiliation } = await req('/api/affiliations', { method: 'POST', token: asha.token, body: { name: `Phase2 College ${stamp}`, type: 'institution' } });
  await req(`/api/affiliations/${affiliation.id}/join`, { method: 'POST', token: bilal.token });
  await req(`/api/affiliations/${affiliation.id}/join`, { method: 'POST', token: chen.token });
  ok('three users share a college', !!affiliation.id);

  // ---- follow ----
  const followRes = await req(`/api/users/${asha.user.id}/follow`, { method: 'POST', token: dev.token });
  ok('D follows A', followRes.following === true);
  const dup = await req(`/api/users/${asha.user.id}/follow`, { method: 'POST', token: dev.token }).then(() => null, (e) => e.status);
  ok('double follow is 409', dup === 409);
  const self = await req(`/api/users/${dev.user.id}/follow`, { method: 'POST', token: dev.token }).then(() => null, (e) => e.status);
  ok('self follow is 400', self === 400);

  // ---- feed filters ----
  const worldPost = await req('/api/posts', { method: 'POST', token: asha.token, body: { body: 'worldwide post from Asha' } });
  const devWorld = await req('/api/posts?filter=worldwide', { token: dev.token });
  ok('worldwide feed includes stranger', devWorld.posts.some((p) => p.id === worldPost.post.id));
  const bilalPlaces = await req('/api/posts?filter=places', { token: bilal.token });
  ok('places feed includes college-mate', bilalPlaces.posts.some((p) => p.id === worldPost.post.id));
  const bilalFollowingEmpty = await req('/api/posts?filter=following', { token: bilal.token });
  ok('following feed empty before following anyone', !bilalFollowingEmpty.posts.some((p) => p.userId === asha.user.id));
  await req(`/api/users/${asha.user.id}/follow`, { method: 'POST', token: bilal.token });
  const bilalFollowing = await req('/api/posts?filter=following', { token: bilal.token });
  ok('following feed shows followed author', bilalFollowing.posts.some((p) => p.userId === asha.user.id));
  const devPlaces = await req('/api/posts?filter=places', { token: dev.token });
  ok('places feed excludes non-sharer (D sees only own)', devPlaces.posts.every((p) => p.userId === dev.user.id));
  const hydratedForDev = devWorld.posts.find((p) => p.id === worldPost.post.id);
  ok('hydratePost marks following for D', hydratedForDev.following === true);

  // ---- audience "places" ----
  const placesPost = await req('/api/posts', { method: 'POST', token: asha.token, body: { body: 'college-only post', audience: 'places' } });
  ok('places post created', !!placesPost.post.id);
  const bilalWorld = await req('/api/posts?filter=worldwide', { token: bilal.token });
  ok('college-mate sees places post', bilalWorld.posts.some((p) => p.id === placesPost.post.id));
  const devWorld2 = await req('/api/posts?filter=worldwide', { token: dev.token });
  ok('outsider cannot see places post', !devWorld2.posts.some((p) => p.id === placesPost.post.id));
  const devLike = await req(`/api/posts/${placesPost.post.id}/like`, { method: 'POST', token: dev.token }).then(() => 'liked', (e) => e.status);
  ok('outsider cannot like places post (403)', devLike === 403);
  await req(`/api/posts/${placesPost.post.id}/like`, { method: 'POST', token: bilal.token });
  ok('college-mate can like places post', true);
  const noAffilPlaces = await req('/api/posts', { method: 'POST', token: dev.token, body: { body: 'x', audience: 'places' } }).then(() => null, (e) => e.status);
  ok('posting to places without a place is 400', noAffilPlaces === 400);

  // ---- pushes: college post + follower post ----
  sentPushes.length = 0;
  const pushPost = await req('/api/posts', { method: 'POST', token: asha.token, body: { body: 'push me', audience: 'places' } });
  await sleep(400);
  const bilalPushes = sentPushes.filter((p) => /from your college posted/.test(p.body || ''));
  ok('college-mates got "from your college posted"', bilalPushes.length >= 2, JSON.stringify(sentPushes.map((p) => p.body)));
  ok('push routes to network', bilalPushes[0]?.data?.route === 'network');
  sentPushes.length = 0;
  await req('/api/posts', { method: 'POST', token: asha.token, body: { body: 'for my followers' } });
  await sleep(400);
  const followerPush = sentPushes.find((p) => /posted: for my followers/.test(p.body || ''));
  ok('follower got plain "posted:" push', !!followerPush, JSON.stringify(sentPushes.map((p) => p.body)));

  // ---- I'm around ----
  sentPushes.length = 0;
  const aroundRes = await req('/api/me/around', { method: 'POST', token: asha.token, body: { around: true } });
  ok('around flag set with 12h window', aroundRes.around === true && aroundRes.expiresAt > Date.now() + 11.5 * 3600 * 1000);
  await sleep(400);
  const aroundPushes = sentPushes.filter((p) => /is around/.test(p.body || ''));
  ok('place-sharers got "is around" push', aroundPushes.length >= 2, JSON.stringify(sentPushes.map((p) => p.body)));
  ok('outsider got no around push', !aroundPushes.some((p) => p.to === 'ExpoPushToken[test-d]'));

  // ---- Today at your place ----
  
  const sockAsha = io(API, { auth: { token: asha.token }, transports: ['websocket'] });
  await sleep(600); // presence: is_online flips on socket connect
  const today = await req(`/api/today?since=${Date.now() - 3600 * 1000}`, { token: bilal.token });
  ok('today lists Asha as around', today.around.some((a) => a.user.id === asha.user.id));
  ok('today lists Asha as online', (today.around.concat(today.online)).some((u) => (u.user?.id || u.id) === asha.user.id));
  ok('today shows college posts from today', today.posts.some((p) => p.userId === asha.user.id));
  ok('today excludes outsider posts', !today.posts.some((p) => p.userId === dev.user.id));
  ok('today carries my around state', today.me.around === false);
  ok('today place label', today.placeLabel === 'college', today.placeLabel);
  const devToday = await req('/api/today', { token: dev.token });
  ok('outsider today is empty of sharers', devToday.around.length === 0 && devToday.online.length === 0);

  // ---- greeter summary ----
  const greet = await req(`/api/greeting-summary?since=${Date.now() - 3600 * 1000}`, { token: bilal.token });
  ok('summary counts today’s college posters', greet.summary.placesPostersToday >= 1, JSON.stringify(greet.summary));
  ok('summary counts people around now', greet.summary.aroundNow >= 1);

  // ---- around expiry + clear ----
  const db = require('./src/db');
  db.prepare('UPDATE around_status SET expires_at = 1').run();
  const todayAfterExpiry = await req('/api/today', { token: bilal.token });
  ok('expired around flags disappear', todayAfterExpiry.around.length === 0);
  const summaryAfter = await req('/api/greeting-summary', { token: bilal.token });
  ok('summary aroundNow resets after expiry', summaryAfter.summary.aroundNow === 0);
  await req('/api/me/around', { method: 'POST', token: chen.token, body: { around: true } });
  const clearRes = await req('/api/me/around', { method: 'POST', token: chen.token, body: { around: false } });
  ok('explicit "not around" clears the flag', clearRes.around === false && clearRes.expiresAt === null);

  // ---- unfollow ----
  const unfollow = await req(`/api/users/${asha.user.id}/follow`, { method: 'DELETE', token: dev.token });
  ok('unfollow works', unfollow.following === false);
  await req(`/api/users/${asha.user.id}/follow`, { method: 'DELETE', token: dev.token });
  ok('unfollow is idempotent', true);
  const devWorld3 = await req('/api/posts?filter=worldwide', { token: dev.token });
  const hydrateAfter = devWorld3.posts.find((p) => p.id === worldPost.post.id);
  ok('following flag resets after unfollow', hydrateAfter.following === false);

  sockAsha.disconnect();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error('test crashed:', e);
  process.exit(1);
});
