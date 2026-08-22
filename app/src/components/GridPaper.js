import React, { useEffect, useRef } from 'react';
import { View, StyleSheet, Animated } from 'react-native';
import Svg, { Defs, Pattern, Path, Rect } from 'react-native-svg';
import { useReducedMotion } from '../motion';

/**
 * BROSKIE signature: a subtle drafting-grid texture.
 * Never a spreadsheet — faint lines that drift a few pixels.
 */
export default function GridPaper({
  color,
  opacity = 0.18,
  size = 22,
  animate = true,
  style,
  children,
}) {
  const reduced = useReducedMotion();
  const drift = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!animate || reduced) return undefined;
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(drift, { toValue: 1, duration: 14000, useNativeDriver: true }),
      Animated.timing(drift, { toValue: 0, duration: 14000, useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [animate, reduced, drift]);

  const tx = drift.interpolate({ inputRange: [0, 1], outputRange: [0, 6] });
  const ty = drift.interpolate({ inputRange: [0, 1], outputRange: [0, -4] });
  const line = color || 'rgba(28,27,27,0.22)';

  return (
    <View style={[styles.host, style]} pointerEvents="box-none">
      <Animated.View
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, { opacity, transform: [{ translateX: reduced ? 0 : tx }, { translateY: reduced ? 0 : ty }] }]}
      >
        <Svg width="100%" height="100%">
          <Defs>
            <Pattern id="broskieGrid" x="0" y="0" width={size} height={size} patternUnits="userSpaceOnUse">
              <Path d={`M ${size} 0 L 0 0 0 ${size}`} fill="none" stroke={line} strokeWidth={0.6} />
            </Pattern>
          </Defs>
          <Rect x="0" y="0" width="100%" height="100%" fill="url(#broskieGrid)" />
        </Svg>
      </Animated.View>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  host: { overflow: 'hidden' },
});
