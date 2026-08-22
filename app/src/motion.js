/**
 * +one — centralized motion system ("Graphite & Pulp" motion language).
 *
 * Every animation in the app comes from here: shared duration tokens, easing
 * curves, spring presets, a reduced-motion gate, safe haptics, and the
 * reusable animated primitives (press scale, mount fades, pops, icon
 * morphs, toggle blooms, staggered entrances, error shakes, typing dots,
 * skeletons, floating empties, heart bursts, drag-to-dismiss sheets).
 *
 * Rules enforced by this module:
 *   - transform + opacity only (60fps, native driver everywhere)
 *   - tiny interactions 120–180ms, normal 180–280ms, larger 300–450ms
 *   - interactive elements use spring-like motion, gestures track the finger
 *   - overshoot is a single ~1.5% kick, never a bounce
 *   - `prefers-reduced-motion` is respected: movement is cut, state
 *     feedback (opacity/brightness) is preserved
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated, Easing, Modal, PanResponder, Platform, Pressable, View, StyleSheet, AccessibilityInfo,
} from 'react-native';
import { useTheme } from './store/ThemeContext';

/* ------------------------------------------------------------------ */
/* tokens                                                              */
/* ------------------------------------------------------------------ */

export const motion = {
  micro: 130,   // press feedback, tiny state blips
  fast: 190,    // small transitions (badges, chips, search)
  normal: 260,  // standard UI transitions
  slow: 360,    // larger transitions (sheets, theme crossfades)

  // Snappy spring for press-in: reaches the pressed state in ~90ms with no
  // bounce, so the finger feels answered instantly.
  springPress: { damping: 22, stiffness: 520, mass: 0.55 },
  // Spring-back for release. Damping is tuned for a *single* ~1.5% overshoot
  // (1.00 → 0.97 → 1.015 → 1.00) — tactile, never rubbery.
  springBack: { damping: 15, stiffness: 320, mass: 0.75 },
  // Soft pop for badges / reactions / checks.
  springPop: { damping: 12, stiffness: 300, mass: 0.7 },
  // Sheet / modal entrance — heavier mass so big surfaces feel weighted.
  springSheet: { damping: 26, stiffness: 260, mass: 1 },
  // Sheet dismissal / gesture settle: no overshoot, follows fling velocity.
  springSettle: { damping: 30, stiffness: 300, mass: 1 },

  /**
   * Press-scale ladder. Larger surfaces move less — a full-width card
   * dropping 4% reads as broken, a 20px icon dropping 4% reads as dead.
   */
  scale: {
    row: 0.985,    // full-width list rows, cards
    card: 0.975,   // medium cards, tiles
    button: 0.97,  // standard buttons
    chip: 0.95,    // chips, small pills
    icon: 0.9,     // icon-only buttons
  },

  easing: {
    out: Easing.out(Easing.cubic),
    // Decelerate hard then glide — the "arriving" curve for entrances.
    entrance: Easing.bezier(0.16, 1, 0.3, 1),
    inOut: Easing.inOut(Easing.cubic),
    linear: Easing.linear,
  },

  /** Per-item stagger for list entrances, and the cap that keeps long
   *  lists from taking a visible age to appear. */
  stagger: { step: 26, max: 6 },
};

/** Delay for the nth item of a staggered entrance (capped, never crawls). */
export const staggerDelay = (index = 0, step = motion.stagger.step) =>
  Math.min(index, motion.stagger.max) * step;

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
/* off-screen gate — never animate what nobody can see                 */
/* ------------------------------------------------------------------ */

/**
 * The page pager keeps the current page's neighbours mounted so a swipe
 * reveals real content instead of a blank gap. Without a gate, every
 * skeleton shimmer, typing indicator and floating empty state on those
 * neighbours would keep running forever, burning frames off-screen.
 *
 * `MotionActive` marks a subtree as visible or not; the looping primitives
 * below subscribe and simply stop when it goes false.
 */
const MotionActiveContext = React.createContext(true);

