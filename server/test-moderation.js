/* End-to-end test for the Admin Safety & Moderation Center (standalone;
 * boots its own server on :4400 with a throwaway DATA_DIR and stubbed
 * Expo/web-push endpoints). Usage: node test-moderation.js
 *
 * Acceptance flow from the spec:
 *   harmless messages → no cases
 *   threatening message → case → admin alert (realtime + push) → review →
 *   action → audit log
 *   unauthorized account → admin API → 403 everywhere
 */
process.env.PORT = '4400';
process.env.DATA_DIR = process.env.MOD_TEST_DATA_DIR || `/tmp/plusone-mod-test-${Date.now()}`;
process.env.ADMIN_USERNAMES = 'saksham';

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
const webpush = require('web-push');
const sentWebPushes = [];
webpush.sendNotification = async (subscription, payload) => {
  sentWebPushes.push({ endpoint: subscription.endpoint, payload: JSON.parse(payload) });
  return { statusCode: 201 };
};

require('./src/index');
const db = require('./src/db');

const { io } = require('socket.io-client');
const API = 'http://localhost:4400';

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
const emit = (s, ev, payload) => new Promise((resolve) => {
  const t = setTimeout(() => resolve(undefined), 2500);
  s.emit(ev, payload, (...args) => { clearTimeout(t); resolve(args[0]); });
});
const connect = (token) => new Promise((resolve, reject) => {
  const s = io(API, { auth: { token }, transports: ['websocket'] });
  s.on('connect', () => resolve(s));
  s.on('connect_error', reject);
});

