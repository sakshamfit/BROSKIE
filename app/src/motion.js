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
import Svg, { Defs, LinearGradient, RadialGradient, Stop, Path, Circle } from 'react-native-svg';
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
/* LikeBurst — double-tap love, the modern way                         */
/* ------------------------------------------------------------------ */

/**
 * A big gradient heart springs out of the message with a playful rotation
 * wobble, a shockwave ring ripples out from the tap, and a ring of mini
 * hearts/dots scatters — then the heart floats up and away. Layout,
 * geometry and palettes are deterministic (no Math.random in render) so the
 * burst feels identical on every double-tap.
 *
 * Everything is transform + opacity on the native driver. Reduced motion
 * keeps the feedback: a quick static heart that fades.
 * Renders once, then calls `onDone`.
 */

// Official Twemoji red-heart silhouette (36×36 grid), given a soft brand
// gradient + glow so the burst reads premium over any chat theme.
const HEART_PATH =
  'M35.89 11.83c0-5.45-4.42-9.87-9.87-9.87-3.31 0-6.23 1.63-8.02 4.13-1.79-2.5-4.71-4.13-8.02-4.13-5.45 0-9.87 4.42-9.87 9.87 0 .77.1 1.52.27 2.24C1.75 22.59 11.22 31.57 18 34.03c6.78-2.47 16.25-11.45 17.62-19.96.17-.72.27-1.47.27-2.24z';

const PARTICLE_ANGLES = [-90, -38, 12, 63, -64, 27, -15, 116];
const PARTICLE_HEART = [0, 2, 4, 6];           // these indices are mini hearts, rest are dots
const PARTICLE_DIST = [64, 78, 58, 72, 66, 80, 60, 74];

function LikeHeart({ size = 84, id = 'like' }) {
  return (
    <Svg width={size} height={size} viewBox="-6 -6 48 48">
      <Defs>
        <LinearGradient id={`${id}g`} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#FF8FA3" />
          <Stop offset="0.55" stopColor="#FF4D6D" />
          <Stop offset="1" stopColor="#E5383B" />
        </LinearGradient>
        <RadialGradient id={`${id}glow`} cx="0.5" cy="0.5" r="0.5">
          <Stop offset="0" stopColor="#FF4D6D" stopOpacity="0.38" />
          <Stop offset="0.55" stopColor="#FF4D6D" stopOpacity="0.14" />
          <Stop offset="1" stopColor="#FF4D6D" stopOpacity="0" />
        </RadialGradient>
      </Defs>
      <Circle cx="18" cy="17" r="22" fill={`url(#${id}glow)`} />
      <Path
        d={HEART_PATH}
        fill={`url(#${id}g)`}
        stroke="rgba(120,10,28,0.35)"
        strokeWidth="0.6"
      />
    </Svg>
  );
}

function MiniHeart({ size = 11, color = '#FF4D6D' }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 36 36">
      <Path d={HEART_PATH} fill={color} />
    </Svg>
  );
}

