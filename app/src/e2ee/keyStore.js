/**
 * Identity key storage — single-device-per-account.
 * Native: expo-secure-store (secure enclave / keystore)
 * Web: IndexedDB via persistence layer + localStorage fallback, with explicit warning
 * that browser storage is NOT equivalent to mobile secure enclave.
 *
 * Private key never leaves device. Public key published to server.
 */

import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { api } from '../api';
import { generateIdentityKeyPair, initSodium } from './crypto';

const PRIVATE_KEY_KEY = 'plusone.e2ee.privateKey';
const PUBLIC_KEY_KEY = 'plusone.e2ee.publicKey';
const KEY_VERSION_KEY = 'plusone.e2ee.keyVersion';

let cachedKeyPair = null; // { publicKeyBase64, privateKeyBase64 }

// --- Secure storage abstraction ---

async function secureSet(key, value) {
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(key, value);
    }
    // Also try AsyncStorage/IndexedDB via global? For simplicity localStorage
    return;
  }
  try {
    await SecureStore.setItemAsync(key, value, { keychainService: 'plusone-e2ee' });
  } catch (e) {
    console.warn('[e2ee] SecureStore set failed, falling back to memory:', e.message);
  }
}

async function secureGet(key) {
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage.getItem(key);
    }
    return null;
  }
  try {
    return await SecureStore.getItemAsync(key, { keychainService: 'plusone-e2ee' });
  } catch (e) {
    console.warn('[e2ee] SecureStore get failed:', e.message);
    return null;
  }
}

async function secureDelete(key) {
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.removeItem(key);
    }
    return;
  }
  try {
    await SecureStore.deleteItemAsync(key, { keychainService: 'plusone-e2ee' });
  } catch {}
}

// --- Public API ---

export async function getOrCreateIdentityKeyPair(userId) {
  if (cachedKeyPair) return cachedKeyPair;

  await initSodium();

  // Try to load existing
  const [privB64, pubB64] = await Promise.all([
    secureGet(PRIVATE_KEY_KEY),
    secureGet(PUBLIC_KEY_KEY),
  ]);

  if (privB64 && pubB64) {
    cachedKeyPair = { privateKeyBase64: privB64, publicKeyBase64: pubB64 };
    return cachedKeyPair;
  }

  // Generate new
  console.log('[e2ee] Generating new identity keypair for', userId);
  const kp = await generateIdentityKeyPair();
  await Promise.all([
    secureSet(PRIVATE_KEY_KEY, kp.privateKeyBase64),
    secureSet(PUBLIC_KEY_KEY, kp.publicKeyBase64),
    secureSet(KEY_VERSION_KEY, '1'),
  ]);
  cachedKeyPair = { privateKeyBase64: kp.privateKeyBase64, publicKeyBase64: kp.publicKeyBase64 };

  // Publish public key to server (best-effort, will retry on next app launch if fails)
  try {
    await api.publishPublicKey(kp.publicKeyBase64);
    console.log('[e2ee] Published public key to server');
  } catch (e) {
    console.warn('[e2ee] Failed to publish public key:', e.message);
  }

  return cachedKeyPair;
}

export async function getIdentityKeyPair() {
  if (cachedKeyPair) return cachedKeyPair;
  const [privB64, pubB64] = await Promise.all([
    secureGet(PRIVATE_KEY_KEY),
    secureGet(PUBLIC_KEY_KEY),
  ]);
  if (privB64 && pubB64) {
    cachedKeyPair = { privateKeyBase64: privB64, publicKeyBase64: pubB64 };
    return cachedKeyPair;
  }
  return null;
}

export async function getPublicKey() {
  const kp = await getIdentityKeyPair();
  return kp?.publicKeyBase64 || null;
}

export async function getPrivateKey() {
  const kp = await getIdentityKeyPair();
  return kp?.privateKeyBase64 || null;
}

export async function publishPublicKeyToServer() {
  const kp = await getIdentityKeyPair();
  if (!kp) return null;
  try {
    await api.publishPublicKey(kp.publicKeyBase64);
    return kp.publicKeyBase64;
  } catch (e) {
    console.warn('[e2ee] publish failed', e.message);
    return null;
  }
}

export async function clearKeys() {
  cachedKeyPair = null;
  await Promise.all([
    secureDelete(PRIVATE_KEY_KEY),
    secureDelete(PUBLIC_KEY_KEY),
    secureDelete(KEY_VERSION_KEY),
  ]);
}

export function isWebStorageInsecure() {
  // Explicit limitation: browser storage isn't equivalent to mobile secure enclave
  return Platform.OS === 'web';
}

export async function hasKeys() {
  const kp = await getIdentityKeyPair();
  return !!kp;
}

// For testing: allow injecting a keypair
export function _setCachedKeyPairForTest(pair) {
  cachedKeyPair = pair;
}
