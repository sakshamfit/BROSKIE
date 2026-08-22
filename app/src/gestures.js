/**
 * +one — centralized gesture-priority system ("finger-first" motion).
 *
 * Every horizontal gesture in the app resolves through this module so that
 * competing gestures never fight. Priority, highest first:
 *
 *   1. MESSAGE_SWIPE    — swipe-to-reply when the finger starts on a message
 *                         (MessageBubble claims in the responder CAPTURE
 *                         phase, which always runs before this pager's
 *                         bubble-phase claim — so it always wins).
 *   2. COMPONENT_SWIPE  — horizontal carousels / filter strips / media
 *                         viewers. Native ScrollViews claim the responder
 *                         in the capture phase too, so a swipe inside a
 *                         horizontal list scrolls the list and never flips
 *                         a page. Modal viewers sit on their own root and
 *                         never even reach the pager.
 *   3. PAGE_SWIPE       — page-to-page navigation between major sections.
 *                         Only claims in the bubble phase, only after the
 *                         lock zone, and only when the dominant axis is
 *                         horizontal — so vertical feed scrolling, message
 *                         swipes and carousels always win first.
 *
 * Nothing is decided on touch-down. A small lock zone (GESTURE_LOCK) lets
 * the finger move before the dominant axis is chosen, so scrolling a feed
 * never flips a page and swiping a message never scrolls the chat.
 *
 * All functions here are pure (no react-native imports) so the gesture
 * math is unit-testable and shared verbatim by every gesture surface.
 *
 * ------------------------------------------------------------------ */

/*
 * Gesture state machine (shared by the pager and the message bubble):
 *
 *   IDLE ──touch──▶ TOUCH_START ──movement──▶ GESTURE_DETECTING
 *                                                 │
 *                    ┌────────────────────────────┼──────────────────────────┐
 *                    │                            │                          │
 *               vertical dominant            horizontal dominant        no winner
 *                    │                            │                          │
 *                    ▼                            ▼                          ▼
 *              VERTICAL_SCROLL          MESSAGE_SWIPE   COMPONENT_SWIPE   PAGE_SWIPE
 *              (never claimed)          (capture phase) (capture phase)  (bubble phase)
 *                    │                            │                          │
 *                    │                      BELOW_THRESHOLD           BELOW_THRESHOLD
 *                    │                      ──release──▶ CANCEL       ──release──▶ SPRING_BACK
 *                    │                      THRESHOLD_REACHED         THRESHOLD_REACHED
 *                    │                      ──release──▶ REPLY        ──release▶ NAVIGATE
 *                    │                      (badge armed once,        (momentum spring +
 *                    │                       message springs back)     state commits)
 *                    ▼
 *               scroll view keeps the finger
 *
 * Each surface implements its slice of the machine with PanResponder
 * claim/arm state plus these pure decision functions — no scattered
 * booleans deciding gestures across components.
 */

/* ------------------------------------------------------------------ */
/* input modality (shared by every gesture surface)                    */
/* ------------------------------------------------------------------ */

/**
 * True when a gesture/press event came from a finger (not mouse or pen).
 * `nativeEvent` is the raw event payload react-native(-web) attaches:
 *   - Pointer Events builds (react-native-web) expose `pointerType`;
 *   - Touch Events builds expose a live `touches` array.
 * Pure — no react-native imports, safe to unit test.
 */
export const isTouchInput = (nativeEvent) => {
  if (!nativeEvent) return false;
  if (nativeEvent.pointerType) return nativeEvent.pointerType === 'touch';
  return !!(nativeEvent.touches && nativeEvent.touches.length > 0);
};

/**
 * True when the environment has a real touch screen — phones/tablets in a
 * browser, WebView app shells (Median), and touch laptops. Mouse-only
 * desktops stay swipe-free (they keep click/hover semantics untouched).
 * `win` is injectable for tests; falls back to the global `window`.
 */
export const hasTouchScreen = (win) => {
  const w = win || (typeof window !== 'undefined' ? window : undefined);
  if (!w) return false;
  if ('ontouchstart' in w) return true;
  const nav = w.navigator || {};
  return typeof nav.maxTouchPoints === 'number' && nav.maxTouchPoints > 0;
};

/* ------------------------------------------------------------------ */
/* direction lock zone                                                 */
/* ------------------------------------------------------------------ */

/** Pixels of freedom before any gesture claims the finger. */
export const GESTURE_LOCK = 10;

