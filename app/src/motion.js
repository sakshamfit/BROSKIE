/**
 * +one — centralized motion system ("Graphite & Pulp" motion language).
 *
 * Every animation in the app comes from here: shared duration tokens, easing
 * curves, spring presets, a reduced-motion gate, safe haptics, and the
 * reusable animated primitives (press scale, mount fades, pops, typing dots,
 * skeletons, floating empties, heart bursts, sheet springs).
 *
 * Rules enforced by this module:
 *   - transform + opacity only (60fps, native driver everywhere)
 *   - tiny interactions 120–180ms, normal 180–280ms, larger 300–450ms
 *   - interactive elements use spring-like motion
 *   - `prefers-reduced-motion` is respected: movement is cut, state
 *     feedback (opacity/brightness) is preserved
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  Animated, Easing, Platform, Pressable, View, StyleSheet, AccessibilityInfo,
} from 'react-native';
import { useTheme } from './store/ThemeContext';

/* ------------------------------------------------------------------ */
/* tokens                                                              */
/* ------------------------------------------------------------------ */

export const motion = {
  micro: 150,   // press feedback, tiny state blips
  fast: 210,    // small transitions (badges, chips, search)
  normal: 280,  // standard UI transitions
  slow: 380,    // larger transitions (sheets, theme crossfades)

  // Snappy spring for press-in (stiff, little bounce).
  springPress: { damping: 20, stiffness: 420, mass: 0.6 },
  // Spring-back for release (a touch bouncier, still controlled).
  springBack: { damping: 13, stiffness: 240, mass: 0.8 },
  // Soft pop for badges / reactions / checks.
  springPop: { damping: 11, stiffness: 260, mass: 0.7 },
  // Sheet / modal entrance.
  springSheet: { friction: 8, tension: 120 },

  easing: {
    out: Easing.out(Easing.cubic),
    inOut: Easing.inOut(Easing.cubic),
    linear: Easing.linear,
  },
};

/* ------------------------------------------------------------------ */
/* reduced motion                                                      */
/* ------------------------------------------------------------------ */

function readReduced() {
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
      return !!window.matchMedia('(prefers-reduced-motion: reduce)')?.matches;
    }
    return false;
  }
  return false;
}

/**
 * Live `prefers-reduced-motion` flag. Web reads the CSS media query; native
 * reads AccessibilityInfo. Components gate their motion on this.
 */
export function useReducedMotion() {
  const [reduced, setReduced] = useState(readReduced);

  useEffect(() => {
    if (Platform.OS === 'web') {
      if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
      const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
      const onChange = (e) => setReduced(!!e.matches);
      setReduced(!!mq.matches);
      mq.addEventListener?.('change', onChange);
      return () => mq.removeEventListener?.('change', onChange);
    }
    let mounted = true;
    (async () => {
      try {
        const v = await AccessibilityInfo.isReduceMotionEnabled();
        if (mounted) setReduced(!!v);
      } catch {}
    })();
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', (v) => setReduced(!!v));
    return () => { mounted = false; sub?.remove?.(); };
  }, []);

  return reduced;
}

/* ------------------------------------------------------------------ */
/* haptics — subtle feedback for important interactions only           */
/* ------------------------------------------------------------------ */

let Haptics = null;
try { Haptics = require('expo-haptics'); } catch { Haptics = null; }

/** Light haptic nudge. Safe no-op on web / when expo-haptics is missing. */
export function haptic(kind = 'selection') {
  if (!Haptics || Platform.OS === 'web') return;
  try {
    if (kind === 'impact') Haptics.impactAsync?.(Haptics.ImpactFeedbackStyle.Light);
    else if (kind === 'medium') Haptics.impactAsync?.(Haptics.ImpactFeedbackStyle.Medium);
    else if (kind === 'success') Haptics.notificationAsync?.(Haptics.NotificationFeedbackType.Success);
    else Haptics.selectionAsync?.();
  } catch { /* never break UI for haptics */ }
}

/* ------------------------------------------------------------------ */
/* press scale — buttons feel physical                                */
/* ------------------------------------------------------------------ */

/**
 * 100% → ~96% → 100% spring. Returns the animated value and the handlers to
 * attach to a Pressable.
 */
export function usePressScale(scaleTo = 0.96) {
  const reduced = useReducedMotion();
  const scale = useRef(new Animated.Value(1)).current;
  const onPressIn = () => {
    if (reduced) return;
    Animated.spring(scale, { toValue: scaleTo, ...motion.springPress, useNativeDriver: true }).start();
  };
  const onPressOut = () => {
    if (reduced) return;
    Animated.spring(scale, { toValue: 1, ...motion.springBack, useNativeDriver: true }).start();
  };
  return { scale, onPressIn, onPressOut };
}

/**
 * Pressable whose children scale down slightly while pressed and spring back
 * on release. Pressed-state background changes still work via the `style`
 * function (applied to the outer Pressable); the spring applies to the
 * content inside.
 */
