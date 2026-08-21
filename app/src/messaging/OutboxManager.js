import { api } from '../api';
import { isLocalMediaUri } from './ids';
import { isPermanentSendError, nextBackoffMs } from './messageState';
import { guessUploadName, prepareOutgoingImage } from './media';

const ACK_TIMEOUT_MS = 15000;
const TEXT_TYPES = new Set(['text', 'system', 'poll']);

function needsMediaUpload(item) {
  if (item.type !== 'image' && item.type !== 'voice') return false;
  if (item.mediaUrl && !isLocalMediaUri(item.mediaUrl)) return false;
  return !!item.localMediaUri || isLocalMediaUri(item.mediaUrl);
}

function emitAck(socket, event, payload, timeoutMs = ACK_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    if (!socket?.connected) {
      reject(Object.assign(new Error('SOCKET_DISCONNECTED'), { code: 'NETWORK' }));
      return;
    }
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(Object.assign(new Error('ACK_TIMEOUT'), { code: 'TIMEOUT' }));
    }, timeoutMs);
    try {
      socket.emit(event, payload, (res) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (res?.error) {
          reject(Object.assign(new Error(res.error), {
            code: 'SERVER',
            permanent: isPermanentSendError(res.error),
          }));
        } else resolve(res);
      });
    } catch (error) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(Object.assign(error, { code: 'NETWORK' }));
    }
  });
}

function wirePayload(item) {
  return {
    chatId: item.conversationId,
    type: item.type || 'text',
    body: item.body || '',
    mediaUrl: item.mediaUrl || null,
    mediaThumbUrl: item.mediaThumbUrl || null,
    duration: item.duration || 0,
    replyTo: item.replyTo || null,
    clientId: item.messageId,
    clientCreatedAt: item.createdAt,
    tempId: item.messageId,
    pollId: item.pollId || null,
    disappearAt: item.disappearAt || null,
  };
}