export function LikeBurst({ onDone, reduced: reducedProp }) {
  const reduced = reducedProp ?? useReducedMotion();
  // unique gradient ids per burst instance (double-taps can stack)
  const heartId = React.useId().replace(/[^a-zA-Z0-9]/g, 'h');

  // main heart
  const scale = useRef(new Animated.Value(0)).current;
  const rotate = useRef(new Animated.Value(0)).current;    // -1..1 → degrees
  const rise = useRef(new Animated.Value(0)).current;      // exit float
  const opacity = useRef(new Animated.Value(1)).current;
  // shockwave ring
  const ring = useRef(new Animated.Value(0)).current;
  // particles
  const parts = useRef(PARTICLE_ANGLES.map(() => new Animated.Value(0))).current;

  useEffect(() => {
    if (reduced) {
      opacity.setValue(0.95);
      Animated.timing(opacity, { toValue: 0, duration: 480, easing: motion.easing.out, useNativeDriver: true })
        .start(() => onDone?.());
      return undefined;
    }

    const heartHit = Animated.sequence([
      Animated.parallel([
        Animated.spring(scale, { toValue: 1, friction: 4, tension: 170, useNativeDriver: true }),
        Animated.sequence([
          Animated.timing(rotate, { toValue: -1, duration: 90, easing: motion.easing.out, useNativeDriver: true }),
          Animated.spring(rotate, { toValue: 0.35, friction: 4, tension: 160, useNativeDriver: true }),
          Animated.spring(rotate, { toValue: 0, friction: 5, tension: 190, useNativeDriver: true }),
        ]),
      ]),
      Animated.spring(scale, { toValue: 0.92, friction: 5, tension: 240, useNativeDriver: true }),
      Animated.spring(scale, { toValue: 1, friction: 5, tension: 200, useNativeDriver: true }),
      Animated.delay(330),
      Animated.parallel([
        Animated.timing(rise, { toValue: 1, duration: 420, easing: motion.easing.out, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0, duration: 400, easing: motion.easing.out, useNativeDriver: true }),
      ]),
    ]);

    const ringWave = Animated.sequence([
      Animated.timing(ring, { toValue: 1, duration: 520, easing: motion.easing.out, useNativeDriver: true }),
    ]);

    const scatter = Animated.stagger(26, parts.map((p) =>
      Animated.sequence([
        Animated.timing(p, { toValue: 1, duration: 560, easing: motion.easing.out, useNativeDriver: true }),
      ]),
    ));

    Animated.parallel([heartHit, ringWave, scatter]).start(() => onDone?.());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rotateDeg = rotate.interpolate({ inputRange: [-1, 0, 0.35, 1], outputRange: ['-14deg', '0deg', '5deg', '14deg'] });
  const liftY = rise.interpolate({ inputRange: [0, 1], outputRange: [0, -54] });
  const shrink = rise.interpolate({ inputRange: [0, 1], outputRange: [1, 0.82] });

  const ringScale = ring.interpolate({ inputRange: [0, 1], outputRange: [0.32, 2.05] });
  const ringOpacity = ring.interpolate({ inputRange: [0, 0.25, 1], outputRange: [0, 0.5, 0] });

  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.burstWrap]}>
      {/* shockwave ring */}
      <Animated.View style={[styles.ring, { opacity: ringOpacity, transform: [{ scale: ringScale }] }]} />
      {/* scattered mini hearts + dots */}
      {parts.map((p, i) => {
        const rad = (PARTICLE_ANGLES[i] * Math.PI) / 180;
        const dist = PARTICLE_DIST[i];
        const tx = p.interpolate({ inputRange: [0, 1], outputRange: [0, Math.cos(rad) * dist] });
        const ty = p.interpolate({ inputRange: [0, 1], outputRange: [8, Math.sin(rad) * dist - 14] });
        const popIn = p.interpolate({ inputRange: [0, 0.18, 1], outputRange: [0, 1, 0.55] });
        const fade = p.interpolate({ inputRange: [0, 0.55, 1], outputRange: [0, 1, 0] });
        const sizeAlt = i % 3 === 0 ? 1 : 0.72;
        return (
          <Animated.View
            key={i}
            style={[
              styles.particle,
              { opacity: fade, transform: [{ translateX: tx }, { translateY: ty }, { scale: popIn }, { scale: sizeAlt }] },
            ]}
          >
            {PARTICLE_HEART.includes(i) ? <MiniHeart /> : <View style={styles.dot} />}
          </Animated.View>
        );
      })}
      {/* the hero heart */}
      <Animated.View
        style={{
          opacity,
          transform: [
            { translateY: liftY },
            { rotate: rotateDeg },
            { scale: Animated.multiply(scale, shrink) },
          ],
          ...styles.heroShadow,
        }}
      >
        <LikeHeart id={heartId} />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  burstWrap: { alignItems: 'center', justifyContent: 'center', zIndex: 40 },
  heroShadow: Platform.select({
    web: { filter: 'drop-shadow(0 6px 14px rgba(229,56,59,0.35))' },
    default: {},
  }),
  ring: {
    position: 'absolute', width: 78, height: 78, borderRadius: 999,
    borderWidth: 3, borderColor: '#FF758F',
  },
  particle: { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
  dot: { width: 8, height: 8, borderRadius: 999, backgroundColor: '#FF758F' },
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
