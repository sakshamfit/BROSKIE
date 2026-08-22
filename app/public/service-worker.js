/* +one web push service worker.
 *
 * Shows a notification for every push — app open or closed — EXCEPT when
 * the user is focused on the app and already reading the exact conversation
 * the push belongs to (the socket renders that message live). Tapping a
 * notification focuses the app (or opens it) and hands the deep-link
 * payload to the page, which routes to the exact screen — same contract as
 * the native apps. A push that is merely received NEVER navigates.
 */
/* eslint-disable no-restricted-globals */

/* ---- offline cache -------------------------------------------------
 * Network-first with a cache fallback for same-origin GETs. This is what
 * lets the web app (a) reload while offline and (b) keep showing a user's
 * already-downloaded chats when the connection drops — the app's IndexedDB
 * holds the message data, and this cache holds the shell + the last API GET
 * responses. Socket.IO and media uploads are never cached; neither are
 * auth/profile endpoints, so a cached login is never served to anyone. */
const CACHE_NAME = 'plusone-shell-v3';

function isCacheable(request) {
  if (request.method !== 'GET') return false;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return false;
  if (url.pathname.startsWith('/socket.io')) return false;
  if (url.pathname.startsWith('/uploads')) return false;
  if (url.pathname.startsWith('/api/auth')) return false;
  if (url.pathname.startsWith('/api/me')) return false;
  if (url.pathname.startsWith('/api/push')) return false;
  return true;
}

/* Content-hashed build output never changes for a given URL (a new build
 * gets new file names), so once a chunk / font / image is cached it can be
 * served instantly from disk — no network round-trip, no re-download on slow
 * connections, fully available offline. */
function isImmutableAsset(request) {
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return false;
  return url.pathname.startsWith('/_expo/static/') || url.pathname.startsWith('/assets/');
}

self.addEventListener('install', (event) => {
  self.skipWaiting();
  // Pre-cache the shell so a first-visit user who goes offline (or hits a
  // dead zone) can still relaunch the app before their first natural reload.
  event.waitUntil((async () => {
    try {
      const cache = await caches.open(CACHE_NAME);
      await cache.add('/');
    } catch (e) { /* offline install — the fetch handler will fill it in */ }
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // Drop old cache versions so stale entries never shadow fresh ones.
    const keys = await caches.keys();
    await Promise.all(
      keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
    );
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  if (!isCacheable(event.request)) return;

  // Immutable hashed assets: cache-first. Serving from disk makes repeat
  // visits load instantly on slow networks and keeps chunk navigation
  // working offline. A miss falls through to the network and back-fills.
  if (isImmutableAsset(event.request)) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(event.request);
      if (cached) return cached;
      const network = await fetch(event.request);
      if (network && network.status === 200) {
        cache.put(event.request, network.clone());
      }
      return network;
    })());
    return;
  }

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    try {
      const network = await fetch(event.request);
      if (network && network.status === 200) {
        cache.put(event.request, network.clone());
      }
      return network;
    } catch (err) {
      const cached = await cache.match(event.request);
      if (cached) return cached;
      if (event.request.mode === 'navigate') {
        const shell = await cache.match('/');
        if (shell) return shell;
      }
      throw err;
    }
  })());
});

/* Is any app tab FOCUSED right now? (A visible-but-unfocused tab — second
 * monitor, another window — must still get notifications.) */
async function hasFocusedClient() {
  const clientList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  return clientList.some((client) => client.focused);
}

/* The conversation the page currently has on screen, reported via
 * postMessage({ type: 'plusone-viewing' }). Pushes for THIS chat are
 * suppressed while the user is focused on the app — the socket renders
 * them live. Everything else notifies, tab open or not. */
let viewingChatId = null;

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (e) {
    payload = { title: '+one', body: event.data ? event.data.text() : '' };
  }

  const title = payload.title || '+one';
  const silent = payload.silent === true;
  const data = payload.data || {};
  const options = {
    body: payload.body || '',
    tag: data.route === 'chat' ? `chat:${data.chatId}` : 'plusone',
    // Chat notifications re-tag per conversation so each chat shows its own
    // entry; everything else collapses into one "+one" row.
    renotify: true,
    icon: '/icon-192.png',
    badge: '/favicon-32.png',
    data,
    requireInteraction: payload.channel === 'calls',
  };
  if (!silent) {
    options.vibrate = payload.channel === 'calls' ? [300, 150, 300, 150, 300] : [120];
    options.silent = false;
  } else {
    options.silent = true;
  }

  event.waitUntil((async () => {
    // Suppress ONLY when the user is focused on the app AND already reading
    // this exact conversation (the socket paints it live). Every other case
    // — unfocused tab, another window, app closed, different screen — shows
    // a real notification. Receiving a push NEVER navigates by itself:
    // deep links happen only on notificationclick below.
    try {
      const focused = await hasFocusedClient();
      const readingThisChat = focused
        && data.route === 'chat'
        && !!data.chatId
        && data.chatId === viewingChatId;
      if (readingThisChat) return;
    } catch {}
    await self.registration.showNotification(title, options);
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  event.waitUntil((async () => {
    const clientList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    // Hand the route to an existing app window when possible. `tapped` marks
    // this as a genuine user tap — the page only navigates on those.
    for (const client of clientList) {
      if ('focus' in client) {
        client.postMessage({ plusonePush: data, tapped: true });
        return client.focus();
      }
    }
    // No window to hand the payload to — carry it in the launch URL so the
    // freshly opened app can still deep-link to the tapped chat.
    let url = '/';
    if (data && data.route) {
      try {
        url = `/?push=${encodeURIComponent(btoa(encodeURIComponent(JSON.stringify(data))))}`;
      } catch {}
    }
    return self.clients.openWindow(url);
  })());
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
  // The page reports which conversation is on screen so pushes for that
  // chat can be suppressed while the user is actively reading it.
  if (event.data && event.data.type === 'plusone-viewing') {
    viewingChatId = event.data.chatId || null;
  }
});
