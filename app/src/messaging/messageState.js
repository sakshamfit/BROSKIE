/** Pure helpers for local-first message merge, ordering, and status.
 * No React / storage imports — safe to reason about in isolation. */

import TextOperation from '../ot/TextOperation';

export const STATUS_RANK = {
  failed: -1,
  queued: 0,
  sending: 1,
  sent: 2,
  delivered: 3,
  read: 4,
};

export function isOutboxStatus(status) {
  return status === 'queued' || status === 'sending';
}

export function isPendingMessage(message) {
  if (!message) return false;
  return !!message.pending || isOutboxStatus(message.status);
}

export function messageTime(message) {
  if (!message) return 0;
  return Number(message.clientCreatedAt || message.createdAt || 0);
}

export function sortMessages(list) {
  return [...(list || [])].sort((a, b) => {
    const ta = messageTime(a);
    const tb = messageTime(b);
    if (ta !== tb) return ta - tb;
    return String(a?.id || '').localeCompare(String(b?.id || ''));
  });
}

export function higherStatus(current, incoming) {
  if (!incoming) return current || 'sent';
  if (!current) return incoming;
  if (current === 'failed' && incoming !== 'failed') return incoming;
  if (incoming === 'failed' && isOutboxStatus(current)) return current;
  return (STATUS_RANK[incoming] ?? 0) >= (STATUS_RANK[current] ?? 0) ? incoming : current;
}

export function messageKey(message) {
  return message?.id || message?.clientId || '';
}

export function sameMessage(a, b) {
  if (!a || !b) return false;
  if (a.id && b.id && a.id === b.id) return true;
  if (a.clientId && b.clientId && a.clientId === b.clientId) return true;
  if (a.id && b.clientId && a.id === b.clientId) return true;
  if (a.clientId && b.id && a.clientId === b.id) return true;
  return false;
}

export function findMessageIndex(list, incoming, replaceId) {
  if (!list || !incoming) return -1;
  return list.findIndex((item) => (
    sameMessage(item, incoming)
    || (replaceId && (item.id === replaceId || item.clientId === replaceId))
  ));
}

export function mergeMessage(local, incoming, { replaceId } = {}) {
  if (!local) return incoming;
  if (!incoming) return local;
  const status = higherStatus(local.status, incoming.status);
  const pending = isOutboxStatus(status) ? (incoming.pending ?? local.pending) : false;
  const remoteMedia = incoming.mediaUrl && !isLikelyLocal(incoming.mediaUrl);

  // OT-aware merging: handle otVersion and otOperation for conflict-free edits
  let body = incoming.body ?? local.body;
  let otVersion = incoming.otVersion ?? local.otVersion ?? 0;
  let edited = incoming.edited ?? local.edited ?? false;

  if (incoming.otOperation && local.body && incoming.body == null) {
    try {
      const op = TextOperation.fromJSON(incoming.otOperation);
      body = op.apply(local.body);
      otVersion = incoming.otVersion != null ? incoming.otVersion : local.otVersion || 0;
      edited = true;
    } catch {
      body = incoming.body || local.body;
    }
  } else if (incoming.otVersion != null && local.otVersion != null) {
    if (incoming.otVersion >= local.otVersion) {
      body = incoming.body != null ? incoming.body : local.body;
      otVersion = incoming.otVersion;
    } else {
      body = local.body;
      otVersion = local.otVersion;
    }
  } else if (incoming.otVersion != null) {
    otVersion = incoming.otVersion;
  }

  return {
    ...local,
    ...incoming,
    id: incoming.id || local.id,
    clientId: incoming.clientId || local.clientId || incoming.id || local.id,
    clientCreatedAt: local.clientCreatedAt || incoming.clientCreatedAt || local.createdAt,
    createdAt: incoming.createdAt || local.createdAt,
    body,
    otVersion,
    edited,
    status,
    pending,
    _new: replaceId || isPendingMessage(local) ? false : (incoming._new || local._new),
    localMediaUri: remoteMedia ? null : (incoming.localMediaUri || local.localMediaUri || null),
    uploadProgress: remoteMedia ? null : (incoming.uploadProgress ?? local.uploadProgress ?? null),
    replyTo: incoming.replyTo || local.replyTo || null,
    reactions: incoming.reactions || local.reactions || [],
  };
}

