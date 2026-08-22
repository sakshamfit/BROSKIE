/* Push notifications on native (Android first, iOS follows).
 *
 * Registration flow (after sign-in):
 *   1. Create the Android notification channels — the server picks one per
 *      push (messages / calls / activity, plus "-silent" twins for quiet
 *      hours), and Android plays the CHANNEL's sound, not the message's.
 *   2. Ask for notification permission (Android 13+ / iOS).
 *   3. Get an Expo push token bound to this EAS project and register it with
 *      the server (POST /api/push/token) so the server knows this device.
 *   4. Listen: taps route straight to the exact screen (Conversation /
 *      Activity / Colleagues) via src/push/routing.js.
 *
 * FOREGROUND banners: a push alerts the user whenever the app is open UNLESS
 * they are actively looking at the exact conversation it belongs to (the
 * socket already renders that message live — a banner would echo it).
 * ConversationScreen reports the on-screen chat via setViewedChat(). When
 * the app is backgrounded or killed, the OS displays the push on its own.
 */
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { AppState, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api } from '../api';

const DEVICE_ID_KEY = 'plusone.deviceId';

/* When this JS process booted. Only a process this young can be launched
 * BY a notification tap, so getLastNotificationResponseAsync() is only
 * honored while the process is fresh — otherwise an old notification (or
 * one that merely arrived while the app was killed) would hijack a normal
 * launch and auto-open its chat. */
const PROCESS_STARTED_AT = Date.now();
const COLD_START_WINDOW_MS = 45000;

/* Reliable app state. AppState.currentState can be stale on Android until a
 * listener is attached — keep it current ourselves. */
let currentAppState = AppState.currentState || 'active';
AppState.addEventListener('change', (s) => { currentAppState = s; });

/* The conversation currently on screen (null = none), reported by
 * ConversationScreen. Foreground pushes for THIS chat are silent. */
let viewedChatId = null;
export function setViewedChat(chatId) {
  viewedChatId = chatId || null;
}

/* Show a banner for every push except the one conversation the user is
 * actively reading while the app is foregrounded. Backgrounded pushes are
 * always shown (the handler only runs in-app anyway, but stay explicit). */
Notifications.setNotificationHandler({
  handleNotification: ({ notification }) => {
    const data = notification?.request?.content?.data || {};
    const readingThisChat = currentAppState === 'active'
      && (data.route === 'chat' || data.route === 'gc')
      && !!data.chatId
      && data.chatId === viewedChatId;
    const show = !readingThisChat;
    return {
      shouldShowBanner: show,
      shouldShowList: show,
      shouldShowAlert: show, // legacy field, kept for older native shells
      shouldPlaySound: show,
      shouldSetBadge: true,
    };
  },
});

let registeredToken = null;

/** Android channels. Ids are the contract with server/src/push.js. */
async function ensureAndroidChannels() {
  if (Platform.OS !== 'android') return;
  const { Importance } = Notifications.Android;
  const defs = [
    {
      id: 'messages',
      name: 'Messages',
      importance: Importance.HIGH,
      sound: 'default',
      vibrationPattern: [0, 180, 120, 180],
    },
    {
      id: 'messages-silent',
      name: 'Messages (quiet hours)',
      importance: Importance.LOW, // tray only — no sound, no heads-up
    },
    {
      id: 'calls',
      name: 'Calls',
      importance: Importance.HIGH,
      sound: 'default',
      vibrationPattern: [0, 400, 200, 400],
    },
    {
      id: 'calls-silent',
      name: 'Calls (quiet hours)',
      importance: Importance.LOW,
    },
    {
      id: 'activity',
      name: 'Activity & requests',
      importance: Importance.DEFAULT,
      sound: 'default',
    },
    {
      id: 'activity-silent',
      name: 'Activity & requests (quiet hours)',
      importance: Importance.LOW,
    },
  ];
  await Promise.all(
    defs.map((d) =>
      Notifications.setNotificationChannelAsync(d.id, {
        name: d.name,
        importance: d.importance,
        sound: d.sound || null,
        vibrationPattern: d.vibrationPattern || undefined,
        lockscreenVisibility: Notifications.Android.NotificationVisibility.PRIVATE,
        bypassDnd: false,
      }).catch(() => null)
    )
  );
}

