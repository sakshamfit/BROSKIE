/* +one web push service worker.
 *
 * Shows push notifications for the +one PWA when the app is NOT visible
 * (hidden tab, minimized window, closed app). When a tab IS visible the
 * socket already updates the UI, so the push is forwarded to the page
 * instead of doubling up as a banner. Tapping a notification focuses the
 * app (or opens it) and hands the deep-link payload to the page, which
 * routes to the exact screen — same contract as the native apps.
 */
/* eslint-disable no-restricted-globals */

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

/** Is any app tab visible right now? */
async function hasVisibleClient() {
  const clientList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  return clientList.some((client) => client.visibilityState === 'visible');
}

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (e) {
    payload = { title: '+one', body: event.data ? event.data.text() : '' };
  }

  const title = payload.title || '+one';
  const silent = payload.silent === true;
  const options = {
    body: payload.body || '',
    tag: payload.data && payload.data.route === 'chat' ? `chat:${payload.data.chatId}` : 'plusone',
    // Chat notifications re-tag per conversation so each chat shows its own
    // entry; everything else collapses into one "+one" row.
    renotify: true,
    icon: '/icon-192.png',
    badge: '/favicon-32.png',
    data: payload.data || {},
    requireInteraction: payload.channel === 'calls',
  };
  if (!silent) {
    options.vibrate = payload.channel === 'calls' ? [300, 150, 300, 150, 300] : [120];
    options.silent = false;
  } else {
    options.silent = true;
  }

  event.waitUntil((async () => {
    const visible = await hasVisibleClient();
    if (visible) {
      // App is open on screen — let the page's live socket state handle it.
      const clientList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      clientList.forEach((client) => client.postMessage({ plusonePush: payload.data || {} }));
      return;
    }
    await self.registration.showNotification(title, options);
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  event.waitUntil((async () => {
    const clientList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    // Hand the route to an existing app window when possible.
    for (const client of clientList) {
      if ('focus' in client) {
        client.postMessage({ plusonePush: data });
        return client.focus();
      }
    }
    return self.clients.openWindow('/');
  })());
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});
