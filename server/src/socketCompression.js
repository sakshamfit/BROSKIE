'use strict';

/**
 * Realtime (Socket.IO) compression settings.
 *
 * Socket.IO ships with permessage-deflate **disabled**, so every chat
 * message, presence sweep and OT operation used to cross the wire at full
 * JSON size. Browser WebSockets (and the `ws` client) support the extension,
 * so turning it on is a direct bandwidth win on the traffic users feel most.
 *
 * Measured by server/test-compression.js: an 18.6 KB chat batch costs 18.6 KB
 * on the wire uncompressed vs 5.6 KB with permessage-deflate (−70%).
 *
 * The settings are deliberately conservative, because a deflate context is
 * per-connection memory:
 *  - `threshold` skips frames under 1 KB, where compressing costs more CPU
 *    and latency than it saves.
 *  - 4 KB windows (`*MaxWindowBits: 12`) keep every context small while still
 *    covering a whole chat payload.
 *  - `concurrencyLimit` bounds simultaneous inflations — the classic
 *    permessage-deflate memory-exhaustion vector.
 *  - `maxHttpBufferSize` (set by the caller) is enforced against the
 *    *decompressed* size, so a compressed zip-bomb frame is still rejected.
 *
 * Kept in its own module so the test suite exercises exactly the options
 * production runs, instead of a copy that can drift.
 *
 * Set SOCKET_COMPRESSION=0 to switch all of it off without a rebuild.
 */

function enabled() {
  const raw = process.env.SOCKET_COMPRESSION;
  return raw === undefined || String(raw).trim() === '' ? true : String(raw).trim() !== '0';
}

/**
 * @returns {{perMessageDeflate: object|false, httpCompression: object|false}}
 */
function socketCompressionOptions() {
  if (!enabled()) {
    return { perMessageDeflate: false, httpCompression: false };
  }
  return {
    perMessageDeflate: {
      threshold: 1024,
      concurrencyLimit: 10,
      zlibDeflateOptions: { level: 6, chunkSize: 16 * 1024 },
      zlibInflateOptions: { chunkSize: 16 * 1024 },
      serverMaxWindowBits: 12,
      clientMaxWindowBits: 12,
    },
    // engine.io's HTTP long-polling fallback (used before the WebSocket
    // upgrade, and by clients behind proxies that block upgrades).
    httpCompression: { threshold: 1024, level: 6 },
  };
}

module.exports = socketCompressionOptions;
module.exports.enabled = enabled;
