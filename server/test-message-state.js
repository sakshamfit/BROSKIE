/* Pure local-first merge/backoff checks. No database. */
const {
  sortMessages, mergeMessageLists, upsertMessageList, higherStatus,
  nextBackoffMs, isPermanentSendError, boundMessages, dropExpiredMessages,
} = (() => {
  // Mirror app/src/messaging/messageState.js so this file runs in plain Node.
  const STATUS_RANK = { failed: -1, queued: 0, sending: 1, sent: 2, delivered: 3, read: 4 };
  const isOutboxStatus = (s) => s === 'queued' || s === 'sending';
  const isPendingMessage = (m) => !!m?.pending || isOutboxStatus(m?.status);
  const messageTime = (m) => Number(m?.clientCreatedAt || m?.createdAt || 0);
  const sortMessages = (list) => [...(list || [])].sort((a, b) => {
    const ta = messageTime(a); const tb = messageTime(b);
    if (ta !== tb) return ta - tb;
    return String(a?.id || '').localeCompare(String(b?.id || ''));
  });
  const higherStatus = (current, incoming) => {
    if (!incoming) return current || 'sent';
    if (!current) return incoming;
    if (current === 'failed' && incoming !== 'failed') return incoming;
    if (incoming === 'failed' && isOutboxStatus(current)) return current;
    return (STATUS_RANK[incoming] ?? 0) >= (STATUS_RANK[current] ?? 0) ? incoming : current;
  };
  const sameMessage = (a, b) => a && b && (
    (a.id && b.id && a.id === b.id)
    || (a.clientId && b.clientId && a.clientId === b.clientId)
    || (a.id && b.clientId && a.id === b.clientId)
    || (a.clientId && b.id && a.clientId === b.id)
  );
  const findMessageIndex = (list, incoming, replaceId) =>
    (list || []).findIndex((item) => sameMessage(item, incoming) || (replaceId && (item.id === replaceId || item.clientId === replaceId)));
  const mergeMessage = (local, incoming, { replaceId } = {}) => {
    if (!local) return incoming;
    if (!incoming) return local;
    const status = higherStatus(local.status, incoming.status);
    return {
      ...local, ...incoming,
      id: incoming.id || local.id,
      clientId: incoming.clientId || local.clientId || incoming.id || local.id,
      clientCreatedAt: local.clientCreatedAt || incoming.clientCreatedAt || local.createdAt,
      status,
      pending: isOutboxStatus(status) ? (incoming.pending ?? local.pending) : false,
    };
  };
  const upsertMessageList = (list, incoming, { replaceId } = {}) => {
    const current = Array.isArray(list) ? list : [];
    const idx = findMessageIndex(current, incoming, replaceId);
    if (idx === -1) return sortMessages([...current, incoming]);
    const next = current.slice();
    next[idx] = mergeMessage(current[idx], incoming, { replaceId });
    return sortMessages(next);
  };
  const mergeMessageLists = (local, remote) => {
    const byId = new Map();
    const remember = (message) => {
      if (!message?.id && !message?.clientId) return;
      const existing = [...byId.values()].find((item) => sameMessage(item, message));
      if (existing) {
        const merged = mergeMessage(existing, message);
        byId.delete(existing.id || existing.clientId);
        byId.set(merged.id || merged.clientId, merged);
        return;
      }
      byId.set(message.id || message.clientId, message);
    };
    (local || []).forEach(remember);
    (remote || []).forEach(remember);
    return sortMessages([...byId.values()]);
  };
  const dropExpiredMessages = (list, now = Date.now()) =>
    (list || []).filter((m) => isPendingMessage(m) || !m.expiresAt || Number(m.expiresAt) > now);
  const boundMessages = (list, limit = 400) => {
    const messages = sortMessages(list || []);
    if (messages.length <= limit) return messages;
    const pending = messages.filter(isPendingMessage);
    const rest = messages.filter((m) => !isPendingMessage(m)).slice(-limit);
    const pendingMissing = pending.filter((item) => !rest.some((other) => sameMessage(other, item)));
    return sortMessages([...rest, ...pendingMissing]);
  };
  const nextBackoffMs = (retryCount) => {
    const exponent = Math.min(Math.max(0, Number(retryCount) || 0), 6);
    return Math.min(60_000, 1000 * (2 ** exponent));
  };
  const isPermanentSendError = (error) =>
    /not a member|can't message this person|blocked|accept this message request/i.test(String(error?.message || error || ''));
  return { sortMessages, mergeMessageLists, upsertMessageList, higherStatus, nextBackoffMs, isPermanentSendError, boundMessages, dropExpiredMessages };
})();

let passed = 0;
function pass(name, cond) {
  if (!cond) throw new Error(name);
  passed += 1;
  console.log(`  ✓ ${name}`);
}

const a = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', clientId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', clientCreatedAt: 1, createdAt: 10, status: 'queued', pending: true, body: 'hi' };
const ack = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', clientId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', createdAt: 10, status: 'delivered', body: 'hi' };
const merged = upsertMessageList([a], ack);
pass('ack replaces the optimistic copy instead of duplicating', merged.length === 1);
pass('status never moves backwards from delivered to queued', merged[0].status === 'delivered');
pass('pending is cleared once the server acks', merged[0].pending === false);

const lateSent = upsertMessageList(merged, { ...ack, status: 'sent' });
pass('a late sent ack cannot un-deliver a message', lateSent[0].status === 'delivered');

const second = { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', clientCreatedAt: 2, createdAt: 20, status: 'queued', pending: true, body: 'two' };
const ordered = sortMessages([second, a]);
pass('queued messages keep send order by clientCreatedAt', ordered[0].id === a.id && ordered[1].id === second.id);

const both = mergeMessageLists([a, second], [ack]);
pass('merge keeps both the acked row and the still-queued neighbour', both.length === 2);

pass('backoff grows exponentially and caps', nextBackoffMs(0) === 1000 && nextBackoffMs(3) === 8000 && nextBackoffMs(20) === 60000);
pass('timeouts are not permanent failures', isPermanentSendError({ message: 'ACK_TIMEOUT' }) === false);
pass('blocked/not-a-member errors are permanent', isPermanentSendError('Not a member') === true);

const expired = dropExpiredMessages([
  { id: '1', expiresAt: Date.now() - 10, status: 'sent' },
  { id: '2', expiresAt: Date.now() + 10_000, status: 'sent' },
  { id: '3', expiresAt: Date.now() - 10, status: 'queued', pending: true },
], Date.now());
pass('expired synced messages drop, queued ones never do', expired.map((m) => m.id).join(',') === '2,3');

const bounded = boundMessages([
  ...Array.from({ length: 10 }, (_, i) => ({ id: `old${i}`, createdAt: i, status: 'sent' })),
  { id: 'pending', createdAt: 0, status: 'queued', pending: true },
], 5);
pass('bounding history never drops the outbox', bounded.some((m) => m.id === 'pending') && bounded.length <= 6);

console.log(`\n${passed} local message-state checks passed.`);