export function SpringPressable({ children, style, scaleTo = 0.96, dim = false, onPressIn, onPressOut, ...rest }) {
  const { scale, onPressIn: in_, onPressOut: out_ } = usePressScale(scaleTo);
  return (
    <Pressable
      {...rest}
      onPressIn={(e) => { in_(); onPressIn?.(e); }}
      onPressOut={(e) => { out_(); onPressOut?.(e); }}
      style={typeof style === 'function'
        ? (state) => [style(state), state.pressed && dim && { opacity: 0.82 }]
        : [style, dim && { opacity: 1 }]}
    >
      {typeof children === 'function'
        ? (state) => <Animated.View style={{ transform: [{ scale }] }}>{children(state)}</Animated.View>
        : <Animated.View style={{ transform: [{ scale }] }}>{children}</Animated.View>}
    </Pressable>
  );
}

/* ------------------------------------------------------------------ */
/* FadeSlide — mount / transition entrances                            */
/* ------------------------------------------------------------------ */

/**
 * Opacity + translate (+ optional scale) entrance, native driver.
 * `from`: 'up' | 'down' | 'left' | 'right' | 'none'. Honors reduced motion
 * by rendering the final state instantly.
 */
export function FadeSlide({
  children, delay = 0, distance = 10, duration, from = 'up', scale = 1, style, reduced: reducedProp,
}) {
  const reduced = reducedProp ?? useReducedMotion();
  const v = useRef(new Animated.Value(reduced ? 1 : 0)).current;

  useEffect(() => {
    if (reduced) { v.setValue(1); return undefined; }
    const anim = Animated.timing(v, {
      toValue: 1,
      duration: duration ?? motion.normal,
      delay,
      easing: motion.easing.out,
      useNativeDriver: true,
    });
    anim.start();
    return () => anim.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduced]);

  const tx = from === 'left' ? -distance : from === 'right' ? distance : 0;
  const ty = from === 'down' ? -distance : from === 'up' ? distance : 0;
  const translateX = v.interpolate({ inputRange: [0, 1], outputRange: [tx, 0] });
  const translateY = v.interpolate({ inputRange: [0, 1], outputRange: [ty, 0] });
  const opacity = v.interpolate({ inputRange: [0, 1], outputRange: [0, 1] });
  const scaleV = v.interpolate({ inputRange: [0, 1], outputRange: [scale, 1] });

  return (
    <Animated.View style={[{ opacity, transform: [{ translateX }, { translateY }, { scale: scaleV }] }, style]}>
      {children}
    </Animated.View>
  );
}

/* ------------------------------------------------------------------ */
/* Pop — spring attention for badges, checks, reactions                */
/* ------------------------------------------------------------------ */

/**
 * Springs to 1.12 → 1.0 whenever `trigger` changes. First mount either pops
 * from `from` (badges appearing) or stays static (`firstStatic` — for
 * pre-existing content that must not re-animate on load).
 */
export function Pop({ children, style, trigger, from = 0.4, firstStatic = false, reduced: reducedProp }) {
  const reduced = reducedProp ?? useReducedMotion();
  const scale = useRef(new Animated.Value(1)).current;
  const first = useRef(true);

  useEffect(() => {
    if (reduced) { scale.setValue(1); return undefined; }
    if (first.current) {
      first.current = false;
      if (firstStatic) { scale.setValue(1); return undefined; }
      scale.setValue(from);
    } else {
      scale.setValue(0.84);
    }
    Animated.sequence([
      Animated.spring(scale, { toValue: 1.12, ...motion.springPop, useNativeDriver: true }),
      Animated.spring(scale, { toValue: 1, ...motion.springBack, useNativeDriver: true }),
    ]).start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trigger, reduced]);

  return <Animated.View style={[{ transform: [{ scale }] }, style]}>{children}</Animated.View>;
}

/* ------------------------------------------------------------------ */
/* TypingDots — three dots, staggered subtle pulse                     */
/* ------------------------------------------------------------------ */

export function TypingDots({ color, size = 5, reduced: reducedProp }) {
  const reduced = reducedProp ?? useReducedMotion();
  const dots = useRef([new Animated.Value(0), new Animated.Value(0), new Animated.Value(0)]).current;

  useEffect(() => {
    if (reduced) return undefined;
    const loops = dots.map((dot, i) => Animated.loop(Animated.sequence([
      Animated.delay(i * 170),
      Animated.timing(dot, { toValue: 1, duration: 460, easing: motion.easing.inOut, useNativeDriver: true }),
      Animated.timing(dot, { toValue: 0, duration: 460, easing: motion.easing.inOut, useNativeDriver: true }),
      Animated.delay((2 - i) * 170),
    ])));
    loops.forEach((l) => l.start());
    return () => loops.forEach((l) => l.stop());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduced]);

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: Math.max(2, size * 0.5) }}>
      {dots.map((dot, i) => {
        const translateY = dot.interpolate({ inputRange: [0, 1], outputRange: [0, -size * 0.9] });
        const opacity = dot.interpolate({ inputRange: [0, 1], outputRange: [0.45, 1] });
        return (
          <Animated.View
            key={i}
            style={{
              width: size, height: size, borderRadius: 999,
              backgroundColor: color || '#888',
              opacity: reduced ? 0.65 : opacity,
              transform: [{ translateY: reduced ? 0 : translateY }],
            }}
          />
        );
      })}
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* Skeleton — soft shimmer placeholder                                 */
/* ------------------------------------------------------------------ */

