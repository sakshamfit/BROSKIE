/**
 * GC-only local store — the second, fully separate cache for GC chats.
 *
 * Direct/private chat state lives in `LocalMessageStore` under
 * `plusone.lf.v1.<userId>`; GC state lives HERE under
 * `plusone.gc.v1.<userId>` (one blob, its own keys). The two caches never
 * share a key, so opening or syncing a GC can never overwrite, archive, or
 * reorder a direct chat.
 *
 * Messages are keyed per GC (`gc-messages` -> { [gcId]: [...] }), so GC A
 * and GC B each keep their own isolated list, exactly like the direct chat
 * store. Everything here is pure local-first cache: the server remains the
 * source of truth, and hydration is best-effort.
 */
import { createPersistence } from './persistence';
import { sortChats } from './LocalMessageStore';
import {
  boundMessages, dropExpiredMessages, mergeMessageLists, mergeServerChats,
  previewFromMessage, sortMessages, upsertMessageList,
} from './messageState';

const STORE_VERSION = 1;
const MAX_GC_CHATS = 60;
const MAX_MESSAGES_PER_GC = 400;

export class GCLocalStore {
  constructor(userId, persistence = createPersistence()) {
    this.userId = userId;
    this.persistence = persistence;
    this.key = `plusone.gc.v${STORE_VERSION}.${userId}`;
    this.chats = [];
    this.messages = {};   // gcId -> message[]
    this.loaded = {};     // gcId -> boolean
    this.cursors = {};    // gcId -> { beforeId, before, hasMore }
    this.listeners = new Set();
    this.writeTimer = null;
    this.hydrated = false;
  }

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
  getMessages(gcId) { return this.messages[gcId] || []; }
  getAllMessagesCopy() {
    const copy = {};
    Object.entries(this.messages).forEach(([gcId, list]) => { copy[gcId] = list; });
    return copy;
  }
  getLoaded() { return { ...this.loaded }; }
  getCursor(gcId) { return this.cursors[gcId] || null; }

  async hydrate() {
    let blob = null;
    try { blob = await this.persistence.get(this.key); } catch {}
    if (blob && (blob.version !== STORE_VERSION || blob.userId !== this.userId)) blob = null;

    const liveChats = this.chats;
    const liveMessages = this.messages;
    if (blob) {
      this.chats = mergeServerChats(
        liveChats,
        (Array.isArray(blob.chats) ? blob.chats : []).filter((c) => c?.type === 'gc'),
        sortChats
      );
      this.messages = { ...liveMessages };
      if (blob.messages && typeof blob.messages === 'object') {
        Object.entries(blob.messages).forEach(([gcId, list]) => {
          if (!Array.isArray(list) || !list.length) return;
          this.messages[gcId] = boundMessages(
            dropExpiredMessages(mergeMessageLists(list, this.messages[gcId] || [])),
            MAX_MESSAGES_PER_GC
          );
          this.loaded[gcId] = true;
        });
      }
      if (blob.cursors && typeof blob.cursors === 'object') this.cursors = { ...blob.cursors };
    }
    this.hydrated = true;
    this.notify();
  }

  schedulePersist() {
    clearTimeout(this.writeTimer);
    this.writeTimer = setTimeout(() => { this.persist().catch(() => {}); }, 140);
  }

  async persist() {
    const ranked = Object.entries(this.messages)
      .sort(([, a], [, b]) => {
        const last = (list) => list?.[list.length - 1]?.createdAt || list?.[list.length - 1]?.clientCreatedAt || 0;
        return last(b) - last(a);
      })
      .slice(0, MAX_GC_CHATS);
    const messages = {};
    ranked.forEach(([gcId, list]) => {
      messages[gcId] = boundMessages(list, MAX_MESSAGES_PER_GC);
    });
    await this.persistence.set(this.key, {
      version: STORE_VERSION,
      userId: this.userId,
      savedAt: Date.now(),
      chats: this.chats.slice(0, MAX_GC_CHATS),
      messages,
      loaded: this.loaded,
      cursors: this.cursors,
    });
  }