/**
 * Decide the gesture axis after the lock zone. Returns one of:
 *   'none' | 'vertical' | 'horizontal'
 *
 * `dominance` is the ratio the winning axis must beat the other by, so a
 * slightly diagonal drag doesn't trigger anything.
 */
export const resolveGesture = (
  dx,
  dy,
  { lock = GESTURE_LOCK, dominance = 1.2 } = {},
) => {
  const adx = Math.abs(dx);
  const ady = Math.abs(dy);
  if (adx < lock && ady < lock) return 'none';
  if (adx > ady * dominance) return 'horizontal';
  if (ady > adx * dominance) return 'vertical';
  return 'none';
};

/* ------------------------------------------------------------------ */
/* page swipe (priority 3)                                             */
/* ------------------------------------------------------------------ */

export const PAGE_SWIPE = {
  /** Lock zone before the pager claims the finger (message swipe locks at 8,
   *  carousels at their own slop — both below this, so they always win). */
  LOCK: 12,
  /** Horizontal axis must beat vertical by this much. */
  DOMINANCE: 1.2,
  /** Release at ≥ this fraction of the viewport width commits navigation. */
  THRESHOLD_FRACTION: 0.3,
  /** Fast intentional flick: commit under the distance threshold if the
   *  finger is moving at least this fast (px/ms)… */
  VELOCITY: 0.55,
  /** …and has travelled at least this far (so a 2px twitch never flips). */
  VELOCITY_MIN_DX: 40,
  /** Resistance applied past the first/last page so the strip never shows
   *  a blank gap beyond the edge. */
  EDGE_RESIST: 0.35,
};

/**
 * Distance + velocity commit rule for a page swipe.
 * `width` is the viewport width in px; `vx` is PanResponder velocity (px/ms).
 */
export const shouldCommitPageSwipe = (dx, vx, width) => {
  if (!width || dx === 0) return false;
  const distance = Math.abs(dx);
  if (distance >= width * PAGE_SWIPE.THRESHOLD_FRACTION) return true;
  return Math.abs(vx) >= PAGE_SWIPE.VELOCITY && distance >= PAGE_SWIPE.VELOCITY_MIN_DX;
};

/**
 * Resisted edge drag. `base` is the strip position at gesture start,
 * `minX`/`maxX` the strip's allowed range. Returns the *delta* to apply
 * (not the absolute position), already resisted at the edges.
 */
export const rubberBand = (dx, base, minX, maxX, resist = PAGE_SWIPE.EDGE_RESIST) => {
  const target = base + dx;
  const clamped =
    target < minX ? minX + (target - minX) * resist
    : target > maxX ? maxX + (target - maxX) * resist
    : target;
  return clamped - base;
};

/* ------------------------------------------------------------------ */
/* message swipe (priority 1)                                          */
/* ------------------------------------------------------------------ */

/** Tuning shared with MessageBubble's swipe-to-reply (dp). */
export const MESSAGE_SWIPE = {
  /** Lock zone: tiny jitters never claim; vertical scroll wins below this. */
  LOCK: 8,
  /** Horizontal axis must beat vertical by this much. */
  DOMINANCE: 1.15,
  /** Max visual travel the bubble allows. */
  MAX: 72,
  /** Releasing at/after this commits the reply. */
  THRESHOLD: 48,
  /** Linear tracking until here… */
  RESIST_START: 50.4,
  /** …then each extra pixel counts for this much. */
  RESIST: 0.3,
};

/**
 * Map raw finger dx to resisted, capped visual travel for a message bubble.
 * Rightward drags only (replies are swiped left-to-right, per +one design).
 */
export const messageTravel = (dx) => {
  if (dx <= 0) return 0;
  if (dx <= MESSAGE_SWIPE.RESIST_START) return dx;
  return Math.min(
    MESSAGE_SWIPE.MAX,
    MESSAGE_SWIPE.RESIST_START + (dx - MESSAGE_SWIPE.RESIST_START) * MESSAGE_SWIPE.RESIST,
  );
};

/**
 * Claim rule for swipe-to-reply: rightward, horizontal-dominant drags only —
 * vertical scroll, taps, long-press and double-tap all keep working.
 */
export const shouldClaimMessageSwipe = (dx, dy) =>
  dx > MESSAGE_SWIPE.LOCK &&
  resolveGesture(dx, dy, {
    lock: MESSAGE_SWIPE.LOCK,
    dominance: MESSAGE_SWIPE.DOMINANCE,
  }) === 'horizontal';
