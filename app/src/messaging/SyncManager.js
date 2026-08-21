import { api } from '../api';
import { mergeMessageLists, messageTime } from './messageState';

const PAGE = 50;

function applyCursorFromList(store, chatId, list, { hasMore } = {}) {
  if (!list?.length) {
    if (hasMore === false) store.setCursor(chatId, { hasMore: false });
    return;
  }
  const newest = list[list.length - 1];
  const oldest = list[0];
  store.setCursor(chatId, {
    after: newest.createdAt || messageTime(newest),
    afterId: newest.id,
    oldestCreatedAt: oldest.createdAt || messageTime(oldest),
    oldestId: oldest.id,
    hasMore: hasMore ?? store.getCursor(chatId)?.hasMore ?? true,
  });
  store.touchGlobalCursorFromMessages(list);
}

export function createSyncManager({ store, outbox, connectivity }) {
  let pulling = false;
  let pullAgain = false;
  let disposed = false;
  const chatPulls = new Set();

  async function refreshChatsFromServer() {
    const result = await api.chats();
    if (!Array.isArray(result?.chats)) throw new Error('Invalid conversations response');
    store.setChats(result.chats, { fromServer: true });
    connectivity.noteHttpSuccess();
    return result.chats;
  }

  async function pullMissed() {
    const after = store.getSyncAfter?.() || store.getGlobalCursor();
    if (!after) return;
    let cursor = after;
    for (let i = 0; i < 8; i += 1) {
      const page = await api.syncMessages({ after: cursor, limit: 200 });
      const messages = Array.isArray(page?.messages) ? page.messages : [];
      const byChat = {};
      messages.forEach((message) => {
        (byChat[message.chatId] ||= []).push(message);
      });
      Object.entries(byChat).forEach(([chatId, list]) => {
        store.setMessages(chatId, mergeMessageLists(store.getMessages(chatId), list));
        applyCursorFromList(store, chatId, store.getMessages(chatId));
        store.markLoaded(chatId);
      });
      if (Array.isArray(page?.chats) && page.chats.length) {
        store.setChats(page.chats, { fromServer: true });
      }
      connectivity.noteHttpSuccess();
      const nextCursor = Number(page?.cursor) || cursor;
      if (nextCursor > cursor) store.setGlobalCursor(nextCursor);
      cursor = nextCursor;
      if (!page?.hasMore || !messages.length) break;
    }
  }

  async function reconnect() {
    if (disposed) return;
    if (pulling) { pullAgain = true; return; }
    pulling = true;
    try {
      await outbox.drain();
      try { await pullMissed(); } catch (error) {
        connectivity.noteHttpFailure();
        throw error;
      }
      await outbox.drain();
    } finally {
      pulling = false;
      if (pullAgain) {
        pullAgain = false;
        reconnect();
      }
    }
  }

  async function pullChat(chatId) {
    if (!chatId || disposed) return store.getMessages(chatId);
    if (chatPulls.has(chatId)) return store.getMessages(chatId);
    chatPulls.add(chatId);
    try {
      const local = store.getMessages(chatId);
      if (local.length) store.markLoaded(chatId);
      const cursor = store.getCursor(chatId);
      let page;
      if (cursor?.after) {
        page = await api.messages(chatId, { after: cursor.after, afterId: cursor.afterId, limit: PAGE });
        const incoming = Array.isArray(page?.messages) ? page.messages : [];
        if (incoming.length) {
          store.setMessages(chatId, mergeMessageLists(store.getMessages(chatId), incoming));
        } else {
          store.markLoaded(chatId);
        }
      } else {
        page = await api.messages(chatId, { limit: PAGE });
        const incoming = Array.isArray(page?.messages) ? page.messages : [];
        store.setMessages(chatId, mergeMessageLists(store.getMessages(chatId), incoming));
        store.setCursor(chatId, { hasMore: !!page?.hasMore });
      }
      applyCursorFromList(store, chatId, store.getMessages(chatId), { hasMore: page?.hasMore });
      if (typeof page?.hasMore === 'boolean') {
        store.setCursor(chatId, { hasMore: page.hasMore });
      }
      store.markLoaded(chatId);
      connectivity.noteHttpSuccess();
      return store.getMessages(chatId);
    } catch (error) {
      store.markLoaded(chatId);
      connectivity.noteHttpFailure();
      throw error;
    } finally {
      chatPulls.delete(chatId);
    }
  }

  async function pullOlder(chatId) {
    if (!chatId || disposed) return;
    const cursor = store.getCursor(chatId);
    const local = store.getMessages(chatId);
    if (cursor?.hasMore === false) return;
    const oldest = local[0];
    if (!oldest) return pullChat(chatId);
    const page = await api.messages(chatId, {
      before: oldest.createdAt || messageTime(oldest),
      beforeId: oldest.id,
      limit: PAGE,
    });
    const incoming = Array.isArray(page?.messages) ? page.messages : [];
    if (incoming.length) {
      store.setMessages(chatId, mergeMessageLists(store.getMessages(chatId), incoming));
    }
    store.setCursor(chatId, { hasMore: !!page?.hasMore });
    applyCursorFromList(store, chatId, store.getMessages(chatId), { hasMore: page?.hasMore });
    connectivity.noteHttpSuccess();
  }

  return {
    reconnect,
    pullMissed,
    pullChat,
    pullOlder,
    refreshChatsFromServer,
    dispose() { disposed = true; },
  };
}
