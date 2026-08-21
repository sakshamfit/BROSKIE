/* Deep-link routing for push notifications.
 *
 * The server attaches { route, chatId?, postId? } to every push. When the
 * user taps a notification we jump straight to the exact screen — the
 * Conversation, the Activity inbox, the Colleagues tab — never just the
 * home tab.
 *
 * Routing is decoupled from the notification system so it works no matter
 * how the payload arrives (notification tap, plusone:// link later, or a
 * cold start): if navigation isn't ready yet (still booting / restoring the
 * session), the target is queued and flushed the moment it is.
 */
import { createNavigationContainerRef } from '@react-navigation/native';

export const navigationRef = createNavigationContainerRef();

/* Pages inside HomeTabs (Network | See | Chats | Colleagues). HomeTabs
 * registers a listener so a push can switch the visible page even though
 * tab state lives in component state, not navigation state. */
const tabListeners = new Set();
export function onHomeTabRequest(fn) {
  tabListeners.add(fn);
  return () => tabListeners.delete(fn);
}
function requestHomeTab(tab) {
  tabListeners.forEach((fn) => {
    try { fn(tab); } catch {}
  });
}

let pendingRouteData = null;
let lastAppliedAt = 0;
let lastAppliedKey = '';

/* Network feed filter requests (Phase 2): the Today strip and the greeter can
 * say "show my-places posts" from anywhere; NetworkScreen subscribes. The
 * request is also remembered as "pending" because the Network page may not be
 * mounted when the request is made (the swipe pager keeps nearby pages
 * alive) — NetworkScreen consumes it whenever it (re)mounts. */
const networkFilterListeners = new Set();
let pendingNetworkFilter = null;
export function onNetworkFilterRequest(fn) {
  networkFilterListeners.add(fn);
  return () => networkFilterListeners.delete(fn);
}
export function requestNetworkFilter(filter) {
  pendingNetworkFilter = filter || null;
  networkFilterListeners.forEach((fn) => {
    try { fn(filter); } catch {}
  });
}
/** Jump to the Network feed with a filter applied ('places' | 'following' | null). */
export function openNetworkFeed(filter) {
  if (filter) pendingNetworkFilter = filter;
  networkFilterListeners.forEach((fn) => {
    try { fn(pendingNetworkFilter); } catch {}
  });
  requestHomeTab('network');
}
export function consumePendingNetworkFilter() {
  const filter = pendingNetworkFilter;
  pendingNetworkFilter = null;
  return filter;
}

function routeKey(data) {
  return `${data.route || ''}:${data.chatId || ''}:${data.postId || ''}:${data.messageId || ''}`;
}

/** Apply a queued route if navigation is up. Safe to call repeatedly. */
export function flushPendingRoute() {
  if (!pendingRouteData || !navigationRef.isReady()) return;
  const data = pendingRouteData;
  const key = routeKey(data);
  // A repeated tap on the same notification (or the state-change storm right
  // after routing) must not push the same screen twice.
  if (key === lastAppliedKey && Date.now() - lastAppliedAt < 1500) { pendingRouteData = null; return; }
  try {
    switch (data.route) {
      case 'chat':
        if (data.chatId) {
          requestHomeTab('chats');
          navigationRef.navigate('Conversation', { chatId: data.chatId });
        }
        break;
      case 'activity':
        navigationRef.navigate('Activity');
        break;
      case 'colleagues':
        requestHomeTab('colleagues');
        navigationRef.navigate('Home');
        break;
      case 'network':
      case 'post':
        requestHomeTab('network');
        navigationRef.navigate('Home');
        break;
      default:
        break;
    }
    lastAppliedKey = key;
    lastAppliedAt = Date.now();
    pendingRouteData = null;
  } catch {
    // Navigation not quite ready — keep it queued; the next state change retries.
  }
}

/** Route the app from a push payload ({ route, chatId?, postId? }). */
export function routeFromNotification(data) {
  if (!data || !data.route) return;
  pendingRouteData = data;
  flushPendingRoute();
}

/** Parse a plusone:// URL (e.g. plusone://chat/abc123) into a route payload. */
export function routeFromUrl(url) {
  if (!url || !url.startsWith('plusone://')) return null;
  const path = url.replace(/^plusone:\/\//, '').replace(/\/+$/, '');
  const [head, id] = path.split('/');
  switch (head) {
    case 'chat': return id ? { route: 'chat', chatId: id } : null;
    case 'activity': return { route: 'activity' };
    case 'colleagues': return { route: 'colleagues' };
    case 'network': return { route: 'network' };
    case 'post': return id ? { route: 'post', postId: id } : null;
    default: return null;
  }
}