function isLikelyLocal(uri) {
  if (!uri || typeof uri !== 'string') return false;
  if (/^https?:\/\//i.test(uri)) return false;
  if (uri.startsWith('/uploads/')) return false;
  return true;
}

export function upsertMessageList(list, incoming, { replaceId } = {}) {
  const current = Array.isArray(list) ? list : [];
  const idx = findMessageIndex(current, incoming, replaceId);
  if (idx === -1) return sortMessages([...current, incoming]);
  const next = current.slice();
  next[idx] = mergeMessage(current[idx], incoming, { replaceId });
  if (replaceId && incoming.id && incoming.id !== replaceId && next[idx].id === replaceId) {
    next[idx] = { ...next[idx], id: incoming.id };
  }
  return sortMessages(next);
}

export function mergeMessageLists(local, remote, { keepPending = true } = {}) {
  const byId = new Map();
  const remember = (message) => {
    if (!message?.id && !message?.clientId) return;
    const existing = [...byId.values()].find((item) => sameMessage(item, message));
    if (existing) {
      const merged = mergeMessage(existing, message);
      byId.delete(messageKey(existing));
      byId.set(messageKey(merged), merged);
      return;
    }
    byId.set(messageKey(message), message);
  };
  (local || []).forEach(remember);
  (remote || []).forEach(remember);
  let merged = sortMessages([...byId.values()]);
  if (keepPending) return merged;
  return merged.filter((message) => !isPendingMessage(message));
}

export function dropExpiredMessages(list, now = Date.now()) {
  return (list || []).filter((message) => (
    isPendingMessage(message)
    || !message.expiresAt
    || Number(message.expiresAt) > now
  ));
}

export function boundMessages(list, limit = 400) {
  const messages = sortMessages(list || []);
  if (messages.length <= limit) return messages;
  const pending = messages.filter(isPendingMessage);
  const rest = messages.filter((message) => !isPendingMessage(message));
  const trimmed = rest.slice(-limit);
  const pendingMissing = pending.filter((item) => !trimmed.some((other) => sameMessage(other, item)));
  return sortMessages([...trimmed, ...pendingMissing]);
}

export function nextBackoffMs(retryCount) {
  const exponent = Math.min(Math.max(0, Number(retryCount) || 0), 6);
  const base = 1000 * (2 ** exponent);
  const jitter = Math.floor(Math.random() * 250);
  return Math.min(60_000, base) + jitter;
}

export function isPermanentSendError(error) {
  const text = String(error?.message || error || '');
  return /not a member|can't message this person|cannot message|blocked|accept this message request|unknown user|message cannot be empty/i.test(text);
}

export function mergeServerChats(local, remote, sortChats) {
  const localById = new Map((local || []).map((chat) => [chat.id, chat]));
  const merged = (remote || []).map((remoteChat) => {
    const localChat = localById.get(remoteChat.id);
    if (!localChat) return remoteChat;
    const preview = localChat.lastMessage;
    if (preview && isPendingMessage(preview)) {
      const remoteTs = messageTime(remoteChat.lastMessage) || remoteChat.updatedAt || 0;
      const localTs = messageTime(preview);
      if (localTs >= remoteTs) {
        return {
          ...remoteChat,
          lastMessage: preview,
          updatedAt: Math.max(remoteChat.updatedAt || 0, localTs),
        };
      }
    }
    return remoteChat;
  });
  return sortChats ? sortChats(merged) : merged;
}

export function previewFromMessage(chat, message) {
  if (!chat || !message) return chat;
  return {
    ...chat,
    lastMessage: message,
    updatedAt: Math.max(chat.updatedAt || 0, messageTime(message)),
  };
}
