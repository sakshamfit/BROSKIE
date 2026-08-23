/* Mounts the push-notification system inside the provider tree.
 *
 * - Registers the device token after sign-in, unregisters on sign-out.
 * - Keeps the icon badge in sync with unread chats + pending Activity,
 *   exactly the number the server stamps on each push (badgeFor in
 *   server/src/push.js) so the app and the tray always agree.
 * - Routes notification taps (see src/push/routing.js).
 *
 * On web the same controller drives the browser Push API + service worker
 * (VAPID, no Expo shim); on native it registers an Expo push token.
 */
import { useEffect } from 'react';
import { AppState } from 'react-native';
import { useAuth } from '../store/AuthContext';
import { useChatListState, useChatRealtime } from '../store/ChatContext';
import {
  registerPushNotifications,
  unregisterPushNotifications,
  setAppBadge,
  clearAppBadge,
  setViewedChat,
} from './notifications';
import { routeFromNotification } from './routing';

export default function PushController() {
  const { user, token } = useAuth();
  const { chats } = useChatListState();
  const { activityUnread } = useChatRealtime();

  /* Registration lifecycle: one registration per signed-in session.
   *
   * Registration can fail silently on a slow/spotty first launch (server
   * unreachable, push service busy), which is the most common reason a phone
   * "doesn't get notifications". If we haven't successfully registered yet,
   * retry whenever the app returns to the foreground — no user action needed.
   */
  useEffect(() => {
    if (!token || !user) return undefined;
    let handle = null;
    let cancelled = false;
    let running = false;

    const attempt = async () => {
      if (running || cancelled || handle) return;
      running = true;
      try {
        const registered = await registerPushNotifications({ onRoute: routeFromNotification });
        if (registered) handle = registered;
        if (cancelled && handle) handle.dispose();
      } finally {
        running = false;
      }
    };

    attempt();

    const appSub = AppState.addEventListener('change', (next) => {
      if (next === 'active') attempt();
    });

    return () => {
      cancelled = true;
      appSub.remove();
      handle?.dispose?.();
    };
  }, [token, user?.id]);

  /* Sign-out cleanup: drop the server token (stops pushes) and the badge. */
  useEffect(() => {
    if (token || user) return undefined;
    unregisterPushNotifications();
    clearAppBadge();
    setViewedChat(null);
    return undefined;
  }, [token, user]);

  /* Badge = unread messages in non-archived chats + pending Activity items.
   * Mirrors the server's badge computation so the number matches the count
   * already stamped on incoming pushes. */
  useEffect(() => {
    if (!token || !user) return;
    const unread = chats.reduce((n, c) => n + (c.archived ? 0 : c.unread || 0), 0);
    setAppBadge(unread + (activityUnread || 0));
  }, [token, user?.id, chats, activityUnread]);

  return null;
}
