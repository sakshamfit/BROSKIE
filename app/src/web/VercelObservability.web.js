import { useEffect } from 'react';
import { Analytics } from '@vercel/analytics/react';
import { SpeedInsights } from '@vercel/speed-insights/react';
import { loadEmojiData } from '../icons/emojiDataState';

/**
 * Vercel Web Analytics + Speed Insights (web only).
 *
 * +one is an Expo / React Native app, not Next.js, so Speed Insights is
 * imported from `@vercel/speed-insights/react` rather than `/next`. The
 * components inject a <script> for /_vercel/... — which is served by Vercel.
 * On ANY other host (Railway single-host, local, Render) those URLs fall
 * through the SPA fallback and return index.html, which the browser then
 * tries to execute as JavaScript ("Unexpected token '<'") — a scary red
 * error even though it's just missing analytics. Only mount the components
 * when we are actually on a Vercel origin; everywhere else render nothing.
 *
 * Metro resolves this file on web via the `.web.js` suffix. Native builds
 * use the sibling no-op so the Vercel packages never enter the iOS/Android
 * bundle.
 */
function isVercel() {
  return typeof window !== 'undefined' && !!window.location?.hostname?.endsWith?.('.vercel.app');
}

export default function VercelObservability() {
  // The emoji path-data table lives in its own async chunk so it does not
  // delay first paint. Once the page is idle we fetch it in the background,
  // which means by the time the user opens a chat or the emoji picker the
  // vector glyphs are usually already there — the app feels faster without
  // paying for it up front.
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.requestIdleCallback !== 'function' && typeof window.setTimeout !== 'function') {
      return undefined;
    }
    const prefetch = () => loadEmojiData().catch(() => {});
    const waiter = window.requestIdleCallback
      ? window.requestIdleCallback(prefetch, { timeout: 4000 })
      : window.setTimeout(prefetch, 1500);
    return () => {
      if (window.requestIdleCallback) window.cancelIdleCallback?.(waiter);
      else window.clearTimeout?.(waiter);
    };
  }, []);

  if (!isVercel()) return null;

  return (
    <>
      <Analytics />
      <SpeedInsights />
    </>
  );
}
