/**
 * High-level message encryption/decryption
 * Handles both 1:1 (crypto_box) and group (secretbox with per-chat symmetric key)
 */

import {
  initSodium,
  encryptBox,
  decryptBox,
  encryptSecretbox,
  decryptSecretbox,
} from './crypto';
import { getIdentityKeyPair } from './keyStore';
import { getChatKey, fetchAndUnwrapChatKey } from './chatKeys';
import { api } from '../api';

// Cache for public keys: userId -> publicKeyBase64
const publicKeyCache = new Map();

export async function fetchPublicKey(userId) {
  if (!userId) return null;
  if (publicKeyCache.has(userId)) return publicKeyCache.get(userId);
  try {
    const res = await api.getPublicKey(userId);
    if (res?.publicKey) {
      publicKeyCache.set(userId, res.publicKey);
      return res.publicKey;
    }
  } catch (e) {
    console.warn('[e2ee] fetchPublicKey failed for', userId, e.message);
  }
  return null;
}

export async function fetchPublicKeysBatch(userIds) {
  const ids = [...new Set(userIds)].filter(id => !publicKeyCache.has(id));
  if (ids.length) {
    try {
      const res = await api.getPublicKeysBatch(ids);
      const keys = res?.keys || {};
      Object.entries(keys).forEach(([uid, pk]) => {
        if (pk) publicKeyCache.set(uid, pk);
      });
    } catch (e) {
      console.warn('[e2ee] batch fetch failed', e.message);
    }
  }
  const map = {};
  userIds.forEach(uid => {
    map[uid] = publicKeyCache.get(uid) || null;
  });
  return map;
}

export function clearPublicKeyCache() {
  publicKeyCache.clear();
}

// Encrypt message for 1:1 chat
export async function encryptForDirectChat(plaintext, recipientUserId) {
  await initSodium();
  const kp = await getIdentityKeyPair();
  if (!kp) throw new Error('No identity keypair');

  const recipientPk = await fetchPublicKey(recipientUserId);
  if (!recipientPk) throw new Error(`Recipient ${recipientUserId} has no public key — cannot encrypt`);

  const result = await encryptBox(plaintext, recipientPk, kp.privateKeyBase64);
  return {
    body: result.ciphertextBase64,
    nonce: result.nonceBase64,
    type: result.type, // 'box'
    isEncrypted: true,
  };
}

// Decrypt message for 1:1 chat
export async function decryptFromDirectChat(ciphertextB64, nonceB64, senderUserId) {
  await initSodium();
  const kp = await getIdentityKeyPair();
  if (!kp) throw new Error('No identity keypair');

  const senderPk = await fetchPublicKey(senderUserId);
  if (!senderPk) throw new Error(`Sender ${senderUserId} has no public key — cannot decrypt`);

  const plaintext = await decryptBox(ciphertextB64, nonceB64, senderPk, kp.privateKeyBase64);
  return plaintext;
}

// Encrypt for group chat (using per-chat symmetric key)
export async function encryptForGroupChat(plaintext, chatId) {
  await initSodium();
  let chatKey = await getChatKey(chatId);
  if (!chatKey) {
    chatKey = await fetchAndUnwrapChatKey(chatId);
  }
  if (!chatKey) throw new Error(`No symmetric key for chat ${chatId} — cannot encrypt group message`);

  const result = await encryptSecretbox(plaintext, chatKey);
  return {
    body: result.ciphertextBase64,
    nonce: result.nonceBase64,
    type: result.type, // 'secretbox'
    isEncrypted: true,
  };
}

// Decrypt for group chat
export async function decryptFromGroupChat(ciphertextB64, nonceB64, chatId) {
  await initSodium();
  let chatKey = await getChatKey(chatId);
  if (!chatKey) {
    chatKey = await fetchAndUnwrapChatKey(chatId);
  }
  if (!chatKey) throw new Error(`No symmetric key for chat ${chatId} — cannot decrypt group message`);

  const plaintext = await decryptSecretbox(ciphertextB64, nonceB64, chatKey);
  return plaintext;
}

// Unified encrypt based on chat type
export async function encryptMessage(plaintext, chat) {
  if (!chat) throw new Error('Missing chat');
  if (!chat.isEncrypted) {
    // Not encrypted chat — return plaintext
    return { body: plaintext, isEncrypted: false };
  }
  if (chat.type === 'direct') {
    // For direct, recipient is otherUserId
    const recipientId = chat.otherUserId;
    if (!recipientId) throw new Error('Direct chat missing otherUserId');
    return encryptForDirectChat(plaintext, recipientId);
  } else {
    // group or gc
    return encryptForGroupChat(plaintext, chat.id);
  }
}

export async function decryptMessage(message, chat) {
  // message: { body, encryptionNonce, encryptionType, isEncrypted, senderId, chatId }
  if (!message) return null;
  if (!message.isEncrypted) return message.body;

  try {
    if (message.encryptionType === 'box' || (chat?.type === 'direct')) {
      return await decryptFromDirectChat(message.body, message.encryptionNonce, message.senderId);
    } else {
      // secretbox group
      return await decryptFromGroupChat(message.body, message.encryptionNonce, message.chatId);
    }
  } catch (e) {
    console.warn('[e2ee] decrypt failed for message', message.id, e.message);
    return null; // indicate failure
  }
}

// For message editing in encrypted chats: re-encrypt full content (last-write-wins)
export async function encryptEditedMessage(newPlaintext, chat) {
  return encryptMessage(newPlaintext, chat);
}
