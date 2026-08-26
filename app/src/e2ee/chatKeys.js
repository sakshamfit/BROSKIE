/**
 * Per-chat symmetric key management — "sender key" style for groups.
 * Group messages encrypted once with shared symmetric key, not once per recipient.
 * Symmetric key distributed by encrypting it individually with each member's public key
 * (server relays wrapped key but can't unwrap).
 *
 * Storage: local cache in memory + AsyncStorage/IndexedDB for persistence.
 * Server table: chat_encryption_keys (chat_id, user_id, wrapped_key)
 */

import { Platform } from 'react-native';
import { api } from '../api';
import { createPersistence } from '../messaging/persistence';
import {
  initSodium,
  generateSymmetricKey,
  sealKey,
  unsealKey,
} from './crypto';
import { getIdentityKeyPair } from './keyStore';

const persistence = createPersistence();

function cacheKey(chatId) {
  return `plusone.e2ee.chatKey.${chatId}`;
}

const memoryCache = new Map(); // chatId -> keyBase64

export async function getChatKey(chatId) {
  if (!chatId) return null;
  if (memoryCache.has(chatId)) return memoryCache.get(chatId);
  try {
    const stored = await persistence.get(cacheKey(chatId));
    if (stored) {
      memoryCache.set(chatId, stored);
      return stored;
    }
  } catch {}
  return null;
}

export async function setChatKey(chatId, keyBase64) {
  if (!chatId || !keyBase64) return;
  memoryCache.set(chatId, keyBase64);
  try {
    await persistence.set(cacheKey(chatId), keyBase64);
  } catch (e) {
    console.warn('[e2ee] failed to persist chat key', e.message);
  }
}

export async function clearChatKey(chatId) {
  memoryCache.delete(chatId);
  try {
    await persistence.remove(cacheKey(chatId));
  } catch {}
}

export async function clearAllChatKeys() {
  memoryCache.clear();
  // We don't clear persistence fully to avoid wiping other data; but we could iterate.
}

// Generate new symmetric key for a chat and wrap it for each member
export async function generateAndWrapChatKey(chatId, memberIds, publicKeysMap, createdBy) {
  // publicKeysMap: userId -> publicKeyBase64
  await initSodium();
  const { keyBase64 } = await generateSymmetricKey();
  const wrapped = [];
  for (const userId of memberIds) {
    const pubKey = publicKeysMap[userId];
    if (!pubKey) {
      console.warn(`[e2ee] No public key for user ${userId}, skipping`);
      continue;
    }
    try {
      const sealed = await sealKey(keyBase64, pubKey);
      wrapped.push({
        userId,
        wrappedKey: sealed.wrappedKeyBase64,
        wrappedNonce: sealed.wrappedNonce,
      });
    } catch (e) {
      console.warn(`[e2ee] Failed to wrap key for ${userId}:`, e.message);
    }
  }
  // Persist locally for creator
  await setChatKey(chatId, keyBase64);
  // Distribute via server
  try {
    if (wrapped.length) {
      await api.distributeChatKeys(chatId, wrapped);
    }
  } catch (e) {
    console.warn('[e2ee] Failed to distribute chat keys:', e.message);
    // Still keep local key; distribution can be retried
  }
  return { keyBase64, wrapped };
}

// Fetch wrapped key from server and unwrap with our private key
export async function fetchAndUnwrapChatKey(chatId) {
  await initSodium();
  const kp = await getIdentityKeyPair();
  if (!kp) throw new Error('No identity keypair — cannot unwrap chat key');

  // Try server
  try {
    const res = await api.getChatEncryptionKey(chatId);
    if (res?.wrappedKey) {
      const unwrapped = await unsealKey(res.wrappedKey, kp.publicKeyBase64, kp.privateKeyBase64);
      await setChatKey(chatId, unwrapped.keyBase64);
      return unwrapped.keyBase64;
    }
  } catch (e) {
    if (e?.status !== 404) {
      console.warn('[e2ee] fetchAndUnwrap failed:', e.message);
    }
  }
  // Fallback to local cache
  const local = await getChatKey(chatId);
  if (local) return local;
  return null;
}

// For new member joining: existing member wraps current key for new user
export async function wrapKeyForNewMember(chatId, newUserId, newUserPublicKeyB64) {
  await initSodium();
  const currentKey = await getChatKey(chatId);
  if (!currentKey) {
    // Try fetching first
    const fetched = await fetchAndUnwrapChatKey(chatId);
    if (!fetched) throw new Error('No chat key to wrap for new member');
    return wrapKeyForNewMember(chatId, newUserId, newUserPublicKeyB64);
  }
  const sealed = await sealKey(currentKey, newUserPublicKeyB64);
  const wrapped = [{ userId: newUserId, wrappedKey: sealed.wrappedKeyBase64, wrappedNonce: sealed.wrappedNonce }];
  try {
    await api.distributeChatKeys(chatId, wrapped);
  } catch (e) {
    console.warn('[e2ee] wrap for new member failed:', e.message);
  }
  return wrapped;
}

// Rotate key when membership changes (especially removal)
export async function rotateChatKey(chatId, remainingMemberIds, publicKeysMap) {
  // Generate new key and distribute to remaining members only
  console.log(`[e2ee] Rotating key for chat ${chatId}, remaining:`, remainingMemberIds.length);
  return generateAndWrapChatKey(chatId, remainingMemberIds, publicKeysMap, null);
}
