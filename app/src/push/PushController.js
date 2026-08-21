/* Mounts the push-notification system inside the provider tree.
 *
 * - Registers the device token after sign-in, unregisters on sign-out.
 * - Keeps the icon badge in sync with unread chats + pending Activity,
 *   exactly the number the server stamps on each push (badgeFor in
 *   server/src/push.js) so the app and the tray always agree.
 * - Routes notification taps (see src/push/routing.js).
 *
 * On web this renders nothing and does nothing — the notifications module
 * resolves to a no-op stub for the web bundle.
 */
import { useEffect } from 'react';
import { useAuth } from '../store/AuthContext';
import { useChat } from '../store/ChatContext';
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
  const { chats, activityUnread } = useChat();

  /* Registration lifecycle: one registration per signed-in session. */
  useEffect(() => {
    if (!token || !user) return undefined;
    let handle = null;
    let cancelled = false;

    (async () => {
      handle = await registerPushNotifications({ onRoute: routeFromNotification });
      if (cancelled && handle) handle.dispose();
    })();

    return () => {
      cancelled = true;
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