export function createOutboxManager({ store, getSocket, connectivity }) {
  let draining = false;
  let drainAgain = false;
  let timer = null;
  let disposed = false;
  const inFlight = new Set();

  const patchItem = (messageId, patch, { persistNow = false } = {}) => {
    const next = store.getOutbox().map((item) => (item.messageId === messageId ? { ...item, ...patch } : item));
    store.setOutbox(next, { persistNow });
    return next.find((item) => item.messageId === messageId);
  };

  const patchMessage = (item, patch) => {
    store.upsertMessage(item.conversationId, {
      id: item.messageId,
      clientId: item.messageId,
      chatId: item.conversationId,
      senderId: item.senderId,
      type: item.type,
      body: item.body,
      mediaUrl: patch.mediaUrl ?? item.mediaUrl ?? item.localMediaUri,
      mediaThumbUrl: patch.mediaThumbUrl ?? item.mediaThumbUrl,
      duration: item.duration,
      createdAt: item.createdAt,
      clientCreatedAt: item.createdAt,
      status: patch.status || item.status,
      pending: patch.pending ?? true,
      uploadProgress: patch.uploadProgress,
      localMediaUri: patch.localMediaUri === undefined ? item.localMediaUri : patch.localMediaUri,
      replyTo: item.replyToMessage || null,
    });
  };

  const schedule = () => {
    clearTimeout(timer);
    if (disposed) return;
    const upcoming = store.getOutbox().filter((item) => item.status !== 'failed');
    if (!upcoming.length) return;
    const now = Date.now();
    const dueIn = Math.min(...upcoming.map((item) => Math.max(0, (item.nextAttemptAt || 0) - now)));
    timer = setTimeout(() => drain(), Math.min(dueIn, 30_000));
  };

  async function uploadMedia(item) {
    const localUri = item.localMediaUri || item.mediaUrl;
    if (!localUri) return item;
    patchMessage(item, { status: 'sending', uploadProgress: item.uploadProgress || 1 });

    let uploadUri = localUri;
    let thumbUri = item.localThumbUri || null;
    let mimeType = item.mimeType || (item.type === 'voice' ? (localUri.includes('webm') ? 'audio/webm' : 'audio/m4a') : 'image/jpeg');

    if (item.type === 'image') {
      const prepared = await prepareOutgoingImage(localUri);
      uploadUri = prepared.uri;
      thumbUri = prepared.thumbUri;
      mimeType = prepared.mimeType;
    }

    const onProgress = (pct) => {
      patchItem(item.messageId, { uploadProgress: pct });
      patchMessage(item, { status: 'sending', uploadProgress: pct });
    };

    const name = guessUploadName(item.type, mimeType);
    const uploaded = await api.uploadFileWithProgress(uploadUri, name, mimeType, onProgress);
    let thumbUrl = item.mediaThumbUrl || null;
    if (item.type === 'image' && thumbUri && thumbUri !== uploaded?.url) {
      try {
        const thumb = await api.uploadFileWithProgress(thumbUri, 'thumb.jpg', 'image/jpeg', () => {});
        thumbUrl = thumb?.url || thumbUrl;
      } catch {
        // Full image is enough; thumbnail is an optimisation.
      }
    }

    const next = patchItem(item.messageId, {
      mediaUrl: uploaded.url,
      mediaThumbUrl: thumbUrl,
      localMediaUri: localUri,
      uploadProgress: 100,
    }, { persistNow: true });
    patchMessage(next, {
      status: 'sending',
      mediaUrl: uploaded.url,
      mediaThumbUrl: thumbUrl,
      uploadProgress: 100,
    });
    connectivity.noteHttpSuccess();
    return next;
  }

  async function deliver(item) {
    const payload = wirePayload(item);
    const socket = getSocket?.();
    if (socket?.connected) {
      try {
        return await emitAck(socket, 'message:send', payload);
      } catch (error) {
        if (error?.permanent) throw error;
        // Timeout is NOT proof the server missed it. Fall through to REST
        // with the same clientId so a lost ack cannot duplicate.
      }
    }
    return api.sendChatMessage(item.conversationId, payload);
  }

  async function processItem(item) {
    if (disposed || inFlight.has(item.messageId)) return;
    const connectivitySnap = connectivity.snapshot();
    if (connectivitySnap.authBlocked) {
      patchItem(item.messageId, { status: 'queued', nextAttemptAt: Date.now() + 8000 });
      return;
    }
    inFlight.add(item.messageId);
    patchItem(item.messageId, { status: 'sending', lastAttemptAt: Date.now() });
    patchMessage(item, { status: 'sending', pending: true });
    try {
      let current = item;
      if (needsMediaUpload(current)) {
        current = await uploadMedia(current);
      }
      const result = await deliver(current);
      const serverMessage = result?.message;
      if (!serverMessage) throw Object.assign(new Error('Empty send response'), { code: 'NETWORK' });
      store.upsertMessage(current.conversationId, {
        ...serverMessage,
        id: serverMessage.id || current.messageId,
        clientId: current.messageId,
        clientCreatedAt: current.createdAt,
        pending: false,
        _new: false,
        localMediaUri: null,
        uploadProgress: null,
      }, { replaceId: current.messageId });
      store.setOutbox(store.getOutbox().filter((row) => row.messageId !== current.messageId), { persistNow: true });
      store.touchGlobalCursorFromMessages([serverMessage]);
      connectivity.noteHttpSuccess();
      connectivity.clearAuthFailure();
    } catch (error) {
      const status = error?.status || 0;
      if (status === 401) connectivity.noteAuthFailure();
      else if (error?.code !== 'TIMEOUT') connectivity.noteHttpFailure();

      if (error?.permanent || isPermanentSendError(error) || status === 403) {
        patchItem(item.messageId, { status: 'failed', lastError: String(error.message || error) }, { persistNow: true });
        patchMessage(item, { status: 'failed', pending: false });
      } else {
        const retryCount = (item.retryCount || 0) + 1;
        const nextAttemptAt = Date.now() + nextBackoffMs(retryCount);
        patchItem(item.messageId, {
          status: 'queued',
          retryCount,
          nextAttemptAt,
          lastError: String(error.message || error),
        }, { persistNow: true });
        patchMessage(item, { status: 'queued', pending: true });
      }
    } finally {
      inFlight.delete(item.messageId);
    }
  }

  async function drain() {
    if (disposed) return;
    if (draining) { drainAgain = true; return; }
    draining = true;
    try {
      while (!disposed) {
        const now = Date.now();
        const due = store.getOutbox()
          .filter((item) => item.status !== 'failed' && !inFlight.has(item.messageId) && (item.nextAttemptAt || 0) <= now);
        if (!due.length) break;
        due.sort((a, b) => {
          const mediaA = needsMediaUpload(a) && !TEXT_TYPES.has(a.type) ? 1 : 0;
          const mediaB = needsMediaUpload(b) && !TEXT_TYPES.has(b.type) ? 1 : 0;
          if (mediaA !== mediaB) return mediaA - mediaB;
          return (a.createdAt || 0) - (b.createdAt || 0);
        });
        await processItem(due[0]);
      }
    } finally {
      draining = false;
      if (drainAgain) {
        drainAgain = false;
        drain();
      } else {
        schedule();
      }
    }
  }

  async function enqueue(item) {
    const existing = store.getOutbox();
    if (existing.some((row) => row.messageId === item.messageId)) {
      drain();
      return;
    }
    store.setOutbox([...existing, {
      ...item,
      status: 'queued',
      retryCount: item.retryCount || 0,
      lastAttemptAt: 0,
      nextAttemptAt: 0,
    }], { persistNow: true });
    drain();
  }

  const unsub = connectivity.subscribe((snap) => {
    if (disposed) return;
    if (snap.socketConnected || (snap.browserOnline && snap.appState === 'active')) {
      drain();
    }
  });

  return {
    enqueue,
    drain,
    dispose() {
      disposed = true;
      clearTimeout(timer);
      unsub?.();
    },
  };
}