export function MotionActive({ active, children }) {
  return <MotionActiveContext.Provider value={active}>{children}</MotionActiveContext.Provider>;
}

/** True when this subtree is on screen (see MotionActive). */
export function useMotionActive() {
  return React.useContext(MotionActiveContext);
}

/* ------------------------------------------------------------------ */
/* haptics — subtle feedback for important interactions only           */
/* ------------------------------------------------------------------ */

let Haptics = null;
try { Haptics = require('expo-haptics'); } catch { Haptics = null; }

// Haptics are feedback, not decoration: two buzzes inside this window is
// noise, so repeats are swallowed. Keeps rapid-fire taps (double-tap like,
// scrubbing a list) from turning into a vibration storm.
const HAPTIC_THROTTLE_MS = 45;
let lastHapticAt = 0;

/** Light haptic nudge. Safe no-op on web / when expo-haptics is missing. */
export function haptic(kind = 'selection') {
  if (!Haptics || Platform.OS === 'web') return;
  const now = Date.now();
  if (now - lastHapticAt < HAPTIC_THROTTLE_MS) return;
  lastHapticAt = now;
  try {
    if (kind === 'impact') Haptics.impactAsync?.(Haptics.ImpactFeedbackStyle.Light);
    else if (kind === 'medium') Haptics.impactAsync?.(Haptics.ImpactFeedbackStyle.Medium);
    else if (kind === 'heavy') Haptics.impactAsync?.(Haptics.ImpactFeedbackStyle.Heavy);
    else if (kind === 'success') Haptics.notificationAsync?.(Haptics.NotificationFeedbackType.Success);
    else if (kind === 'warning') Haptics.notificationAsync?.(Haptics.NotificationFeedbackType.Warning);
    else if (kind === 'error') Haptics.notificationAsync?.(Haptics.NotificationFeedbackType.Error);
    else Haptics.selectionAsync?.();
  } catch { /* never break UI for haptics */ }
}

/* ------------------------------------------------------------------ */
/* press scale — buttons feel physical                                */
/* ------------------------------------------------------------------ */

/**
 * The app's press primitive: 100% → `scaleTo` on touch-down (≈90ms, no
 * bounce), then a spring back through a single ~1.5% overshoot on release.
 *
 * Press-in is deliberately *not* gated on reduced motion in the same way as
 * entrances: a 3% scale is state feedback, not decoration. With reduced
 * motion on we swap the scale for a brightness dip so the touch is still
 * acknowledged instantly.
 */
export function usePressScale(scaleTo = motion.scale.button) {
  const reduced = useReducedMotion();
  const scale = useRef(new Animated.Value(1)).current;
  const opacity = useRef(new Animated.Value(1)).current;
  const anim = useRef(null);

  const stop = () => { anim.current?.stop?.(); anim.current = null; };

  const onPressIn = () => {
    stop();
    if (reduced) { opacity.setValue(0.7); return; }
    anim.current = Animated.spring(scale, {
      toValue: scaleTo, ...motion.springPress, useNativeDriver: true,
    });
    anim.current.start();
  };
  const onPressOut = () => {
    stop();
    if (reduced) {
      anim.current = Animated.timing(opacity, {
        toValue: 1, duration: motion.micro, easing: motion.easing.out, useNativeDriver: true,
      });
      anim.current.start();
      return;
    }
    anim.current = Animated.spring(scale, {
      toValue: 1, ...motion.springBack, useNativeDriver: true,
    });
    anim.current.start();
  };

  // A press that unmounts its host (row → screen push) must not leave a
  // running spring behind.
  useEffect(() => stop, []);

  return { scale, opacity, onPressIn, onPressOut, style: { transform: [{ scale }], opacity } };
}

/* Layout properties describe how a pressable arranges its *children*, so
 * they have to follow the children into the animated wrapper — otherwise
 * wrapping a row of [icon, label] in a scaling view silently stacks them
 * vertically. */
const CHILD_LAYOUT_KEYS = [
  'flexDirection', 'alignItems', 'justifyContent', 'gap', 'rowGap', 'columnGap', 'flexWrap',
];