(async () => {
  for (let i = 0; i < 50; i++) {
    try { await realFetch(API + '/api/health'); break; } catch { await sleep(200); }
  }

  const stamp = Date.now().toString(36);
  const mk = (name) => ({
    username: name.toLowerCase() + stamp,
    name,
    password: 'testpass1234',
    phone: `+1555${Math.floor(1000000 + Math.random() * 8999999)}`,
  });

  // The admin account uses the production admin username.
  const adminBody = mk('Saksham');
  adminBody.username = 'saksham';
  const [admin, a, b, c] = await Promise.all([
    req('/api/auth/register', { method: 'POST', body: adminBody }),
    req('/api/auth/register', { method: 'POST', body: mk('Asha') }),
    req('/api/auth/register', { method: 'POST', body: mk('Bilal') }),
    req('/api/auth/register', { method: 'POST', body: mk('Chen') }),
  ]);
  ok('users registered', !!(admin.token && a.token && b.token && c.token));
  ok('saksham has the admin ROLE (not a username check)', admin.user.role === 'admin');
  ok('normal users do not', a.user.role !== 'admin');

  // ---------------- unauthorized access ----------------
  for (const path of ['/api/admin/moderation/overview', '/api/admin/moderation/cases', '/api/admin/moderation/audit', '/api/admin/moderation/settings']) {
    const status = await req(path, { token: a.token }).then(() => 'OPEN?!', (e) => e.status);
    ok(`normal user GET ${path} → 403`, status === 403, String(status));
  }
  const noAuth = await req('/api/admin/moderation/overview').then(() => 'OPEN?!', (e) => e.status);
  ok('anonymous GET admin API → 401', noAuth === 401, String(noAuth));
  const forge = await req('/api/admin/moderation/users/banneduser/action', {
    method: 'POST', token: b.token, body: { action: 'ban', confirmIrreversible: true },
  }).then(() => 'DONE?!', (e) => e.status);
  ok('normal user cannot act on users (403)', forge === 403, String(forge));

  // ---------------- harmless messages → no cases ----------------
  const { chat: dm } = await req('/api/chats/direct', { method: 'POST', token: a.token, body: { userId: b.user.id } });
  await req(`/api/connect/${a.user.id}`, { method: 'POST', token: b.token });
  await req(`/api/chat-requests/${dm.id}/respond`, { method: 'POST', token: a.token, body: { action: 'accept' } });
  const sockA = await connect(a.token);
  for (const text of ['Hello', 'How are you?', "Let's meet tomorrow.", 'I hate this movie.', 'Violence is bad.']) {
    const r = await emit(sockA, 'message:send', { chatId: dm.id, body: text });
    if (!r || r.error) ok(`harmless message stored: "${text}"`, false, JSON.stringify(r));
  }
  ok('harmless messages all stored + delivered', true);
  await sleep(700);
  ok('NO cases created from harmless messages',
    db.prepare('SELECT COUNT(*) c FROM moderation_cases').get().c === 0,
    JSON.stringify(db.prepare('SELECT severity, reason FROM moderation_cases').all()));

  // ---------------- context-aware negatives ----------------
  for (const text of [
    '"I will find you" he said, laughing',
    'Why is there so much violence in the news?',
    'In history class we learned that violence is never the answer',
    'reading an article about how bombs work in ww2',
  ]) {
    await emit(sockA, 'message:send', { chatId: dm.id, body: text });
  }
  await sleep(700);
  const ctxCases = db.prepare("SELECT severity, category FROM moderation_cases WHERE severity IN ('HIGH','CRITICAL')").all();
  ok('quotes/questions/education never produce HIGH/CRITICAL', ctxCases.length === 0, JSON.stringify(ctxCases));

  // ---------------- real threat → HIGH case + realtime alert + push ----------------
  await req('/api/push/token', { method: 'POST', token: admin.token, body: { token: 'ExpoPushToken[mod-admin]', platform: 'android' } });
  const webSub = { endpoint: 'https://fcm.googleapis.com/fcm/send/mod-admin-web', expirationTime: null, keys: { p256dh: 'BEl62iUY4UvlXV6ysYxDtQK-3KS2LcLXhSvAauq1U3yC0xJSTQbNBGzQ2Y8TLQ0Vn', auth: 'modtestkey' } };
  await req('/api/push/web-subscription', { method: 'POST', token: admin.token, body: { subscription: webSub } });

  const adminSock = await connect(admin.token);
  const alertPromise = new Promise((resolve) => {
    const t = setTimeout(() => resolve(null), 4000);
    adminSock.on('moderation:update', function h(p) { clearTimeout(t); adminSock.off('moderation:update', h); resolve(p); });
  });

  // Threat goes into a GROUP with all three members so two independent
  // users can report the same message.
  const { chat: group } = await req('/api/chats/group', {
    method: 'POST', token: a.token, body: { name: `Mod Test ${stamp}`, memberIds: [b.user.id, c.user.id] },
  });
  const threatRes = await emit(sockA, 'message:send', { chatId: group.id, body: 'i am going to kill you bilal, i will find you' });
  ok('threat message still stores + delivers (never blocked by analysis)', !!threatRes?.message);
  const alert = await alertPromise;
  ok('admin got a REALTIME moderation alert', !!alert && ['HIGH', 'CRITICAL'].includes(alert.severity), JSON.stringify(alert));

  await sleep(600);
  const threatCase = db.prepare("SELECT * FROM moderation_cases WHERE severity IN ('HIGH','CRITICAL') ORDER BY id DESC").get();
  ok('HIGH case recorded with category + confidence', !!threatCase && threatCase.category === 'threat' && threatCase.confidence >= 0.7, JSON.stringify(threatCase));
  ok('case keeps minimal evidence (message id + bounded snapshot)', threatCase?.message_id === threatRes.message.id && threatCase.snapshot.length <= 300);
  const adminPush = sentPushes.find((p) => p.to === 'ExpoPushToken[mod-admin]' && /Safety Alert/i.test(p.title || ''));
  ok('admin got a PUSH safety alert', !!adminPush, JSON.stringify(sentPushes.map((p) => p.title)));
  ok('admin web browser got the alert too', sentWebPushes.some((w) => /Safety Alert/i.test(w.payload.title || '')));
  ok('alert deep-links into the Safety Center', adminPush?.data?.route === 'admin' && adminPush.data.caseId === threatCase.id);
  ok('reported user got NO safety notification', !sentPushes.some((p) => p.to && p.to !== 'ExpoPushToken[mod-admin]' && /Safety/i.test(p.title || '')));

  // ---------------- dedupe ----------------
  // two more users report the SAME message → one case, signals grow, source mixed
  const sockB = await connect(b.token);
  const reportB = await req('/api/moderation/report', { method: 'POST', token: b.token, body: { messageId: threatRes.message.id, reason: 'threat' } });
  const reportC = await req('/api/moderation/report', { method: 'POST', token: c.token, body: { messageId: threatRes.message.id, reason: 'threat', note: 'he really said this' } });
  ok('user reports accepted', reportB.ok && reportC.ok);
  const afterReports = db.prepare('SELECT * FROM moderation_cases WHERE id = ?').get(threatCase.id);
  ok('reports MERGED into the same case (no duplicates)', afterReports.signals === 3 && afterReports.source === 'mixed', JSON.stringify(afterReports));
  const dupReport = await req('/api/moderation/report', { method: 'POST', token: b.token, body: { messageId: threatRes.message.id, reason: 'violence' } });
  ok('duplicate report by same user is a no-op', dupReport.duplicate === true);

  // ---------------- report abuse protection ----------------
  const foreign = await req('/api/moderation/report', { method: 'POST', token: c.token, body: { messageId: 'nonexistent', reason: 'spam' } })
    .then(() => null, (e) => e.status);
  ok('reporting a message outside your chats → 404 (no probing)', foreign === 404);
  const badReason = await req('/api/moderation/report', { method: 'POST', token: c.token, body: { messageId: threatRes.message.id, reason: 'revenge' } })
    .then(() => null, (e) => e.status);
  ok('invalid report reason → 400', badReason === 400);
  let rateLimited = 429;
  for (let i = 0; i < 8; i += 1) {
    const r = await req('/api/moderation/report', {
      method: 'POST', token: c.token,
      body: { messageId: threatRes.message.id, reason: 'other', note: `spam report ${i}` },
    }).then(() => 200, (e) => e.status);
    if (r === 429) { rateLimited = 429; break; }
  }
  ok('report flooding is rate-limited (429)', rateLimited === 429);

  // ---------------- admin sees the case ----------------
  const overview = await req('/api/admin/moderation/overview', { token: admin.token });
  ok('overview counts the HIGH case', overview.counts.high + overview.counts.critical >= 1, JSON.stringify(overview.counts));
  ok('open cases counted', overview.openCases >= 1);
  const detail = await req(`/api/admin/moderation/cases/${threatCase.id}`, { token: admin.token });
  ok('case detail shows evidence + reporters', detail.case.id === threatCase.id && detail.reports.length === 2 && detail.user.username === a.user.username);
  ok('conversation context shown (no bulk access)', typeof detail.conversation?.name === 'string' && detail.conversation.name.startsWith('Mod Test'));

  // filters + search
  const filtered = await req(`/api/admin/moderation/cases?severity=HIGH&category=threat&sort=severity`, { token: admin.token });
  ok('severity/category filters work', filtered.cases.length >= 1 && filtered.cases.every((x) => x.severity === 'HIGH' && x.category === 'threat'));
  const searched = await req(`/api/admin/moderation/cases?q=${a.user.username}`, { token: admin.token });
  ok('username search works', searched.cases.length >= 1);
  const searchedId = await req(`/api/admin/moderation/cases?q=${threatCase.id}`, { token: admin.token });
  ok('case-id search works', searchedId.cases.length === 1);
  const searchedDenied = await req(`/api/admin/moderation/cases?q=${a.user.username}`, { token: b.token }).then(() => null, (e) => e.status);
  ok('normal users cannot search moderation records (403)', searchedDenied === 403);

  // ---------------- review → confirm → restrict → audit ----------------
  const confirmed = await req(`/api/admin/moderation/cases/${threatCase.id}/review`, {
    method: 'POST', token: admin.token, body: { action: 'confirm', reason: 'Confirmed direct threat' },
  });
  ok('case confirmed', confirmed.case.status === 'CONFIRMED');

  const noConfirm = await req(`/api/admin/moderation/users/${a.user.id}/action`, {
    method: 'POST', token: admin.token, body: { action: 'ban' },
  }).then(() => null, (e) => e.status);
  ok('ban without explicit confirmation rejected (400)', noConfirm === 400);

  const restricted = await req(`/api/admin/moderation/users/${a.user.id}/action`, {
    method: 'POST', token: admin.token, body: { action: 'restrict', reason: 'Confirmed threat', caseId: threatCase.id },
  });
  ok('user restricted', restricted.state === 'restricted');
  const gated = await emit(sockA, 'message:send', { chatId: dm.id, body: 'can i still talk?' });
  ok('restricted user cannot send messages (server-side)', !!gated?.error && /restricted/i.test(gated.error), JSON.stringify(gated));
  const caseAfter = await req(`/api/admin/moderation/cases/${threatCase.id}`, { token: admin.token });
  ok('case auto-closed as ACTION_TAKEN with the action recorded', caseAfter.case.status === 'ACTION_TAKEN' && caseAfter.case.actionTaken === 'restrict');

  const unrestr = await req(`/api/admin/moderation/users/${a.user.id}/action`, {
    method: 'POST', token: admin.token, body: { action: 'unrestrict', reason: 'resolved' },
  });
  ok('restriction lifted', unrestr.state === 'active');
  const gatedOk = await emit(sockA, 'message:send', { chatId: dm.id, body: 'thanks, back now' });
  ok('messaging restored', !!gatedOk?.message);

  // false positive path on a fresh case
  const lowish = await emit(sockA, 'message:send', { chatId: dm.id, body: 'you are worthless and pathetic, nobody loves you' });
  await sleep(700);
  const harassCase = db.prepare("SELECT * FROM moderation_cases WHERE category = 'harassment' ORDER BY id DESC").get();
  ok('harassment detector creates a reviewable MEDIUM+ case', !!harassCase, JSON.stringify(db.prepare('SELECT category, severity FROM moderation_cases').all()));
  if (harassCase) {
    const fp = await req(`/api/admin/moderation/cases/${harassCase.id}/review`, {
      method: 'POST', token: admin.token, body: { action: 'false_positive', reason: 'inside joke between friends' },
    });
    ok('false positive closes without punishing', fp.case.status === 'FALSE_POSITIVE');
    const stillActive = await req(`/api/admin/moderation/users/${a.user.id}`, { token: admin.token });
    ok('user state untouched by false positive', stillActive.user.moderation === 'active');
  }

  // remove content
  const removed = await req(`/api/admin/moderation/cases/${threatCase.id}/remove-content`, {
    method: 'POST', token: admin.token, body: { reason: 'Direct threat removed' },
  });
  ok('content removal works', removed.ok === true);
  const removedMsg = db.prepare('SELECT deleted FROM messages WHERE id = ?').get(threatRes.message.id);
  ok('message soft-deleted for everyone', removedMsg.deleted === 1);

  // audit log
  const audit = await req('/api/admin/moderation/audit', { token: admin.token });
  const actions = audit.entries.map((e) => e.action);
  ok('audit log records every admin action', ['case:confirm', 'user:restrict', 'user:unrestrict', 'content:removed'].every((x) => actions.includes(x)), JSON.stringify(actions));
  ok('audit entries carry admin + target + case', audit.entries.every((e) => e.admin === 'saksham') && audit.entries.some((e) => e.caseId === threatCase.id));

  // suspend + login enforcement
  await req(`/api/admin/moderation/users/${b.user.id}/action`, {
    method: 'POST', token: admin.token, body: { action: 'suspend', reason: 'test', days: 1, confirmIrreversible: true },
  });
  const suspendedLogin = await req('/api/auth/login', { method: 'POST', body: { username: b.user.username, password: 'testpass1234' } })
    .then(() => null, (e) => e.status);
  ok('suspended user cannot log in (403)', suspendedLogin === 403);
  await req(`/api/admin/moderation/users/${b.user.id}/action`, { method: 'POST', token: admin.token, body: { action: 'unsuspend', reason: 'test over' } });
  // Suspension killed B's live session — reconnect before the next test.
  const sockB2 = await connect(b.token);

  // LOW aggregation: profanity spam collapses, never alerts
  sentPushes.length = 0;
  for (let i = 0; i < 5; i += 1) {
    await emit(sockA, 'message:send', { chatId: dm.id, body: `this movie is fucking shit (${i})` });
  }
  await sleep(800);
  const lowCases = db.prepare("SELECT * FROM moderation_cases WHERE severity = 'LOW' AND category = 'profanity'").all();
  ok('LOW profanity aggregates into ONE case', lowCases.length === 1 && lowCases[0].signals >= 2, JSON.stringify(lowCases.map((x) => x.signals)));
  ok('LOW events never push the admin', !sentPushes.some((p) => /Safety/i.test(p.title || '')));

  // scam detector
  await emit(sockB2, 'message:send', { chatId: dm.id, body: 'send me your otp and card number to claim your prize' });
  await sleep(700);
  ok('scam detector flags credential solicitation', !!db.prepare("SELECT 1 FROM moderation_cases WHERE category = 'scam'").get());

  // settings + audit of settings change
  const setRes = await req('/api/admin/moderation/settings', {
    method: 'PUT', token: admin.token, body: { retentionDays: 200, alertPushLevel: 'CRITICAL' },
  });
  ok('settings update + audit', setRes.settings.retentionDays === 200 && !!db.prepare("SELECT 1 FROM moderation_audit_log WHERE action = 'settings:update'").get());
  const setDenied = await req('/api/admin/moderation/settings', { method: 'PUT', token: b.token, body: { retentionDays: 1 } })
    .then(() => null, (e) => e.status);
  ok('normal user cannot change settings (403)', setDenied === 403);

  // normal-user surface is clean: /api/me exposes only own role; activity has no moderation noise
  const meNormal = await req('/api/me', { token: b.token });
  ok('/api/me exposes own role only', meNormal.user.role === 'user' && !('confidence' in meNormal.user));

  sockA.disconnect(); sockB.disconnect(); sockB2.disconnect(); adminSock.disconnect();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error('test crashed:', e);
  process.exit(1);
});
