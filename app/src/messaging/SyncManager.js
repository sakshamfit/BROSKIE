import { api } from '../api';
import { mergeMessageLists, messageTime } from './messageState';

const PAGE = 50;

async function tryDecryptBatch(messages, getChats) {
  if (!messages || !messages.length) return messages;
  try {
    const { initSodium } = await import('../e2ee/crypto');
    await initSodium();
    const { decryptMessage } = await import('../e2ee/messageCrypto');
    const out = [];
    for (const msg of messages) {
      if (!msg.isEncrypted) { out.push(msg); continue; }
      try {
        const chat = getChats ? getChats().find(c => c.id === msg.chatId) : null;
        const plain = await decryptMessage(msg, chat);
        if (plain == null) {
          out.push({ ...msg, body: '🔒 Encrypted message — unable to decrypt', _decryptFailed: true });
        } else {
          // Handle media payload inside decrypted body
          try {
            const { parseEncryptedMediaPayload } = await import('../e2ee/mediaCrypto');
            const mediaPayload = parseEncryptedMediaPayload(plain);
            if (mediaPayload) {
              out.push({
                ...msg,
                body: mediaPayload.body || '',
                mediaUrl: mediaPayload.mediaUrl || msg.mediaUrl,
                _mediaKey: mediaPayload.mediaKey,
                _mediaNonce: mediaPayload.mediaNonce,
                _decrypted: true,
                _decryptedBody: plain,
              });
            } else {
              out.push({ ...msg, body: plain, _decrypted: true, _decryptedBody: plain });
            }
          } catch {
            out.push({ ...msg, body: plain, _decrypted: true, _decryptedBody: plain });
          }
        }
      } catch (e) {
        console.warn('[e2ee] decrypt batch failed', e.message);
        out.push({ ...msg, body: '🔒 Encrypted message — decryption error', _decryptFailed: true });
      }
    }
    return out;
  } catch {
    return messages;
  }
}
// Global catch-up sync is deliberately lighter than per-chat paging: on a
// flaky, low-bandwidth connection the socket reconnects often, and every
// reconnect must not re-download a large backlog. A smaller page, fewer
// pages, and a minimum interval between runs keeps reconnect sync cheap —
// realtime messages still arrive over the socket, and per-chat history is
// paged in on demand (loadMessages / loadOlderMessages).
const SYNC_PAGE = 100;
const MAX_SYNC_PAGES = 5;
const SYNC_MIN_INTERVAL_MS = 15000;

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

export function createSyncManager({ store, outbox, connectivity, getChats }) {
  let pulling = false;
  let pullAgain = false;
  let disposed = false;
  let lastSyncAt = 0;
  const chatPulls = new Set();

  async function refreshChatsFromServer() {
    const result = await api.chats();
    if (!Array.isArray(result?.chats)) throw new Error('Invalid conversations response');
    store.setChats(result.chats, { fromServer: true });
    connectivity.noteHttpSuccess();
    return result.chats;
  }

  async function pullMissed() {
    // Throttle: repeated reconnects on a flaky link must not each trigger a
    // multi-page catch-up. Anything missed in the window arrives over the
    // socket, or on the next (later) sync.
    const now = Date.now();
    if (lastSyncAt && now - lastSyncAt < SYNC_MIN_INTERVAL_MS) return;
    lastSyncAt = now;

    // The monotonic global cursor (latest updated_at we've already seen)
    // advances every sync, so a steady connection only ever downloads
    // genuinely new messages. Per-chat history is paged in separately.
    const after = store.getGlobalCursor() || store.getSyncAfter?.() || 0;
    if (!after) return;
    let cursor = after;
    for (let i = 0; i < MAX_SYNC_PAGES; i += 1) {
      const page = await api.syncMessages({ after: cursor, limit: SYNC_PAGE });
      let messages = Array.isArray(page?.messages) ? page.messages : [];
      messages = await tryDecryptBatch(messages, getChats);
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
        let incoming = Array.isArray(page?.messages) ? page.messages : [];
        incoming = await tryDecryptBatch(incoming, getChats);
        if (incoming.length) {
          store.setMessages(chatId, mergeMessageLists(store.getMessages(chatId), incoming));
        } else {
          store.markLoaded(chatId);
        }
      } else {
        page = await api.messages(chatId, { limit: PAGE });
        let incoming = Array.isArray(page?.messages) ? page.messages : [];
        incoming = await tryDecryptBatch(incoming, getChats);
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
    let incoming = Array.isArray(page?.messages) ? page.messages : [];
    incoming = await tryDecryptBatch(incoming, getChats);
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
