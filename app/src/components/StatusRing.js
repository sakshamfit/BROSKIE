import React, { useEffect, useRef } from 'react';
import { View, Animated, Easing } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { useReducedMotion } from '../motion';

/**
 * Segmented BROSKIE status ring — not an Instagram gradient.
 * Unseen: ink segments with a faint highlighter glow.
 * Seen: graphite dashed segments.
 * Multiple items: one arc per status.
 */
export default function StatusRing({
  size = 68,
  segments = 1,
  seen = false,
  empty = false,
  active = false,
  color = '#1c1b1b',
  seenColor = '#c4c7c7',
  children,
}) {
  const reduced = useReducedMotion();
  const pulse = useRef(new Animated.Value(0)).current;
  const count = Math.max(1, Math.min(12, segments));
  const stroke = empty ? 1.6 : seen ? 2 : 2.6;
  const r = (size - stroke - 2) / 2;
  const c = 2 * Math.PI * r;
  const gap = count > 1 ? Math.min(10, 28 / count) : 0;
  const dash = count > 1 ? (c / count) - gap : c;
  const gapLen = count > 1 ? gap : 0;

  useEffect(() => {
    if (!active || reduced || seen || empty) return undefined;
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 1600, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 0, duration: 1600, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [active, reduced, seen, empty, pulse]);

  const glow = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.18, 0.48] });

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      {!empty && !seen && (
        <Animated.View
          pointerEvents="none"
          style={{
            position: 'absolute', width: size + 8, height: size + 8, borderRadius: 999,
            borderWidth: 1, borderColor: '#FFE24D', opacity: glow,
          }}
        />
      )}
      <Svg width={size} height={size} style={{ position: 'absolute' }}>
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={empty ? color : seen ? seenColor : color}
          strokeWidth={stroke}
          strokeDasharray={empty ? '4 5' : `${dash} ${gapLen}`}
          strokeLinecap="round"
          rotation="-90"
          origin={`${size / 2}, ${size / 2}`}
        />
      </Svg>
      {children}
    </View>
  );
}
