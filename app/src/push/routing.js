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

/* Community deep links (Phase 3 invite links): open a community's detail
 * from anywhere — Network switches to the Communities section and the
 * detail sheet opens. Survives pager unmounts like the filter above. */
const communityListeners = new Set();
let pendingCommunityId = null;
export function onOpenCommunity(fn) {
  communityListeners.add(fn);
  return () => communityListeners.delete(fn);
}
export function openCommunity(communityId) {
  if (!communityId) return;
  pendingCommunityId = communityId;
  communityListeners.forEach((fn) => {
    try { fn(communityId); } catch {}
  });
  requestHomeTab('network');
}
export function consumePendingCommunity() {
  const id = pendingCommunityId;
  pendingCommunityId = null;
  return id;
}

/* Profiles & posts — tapping any avatar opens that person's profile, and
 * tapping a "liked your post" activity row opens the post itself. On phones
 * these are real stack screens (UserProfile / PostDetail) reached through
 * navigationRef; the desktop/tablet split shell registers a handler instead
 * and shows them as overlay panels. `will-open` listeners let modal hosts
 * (comments sheet, community detail) close themselves so the destination is
 * actually visible. */
const profileHandlers = new Set();
const postHandlers = new Set();
const willOpenListeners = new Set();

export function onOpenProfileRequest(fn) {
  profileHandlers.add(fn);
  return () => profileHandlers.delete(fn);
}
export function onOpenPostRequest(fn) {
  postHandlers.add(fn);
  return () => postHandlers.delete(fn);
}
/** Fired right before a profile or post opens — modal hosts should close. */
export function onProfileWillOpen(fn) {
  willOpenListeners.add(fn);
  return () => willOpenListeners.delete(fn);
}
function announceWillOpen() {
  willOpenListeners.forEach((fn) => {
    try { fn(); } catch {}
  });
}

/** Open a user's profile from anywhere in the app. */
export function openProfile(userId) {
  if (!userId) return;
  announceWillOpen();
  if (profileHandlers.size) {
    profileHandlers.forEach((fn) => {
      try { fn(userId); } catch {}
    });
    return;
  }
  if (navigationRef.isReady()) {
    navigationRef.navigate('UserProfile', { userId });
  }
}

/** Open a single post (deep link target for "liked your post" etc.). */
export function openPost(postId) {
  if (!postId) return;
  announceWillOpen();
  if (postHandlers.size) {
    postHandlers.forEach((fn) => {
      try { fn(postId); } catch {}
    });
    return;
  }
  if (navigationRef.isReady()) {
    navigationRef.navigate('PostDetail', { postId });
  }
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
      case 'admin':
        // Safety alert tap → the Admin Safety Center.
        navigationRef.navigate('AdminSafety');
        break;
      case 'network':
      case 'post':
        // Like/comment pushes carry the post id — land directly on the post.
        if (data.postId) {
          navigationRef.navigate('PostDetail', { postId: data.postId });
          break;
        }
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
    case 'c': return id ? { route: 'community', code: id } : null;
    default: return null;
  }
}
