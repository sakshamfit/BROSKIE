/* Incoming deep links — community invite links (`https://…/c/<code>` on the
 * web, `plusone://c/<code>` on native) and the plusone:// screen routes.
 * Invite links JOIN the community first (the link is the approval, whatever
 * the join policy) and then open its detail screen.
 */
import { Linking, Platform } from 'react-native';
import { api } from '../api';
import { routeFromNotification, routeFromUrl, openCommunity, openCommunitiesTab } from './routing';
// Single source of truth for the marketing /communities/<slug> pages
// (app/web/community-niches.json). Deep links use the page slug in the URL
// but the app's category keys are the REAL filter (slug "travel" → category
// "trip"). One import keeps every mapping in the pages and the app in sync.
import niches from '../../web/community-niches.json';

const SLUG_CATEGORY = new Map(
  (niches?.niches || []).map((n) => [String(n.slug).toLowerCase(), String(n.category)])
);

/* The web app is served from /app on the public site and from / on
 * single-host deployments — always clean URLs back to the app, not to the
 * marketing homepage. */
function appBase() {
  try {
    const p = window.location.pathname;
    return p === '/app' || p.startsWith('/app/') ? '/app' : '/';
  } catch {
    return '/';
  }
}

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
  // Marketing deep links (plusone://communities/<category>, the web form
  // …/app?tab=communities&category=<category>, and Android App Links
  // https://www.plusoneco.in/communities/<slug>): open the Communities grid,
  // pre-filtered. The URL slug is the marketing page's slug — map it to the
  // app category key so the filter matches what the landing page promised.
  // Category validity is enforced where it is consumed (unknown → unfiltered).
  if (route.route === 'communities') {
    const key = (route.category || '').toLowerCase();
    const category = SLUG_CATEGORY.get(key) || key || null;
    openCommunitiesTab(category);
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
      // Landing-page CTA links: /app?tab=communities&category=run opens the
      // Communities grid with that filter. No side effect to guard against,
      // so the query stays in the URL (a refresh keeps the same view).
      const search = window.location.search || '';
      if (/[?&]tab=communities(&|$)/.test(search)) {
        const category = (search.match(/[?&]category=([a-z-]+)/i) || [])[1];
        openCommunitiesTab(category || null);
      }
      if (/^\/c\/[a-z0-9]+\/?$/i.test(path)) {
        const code = path.split('/')[2];
        // Strip the path so a refresh doesn't re-join; history stays clean.
        window.history.replaceState({}, '', appBase());
        if (code) joinCommunityByCode(code.toLowerCase());
      } else if (/^\/gc\/[0-9a-z]+\/?$/i.test(path)) {
        const gcId = path.split('/')[2];
        window.history.replaceState({}, '', appBase());
        if (gcId) handleDeepLink(`plusone://gc/${gcId}`);
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
