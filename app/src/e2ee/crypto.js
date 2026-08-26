/**
 * E2EE Crypto — audited library only, no custom ciphers.
 * Uses libsodium-wrappers (NaCl) high-level primitives:
 * - crypto_box for 1:1 (X25519 + XSalsa20Poly1305, authenticated)
 * - crypto_secretbox for group messages (XSalsa20Poly1305, symmetric)
 * - crypto_box_seal for wrapping group keys (anonymous, recipient public only)
 *
 * All keys are base64 (ORIGINAL variant) for transport/storage.
 * Plaintext is UTF-8 string for messages; binary for media.
 */

import _sodium from 'libsodium-wrappers';

let sodium = null;
let readyPromise = null;

export async function initSodium() {
  if (sodium) return sodium;
  if (readyPromise) return readyPromise;
  readyPromise = (async () => {
    await _sodium.ready;
    sodium = _sodium;
    return sodium;
  })();
  return readyPromise;
}

function ensureSodium() {
  if (!sodium) throw new Error('Sodium not initialized — call initSodium() first');
  return sodium;
}

function toB64(bytes) {
  return ensureSodium().to_base64(bytes, _sodium.base64_variants.ORIGINAL);
}
function fromB64(b64) {
  return ensureSodium().from_base64(b64, _sodium.base64_variants.ORIGINAL);
}

// --- Identity keypair (X25519 box) ---

export async function generateIdentityKeyPair() {
  const s = await initSodium();
  const kp = s.crypto_box_keypair();
  return {
    publicKey: kp.publicKey,
    privateKey: kp.privateKey,
    publicKeyBase64: toB64(kp.publicKey),
    privateKeyBase64: toB64(kp.privateKey),
  };
}

// --- 1:1 Box encryption ---

export async function encryptBox(plaintext, recipientPublicKeyB64, senderPrivateKeyB64) {
  const s = await initSodium();
  const nonce = s.randombytes_buf(s.crypto_box_NONCEBYTES);
  const msgBytes = typeof plaintext === 'string' ? s.from_string(plaintext) : plaintext;
  const recipientPk = fromB64(recipientPublicKeyB64);
  const senderSk = fromB64(senderPrivateKeyB64);
  const cipher = s.crypto_box_easy(msgBytes, nonce, recipientPk, senderSk);
  return {
    ciphertextBase64: toB64(cipher),
    nonceBase64: toB64(nonce),
    type: 'box',
  };
}

export async function decryptBox(ciphertextB64, nonceB64, senderPublicKeyB64, recipientPrivateKeyB64) {
  const s = await initSodium();
  const cipher = fromB64(ciphertextB64);
  const nonce = fromB64(nonceB64);
  const senderPk = fromB64(senderPublicKeyB64);
  const recipientSk = fromB64(recipientPrivateKeyB64);
  const plain = s.crypto_box_open_easy(cipher, nonce, senderPk, recipientSk);
  return s.to_string(plain);
}

// --- Symmetric secretbox (group messages & media) ---

export async function generateSymmetricKey() {
  const s = await initSodium();
  const key = s.randombytes_buf(s.crypto_secretbox_KEYBYTES); // 32 bytes
  return {
    key,
    keyBase64: toB64(key),
  };
}

export async function encryptSecretbox(plaintext, keyB64) {
  const s = await initSodium();
  const key = fromB64(keyB64);
  const nonce = s.randombytes_buf(s.crypto_secretbox_NONCEBYTES);
  const msgBytes = typeof plaintext === 'string' ? s.from_string(plaintext) : plaintext;
  const cipher = s.crypto_secretbox_easy(msgBytes, nonce, key);
  return {
    ciphertextBase64: toB64(cipher),
    nonceBase64: toB64(nonce),
    type: 'secretbox',
  };
}

