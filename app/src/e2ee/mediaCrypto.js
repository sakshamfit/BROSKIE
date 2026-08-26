/**
 * Media E2EE — encrypt image/voice binary before upload.
 * Per spec: symmetric encryption with per-message random key, which itself gets encrypted
 * the same way message bodies are for the relevant chat.
 *
 * Flow:
 * - Generate random mediaKey (32 bytes) + nonce
 * - Encrypt file bytes with secretbox(mediaKey, nonce) -> ciphertext
 * - Upload ciphertext blob to server (server stores encrypted blob in uploads/)
 * - The mediaKey + mediaNonce are included INSIDE the encrypted message body
 *   (so only clients with chat key can decrypt the file after download)
 *
 * For simplicity in MVP:
 * - For encrypted chats, we encrypt file via secretbox with random key,
 *   then encrypt that key+nonce as part of message body (which is itself encrypted).
 *   So we produce an intermediate JSON: { mediaKey, mediaNonce, originalType }
 *   and then that JSON is encrypted via messageCrypto, and the encrypted file is uploaded.
 *
 * - For non-encrypted chats, no extra encryption.
 */

import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system';
import { initSodium, encryptMediaFile, decryptMediaFile, b64encode, b64decode } from './crypto';

// Helper to read file as Uint8Array (web + native)
async function readFileAsBytes(uri) {
  if (Platform.OS === 'web') {
    const res = await fetch(uri);
    const buf = await res.arrayBuffer();
    return new Uint8Array(buf);
  } else {
    // Expo FileSystem
    const base64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
    // Convert base64 to Uint8Array via atob or via sodium
    // Use global atob if available, else use libsodium
    if (typeof atob !== 'undefined') {
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return bytes;
    } else {
      // Fallback via sodium
      await initSodium();
      const sodium = await import('libsodium-wrappers');
      await sodium.ready;
      return sodium.from_base64(base64, sodium.base64_variants.ORIGINAL);
    }
  }
}

async function writeBytesToTempFile(bytes, extension = 'enc') {
  if (Platform.OS === 'web') {
    // Create blob URL
    const blob = new Blob([bytes], { type: 'application/octet-stream' });
    return URL.createObjectURL(blob);
  } else {
    // Write to cache directory
    const tempUri = FileSystem.cacheDirectory + `e2ee-${Date.now()}.${extension}`;
    // Convert bytes to base64
    let base64;
    if (typeof btoa !== 'undefined') {
      let binary = '';
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
      base64 = btoa(binary);
    } else {
      const sodium = await import('libsodium-wrappers');
      await sodium.ready;
      base64 = sodium.to_base64(bytes, sodium.base64_variants.ORIGINAL);
    }
    await FileSystem.writeAsStringAsync(tempUri, base64, { encoding: FileSystem.EncodingType.Base64 });
    return tempUri;
  }
}

// Encrypt a file for an encrypted chat, returns { encryptedFileUri, mediaKeyBase64, mediaNonceBase64, originalMime }
export async function encryptFileForUpload(uri, mimeType = 'application/octet-stream') {
  await initSodium();
  const fileBytes = await readFileAsBytes(uri);
  const enc = await encryptMediaFile(fileBytes);
  const encryptedUri = await writeBytesToTempFile(enc.ciphertext, 'enc');
  return {
    encryptedFileUri: encryptedUri,
    mediaKeyBase64: enc.mediaKeyBase64,
    mediaNonceBase64: enc.nonceBase64,
    originalMime: mimeType,
    originalSize: fileBytes.length,
  };
}

// Decrypt downloaded encrypted file, returns blob URL or temp file uri
export async function decryptDownloadedFile(encryptedFileUrl, mediaKeyB64, mediaNonceB64, expectedMime) {
  await initSodium();
  // Fetch encrypted file bytes
  let encBytes;
  if (Platform.OS === 'web') {
    const res = await fetch(encryptedFileUrl);
    const buf = await res.arrayBuffer();
    encBytes = new Uint8Array(buf);
  } else {
    // For native, encryptedFileUrl may be remote https URL — fetch as base64
    // Use expo-file-system download?
    // Simplify: fetch via fetch API and get arrayBuffer (works on native too with RN 0.72+)
    try {
      const res = await fetch(encryptedFileUrl);
      const buf = await res.arrayBuffer();
      encBytes = new Uint8Array(buf);
    } catch (e) {
      // Fallback: download to file then read
      const downloadUri = FileSystem.cacheDirectory + `dl-${Date.now()}.enc`;
      const dl = await FileSystem.downloadAsync(encryptedFileUrl, downloadUri);
      const b64 = await FileSystem.readAsStringAsync(dl.uri, { encoding: FileSystem.EncodingType.Base64 });
      const sodium = await import('libsodium-wrappers');
      await sodium.ready;
      encBytes = sodium.from_base64(b64, sodium.base64_variants.ORIGINAL);
    }
  }

  // Decrypt
  const sodium = await import('libsodium-wrappers');
  await sodium.ready;
  const key = sodium.from_base64(mediaKeyB64, sodium.base64_variants.ORIGINAL);
  const nonce = sodium.from_base64(mediaNonceB64, sodium.base64_variants.ORIGINAL);
  const plain = sodium.crypto_secretbox_open_easy(encBytes, nonce, key);
  if (!plain) throw new Error('Failed to decrypt media file');

  // Return as file uri / blob URL
  if (Platform.OS === 'web') {
    const blob = new Blob([plain], { type: expectedMime || 'application/octet-stream' });
    return URL.createObjectURL(blob);
  } else {
    const tempUri = FileSystem.cacheDirectory + `dec-${Date.now()}.${expectedMime?.includes('audio') ? 'm4a' : 'jpg'}`;
    let base64;
    if (typeof btoa !== 'undefined') {
      let binary = '';
      for (let i = 0; i < plain.length; i++) binary += String.fromCharCode(plain[i]);
      base64 = btoa(binary);
    } else {
      base64 = sodium.to_base64(plain, sodium.base64_variants.ORIGINAL);
    }
    await FileSystem.writeAsStringAsync(tempUri, base64, { encoding: FileSystem.EncodingType.Base64 });
    return tempUri;
  }
}

// For encrypted chat messages, the message body will be a JSON that includes media metadata encrypted inside.
// We create a wrapper: when sending image/voice in encrypted chat, we encrypt file first, then create
// a JSON payload { t: 'media', mediaKey, mediaNonce, mediaUrl (encrypted file url placeholder), ... }
// and then encrypt that JSON as the message body via messageCrypto.
// On receipt, decrypt message body -> get mediaKey -> decrypt file.

export async function createEncryptedMediaPayload({ encryptedFileUrl, mediaKeyB64, mediaNonceB64, duration, originalBody }) {
  // This payload will be stringified and then encrypted via box/secretbox
  return JSON.stringify({
    _e2eeMedia: true,
    mediaKey: mediaKeyB64,
    mediaNonce: mediaNonceB64,
    mediaUrl: encryptedFileUrl, // this is the encrypted blob url on server
    duration: duration || 0,
    body: originalBody || '',
  });
}

export function parseEncryptedMediaPayload(decryptedBody) {
  try {
    const obj = JSON.parse(decryptedBody);
    if (obj && obj._e2eeMedia) return obj;
  } catch {}
  return null;
}
