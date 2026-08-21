/* ------------------------------------------------------------------ */
/* push notifications — Expo Push, Android-first                      */
/* ------------------------------------------------------------------ */
/*
 * The server emits pushes at the same moments it emits socket events:
 * new chat messages (incl. group mentions), message/connect requests,
 * colleague requests, likes/comments on your Network posts, community
 * join approvals, and incoming calls. Tapping the notification deep-links
 * straight to the relevant screen via the `data.route` payload:
 *
 *   { route: 'chat',       chatId }             -> that Conversation
 *   { route: 'activity' }                        -> Activity inbox
 *   { route: 'colleagues' }                      -> Colleagues tab
 *   { route: 'network',    postId? }             -> Network feed
 *
 * Every push respects, server-side:
 *   - the recipient's notification settings (PATCH /api/me/settings)
 *   - per-chat mute (chat_members.muted) — a muted chat never pings
 *   - quiet hours (settings.notifications.quietHours, in the recipient's
 *     own timezone): pushes are still delivered, but silently — a separate
 *     low-importance Android channel and no sound, so nothing buzzes at 3am
 *     while the message is still there in the morning.
 *
 * No credentials are needed here: the Expo Push API needs no server key,
 * and Android FCM credentials are managed by EAS (see APP_STATUS.md).
 * All sends are fire-and-forget with error logging — a push failure must
 * never fail the message/like/call that triggered it.
 */
const db = require('./db');

const EXPO_PUSH_SEND_URL = 'https://exp.host/--/api/v2/push/send';
const EXPO_CHUNK = 100; // Expo's documented max messages per request

const now = () => Date.now();

/* Injected by index.js to avoid a circular require (getSettings lives there). */
let getUser = () => null;
let getSettings = () => ({ notifications: {}, privacy: {} });
function init({ getUser: getUserFn, getSettings: getSettingsFn }) {
  getUser = getUserFn;
  getSettings = getSettingsFn;
}

/* Android notification channels the client creates (see app/src/push).
 * The `-silent` twins exist because Android plays the CHANNEL's sound, not
 * the message's — quiet hours can only be quiet by switching channels. */
const CHANNELS = {
  messages: 'messages',
  messagesQuiet: 'messages-silent',
  calls: 'calls',
  callsQuiet: 'calls-silent',
  activity: 'activity',
  activityQuiet: 'activity-silent',
};

/* ------------------------------------------------------------------ */
/* quiet hours                                                        */
/* ------------------------------------------------------------------ */

/* qh: { enabled, startMinute, endMinute, tzOffsetMinutes } where minutes are
 * 0..1439 local wall-clock and tzOffsetMinutes is minutes EAST of UTC (i.e.
 * -(new Date().getTimezoneOffset()) on the client). A window that wraps
 * midnight (e.g. 22:00 -> 07:00) is the normal case. */
function isQuietHours(qh, at = Date.now()) {
  if (!qh || !qh.enabled) return false;
  const { startMinute, endMinute } = qh;
  if (!Number.isFinite(startMinute) || !Number.isFinite(endMinute)) return false;
  if (startMinute === endMinute) return false; // zero-length window = off
  // Shift the instant into the user's local wall clock, then read it as UTC.
  const local = new Date(at + (Number(qh.tzOffsetMinutes) || 0) * 60000);
  const minutes = local.getUTCHours() * 60 + local.getUTCMinutes();
  return startMinute < endMinute
    ? minutes >= startMinute && minutes < endMinute
    : minutes >= startMinute || minutes < endMinute;
}

/* ------------------------------------------------------------------ */
/* badge                                                             */
/* ------------------------------------------------------------------ */

/* Launcher/icon badge = unread chat messages (archived chats excluded,
 * "deleted for me" cutoffs respected) + pending requests waiting in
 * Activity (message requests, colleague requests, community join requests
 * where you admin). Matches what the app already renders, so the number
 * agrees everywhere. */
