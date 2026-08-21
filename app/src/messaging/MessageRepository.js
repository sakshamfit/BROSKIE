import { createMessageId, isLocalMediaUri } from './ids';

export function createMessageRepository({ store, outbox }) {
  function queueSend(chatId, payload, user) {
    const id = createMessageId();
    const createdAt = Date.now();
    const localMedia = payload.localMediaUri
      || (isLocalMediaUri(payload.mediaUrl) ? payload.mediaUrl : null);
    const remoteMedia = payload.mediaUrl && !isLocalMediaUri(payload.mediaUrl) ? payload.mediaUrl : null;
    const optimistic = {
      id,
      clientId: id,
      chatId,
      senderId: user.id,
      type: payload.type || 'text',
      body: payload.body || '',
      mediaUrl: payload.mediaUrl || localMedia || null,
      mediaThumbUrl: payload.mediaThumbUrl || null,
      duration: payload.duration || 0,
      createdAt,
      clientCreatedAt: createdAt,
      status: 'sending',
      reactions: [],
      replyTo: payload.replyToMessage || null,
      pending: true,
      _new: true,
      uploadProgress: localMedia ? 0 : null,
      localMediaUri: localMedia,
    };
    store.upsertMessage(chatId, optimistic);
    outbox.enqueue({
      messageId: id,
      conversationId: chatId,
      senderId: user.id,
      type: optimistic.type,
      body: optimistic.body,
      mediaUrl: remoteMedia,
      mediaThumbUrl: payload.mediaThumbUrl || null,
      localMediaUri: localMedia,
      localThumbUri: payload.localThumbUri || null,
      mimeType: payload.mimeType || null,
      duration: optimistic.duration,
      replyTo: payload.replyTo || null,
      replyToMessage: payload.replyToMessage || null,
      pollId: payload.pollId || null,
      disappearAt: payload.disappearAt || null,
      createdAt,
      status: 'queued',
      retryCount: 0,
    });
    return optimistic;
  }

  function applyIncoming(message, tempId) {
    if (!message?.chatId) return;
    const existing = (store.getMessages(message.chatId) || []).find((item) => (
      item.id === message.id
      || (tempId && item.id === tempId)
      || (message.clientId && (item.clientId === message.clientId || item.id === message.clientId))
    ));
    store.upsertMessage(message.chatId, {
      ...message,
      _new: !existing,
    }, { replaceId: tempId });
    store.markLoaded(message.chatId);
    store.touchGlobalCursorFromMessages([message]);
    if (existing && (existing.id === message.id || existing.clientId === message.clientId || existing.id === tempId)) {
      const outbox = store.getOutbox().filter((item) => item.messageId !== existing.id && item.messageId !== message.id && item.messageId !== tempId);
      if (outbox.length !== store.getOutbox().length) store.setOutbox(outbox, { persistNow: true });
    }
  }

  function applyUpdated(message) {
    if (!message?.chatId) return;
    store.upsertMessage(message.chatId, { ...message, _new: false });
    store.touchGlobalCursorFromMessages([message]);
  }

  function applyExpired(chatId, messageIds) {
    store.removeMessages(chatId, messageIds);
  }

  return { queueSend, applyIncoming, applyUpdated, applyExpired };
}
