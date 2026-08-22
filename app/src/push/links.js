/* Incoming deep links — community invite links (`https://…/c/<code>` on the
 * web, `plusone://c/<code>` on native) and the plusone:// screen routes.
 * Invite links JOIN the community first (the link is the approval, whatever
 * the join policy) and then open its detail screen.
 */
import { Linking, Platform } from 'react-native';
import { api } from '../api';
import { routeFromNotification, routeFromUrl, openCommunity } from './routing';

async function joinCommunityByCode(code) {
  try {
    const result = await api.joinCommunityByCode(code);
    if (result?.community?.id) openCommunity(result.community.id);
  } catch (e) {
    if (typeof __DEV__ !== 'undefined' && __DEV__) console.warn('[links] invite link failed:', e?.message);
  }
}

/** Route any incoming URL. Safe to call multiple times. */
export function handleDeepLink(url) {
  if (!url) return;
  let asPlusone = url;
  if (/^https?:\/\//i.test(url)) {
    // Web invite links arrive as https://host/c/<code> — normalize to the
    // plusone:// shape so one parser handles every platform.
    asPlusone = `plusone://${url.replace(/^https?:\/\/[^/]+\//i, '')}`;
  }
  const route = routeFromUrl(asPlusone);
  if (!route) return;
  if (route.route === 'community' && route.code) {
    joinCommunityByCode(route.code);
    return;
  }
  routeFromNotification(route);
}

/** Wire up native Linking events + the web /c/<code> path. Call once, after
 *  the user is signed in (invite joins need auth). Returns a cleanup fn. */
export function setupDeepLinks() {
  if (Platform.OS === 'web') {
    try {
      const path = window.location.pathname;
      if (/^\/c\/[a-z0-9]+\/?$/i.test(path)) {
        const code = path.split('/')[2];
        // Strip the path so a refresh doesn't re-join; history stays clean.
        window.history.replaceState({}, '', '/');
        if (code) joinCommunityByCode(code.toLowerCase());
      }
    } catch {}
    return () => {};
  }

  (async () => {
    try {
      const url = await Linking.getInitialURL?.();
      handleDeepLink(url);
    } catch {}
  })();
  const sub = Linking.addEventListener?.('url', ({ url }) => handleDeepLink(url));
  return () => sub?.remove?.();
}