function badgeFor(userId) {
  const unread = db
    .prepare(
      `SELECT COUNT(*) c FROM messages m
       JOIN chats c ON c.id = m.chat_id
       JOIN chat_members cm ON cm.chat_id = m.chat_id AND cm.user_id = ?
       WHERE m.sender_id != ? AND m.sender_id != 'system' AND m.type != 'system'
         AND m.created_at > COALESCE(cm.cleared_at, 0)
         AND instr(',' || COALESCE(c.archived_by, '') || ',', ',' || ? || ',') = 0
         AND NOT EXISTS (SELECT 1 FROM receipts r WHERE r.message_id = m.id AND r.user_id = ? AND r.state = 'read')`
    )
    .get(userId, userId, userId, userId).c;
  const chatRequests = db
    .prepare("SELECT COUNT(*) c FROM chat_requests WHERE receiver_id = ? AND status = 'pending'")
    .get(userId).c;
  const colleagueRequests = db
    .prepare("SELECT COUNT(*) c FROM colleague_requests WHERE receiver_id = ? AND status = 'pending'")
    .get(userId).c;
  const communityRequests = db
    .prepare(
      `SELECT COUNT(*) c FROM community_requests r
       JOIN community_members m ON m.community_id = r.community_id AND m.user_id = ? AND m.role = 'admin'`
    )
    .get(userId).c;
  return unread + chatRequests + colleagueRequests + communityRequests;
}

/* ------------------------------------------------------------------ */
/* sending                                                           */
/* ------------------------------------------------------------------ */

async function sendToExpo(messages) {
  for (let i = 0; i < messages.length; i += EXPO_CHUNK) {
    const chunk = messages.slice(i, i + EXPO_CHUNK);
    try {
      const res = await fetch(EXPO_PUSH_SEND_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(chunk),
      });
      const body = await res.json().catch(() => null);
      if (!body || !Array.isArray(body.data)) continue;
      // Prune dead registrations so the table stays honest. Any other error
      // (MessageTooBig, InvalidCredentials, …) is logged, never thrown.
      body.data.forEach((r, idx) => {
        if (r && r.status === 'error') {
          if (r.details?.error === 'DeviceNotRegistered') {
            const token = chunk[idx]?.to;
            if (token) db.prepare('DELETE FROM push_tokens WHERE token = ?').run(token);
          } else {
            console.warn('[push] expo error:', r.details?.error || 'unknown', JSON.stringify(r.message || '').slice(0, 120));
          }
        }
      });
    } catch (e) {
      // Network hiccup talking to Expo — nothing to do, next event retries.
      console.warn('[push] send failed:', e?.message || e);
    }
  }
}

/**
 * Core fan-out. `opts`:
 *   userId        recipient (rules are evaluated per recipient)
 *   settingKey    key under settings.notifications that gates this push
 *   chatId        optional — per-chat mute is checked when present
 *   title / body  notification text
 *   data          deep-link payload ({ route, chatId?, postId? })
 *   channel       one of 'messages' | 'calls' | 'activity' (picks the quiet twin automatically)
 *   priority      Android pre-8 urgency; channel importance owns it on 8+
 *   callSound     true for the ringing call channel
 */
async function pushToUser(userId, opts) {
  try {
    const u = getUser(userId);
    if (!u) return;
    const settings = getSettings(u);
    const n = settings.notifications || {};
    if (opts.settingKey && n[opts.settingKey] === false) return;

    // Per-chat mute: a muted chat never pings, exactly like WhatsApp.
    if (opts.chatId) {
      const member = db
        .prepare('SELECT muted FROM chat_members WHERE chat_id = ? AND user_id = ?')
        .get(opts.chatId, userId);
      if (member?.muted) return;
    }

    const quiet = isQuietHours(n.quietHours);
    const channelBase = opts.channel || 'messages';
    const channelId = quiet
      ? (channelBase === 'calls' ? CHANNELS.callsQuiet : channelBase === 'activity' ? CHANNELS.activityQuiet : CHANNELS.messagesQuiet)
      : (channelBase === 'calls' ? CHANNELS.calls : channelBase === 'activity' ? CHANNELS.activity : CHANNELS.messages);

    const tokens = db.prepare('SELECT token FROM push_tokens WHERE user_id = ?').all(userId);
    if (!tokens.length) return;

    const badge = badgeFor(userId);
    const messages = tokens.map(({ token }) => ({
      to: token,
      title: String(opts.title || '+one').slice(0, 120),
      body: String(opts.body || '').slice(0, 240),
      sound: quiet ? null : (opts.sound === null ? null : 'default'),
      badge: Number.isFinite(badge) ? badge : undefined,
      channelId,
      priority: quiet ? 'normal' : (opts.priority || 'default'),
      interruptionLevel: quiet ? 'passive' : (opts.callSound ? 'timeSensitive' : 'default'),
      data: { ...(opts.data || {}), type: opts.type || 'message' },
    }));
    await sendToExpo(messages);
  } catch (e) {
    console.warn('[push] skipped:', e?.message || e);
  }
}

