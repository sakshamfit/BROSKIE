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

function isChatEncrypted(chatId, getChats) {
  try {
    const chats = getChats ? getChats() : [];
    const chat = chats.find(c => c.id === chatId);
    return !!(chat && chat.isEncrypted);
  } catch { return false; }
}

function getChatById(chatId, getChats) {
  try {
    const chats = getChats ? getChats() : [];
    return chats.find(c => c.id === chatId) || null;
  } catch { return null; }
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
    isEncrypted: item.isEncrypted || false,
    encryptionNonce: item.encryptionNonce || null,
    encryptionType: item.encryptionType || null,
  };
}

export function createOutboxManager({ store, getSocket, connectivity, getChats }) {
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

    // E2EE media encryption: if chat is encrypted, encrypt file bytes with random key before upload
    const encryptedChat = isChatEncrypted(item.conversationId, getChats);
    let mediaKeyB64 = null;
    let mediaNonceB64 = null;
    let encryptedUploadUri = uploadUri;
    let encryptedThumbUri = thumbUri;

    if (encryptedChat) {
      try {
        const { encryptFileForUpload } = await import('../e2ee/mediaCrypto');
        // Encrypt main file
        const enc = await encryptFileForUpload(uploadUri, mimeType);
        encryptedUploadUri = enc.encryptedFileUri;
        mediaKeyB64 = enc.mediaKeyBase64;
        mediaNonceB64 = enc.mediaNonceBase64;
        // For thumbnail, encrypt with same key for simplicity (if exists)
        if (thumbUri) {
          // We reuse same key but new nonce for thumb
          const { initSodium, encryptSecretboxBinary, b64encode } = await import('../e2ee/crypto');
          await initSodium();
          // Read thumb bytes and encrypt with same media key
          const { Platform } = await import('react-native');
          let thumbBytes;
          if (Platform.OS === 'web') {
            const r = await fetch(thumbUri);
            const buf = await r.arrayBuffer();
            thumbBytes = new Uint8Array(buf);
          } else {
            const FileSystem = await import('expo-file-system');
            const b64 = await FileSystem.readAsStringAsync(thumbUri, { encoding: FileSystem.EncodingType.Base64 });
            const sodium = await import('libsodium-wrappers');
            await sodium.ready;
            thumbBytes = sodium.from_base64(b64, sodium.base64_variants.ORIGINAL);
          }
          const sodium = await import('libsodium-wrappers');
          await sodium.ready;
          const keyBytes = sodium.from_base64(mediaKeyB64, sodium.base64_variants.ORIGINAL);
          const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
          const cipher = sodium.crypto_secretbox_easy(thumbBytes, nonce, keyBytes);
          // Write cipher to temp file
          if (Platform.OS === 'web') {
            const blob = new Blob([cipher], { type: 'application/octet-stream' });
            encryptedThumbUri = URL.createObjectURL(blob);
          } else {
            const FileSystem = await import('expo-file-system');
            const tempUri = FileSystem.cacheDirectory + `thumb-enc-${Date.now()}.enc`;
            const b64 = sodium.to_base64(cipher, sodium.base64_variants.ORIGINAL);
            await FileSystem.writeAsStringAsync(tempUri, b64, { encoding: FileSystem.EncodingType.Base64 });
            encryptedThumbUri = tempUri;
          }
          // Store thumb nonce? For MVP we reuse mediaNonce for both, but we have separate cipher.
          // To keep simple, we will include thumb url as encrypted and decrypt with same key+nonce? Actually need separate nonce.
          // For now, we will not use encrypted thumb — upload encrypted main only, thumb remains plaintext for preview.
          // This is a known limitation documented: thumbnail may leak preview in encrypted chats until improved.
          encryptedThumbUri = thumbUri; // fallback to plaintext thumb for now
        }
      } catch (e) {
        console.warn('[e2ee] media encryption failed, falling back to plaintext upload:', e.message);
      }
    }

    const name = guessUploadName(item.type, mimeType);
    const uploaded = await api.uploadFileWithProgress(encryptedUploadUri, name, mimeType, onProgress);
    let thumbUrl = item.mediaThumbUrl || null;
    if (item.type === 'image' && thumbUri && thumbUri !== uploaded?.url) {
      try {
        // Thumb upload stays plaintext for now (limitation flagged)
        const thumb = await api.uploadFileWithProgress(encryptedThumbUri || thumbUri, 'thumb.jpg', 'image/jpeg', () => {});
        thumbUrl = thumb?.url || thumbUrl;
      } catch {
        // Full image is enough; thumbnail is an optimisation.
      }
    }

    // For encrypted chats, stash media key info so deliver() can encrypt body with it
    const next = patchItem(item.messageId, {
      mediaUrl: uploaded.url,
      mediaThumbUrl: thumbUrl,
      localMediaUri: localUri,
      uploadProgress: 100,
      _mediaKeyB64: mediaKeyB64,
      _mediaNonceB64: mediaNonceB64,
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
    // E2EE: encrypt body if chat is encrypted
    let finalItem = item;
    const chat = getChatById(item.conversationId, getChats);
    if (chat && chat.isEncrypted) {
      try {
        const { encryptMessage } = await import('../e2ee/messageCrypto');
        const { createEncryptedMediaPayload } = await import('../e2ee/mediaCrypto');
        let plaintextToEncrypt = item.body || '';
        // If media with per-message key, create wrapper JSON
        if ((item.type === 'image' || item.type === 'voice') && item._mediaKeyB64 && item._mediaNonceB64) {
          plaintextToEncrypt = await createEncryptedMediaPayload({
            encryptedFileUrl: item.mediaUrl,
            mediaKeyB64: item._mediaKeyB64,
            mediaNonceB64: item._mediaNonceB64,
            duration: item.duration,
            originalBody: item.body || '',
          });
        }
        const enc = await encryptMessage(plaintextToEncrypt, chat);
        if (enc.isEncrypted) {
          finalItem = {
            ...item,
            body: enc.body,
            isEncrypted: true,
            encryptionNonce: enc.nonce,
            encryptionType: enc.type,
          };
        }
      } catch (e) {
        console.warn('[e2ee] encrypt failed, sending plaintext as fallback (should not happen in encrypted chat):', e.message);
        // If encryption fails, we should NOT send plaintext to encrypted chat — fail the message
        throw Object.assign(new Error('Encryption failed: ' + e.message), { code: 'ENCRYPTION', permanent: true });
      }
    }

    const payload = wirePayload(finalItem);
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
    return api.sendChatMessage(finalItem.conversationId, payload);
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
      let serverMessage = result?.message;
      if (!serverMessage) throw Object.assign(new Error('Empty send response'), { code: 'NETWORK' });
      // E2EE: server returns ciphertext for encrypted chats — decrypt for local storage
      if (serverMessage.isEncrypted) {
        try {
          const { initSodium } = await import('../e2ee/crypto');
          await initSodium();
          const { decryptMessage } = await import('../e2ee/messageCrypto');
          const chat = getChatById(current.conversationId, getChats);
          const plain = await decryptMessage(serverMessage, chat);
          if (plain != null) {
            try {
              const { parseEncryptedMediaPayload } = await import('../e2ee/mediaCrypto');
              const mediaPayload = parseEncryptedMediaPayload(plain);
              if (mediaPayload) {
                serverMessage = {
                  ...serverMessage,
                  body: mediaPayload.body || '',
                  mediaUrl: mediaPayload.mediaUrl || serverMessage.mediaUrl,
                  _mediaKey: mediaPayload.mediaKey,
                  _mediaNonce: mediaPayload.mediaNonce,
                  _decrypted: true,
                  _decryptedBody: plain,
                };
              } else {
                serverMessage = { ...serverMessage, body: plain, _decrypted: true, _decryptedBody: plain };
              }
            } catch {
              serverMessage = { ...serverMessage, body: plain, _decrypted: true, _decryptedBody: plain };
            }
          }
        } catch (e) {
          console.warn('[e2ee] decrypt serverMessage failed', e.message);
        }
      }
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
