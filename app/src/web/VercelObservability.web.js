import { useEffect } from 'react';
import { Analytics } from '@vercel/analytics/react';
import { SpeedInsights } from '@vercel/speed-insights/react';
import { loadEmojiData } from '../icons/emojiDataState';

/**
 * Vercel Web Analytics + Speed Insights (web only).
 *
 * +one is an Expo / React Native app, not Next.js, so Speed Insights is
 * imported from `@vercel/speed-insights/react` rather than `/next`. Both
 * components inject a <script> into document.head; they no-op quietly if
 * the site is not served from Vercel (the /_vercel/... request 404s).
 *
 * Metro resolves this file on web via the `.web.js` suffix. Native builds
 * use the sibling no-op so the Vercel packages never enter the iOS/Android
 * bundle.
 */
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

  return (
    <>
      <Analytics />
      <SpeedInsights />
    </>
  );
}
