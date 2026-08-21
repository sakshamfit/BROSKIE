/* Web build: push notifications are native-only for now (Android first —
 * see APP_STATUS.md). This stub keeps imports platform-safe so the web
 * bundle never pulls in expo-notifications' native code. */
export async function registerPushNotifications() {
  return null;
}

export async function unregisterPushNotifications() {
  return false;
}

export function setAppBadge() {}
export function clearAppBadge() {}
