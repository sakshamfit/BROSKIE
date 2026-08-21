import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  boundMessages, dropExpiredMessages, isPendingMessage, mergeMessageLists,
  mergeServerChats, previewFromMessage, sortMessages, upsertMessageList,
} from './messageState';

const STORE_VERSION = 1;
const MAX_MESSAGE_CHATS = 40;
const MAX_MESSAGES_PER_CHAT = 400;
const OLD_HISTORY_KEY = (userId) => `plusone.chat-history.v1.${userId}`;

export const sortChats = (list) =>
  [...list].sort((a, b) =>
    ((b.pinned ? 1 : 0) - (a.pinned ? 1 : 0)) ||
    ((b.lastMessage?.createdAt || b.lastMessage?.clientCreatedAt || b.updatedAt || 0)
      - (a.lastMessage?.createdAt || a.lastMessage?.clientCreatedAt || a.updatedAt || 0))
  );

export class LocalMessageStore {
  constructor(userId, persistence) {
    this.userId = userId;
    this.persistence = persistence;
    this.chats = [];
    this.messages = {};
    this.loaded = {};
    this.outbox = [];
    this.cursors = {};
    this.globalCursor = 0;
    this.listeners = new Set();
    this.writeTimer = null;
    this.hydrated = false;
    this.prefix = `plusone.lf.v${STORE_VERSION}.${userId}`;
  }

  key(suffix) { return `${this.prefix}.${suffix}`; }

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  notify() {
    this.listeners.forEach((fn) => {
      try { fn(); } catch {}
    });
  }

  getChats() { return this.chats; }
  getMessages(chatId) { return this.messages[chatId] || []; }
  getAllMessagesCopy() {
    const copy = {};
    Object.entries(this.messages).forEach(([chatId, list]) => { copy[chatId] = list; });
    return copy;
  }
  getLoaded() { return { ...this.loaded }; }
  getOutbox() { return this.outbox; }
  getCursor(chatId) { return this.cursors[chatId] || null; }
  getGlobalCursor() { return this.globalCursor || 0; }

  getSyncAfter() {
    const times = Object.values(this.cursors)
      .map((cursor) => Number(cursor?.after) || 0)
      .filter((value) => value > 0);
    if (times.length) return Math.min(...times);
    return 0;
  }

  async hydrate() {
    let meta = null;
    try { meta = await this.persistence.get(this.key('meta')); } catch {}

    if (!meta || meta.version !== STORE_VERSION || meta.userId !== this.userId) {
      await this.migrateLegacyCache();
      this.hydrated = true;
      this.notify();
      return;
    }

    try {
      const [chats, outbox, cursors] = await Promise.all([
        this.persistence.get(this.key('chats')),
        this.persistence.get(this.key('outbox')),
        this.persistence.get(this.key('cursors')),
      ]);
      const liveChats = this.chats;
      const liveMessages = this.messages;
      this.chats = mergeServerChats(liveChats, Array.isArray(chats) ? chats : [], sortChats);
      this.outbox = Array.isArray(outbox)
        ? outbox.map((item) => (item.status === 'sending' ? { ...item, status: 'queued' } : item))
        : [];
      this.cursors = cursors && typeof cursors === 'object' ? cursors : {};
      this.globalCursor = Number(meta.globalCursor) || 0;

      const chatIds = Array.isArray(meta.chatIds) ? meta.chatIds : Object.keys(this.cursors);
      const loaded = {};
      const messages = { ...liveMessages };
      await Promise.all(chatIds.map(async (chatId) => {
        try {
          const list = await this.persistence.get(this.key(`m.${chatId}`));
          if (Array.isArray(list) && list.length) {
            messages[chatId] = dropExpiredMessages(mergeMessageLists(list, messages[chatId] || []));
            loaded[chatId] = true;
          }
        } catch {}
      }));
      this.messages = messages;
      this.loaded = { ...this.loaded, ...loaded };

      // Re-attach pending outbox rows so a kill during send never drops them.
      this.outbox.forEach((item) => {
        const existing = (this.messages[item.conversationId] || []).some((m) => m.id === item.messageId);
        if (existing) return;
        this.upsertMessage(item.conversationId, outboxItemToMessage(item), { silent: true });
      });
      // App was killed after the optimistic insert but before the outbox
      // write finished — never let those rows become orphans.
      Object.entries(this.messages).forEach(([chatId, list]) => {
        (list || []).filter(isPendingMessage).forEach((message) => {
          if (this.outbox.some((item) => item.messageId === message.id)) return;
          this.outbox.push({
            messageId: message.id,
            conversationId: chatId,
            senderId: message.senderId,
            type: message.type,
            body: message.body,
            mediaUrl: isRemoteMedia(message.mediaUrl) ? message.mediaUrl : null,
            mediaThumbUrl: message.mediaThumbUrl || null,
            localMediaUri: message.localMediaUri || (!isRemoteMedia(message.mediaUrl) ? message.mediaUrl : null),
            duration: message.duration || 0,
            replyTo: message.replyTo?.id || null,
            replyToMessage: message.replyTo || null,
            createdAt: message.clientCreatedAt || message.createdAt,
            status: 'queued',
            retryCount: 0,
            nextAttemptAt: 0,
          });
        });
      });
    } catch {
      // A corrupt cache must never block the live session.
    }
    this.hydrated = true;
    this.notify();
  }