export function Skeleton({ width = '100%', height = 14, radius = 5, style, reduced: reducedProp }) {
  const reduced = reducedProp ?? useReducedMotion();
  const o = useRef(new Animated.Value(0.5)).current;

  useEffect(() => {
    if (reduced) return undefined;
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(o, { toValue: 0.95, duration: 780, easing: motion.easing.inOut, useNativeDriver: true }),
      Animated.timing(o, { toValue: 0.5, duration: 780, easing: motion.easing.inOut, useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduced]);

  const { theme } = useTheme();
  return (
    <Animated.View
      style={[{ width, height, borderRadius: radius, backgroundColor: theme.cardAlt, opacity: reduced ? 0.6 : o }, style]}
    />
  );
}

/* ------------------------------------------------------------------ */
/* FloatLoop — slow, calm ambient motion for empty states              */
/* ------------------------------------------------------------------ */

export function FloatLoop({ children, amplitude = 4, duration = 3400, style, reduced: reducedProp }) {
  const reduced = reducedProp ?? useReducedMotion();
  const y = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (reduced) return undefined;
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(y, { toValue: -amplitude, duration, easing: motion.easing.inOut, useNativeDriver: true }),
      Animated.timing(y, { toValue: amplitude, duration, easing: motion.easing.inOut, useNativeDriver: true }),
      Animated.timing(y, { toValue: 0, duration, easing: motion.easing.inOut, useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduced]);

  return <Animated.View style={[{ transform: [{ translateY: reduced ? 0 : y }] }, style]}>{children}</Animated.View>;
}

/* ------------------------------------------------------------------ */
/* HeartBurst — double-tap reaction burst                              */
/* ------------------------------------------------------------------ */

/**
 * The classic double-tap heart: scales in with a spring, small bounce,
 * then scales out while fading. Renders once and calls `onDone`.
 */
export function HeartBurst({ color = '#e5484d', onDone, reduced: reducedProp }) {
  const reduced = reducedProp ?? useReducedMotion();
  const scale = useRef(new Animated.Value(0)).current;
  const opacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (reduced) {
      // Keep state feedback without the motion: a quick opacity flash.
      opacity.setValue(0.95);
      Animated.timing(opacity, { toValue: 0, duration: 500, easing: motion.easing.out, useNativeDriver: true })
        .start(() => onDone?.());
      return undefined;
    }
    Animated.sequence([
      Animated.spring(scale, { toValue: 1, friction: 5, tension: 130, useNativeDriver: true }),
      Animated.spring(scale, { toValue: 0.84, friction: 6, tension: 220, useNativeDriver: true }),
      Animated.spring(scale, { toValue: 1, friction: 5, tension: 170, useNativeDriver: true }),
      Animated.parallel([
        Animated.timing(scale, { toValue: 1.4, duration: 240, easing: motion.easing.out, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0, duration: 300, easing: motion.easing.out, useNativeDriver: true }),
      ]),
    ]).start(() => onDone?.());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Animated.View
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, styles.burstWrap, { opacity, transform: [{ scale }] }]}
    >
      <View style={[styles.burstCircle, { backgroundColor: color }]}>
        <Animated.Text style={[styles.burstHeart, { transform: [{ scale }] }]}>❤️</Animated.Text>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  burstWrap: { alignItems: 'center', justifyContent: 'center', zIndex: 40 },
  burstCircle: {
    width: 66, height: 66, borderRadius: 999,
    alignItems: 'center', justifyContent: 'center',
    // soft ink outline keeps it on-brand even over any bubble color
    borderWidth: 2, borderColor: 'rgba(0,0,0,0.18)',
  },
  burstHeart: { fontSize: 32, lineHeight: 38 },
});

/* ------------------------------------------------------------------ */
/* SheetSpringIn — bottom-sheet / modal panels feel physically         */
/* ------------------------------------------------------------------ */

export function SheetSpringIn({ children, style, reduced: reducedProp }) {
  const reduced = reducedProp ?? useReducedMotion();
  const v = useRef(new Animated.Value(reduced ? 1 : 0)).current;

  useEffect(() => {
    if (reduced) { v.setValue(1); return undefined; }
    const anim = Animated.spring(v, { toValue: 1, ...motion.springSheet, useNativeDriver: true });
    anim.start();
    return () => anim.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduced]);

  const translateY = v.interpolate({ inputRange: [0, 1], outputRange: [28, 0] });
  const scale = v.interpolate({ inputRange: [0, 1], outputRange: [0.965, 1] });
  const opacity = v.interpolate({ inputRange: [0, 1], outputRange: [0, 1] });

  return (
    <Animated.View style={[{ opacity, transform: [{ translateY }, { scale }] }, style]}>
      {children}
    </Animated.View>
  );
}
