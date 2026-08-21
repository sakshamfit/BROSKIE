/** Client-generated message ids. Used as the canonical message id and as the
 * server-side idempotency key so retries never create duplicates. */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isClientMessageId(value) {
  return typeof value === 'string' && UUID_RE.test(value.trim());
}

export function createMessageId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // RFC 4122 v4 fallback for older runtimes.
  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function isLocalMediaUri(uri) {
  if (!uri || typeof uri !== 'string') return false;
  if (/^https?:\/\//i.test(uri)) return false;
  if (uri.startsWith('/uploads/') || uri.startsWith('/api/')) return false;
  return /^(file:|data:|blob:|content:|ph:|assets-library:)/i.test(uri) || uri.startsWith('/');
}