  async migrateLegacyCache() {
    try {
      const raw = await AsyncStorage.getItem(OLD_HISTORY_KEY(this.userId));
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (parsed?.userId !== this.userId || !Array.isArray(parsed?.chats)) return;
      this.chats = mergeServerChats(this.chats, parsed.chats, sortChats);
      const cached = parsed.messages && typeof parsed.messages === 'object' ? parsed.messages : {};
      Object.entries(cached).forEach(([chatId, list]) => {
        if (!Array.isArray(list)) return;
        this.messages[chatId] = mergeMessageLists(list, this.messages[chatId] || []);
        this.loaded[chatId] = true;
      });
      this.schedulePersist();
    } catch {}
  }

  setChats(chats, { fromServer = false } = {}) {
    this.chats = fromServer
      ? mergeServerChats(this.chats, chats, sortChats)
      : sortChats(chats || []);
    this.schedulePersist();
    this.notify();
  }

  upsertChat(chat) {
    if (!chat?.id) return;
    const idx = this.chats.findIndex((item) => item.id === chat.id);
    const local = idx === -1 ? null : this.chats[idx];
    const merged = local
      ? mergeServerChats([local], [chat], sortChats)[0]
      : chat;
    if (idx === -1) this.chats = sortChats([merged, ...this.chats]);
    else {
      const next = this.chats.slice();
      next[idx] = merged;
      this.chats = sortChats(next);
    }
    this.schedulePersist();
    this.notify();
  }

  removeChat(chatId) {
    this.chats = this.chats.filter((chat) => chat.id !== chatId);
    if (chatId in this.messages) {
      const next = { ...this.messages };
      delete next[chatId];
      this.messages = next;
    }
    if (chatId in this.loaded) {
      const next = { ...this.loaded };
      delete next[chatId];
      this.loaded = next;
    }
    if (chatId in this.cursors) {
      const next = { ...this.cursors };
      delete next[chatId];
      this.cursors = next;
    }
    this.outbox = this.outbox.filter((item) => item.conversationId !== chatId);
    this.schedulePersist();
    this.notify();
    this.persistence.remove(this.key(`m.${chatId}`)).catch(() => {});
  }

  setMessages(chatId, list, { loaded = true } = {}) {
    this.messages = { ...this.messages, [chatId]: boundMessages(dropExpiredMessages(sortMessages(list || [])), MAX_MESSAGES_PER_CHAT) };
    if (loaded) this.loaded = { ...this.loaded, [chatId]: true };
    this.schedulePersist();
    this.notify();
  }

  replaceMessagesMap(next) {
    const copy = {};
    Object.entries(next || {}).forEach(([chatId, list]) => {
      copy[chatId] = boundMessages(dropExpiredMessages(sortMessages(list || [])), MAX_MESSAGES_PER_CHAT);
    });
    this.messages = copy;
    this.schedulePersist();
    this.notify();
  }

  upsertMessage(chatId, message, { replaceId, silent = false } = {}) {
    if (!chatId || !message) return;
    const list = upsertMessageList(this.messages[chatId] || [], message, { replaceId });
    this.messages = { ...this.messages, [chatId]: boundMessages(dropExpiredMessages(list), MAX_MESSAGES_PER_CHAT) };
    this.patchChatPreview(chatId, this.messages[chatId][this.messages[chatId].length - 1]);
    if (!silent) {
      this.schedulePersist();
      this.notify();
    }
  }