  setChats(chats, { fromServer = false } = {}) {
    const clean = (chats || []).filter((c) => c?.type === 'gc');
    this.chats = fromServer
      ? mergeServerChats(this.chats, clean, sortChats)
      : sortChats(clean);
    this.schedulePersist();
    this.notify();
  }

  upsertChat(chat) {
    if (!chat?.id || chat.type !== 'gc') return;
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

  removeChat(gcId) {
    this.chats = this.chats.filter((chat) => chat.id !== gcId);
    if (gcId in this.messages) {
      const next = { ...this.messages };
      delete next[gcId];
      this.messages = next;
    }
    if (gcId in this.loaded) {
      const next = { ...this.loaded };
      delete next[gcId];
      this.loaded = next;
    }
    if (gcId in this.cursors) {
      const next = { ...this.cursors };
      delete next[gcId];
      this.cursors = next;
    }
    this.schedulePersist();
    this.notify();
  }

  setMessages(gcId, list, { loaded = true } = {}) {
    this.messages = {
      ...this.messages,
      [gcId]: boundMessages(dropExpiredMessages(sortMessages(list || [])), MAX_MESSAGES_PER_GC),
    };
    if (loaded) this.loaded = { ...this.loaded, [gcId]: true };
    this.schedulePersist();
    this.notify();
  }

  /** Replace the whole GC message map (used by lightweight local patches,
   *  e.g. optimistic star/timer state). Never touches direct chats. */
  replaceMessagesMap(next) {
    const copy = {};
    Object.entries(next || {}).forEach(([gcId, list]) => {
      copy[gcId] = boundMessages(dropExpiredMessages(sortMessages(list || [])), MAX_MESSAGES_PER_GC);
    });
    this.messages = copy;
    this.schedulePersist();
    this.notify();
  }

  mergeMessages(gcId, incoming) {
    this.messages = {
      ...this.messages,
      [gcId]: boundMessages(mergeMessageLists(this.messages[gcId] || [], incoming), MAX_MESSAGES_PER_GC),
    };
    this.loaded = { ...this.loaded, [gcId]: true };
    this.schedulePersist();
    this.notify();
  }

  upsertMessage(gcId, message, { replaceId, silent = false } = {}) {
    if (!gcId || !message) return;
    const list = upsertMessageList(this.messages[gcId] || [], message, { replaceId });
    this.messages = { ...this.messages, [gcId]: boundMessages(dropExpiredMessages(list), MAX_MESSAGES_PER_GC) };
    this.patchChatPreview(gcId, this.messages[gcId][this.messages[gcId].length - 1]);
    if (!silent) {
      this.schedulePersist();
      this.notify();
    }
  }

  patchChatPreview(gcId, message) {
    if (!message) return;
    const idx = this.chats.findIndex((chat) => chat.id === gcId);
    if (idx === -1) return;
    const chat = this.chats[idx];
    const currentTs = chat.lastMessage
      ? (chat.lastMessage.clientCreatedAt || chat.lastMessage.createdAt || 0)
      : 0;
    const nextTs = message.clientCreatedAt || message.createdAt || 0;
    if (currentTs > nextTs && !message.pending) return;
    const next = this.chats.slice();
    next[idx] = previewFromMessage(chat, message);
    this.chats = sortChats(next);
  }

  removeMessages(gcId, ids) {
    const set = new Set(ids || []);
    const list = this.messages[gcId];
    if (!list) return;
    const next = list.filter((message) => !set.has(message.id) && !set.has(message.clientId));
    if (next.length === list.length) return;
    this.messages = { ...this.messages, [gcId]: next };
    this.schedulePersist();
    this.notify();
  }

  markLoaded(gcId) {
    if (this.loaded[gcId]) return;
    this.loaded = { ...this.loaded, [gcId]: true };
    this.notify();
  }

  setCursor(gcId, cursor) {
    this.cursors = { ...this.cursors, [gcId]: { ...(this.cursors[gcId] || {}), ...cursor } };
    this.schedulePersist();
  }

  dispose() {
    clearTimeout(this.writeTimer);
    this.listeners.clear();
    this.persist().catch(() => {});
  }
}
