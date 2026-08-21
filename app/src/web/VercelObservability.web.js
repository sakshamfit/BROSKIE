import { Analytics } from '@vercel/analytics/react';
import { SpeedInsights } from '@vercel/speed-insights/react';

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
  return (
    <>
      <Analytics />
      <SpeedInsights />
    </>
  );
}