export async function decryptSecretbox(ciphertextB64, nonceB64, keyB64) {
  const s = await initSodium();
  const cipher = fromB64(ciphertextB64);
  const nonce = fromB64(nonceB64);
  const key = fromB64(keyB64);
  const plain = s.crypto_secretbox_open_easy(cipher, nonce, key);
  return s.to_string(plain);
}

export async function encryptSecretboxBinary(dataBytes, keyB64) {
  const s = await initSodium();
  const key = fromB64(keyB64);
  const nonce = s.randombytes_buf(s.crypto_secretbox_NONCEBYTES);
  const cipher = s.crypto_secretbox_easy(dataBytes, nonce, key);
  return {
    ciphertext: cipher,
    ciphertextBase64: toB64(cipher),
    nonce,
    nonceBase64: toB64(nonce),
  };
}

export async function decryptSecretboxBinary(ciphertextB64, nonceB64, keyB64) {
  const s = await initSodium();
  const cipher = fromB64(ciphertextB64);
  const nonce = fromB64(nonceB64);
  const key = fromB64(keyB64);
  const plain = s.crypto_secretbox_open_easy(cipher, nonce, key);
  return plain; // Uint8Array
}

// --- Sealed box for wrapping group symmetric keys ---

export async function sealKey(keyB64, recipientPublicKeyB64) {
  const s = await initSodium();
  const keyBytes = fromB64(keyB64);
  const recipientPk = fromB64(recipientPublicKeyB64);
  const sealed = s.crypto_box_seal(keyBytes, recipientPk);
  return {
    wrappedKeyBase64: toB64(sealed),
    wrappedNonce: null, // sealed box has no separate nonce
    type: 'sealed',
  };
}

export async function unsealKey(wrappedKeyB64, recipientPublicKeyB64, recipientPrivateKeyB64) {
  const s = await initSodium();
  const sealed = fromB64(wrappedKeyB64);
  const recipientPk = fromB64(recipientPublicKeyB64);
  const recipientSk = fromB64(recipientPrivateKeyB64);
  const opened = s.crypto_box_seal_open(sealed, recipientPk, recipientSk);
  return {
    key: opened,
    keyBase64: toB64(opened),
  };
}

// --- Helpers for media encryption with per-message random key ---

export async function generateMediaKey() {
  return generateSymmetricKey();
}

// Encrypt file bytes (Uint8Array) with random media key, returns encrypted bytes + key + nonce
export async function encryptMediaFile(fileBytes) {
  const s = await initSodium();
  const mediaKey = s.randombytes_buf(s.crypto_secretbox_KEYBYTES);
  const nonce = s.randombytes_buf(s.crypto_secretbox_NONCEBYTES);
  const cipher = s.crypto_secretbox_easy(fileBytes, nonce, mediaKey);
  return {
    ciphertext: cipher,
    ciphertextBase64: toB64(cipher),
    nonce,
    nonceBase64: toB64(nonce),
    mediaKey,
    mediaKeyBase64: toB64(mediaKey),
  };
}

export async function decryptMediaFile(ciphertextB64, nonceB64, mediaKeyB64) {
  const s = await initSodium();
  const cipher = fromB64(ciphertextB64);
  const nonce = fromB64(nonceB64);
  const key = fromB64(mediaKeyB64);
  const plain = s.crypto_secretbox_open_easy(cipher, nonce, key);
  return plain; // Uint8Array
}

// Utility: string <-> Uint8Array
export async function stringToBytes(str) {
  const s = await initSodium();
  return s.from_string(str);
}
export async function bytesToString(bytes) {
  const s = await initSodium();
  return s.to_string(bytes);
}

// Base64 helpers exposed
export function b64encode(bytes) {
  if (!sodium) return null;
  return sodium.to_base64(bytes, _sodium.base64_variants.ORIGINAL);
}
export function b64decode(b64) {
  if (!sodium) return null;
  return sodium.from_base64(b64, _sodium.base64_variants.ORIGINAL);
}
