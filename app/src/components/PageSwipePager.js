import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Easing, Keyboard, PanResponder, Platform, StyleSheet, View } from 'react-native';
import { useTheme } from '../store/ThemeContext';
import { haptic, useReducedMotion } from '../motion';
import { PAGE_SWIPE, resolveGesture, rubberBand, shouldCommitPageSwipe, isTouchInput } from '../gestures';

const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

/**
 * Touch-only on web: mouse drag stays click/hover navigation (desktop keeps
 * its mouse behaviour untouched); touch screens/tablets get the gesture.
 * Shared finger detection lives in ../gestures (isTouchInput).
 */
const isTouchEvent = (e) => Platform.OS !== 'web' || isTouchInput(e?.nativeEvent);

/**
 * PageSwipePager — finger-driven horizontal navigation between major +one
 * sections ("Graphite & Pulp" page navigation).
 *
 * The finger is physically connected to the UI:
 *   - the strip of pages is translated 1:1 with the finger (transform +
 *     native driver, no re-renders during the gesture),
 *   - the neighbouring page is always mounted, so its content is already
 *     rendered and slides in as a real preview — never a blank gap,
 *   - release below threshold springs back; release past threshold (or a
 *     fast flick) commits navigation with momentum + a clamped spring,
 *   - state (tab index) only changes after the gesture completes.
 *
 * Gesture priority lives in ../gestures.js and in the responder phases:
 * this pager claims ONLY in the bubble phase, so message swipes and
 * horizontal carousels (capture-phase claimers) always win.
 */
export default function PageSwipePager({
  pages,       // [{ key, render }]
  index,       // active page index
  onIndexChange,
  progress,    // optional Animated.Value in [-1,1] fed during the drag (tab-bar feedback)
  enabled = true,
  style,
}) {
  const { theme } = useTheme();
  const reduced = useReducedMotion();
  const [width, setWidth] = useState(0);

  const offset = useRef(new Animated.Value(0)).current;
  const settledIndex = useRef(index);
  const indexRef = useRef(index);
  indexRef.current = index;
  const widthRef = useRef(width);
  widthRef.current = width;
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const reducedRef = useRef(reduced);
  reducedRef.current = reduced;
  const pagesRef = useRef(pages);
  pagesRef.current = pages;
  const onIndexChangeRef = useRef(onIndexChange);
  onIndexChangeRef.current = onIndexChange;
  const draggingRef = useRef(false);

  /** Spring the strip to `toIndex`; `velocity` carries the fling momentum. */
  const animateTo = useCallback((toIndex, velocity = 0) => {
    const w = widthRef.current;
    if (!w) return;
    const target = -toIndex * w;
    offset.stopAnimation();
    if (reducedRef.current) {
      // Reduced motion: keep the gesture functional, cut the spring entirely.
      offset.setValue(target);
      return;
    }
    Animated.spring(offset, {
      toValue: target,
      velocity,
      friction: 24,
      tension: 150,
      // Never overshoot: the neighbouring page is mounted, but a bounce
      // would expose the page after it — and that must never look blank.
      overshootClamping: true,
      useNativeDriver: true,
    }).start();
  }, [offset]);

  const settleProgress = useCallback(() => {
    if (!progress) return;
    if (reducedRef.current) { progress.setValue(0); return; }
    Animated.timing(progress, {
      toValue: 0,
      duration: 180,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [progress]);

  // External index changes (tab-bar tap, "open chat" shortcuts): glide over.
  useEffect(() => {
    if (settledIndex.current === index || !widthRef.current) return undefined;
    settledIndex.current = index;
    animateTo(index, 0);
    return undefined;
  }, [index, animateTo]);

  // First layout / rotation: snap to the current page without animation.
  useEffect(() => {
    if (!width) return undefined;
    offset.stopAnimation();
    offset.setValue(-indexRef.current * width);
    progress?.setValue(0);
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width]);

  const panResponder = useRef(
    PanResponder.create({
      // Never claim on touch-down: children (pressables, inputs, scroll
      // views) keep full control until the finger actually moves.
      onStartShouldSetPanResponder: () => false,
      // Bubble phase only. Messages and carousels claim in the capture
      // phase (deeper in the tree) and always win; this only fires when
      // nobody else wanted the finger. The lock zone + dominance rule keep
      // vertical feed scrolling untouched.
      onMoveShouldSetPanResponder: (e, g) => {
        if (!enabledRef.current) return false;
        if (!isTouchEvent(e)) return false;
        if (g.numberActiveTouches !== 1) return false;
        return (
          resolveGesture(g.dx, g.dy, {
            lock: PAGE_SWIPE.LOCK,
            dominance: PAGE_SWIPE.DOMINANCE,
          }) === 'horizontal'
        );
      },
      onPanResponderGrant: () => {
        draggingRef.current = true;
        offset.stopAnimation();
        progress?.stopAnimation();
        progress?.setValue(0);
      },
      onPanResponderMove: (e, g) => {
        const w = widthRef.current;
        if (!w) return;
        const from = indexRef.current;
        const base = -from * w;
        const minX = -(pagesRef.current.length - 1) * w;
        const dx = rubberBand(g.dx, base, minX, 0);
        offset.setValue(base + dx);
        // Feed the tab bar: -1 → next page, +1 → previous page.
        progress?.setValue(clamp(g.dx / w, -1, 1));
      },
      onPanResponderRelease: (e, g) => {
        draggingRef.current = false;
        const w = widthRef.current;
        const from = indexRef.current;
        if (!w) { settleProgress(); return; }

        const commit = shouldCommitPageSwipe(g.dx, g.vx, w);
        let to = from;
        if (commit) {
          to = g.dx < 0
            ? Math.min(from + 1, pagesRef.current.length - 1)
            : Math.max(from - 1, 0);
        }

        if (to !== from) {
          haptic('selection'); // tiny ack — navigation is committing
          Keyboard.dismiss();
          // Commit navigation state only now, after the gesture ends.
          settledIndex.current = to; // external-index effect will no-op
          onIndexChangeRef.current?.(to);
          animateTo(to, g.vx); // momentum + spring settling
        } else {
          animateTo(from, 0);   // spring back to where we started
        }
        settleProgress();
      },
      onPanResponderTerminate: () => {
        draggingRef.current = false;
        animateTo(indexRef.current, 0);
        settleProgress();
      },
      // Once claimed, keep the finger: the page must follow the finger, not
      // be stolen back by a scroll view mid-drag.
      onPanResponderTerminationRequest: () => false,
    }),
  ).current;

  return (
    <View
      {...(enabled ? panResponder.panHandlers : {})}
      onLayout={(e) => setWidth(Math.round(e.nativeEvent.layout.width))}
      style={[s.container, { backgroundColor: theme.bg }, style]}
    >
      {width > 0 && (
        <Animated.View
          style={[s.strip, { width: width * pages.length, transform: [{ translateX: offset }] }]}
        >
          {pages.map((p, i) => {
            // Active page + immediate neighbours stay mounted and rendered
            // so the next page is already prepared when the finger moves —
            // the transition never exposes a blank background.
            const mounted = Math.abs(i - index) <= 1;
            return (
              <View key={p.key} style={{ width, height: '100%' }}>
                {mounted ? p.render() : null}
              </View>
            );
          })}
        </Animated.View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, overflow: 'hidden' },
  strip: { flexDirection: 'row', height: '100%' },
});
