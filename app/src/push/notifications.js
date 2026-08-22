/* Push notifications on WEB — full parity with Android/iOS.
 *
 * Web push here is the plain browser Push API (Chrome/Edge/Firefox; Safari
 * 16.4+ when the PWA is installed), NOT Expo's web shim: the +one server
 * signs and sends web pushes itself with VAPID keys (server/src/push.js),
 * so nothing extra is configured anywhere.
 *
 * Flow after sign-in:
 *   1. Register our service worker (app/public/service-worker.js).
 *   2. Ask for notification permission.
 *   3. Read the VAPID public key from GET /api/push/web-config and
 *      pushManager.subscribe() with it.
 *   4. POST the PushSubscription to the server.
 *   5. The service worker shows a notification for every push except the
 *      conversation the user is actively reading (reported via
 *      setViewedChat below), and posts TAP payloads back to this page for
 *      deep-link routing — a received push never navigates on its own.
 */
import { api } from '../api';

let registeredSubscription = null;
let messageListenerAttached = false;
let viewingSyncAttached = false;
let lastViewedChatId = null;

/** Base64url → Uint8Array for applicationServerKey. */
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i);
  return output;
}

function attachServiceWorkerMessages(onRoute) {
  if (messageListenerAttached || typeof navigator === 'undefined' || !navigator.serviceWorker) return;
  messageListenerAttached = true;
  navigator.serviceWorker.addEventListener('message', (event) => {
    const data = event?.data?.plusonePush;
    // Route ONLY genuine notification taps. A push that merely arrives must
    // never yank the user into a chat (the old "chat auto-opened" bug).
    if (data?.route && event?.data?.tapped === true) onRoute?.(data);
  });
}

/* ---- which conversation is on screen (suppress its banners) ---- */

function postViewingChatToServiceWorker() {
  try {
    navigator.serviceWorker?.controller?.postMessage({ type: 'plusone-viewing', chatId: lastViewedChatId });
  } catch {}
}

/**
 * Report which conversation is currently on screen (null = none). The
 * service worker skips the notification banner for that chat while the app
 * is focused — the socket renders its messages live — and notifies for
 * everything else. Mirrors the native module's setViewedChat.
 */
export function setViewedChat(chatId) {
  lastViewedChatId = chatId || null;
  postViewingChatToServiceWorker();
}

function attachViewingSync() {
  if (viewingSyncAttached || typeof window === 'undefined' || !navigator.serviceWorker) return;
  viewingSyncAttached = true;
  // The browser can kill and restart the service worker at any time; it
  // then forgets which chat is on screen. Re-send whenever the page gains
  // focus/becomes visible or a new controller takes over.
  const resend = () => postViewingChatToServiceWorker();
  window.addEventListener('focus', resend);
  document.addEventListener('visibilitychange', resend);
  navigator.serviceWorker.addEventListener('controllerchange', resend);
}

/* A notification tap that cold-opened the app (no window existed): the
 * service worker carried the route payload in the launch URL because the
 * new tab misses the postMessage. Consume it once, then clean the URL. */
function consumeLaunchPushFromUrl(onRoute) {
  try {
    const encoded = new URLSearchParams(window.location.search).get('push');
    if (!encoded) return;
    window.history.replaceState({}, '', '/');
    const data = JSON.parse(decodeURIComponent(atob(encoded)));
    if (data?.route) onRoute?.(data);
  } catch {}
}

/**
 * Register this browser for push. Resolves with
 * { token: null, dispose() } or null when push isn't possible/allowed here.
 * `onRoute(data)` is called when the user taps a notification.
 */
export async function registerPushNotifications({ onRoute }) {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return null;
  try {
    attachServiceWorkerMessages(onRoute);
    attachViewingSync();
    consumeLaunchPushFromUrl(onRoute);

    // Register the service worker first and UNCONDITIONALLY. It powers the
    // offline shell cache and PWA installability even when the user declines
    // notification permission — only the push subscription below is gated on
    // their choice. (Previously a denied prompt also disabled offline mode.)
    let registration = null;
    try {
      registration = await navigator.serviceWorker.register('/service-worker.js');
      await navigator.serviceWorker.ready;
    } catch (e) {
      if (typeof __DEV__ !== 'undefined' && __DEV__) console.warn('[push:web] service worker registration failed:', e?.message);
    }

    if (!('PushManager' in window) || typeof Notification === 'undefined') return null;
    let permission = Notification.permission;
    if (permission === 'default') permission = await Notification.requestPermission();
    if (permission !== 'granted' || !registration) return null;

    const config = await api.webPushConfig();
    if (!config?.enabled || !config?.publicKey) return null;

    let subscription = await registration.pushManager.getSubscription();
    const applicationServerKey = urlBase64ToUint8Array(config.publicKey);
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey,
      });
    } else if (!subscriptionKeysMatch(subscription, applicationServerKey)) {
      // Subscribed under an old key (e.g. regenerated VAPID) — resubscribe.
      await subscription.unsubscribe().catch(() => {});
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey,
      });
    }
    registeredSubscription = subscription;

    try {
      await api.registerWebPushSubscription(subscription.toJSON());
    } catch (e) {
      if (typeof __DEV__ !== 'undefined' && __DEV__) console.warn('[push:web] not registered yet:', e?.message);
    }

    return {
      token: null,
      dispose() {
        // Listeners stay attached on purpose: one page-level message router
        // serves every registration.
      },
    };
  } catch (e) {
    if (typeof __DEV__ !== 'undefined' && __DEV__) console.warn('[push:web] registration failed:', e?.message);
    return null;
  }
}

function subscriptionKeysMatch(subscription, applicationServerKey) {
  try {
    const existing = new Uint8Array(subscription.applicationServerKey);
    return existing.length === applicationServerKey.length && existing.every((b, i) => b === applicationServerKey[i]);
  } catch {
    return false;
  }
}

/** Best-effort removal on logout. */
export async function unregisterPushNotifications() {
  const subscription = registeredSubscription;
  registeredSubscription = null;
  if (!subscription) return false;
  try {
    await api.unregisterWebPushSubscription(subscription.endpoint);
  } catch { /* server-side cleanup is best-effort */ }
  try { await subscription.unsubscribe(); } catch {}
  return true;
}

/** Web app badge (Chrome/Edge; ignored elsewhere). */
export function setAppBadge(count) {
  try {
    if (!Number.isFinite(count) || count < 0) return;
    if (count === 0 && navigator.clearAppBadge) navigator.clearAppBadge().catch(() => {});
    else if (navigator.setAppBadge) navigator.setAppBadge(count).catch(() => {});
  } catch {}
}

export function clearAppBadge() {
  setAppBadge(0);
}