async function getOrCreateDeviceId() {
  try {
    const existing = await AsyncStorage.getItem(DEVICE_ID_KEY);
    if (existing) return existing;
    const id = 'dev_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
    await AsyncStorage.setItem(DEVICE_ID_KEY, id);
    return id;
  } catch {
    return null;
  }
}

/**
 * Register this device for push. Resolves with
 * { token, dispose() } or null when push isn't possible/allowed here.
 * `onRoute(data)` is called when the user taps a notification.
 */
export async function registerPushNotifications({ onRoute }) {
  // iOS simulators cannot receive push; Android emulators can.
  if (Platform.OS === 'ios' && !Device.isDevice) return null;

  try {
    await ensureAndroidChannels();

    let permission = await Notifications.getPermissionsAsync();
    if (!permission.granted && permission.canAskAgain !== false) {
      permission = await Notifications.requestPermissionsAsync();
    }
    if (!permission.granted && !permission.ios?.status) return null;

    const projectId = Constants.expoConfig?.extra?.eas?.projectId;
    if (!projectId) {
      if (typeof __DEV__ !== 'undefined' && __DEV__) console.warn('[push] no EAS projectId — push disabled');
      return null;
    }

    const tokenResult = await Notifications.getExpoPushTokenAsync({ projectId });
    const token = tokenResult?.data;
    if (!token) return null;
    registeredToken = token;

    const deviceId = await getOrCreateDeviceId();
    try {
      await api.registerPushToken({
        token,
        platform: Platform.OS === 'ios' ? 'ios' : 'android',
        deviceId,
        appVersion: Constants.expoConfig?.version || null,
      });
    } catch (e) {
      // Server unreachable — the socket/UI still work; token registers on a
      // later launch or the next foregrounding.
      if (typeof __DEV__ !== 'undefined' && __DEV__) console.warn('[push] token not registered yet:', e?.message);
    }

    // Foreground receive: keep the icon badge in step with the server's count.
    const receivedSub = Notifications.addNotificationReceivedListener((notification) => {
      const badge = notification?.request?.content?.badge;
      if (typeof badge === 'number' && badge >= 0) {
        Notifications.setBadgeCountAsync(badge).catch(() => {});
      }
    });

    // Tap while the app is running (foreground or background).
    const responseSub = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response?.notification?.request?.content?.data;
      if (data?.route) onRoute?.(data);
    });

    // Tap that cold-started the app: the response listener misses it because
    // it registered too late. Only a FRESH process can have been launched by
    // the tap itself, and only trust recent notifications so an old tap (or
    // one that merely arrived while the app was killed) doesn't hijack a
    // later normal launch and auto-open its chat.
    (async () => {
      try {
        const response = await Notifications.getLastNotificationResponseAsync();
        const receivedAt = response?.notification?.date;
        const data = response?.notification?.request?.content?.data;
        const isColdStart = Date.now() - PROCESS_STARTED_AT < COLD_START_WINDOW_MS;
        if (isColdStart && data?.route && typeof receivedAt === 'number' && Date.now() - receivedAt < COLD_START_WINDOW_MS) {
          onRoute?.(data);
        }
      } catch {}
    })();

    return {
      token,
      dispose() {
        receivedSub.remove();
        responseSub.remove();
      },
    };
  } catch (e) {
    if (typeof __DEV__ !== 'undefined' && __DEV__) console.warn('[push] registration failed:', e?.message);
    return null;
  }
}

/** Best-effort token removal on logout. */
export async function unregisterPushNotifications() {
  const token = registeredToken;
  registeredToken = null;
  if (!token) return false;
  try {
    await api.unregisterPushToken(token);
    return true;
  } catch {
    return false;
  }
}

/** Set the launcher/icon badge (iOS supported; Android launchers vary). */
export function setAppBadge(count) {
  if (!Number.isFinite(count) || count < 0) return;
  Notifications.setBadgeCountAsync(count).catch(() => {});
}

export function clearAppBadge() {
  Notifications.setBadgeCountAsync(0).catch(() => {});
}