/* ------------------------------------------------------------------ */
/* message preview (respects the messagePreview privacy toggle)        */
/* ------------------------------------------------------------------ */

function messagePreview(message, recipientSettings) {
  const n = recipientSettings?.notifications || {};
  if (n.messagePreview === false) return 'New message';
  const body = String(message.body || '').trim();
  switch (message.type) {
    case 'text': return body.slice(0, 140) || 'Sent a message';
    case 'poll': return `📊 Poll: ${body.slice(0, 120)}`;
    case 'voice': return '🎤 Voice message';
    case 'image': return body ? `📷 ${body.slice(0, 120)}` : '📷 Photo';
    default: return 'Sent an attachment';
  }
}

/* @mention detection for group chats — matches the recipient's @username
 * with a word boundary so @amit doesn't fire for @amita. */
function mentionsUser(body, username) {
  if (!username || !body) return false;
  const escaped = String(username).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`@${escaped}(?![a-zA-Z0-9_])`, 'i').test(String(body));
}

/* ------------------------------------------------------------------ */
/* event helpers (called from index.js right after each socket emit)   */
/* ------------------------------------------------------------------ */

/**
 * A new real message (text/photo/voice/poll, including forwards and status
 * replies) was persisted in `chatId`. Pushes every member except the sender,
 * skipping muted chats, honoring previews, and calling out group mentions.
 */
function notifyMessage({ chatId, chat, message, senderId, excludeIds = [] }) {
  const sender = getUser(senderId);
  if (!sender || !message || message.type === 'system' || message.sender_id === 'system') return;
  const chatRow = chat || db.prepare('SELECT * FROM chats WHERE id = ?').get(chatId);
  if (!chatRow) return;
  const members = db
    .prepare(
      `SELECT u.id, u.username, u.name, cm.muted FROM chat_members cm
       JOIN users u ON u.id = cm.user_id WHERE cm.chat_id = ?`
    )
    .all(chatId);
  const skip = new Set([senderId, ...excludeIds, 'system']);

  members.forEach((m) => {
    if (skip.has(m.id)) return;
    const settings = getSettings(getUser(m.id));
    if (settings.notifications?.messages === false) return;
    if (m.muted) return;

    const mentioned = chatRow.type === 'group' && mentionsUser(message.body, m.username);
    const preview = messagePreview(message, settings);
    const title = chatRow.type === 'group' ? (chatRow.name || 'Group chat') : sender.name;
    const body = chatRow.type === 'group'
      ? (mentioned ? `${sender.name} mentioned you: ${preview}` : `${sender.name}: ${preview}`)
      : preview;

    pushToUser(m.id, {
      settingKey: 'messages',
      chatId,
      channel: 'messages',
      priority: mentioned ? 'high' : 'default',
      type: mentioned ? 'mention' : 'message',
      title,
      body,
      data: { route: 'chat', chatId },
    }).catch(() => {});
  });
}

/** A message/connect request landed in someone's Activity inbox. */
function notifyChatRequest({ request, senderId, chatId, message = null }) {
  const sender = getUser(senderId);
  if (!sender || !request) return;
  const receiverSettings = getSettings(getUser(request.receiver_id));
  const body = message
    ? `wants to connect — "${messagePreview(message, receiverSettings).slice(0, 80)}"`
    : 'wants to connect with you';
  pushToUser(request.receiver_id, {
    settingKey: 'activity',
    channel: 'activity',
    type: 'request',
    title: sender.name,
    body,
    data: { route: 'activity', chatId },
  }).catch(() => {});
}

/** Colleague request (Colleagues tab). */
function notifyColleagueRequest({ targetId, sender }) {
  if (!sender || !targetId) return;
  pushToUser(targetId, {
    settingKey: 'activity',
    channel: 'activity',
    type: 'colleague',
    title: sender.name,
    body: `@${sender.username || 'someone'} wants to be your colleague`,
    data: { route: 'colleagues' },
  }).catch(() => {});
}

