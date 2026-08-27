/**
 * Which feed post owns the shared preview player while the list scrolls.
 *
 * Split out of the feed screens so the Network feed and a user's profile
 * decide identically, and so the rule is unit-testable without a list.
 *
 * Two rules, both learned from the scroll-sync bug:
 *
 *  1. The post you are *looking at* is the most central one on screen — not
 *     simply the first viewable one. FlatList reports `viewableItems` in
 *     index order, so picking the first match handed playback to the post
 *     that was still poking in at the top while the user had already scrolled
 *     to the next one.
 *
 *  2. A fast fling crosses several posts before it settles. Applying every
 *     intermediate decision starts (and immediately tears down) a real audio
 *     load per post, which is what let clips briefly overlap. Callers debounce
 *     the decision by SONG_SETTLE_MS so only the post the scroll lands on ever
 *     loads audio — short enough that a slow scroll still feels immediate,
 *     since the item must already have held the viewability threshold for
 *     `minimumViewTime` before it is reported at all.
 */

/** Trailing coalesce window for viewability changes, in ms. */
export const SONG_SETTLE_MS = 120;

/**
 * The id of the post whose song should be playing, or null when none of the
 * visible posts has a preview.
 */
export function pickActiveSongPostId(viewableItems) {
  const visible = (viewableItems || []).filter(
    (v) => v && v.isViewable && Number.isFinite(v.index),
  );
  if (!visible.length) return null;

  const songed = visible.filter((v) => v.item?.song?.previewUrl);
  if (!songed.length) return null;

  // Middle of the currently visible run of rows.
  const indexes = visible.map((v) => v.index);
  const mid = (Math.min(...indexes) + Math.max(...indexes)) / 2;

  let best = songed[0];
  for (const candidate of songed) {
    const distance = Math.abs(candidate.index - mid);
    const bestDistance = Math.abs(best.index - mid);
    // Ties (two rows equidistant from the middle) resolve upwards, so the
    // choice is stable instead of flickering between the pair.
    if (distance < bestDistance || (distance === bestDistance && candidate.index < best.index)) {
      best = candidate;
    }
  }
  return best.item?.id ?? null;
}