function childLayoutOf(style) {
  const flat = StyleSheet.flatten(style) || {};
  const out = {};
  CHILD_LAYOUT_KEYS.forEach((k) => { if (flat[k] != null) out[k] = flat[k]; });
  // The wrapper must fill the pressable's content box, or a row that spreads
  // its children would collapse to content width.
  out.alignSelf = 'stretch';
  if (flat.justifyContent === 'space-between' || flat.justifyContent === 'space-around') out.flexGrow = 1;
  return out;
}

/**
 * Pressable whose children scale down slightly while pressed and spring back
 * on release. Pressed-state background changes still work via the `style`
 * function (applied to the outer Pressable); the spring applies to the
 * content inside.
 *
 * `haptic`: pass a haptic kind ('selection' | 'impact' | …) to fire it when
 * the press *completes*. Deliberately not on touch-down: rows live inside
 * scroll views, and a finger that lands to scroll would otherwise buzz on
 * every flick. The visual compression still happens instantly on touch-down,
 * so the control feels immediate either way.
 */
export function SpringPressable({
  children, style, contentStyle, scaleTo = motion.scale.button, dim = false,
  onPress, onPressIn, onPressOut, haptic: hapticKind, disabled, ...rest
}) {
  const { scale, opacity, onPressIn: in_, onPressOut: out_ } = usePressScale(scaleTo);
  const spring = { transform: [{ scale }], opacity };

  const wrap = (state) => {
    const resolved = typeof style === 'function' ? style(state) : style;
    return (
      <Animated.View style={[childLayoutOf(resolved), spring, contentStyle]}>
        {typeof children === 'function' ? children(state) : children}
      </Animated.View>
    );
  };

  return (
    <Pressable
      {...rest}
      disabled={disabled}
      onPress={(e) => { if (hapticKind && !disabled) haptic(hapticKind); onPress?.(e); }}
      onPressIn={(e) => { if (!disabled) in_(); onPressIn?.(e); }}
      onPressOut={(e) => { out_(); onPressOut?.(e); }}
      style={typeof style === 'function'
        ? (state) => [style(state), state.pressed && dim && { opacity: 0.82 }]
        : [style, dim && { opacity: 1 }]}
    >
      {(state) => wrap(state)}
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
  children, delay = 0, distance = 8, duration, from = 'up', scale = 1, style, reduced: reducedProp,
}) {
  // Hook must run unconditionally; the prop only overrides its result.
  const reducedAuto = useReducedMotion();
  const reduced = reducedProp ?? reducedAuto;
  const v = useRef(new Animated.Value(reduced ? 1 : 0)).current;

  useEffect(() => {
    if (reduced) { v.setValue(1); return undefined; }
    const anim = Animated.timing(v, {
      toValue: 1,
      duration: duration ?? motion.normal,
      delay,
      easing: motion.easing.entrance,
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
  // Content is fully opaque well before it stops moving — the eye reads the
  // arrival as "already here, settling", not "still fading in".
  const opacity = v.interpolate({ inputRange: [0, 0.6, 1], outputRange: [0, 1, 1] });
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
 * Springs back to 1 from a compressed start whenever `trigger` changes. A
 * single spring (not a chained sequence) does the whole pop: the natural
 * overshoot of `springPop` lands ~6% high once and settles — cheaper than
 * two chained springs and far less bouncy than the old 1.12 double-hop.
 *
 * First mount either pops from `from` (badges appearing) or stays static
 * (`firstStatic` — for pre-existing content that must not re-animate on load).
 */
export function Pop({ children, style, trigger, from = 0.4, firstStatic = false, reduced: reducedProp }) {
  // Hook must run unconditionally; the prop only overrides its result.
  const reducedAuto = useReducedMotion();
  const reduced = reducedProp ?? reducedAuto;
  const scale = useRef(new Animated.Value(1)).current;
  const first = useRef(true);

  useEffect(() => {
    if (reduced) { scale.setValue(1); return undefined; }
    if (first.current) {
      first.current = false;
      if (firstStatic) { scale.setValue(1); return undefined; }
      scale.setValue(from);
    } else {
      scale.setValue(0.86);
    }
    const anim = Animated.spring(scale, { toValue: 1, ...motion.springPop, useNativeDriver: true });
    anim.start();
    return () => anim.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trigger, reduced]);

  return <Animated.View style={[{ transform: [{ scale }] }, style]}>{children}</Animated.View>;
}

/* ------------------------------------------------------------------ */
/* TypingDots — three dots, staggered subtle pulse                     */
/* ------------------------------------------------------------------ */

export function TypingDots({ color, size = 5, reduced: reducedProp }) {
  // Hook must run unconditionally; the prop only overrides its result.
  const reducedAuto = useReducedMotion();
  const reduced = reducedProp ?? reducedAuto;
  const onScreen = useMotionActive();
  const dots = useRef([new Animated.Value(0), new Animated.Value(0), new Animated.Value(0)]).current;

  useEffect(() => {
    if (reduced || !onScreen) return undefined;
    const loops = dots.map((dot, i) => Animated.loop(Animated.sequence([
      Animated.delay(i * 170),
      Animated.timing(dot, { toValue: 1, duration: 460, easing: motion.easing.inOut, useNativeDriver: true }),
      Animated.timing(dot, { toValue: 0, duration: 460, easing: motion.easing.inOut, useNativeDriver: true }),
      Animated.delay((2 - i) * 170),
    ])));
    loops.forEach((l) => l.start());
    return () => loops.forEach((l) => l.stop());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduced, onScreen]);

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
  // Hook must run unconditionally; the prop only overrides its result.
  const reducedAuto = useReducedMotion();
  const reduced = reducedProp ?? reducedAuto;
  const onScreen = useMotionActive();
  const o = useRef(new Animated.Value(0.5)).current;

  useEffect(() => {
    if (reduced || !onScreen) return undefined;
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(o, { toValue: 0.95, duration: 780, easing: motion.easing.inOut, useNativeDriver: true }),
      Animated.timing(o, { toValue: 0.5, duration: 780, easing: motion.easing.inOut, useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduced, onScreen]);

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
  // Hook must run unconditionally; the prop only overrides its result.
  const reducedAuto = useReducedMotion();
  const reduced = reducedProp ?? reducedAuto;
  const onScreen = useMotionActive();
  const y = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (reduced || !onScreen) return undefined;
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(y, { toValue: -amplitude, duration, easing: motion.easing.inOut, useNativeDriver: true }),
      Animated.timing(y, { toValue: amplitude, duration, easing: motion.easing.inOut, useNativeDriver: true }),
      Animated.timing(y, { toValue: 0, duration, easing: motion.easing.inOut, useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduced, onScreen]);

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
  // Hook must run unconditionally; the prop only overrides its result.
  const reducedAuto = useReducedMotion();
  const reduced = reducedProp ?? reducedAuto;
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
    // One arrival, one departure. The old version bounced three times before
    // it left, which read as a cartoon rather than a reaction.
    scale.setValue(0.3);
    Animated.sequence([
      Animated.spring(scale, { toValue: 1, ...motion.springPop, useNativeDriver: true }),
      Animated.delay(240),
      Animated.parallel([
        Animated.timing(scale, { toValue: 1.3, duration: 220, easing: motion.easing.out, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0, duration: 240, easing: motion.easing.out, useNativeDriver: true }),
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
  // Hook must run unconditionally; the prop only overrides its result.
  const reducedAuto = useReducedMotion();
  const reduced = reducedProp ?? reducedAuto;
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

/* ------------------------------------------------------------------ */
/* IconSwap — state changes morph instead of cutting                   */
/* ------------------------------------------------------------------ */

/**
 * Crossfades + counter-rotates between two renderings of the same control
 * (heart ↔ heart-filled, star ↔ star-filled, play ↔ pause). Both layers are
 * always mounted and only opacity/transform animate, so the swap is native
 * driven and there is no layout pass — the icon appears to *turn into* the
 * other state rather than being replaced.
 *
 *   <IconSwap active={liked} size={24}
 *     on={<Icon name="heart" .../>} off={<Icon name="heart-outline" .../>} />
 */
export function IconSwap({ active, on, off, size = 24, spin = 0, pop = true, style }) {
  const reduced = useReducedMotion();
  const v = useRef(new Animated.Value(active ? 1 : 0)).current;
  const punch = useRef(new Animated.Value(1)).current;
  const first = useRef(true);

  useEffect(() => {
    const skipPop = first.current;
    first.current = false;
    if (reduced) { v.setValue(active ? 1 : 0); return undefined; }
    const anims = [
      Animated.timing(v, {
        toValue: active ? 1 : 0,
        duration: motion.micro,
        easing: motion.easing.out,
        useNativeDriver: true,
      }),
    ];
    // Turning a state ON earns a pop; turning it off just relaxes back.
    if (pop && !skipPop && active) {
      punch.setValue(0.82);
      anims.push(Animated.spring(punch, { toValue: 1, ...motion.springPop, useNativeDriver: true }));
    }
    const anim = Animated.parallel(anims);
    anim.start();
    return () => anim.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, reduced]);

  const common = { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' };
  const rot = (deg) => v.interpolate({ inputRange: [0, 1], outputRange: [`${deg}deg`, '0deg'] });

  return (
    <Animated.View style={[{ width: size, height: size, transform: [{ scale: reduced ? 1 : punch }] }, style]}>
      <Animated.View
        pointerEvents="none"
        style={[common, {
          opacity: v,
          transform: [
            { scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.7, 1] }) },
            ...(spin ? [{ rotate: rot(-spin) }] : []),
          ],
        }]}
      >
        {on}
      </Animated.View>
      <Animated.View
        pointerEvents="none"
        style={[common, {
          opacity: v.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }),
          transform: [
            { scale: v.interpolate({ inputRange: [0, 1], outputRange: [1, 0.7] }) },
            ...(spin ? [{ rotate: rot(spin) }] : []),
          ],
        }]}
      >
        {off}
      </Animated.View>
    </Animated.View>
  );
}

/* ------------------------------------------------------------------ */
/* Bloom — a ring that expands out of a toggle the moment it turns on  */
/* ------------------------------------------------------------------ */

/**
 * One outward ring pulse behind a control, fired when `trigger` flips truthy.
 * It is the "energy released" half of a like/star/follow: the icon pops in,
 * the ring pushes out. Purely decorative, so reduced motion skips it
 * entirely and it never mounts anything while idle.
 */
export function Bloom({ active, color, size = 34, style }) {
  const reduced = useReducedMotion();
  const v = useRef(new Animated.Value(0)).current;
  const first = useRef(true);
  const [live, setLive] = useState(false);

  useEffect(() => {
    const skip = first.current;
    first.current = false;
    if (!active || skip || reduced) return undefined;
    setLive(true);
    v.setValue(0);
    const anim = Animated.timing(v, {
      toValue: 1, duration: 420, easing: motion.easing.out, useNativeDriver: true,
    });
    anim.start(({ finished }) => { if (finished) setLive(false); });
    return () => anim.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, reduced]);

  if (!live) return null;
  return (
    <Animated.View
      pointerEvents="none"
      style={[{
        position: 'absolute', width: size, height: size, borderRadius: 999,
        borderWidth: 2, borderColor: color,
        opacity: v.interpolate({ inputRange: [0, 0.15, 1], outputRange: [0, 0.55, 0] }),
        transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1.7] }) }],
      }, style]}
    />
  );
}

/* ------------------------------------------------------------------ */
/* Stagger — list/section entrances that cascade, then stop            */
/* ------------------------------------------------------------------ */

/**
 * FadeSlide with an index-derived, capped delay. Wrap list rows or section
 * blocks: the first few cascade in, everything past `motion.stagger.max`
 * arrives together so long lists never feel like they are loading slowly.
 */
export function Stagger({ index = 0, children, style, distance = 8, from = 'up', duration }) {
  return (
    <FadeSlide
      delay={staggerDelay(index)}
      distance={distance}
      from={from}
      duration={duration ?? motion.fast}
      style={style}
    >
      {children}
    </FadeSlide>
  );
}

/* ------------------------------------------------------------------ */
/* Shake — the one "something went wrong" motion                       */
/* ------------------------------------------------------------------ */

/**
 * Damped horizontal shake, fired whenever `trigger` changes to a new truthy
 * value. Small (5px) and short (~300ms): it reads as a head-shake, not a
 * cartoon. Under reduced motion the caller still gets the error haptic; the
 * movement is skipped.
 */
export function Shake({ trigger, children, style, distance = 5 }) {
  const reduced = useReducedMotion();
  const x = useRef(new Animated.Value(0)).current;
  const first = useRef(true);

  useEffect(() => {
    const skip = first.current;
    first.current = false;
    if (!trigger || skip || reduced) return undefined;
    const leg = (to, d) => Animated.timing(x, {
      toValue: to, duration: d, easing: motion.easing.inOut, useNativeDriver: true,
    });
    const anim = Animated.sequence([
      leg(-distance, 55), leg(distance * 0.8, 65), leg(-distance * 0.45, 60), leg(0, 70),
    ]);
    anim.start();
    return () => anim.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trigger, reduced]);

  return <Animated.View style={[{ transform: [{ translateX: x }] }, style]}>{children}</Animated.View>;
}

/* ------------------------------------------------------------------ */
/* BottomSheet — one sheet behaviour for the whole app                 */
/* ------------------------------------------------------------------ */

const SHEET_DISMISS_DISTANCE = 0.28; // fraction of sheet height
const SHEET_DISMISS_VELOCITY = 0.6;  // px/ms downward fling

/**
 * Modal bottom sheet with the app's standard physics:
 *   - backdrop fades while the sheet springs up from below,
 *   - the grab handle (and the sheet header area) is finger-driven: the
 *     sheet tracks the drag 1:1 downward, with rubber-band resistance
 *     upward, and the backdrop dims proportionally to how far it has gone,
 *   - release past ~28% of its height, or on a downward fling, dismisses
 *     with the fling's own velocity; otherwise it springs home,
 *   - closing always animates out first, then calls `onClose`, so the sheet
 *     never disappears in a single frame.
 *
 * Reduced motion keeps the drag (it is a gesture, not decoration) but cuts
 * the spring travel to an instant crossfade.
 */
export function BottomSheet({
  visible, onClose, children, style, backdropStyle, dismissible = true,
  centered = false, backdrop, height,
}) {
  const reduced = useReducedMotion();
  const [mounted, setMounted] = useState(visible);
  // Real measured height. The sheet cannot animate correctly until it knows
  // how far "offscreen" is, so it stays invisible for the single frame
  // between mount and layout instead of flashing at the wrong offset.
  const [h, setH] = useState(height || 0);
  const y = useRef(new Animated.Value(1)).current;    // 1 = offscreen, 0 = open
  const measured = h > 0;

  useEffect(() => {
    if (visible) setMounted(true);
  }, [visible]);

  useEffect(() => {
    if (!mounted) return undefined;
    if (visible) {
      if (!measured) return undefined;   // wait for layout, then spring
      y.stopAnimation();
      if (reduced) { y.setValue(0); return undefined; }
      const anim = Animated.spring(y, { toValue: 0, ...motion.springSheet, useNativeDriver: true });
      anim.start();
      return () => anim.stop();
    }
    if (reduced) { y.setValue(1); setMounted(false); return undefined; }
    const anim = Animated.timing(y, {
      toValue: 1, duration: motion.fast, easing: motion.easing.out, useNativeDriver: true,
    });
    anim.start(({ finished }) => { if (finished) setMounted(false); });
    return () => anim.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, mounted, measured, reduced]);

  /** Animate out, then hand control back to the owner. */
  const close = useCallback((velocity = 0) => {
    if (reduced) { onClose?.(); return; }
    y.stopAnimation();
    Animated.spring(y, {
      toValue: 1, velocity, ...motion.springSettle, overshootClamping: true, useNativeDriver: true,
    }).start(({ finished }) => { if (finished) onClose?.(); });
  }, [onClose, reduced, y]);

  const heightRef = useRef(h);
  heightRef.current = h || 420;
  // How far a finger must travel to dismiss. A bottom sheet is measured
  // against its own height; a centred dialog has no "offscreen" to fall to,
  // so it uses a fixed, comfortable drag distance instead.
  const dragSpan = centered ? 240 : (h || 420);
  const dragSpanRef = useRef(dragSpan);
  dragSpanRef.current = dragSpan;

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (e, g) => dismissible && Math.abs(g.dy) > 6 && Math.abs(g.dy) > Math.abs(g.dx),
      onPanResponderGrant: () => { y.stopAnimation(); },
      onPanResponderMove: (e, g) => {
        const span = dragSpanRef.current || 1;
        // Downward tracks the finger; upward gets heavy resistance so the
        // surface feels anchored rather than free-floating.
        const raw = g.dy > 0 ? g.dy : g.dy * 0.12;
        y.setValue(Math.max(-0.06, raw / span));
      },
      onPanResponderRelease: (e, g) => {
        const span = dragSpanRef.current || 1;
        const far = g.dy > span * SHEET_DISMISS_DISTANCE;
        const flung = g.vy > SHEET_DISMISS_VELOCITY && g.dy > 12;
        if (far || flung) { haptic('selection'); close(Math.max(g.vy, 0.5)); return; }
        Animated.spring(y, { toValue: 0, velocity: g.vy, ...motion.springSettle, useNativeDriver: true }).start();
      },
      onPanResponderTerminate: () => {
        Animated.spring(y, { toValue: 0, ...motion.springSettle, useNativeDriver: true }).start();
      },
      onPanResponderTerminationRequest: () => false,
    }),
  ).current;

  if (!mounted) return null;

  // Bottom sheets slide their own height; centred dialogs lift 24px and
  // scale a hair — a dialog that flew up from off-screen would be motion
  // for its own sake.
  const translateY = y.interpolate({
    inputRange: [0, 1],
    outputRange: [0, centered ? 24 : (h || 420)],
    extrapolate: 'clamp',
  });
  const sheetOpacity = centered
    ? y.interpolate({ inputRange: [0, 1], outputRange: [1, 0], extrapolate: 'clamp' })
    : 1;
  const sheetScale = centered
    ? y.interpolate({ inputRange: [0, 1], outputRange: [1, 0.97], extrapolate: 'clamp' })
    : 1;
  const backdropOpacity = y.interpolate({ inputRange: [0, 1], outputRange: [1, 0], extrapolate: 'clamp' });

  return (
    <Modal visible transparent animationType="none" onRequestClose={() => close()} statusBarTranslucent>
      <View style={StyleSheet.absoluteFill}>
        <Animated.View style={[StyleSheet.absoluteFill, { opacity: backdropOpacity }, backdropStyle]}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={dismissible ? () => close() : undefined}
            accessibilityLabel="Close"
          >
            {backdrop}
          </Pressable>
        </Animated.View>

        <Animated.View
          pointerEvents="box-none"
          onLayout={(e) => {
            const next = Math.round(e.nativeEvent.layout.height);
            if (next > 0 && next !== h) setH(next);
          }}
          style={[
            { position: 'absolute', left: 0, right: 0 },
            centered
              ? { top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' }
              : { bottom: 0 },
            {
              opacity: measured ? sheetOpacity : 0,
              transform: [{ translateY }, { scale: sheetScale }],
            },
            style,
          ]}
        >
          <View {...(dismissible ? pan.panHandlers : {})}>
            {children}
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

/** The little grab bar at the top of a sheet — the drag affordance. */
export function SheetHandle({ color, style }) {
  return (
    <View style={[{ alignItems: 'center', paddingTop: 8, paddingBottom: 6 }, style]}>
      <View style={{ width: 38, height: 4, borderRadius: 999, backgroundColor: color, opacity: 0.4 }} />
    </View>
  );
}