  patchChatPreview(chatId, message) {
    if (!message) return;
    const idx = this.chats.findIndex((chat) => chat.id === chatId);
    if (idx === -1) return;
    const chat = this.chats[idx];
    const currentTs = chat.lastMessage
      ? (chat.lastMessage.clientCreatedAt || chat.lastMessage.createdAt || 0)
      : 0;
    const nextTs = message.clientCreatedAt || message.createdAt || 0;
    if (currentTs > nextTs && !isPendingMessage(message)) return;
    const next = this.chats.slice();
    next[idx] = previewFromMessage(chat, message);
    this.chats = sortChats(next);
  }

  removeMessages(chatId, ids) {
    const set = new Set(ids || []);
    const list = this.messages[chatId];
    if (!list) return;
    const next = list.filter((message) => !set.has(message.id) && !set.has(message.clientId));
    if (next.length === list.length) return;
    this.messages = { ...this.messages, [chatId]: next };
    this.schedulePersist();
    this.notify();
  }

  markLoaded(chatId) {
    if (this.loaded[chatId]) return;
    this.loaded = { ...this.loaded, [chatId]: true };
    this.notify();
  }

  setCursor(chatId, cursor) {
    this.cursors = { ...this.cursors, [chatId]: { ...(this.cursors[chatId] || {}), ...cursor } };
    this.schedulePersist();
  }

  setGlobalCursor(value) {
    const next = Number(value) || 0;
    if (next <= this.globalCursor) return;
    this.globalCursor = next;
    this.schedulePersist();
  }

  touchGlobalCursorFromMessages(messages) {
    let max = this.globalCursor;
    (messages || []).forEach((message) => {
      const ts = Number(message.updatedAt || message.createdAt || 0);
      if (ts > max) max = ts;
    });
    if (max > this.globalCursor) this.setGlobalCursor(max);
  }

  setOutbox(items, { persistNow = false } = {}) {
    this.outbox = items || [];
    this.notify();
    if (persistNow) return this.persistCritical();
    this.schedulePersist();
    return undefined;
  }

  schedulePersist() {
    clearTimeout(this.writeTimer);
    this.writeTimer = setTimeout(() => { this.persist().catch(() => {}); }, 120);
  }

  async persistCritical() {
    clearTimeout(this.writeTimer);
    await this.persist({ includeMessages: true, outboxNow: true });
  }

  async persist({ includeMessages = true, outboxNow = false } = {}) {
    const visibleIds = this.chats.map((chat) => chat.id);
    const ranked = Object.entries(this.messages)
      .filter(([chatId]) => visibleIds.includes(chatId) || (this.messages[chatId] || []).some(isPendingMessage))
      .sort(([, a], [, b]) => {
        const last = (list) => list?.[list.length - 1]?.createdAt || list?.[list.length - 1]?.clientCreatedAt || 0;
        return last(b) - last(a);
      })
      .slice(0, MAX_MESSAGE_CHATS);

    const chatIds = ranked.map(([chatId]) => chatId);
    const meta = {
      version: STORE_VERSION,
      userId: this.userId,
      savedAt: Date.now(),
      globalCursor: this.globalCursor,
      chatIds,
    };

    const writes = [
      this.persistence.set(this.key('meta'), meta),
      this.persistence.set(this.key('chats'), this.chats),
      this.persistence.set(this.key('outbox'), this.outbox),
      this.persistence.set(this.key('cursors'), this.cursors),
    ];
    if (includeMessages) {
      ranked.forEach(([chatId, list]) => {
        writes.push(this.persistence.set(this.key(`m.${chatId}`), boundMessages(list, MAX_MESSAGES_PER_CHAT)));
      });
    }
    await Promise.all(writes);
    return outboxNow;
  }

  dispose() {
    clearTimeout(this.writeTimer);
    this.listeners.clear();
    this.persistCritical().catch(() => {});
  }
}

function isRemoteMedia(uri) {
  if (!uri || typeof uri !== 'string') return false;
  return /^https?:\/\//i.test(uri) || uri.startsWith('/uploads/');
}

function outboxItemToMessage(item) {
  return {
    id: item.messageId,
    clientId: item.messageId,
    chatId: item.conversationId,
    senderId: item.senderId,
    type: item.type || 'text',
    body: item.body || '',
    mediaUrl: item.mediaUrl || item.localMediaUri || null,
    mediaThumbUrl: item.mediaThumbUrl || null,
    duration: item.duration || 0,
    createdAt: item.createdAt,
    clientCreatedAt: item.createdAt,
    status: item.status === 'sending' ? 'queued' : (item.status || 'queued'),
    pending: true,
    reactions: [],
    replyTo: item.replyToMessage || null,
    localMediaUri: item.localMediaUri || null,
    uploadProgress: item.uploadProgress ?? null,
  };
}