/** Someone liked your Network post. */
function notifyPostLike({ ownerId, actor, post }) {
  if (!ownerId || !actor || ownerId === actor.id) return;
  const preview = (post?.title || post?.body || (post?.media_url ? 'your photo' : 'your post')).slice(0, 60);
  pushToUser(ownerId, {
    settingKey: 'reactions',
    channel: 'activity',
    type: 'like',
    title: actor.name,
    body: `liked ${preview}`,
    data: { route: 'network', postId: post?.id },
  }).catch(() => {});
}

/** Someone commented on your Network post. */
function notifyPostComment({ ownerId, actor, post, body }) {
  if (!ownerId || !actor || ownerId === actor.id) return;
  const preview = (post?.title || post?.body || (post?.media_url ? 'your photo' : 'your post')).slice(0, 60);
  pushToUser(ownerId, {
    settingKey: 'reactions',
    channel: 'activity',
    type: 'comment',
    title: actor.name,
    body: `commented on ${preview}: "${String(body || '').slice(0, 90)}"`,
    data: { route: 'network', postId: post?.id },
  }).catch(() => {});
}

/** Incoming call (ringing now). Highest priority channel. */
function notifyIncomingCall({ calleeId, caller, call, chatId }) {
  if (!calleeId || !caller) return;
  pushToUser(calleeId, {
    settingKey: 'calls',
    chatId,
    channel: 'calls',
    priority: 'max',
    callSound: true,
    type: 'call',
    title: caller.name,
    body: `Incoming ${call?.type === 'video' ? 'video' : 'voice'} call`,
    data: { route: 'chat', chatId, callId: call?.id },
  }).catch(() => {});
}

/** Community join request — notifies every admin. */
function notifyCommunityRequest({ adminIds = [], requester, community }) {
  if (!requester || !community) return;
  adminIds.forEach((adminId) => {
    pushToUser(adminId, {
      settingKey: 'communityActivity',
      channel: 'activity',
      type: 'community_request',
      title: requester.name,
      body: `asked to join ${community.name}`,
      data: { route: 'activity' },
    }).catch(() => {});
  });
}

/** Your community join request was approved. */
function notifyCommunityApproved({ userId, community }) {
  if (!userId || !community) return;
  pushToUser(userId, {
    settingKey: 'communityActivity',
    channel: 'activity',
    type: 'community_approved',
    title: 'Request approved',
    body: `You're in — welcome to ${community.name}`,
    data: { route: 'network' },
  }).catch(() => {});
}

/* ------------------------------------------------------------------ */
/* token registry (REST endpoints in index.js call these)             */
/* ------------------------------------------------------------------ */

const PLATFORMS = new Set(['android', 'ios', 'web']);

function registerToken(userId, { token, platform, deviceId, appVersion }) {
  const clean = String(token || '').trim();
  if (clean.length < 10 || clean.length > 400) throw new Error('Invalid push token');
  const plat = PLATFORMS.has(platform) ? platform : 'android';
  const t = now();
  db.prepare(
    `INSERT INTO push_tokens (token, user_id, platform, device_id, app_version, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?)
     ON CONFLICT(token) DO UPDATE SET
       user_id = excluded.user_id,
       platform = excluded.platform,
       device_id = COALESCE(excluded.device_id, push_tokens.device_id),
       app_version = excluded.app_version,
       updated_at = excluded.updated_at`
  ).run(clean, userId, plat, deviceId ? String(deviceId).slice(0, 120) : null, appVersion ? String(appVersion).slice(0, 40) : null, t, t);
  return { token: clean, platform: plat };
}

function unregisterToken(userId, token) {
  if (!token) return false;
  // Scoped to this user: one account can never delete another's registration.
  const result = db.prepare('DELETE FROM push_tokens WHERE user_id = ? AND token = ?').run(userId, String(token));
  return result.changes > 0;
}

/** For the Notifications screen: which devices will ring, plus quiet hours. */
function describeFor(userId) {
  const rows = db
    .prepare('SELECT platform, app_version, updated_at FROM push_tokens WHERE user_id = ? ORDER BY updated_at DESC')
    .all(userId);
  return { devices: rows.map((r) => ({ platform: r.platform, appVersion: r.app_version, lastSeen: r.updated_at })) };
}

module.exports = {
  init,
  isQuietHours,
  badgeFor,
  notifyMessage,
  notifyChatRequest,
  notifyColleagueRequest,
  notifyPostLike,
  notifyPostComment,
  notifyIncomingCall,
  notifyCommunityRequest,
  notifyCommunityApproved,
  registerToken,
  unregisterToken,
  describeFor,
};
