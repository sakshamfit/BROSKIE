/**
 * Branded loading animation using Reanimated (native thread).
 * A small abstract pulse matching the +one color palette (#FFE24D highlighter,
 * #1c1b1b ink). Short loops (2-3s) so it never feels broken on slow networks.
 *
 * Placeholder: swap in a custom Lottie JSON (e.g. from LottieFiles.com) at
 * src/assets/lottie/loading-brand.json when a branded asset is ready.
 */
import React, { useEffect } from 'react';
import { View, StyleSheet, Text } from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withRepeat, withTiming, Easing } from 'react-native-reanimated';
import Icon from '../icons/Icon';
import { useTheme } from '../store/ThemeContext';
import { motion, useReducedMotion, haptic } from '../motion';

export default function BrandLoader({ label, size = 42 }) {
  const { theme } = useTheme();
  const reduced = useReducedMotion();
  const pulse = useSharedValue(0);
  const rotate = useSharedValue(0);

  useEffect(() => {
    if (reduced) {
      pulse.value = 0;
      rotate.value = 0;
      return () => {};
    }
    const p = withRepeat(
      withTiming(1, { duration: 900, easing: Easing.inOut(Easing.cubic) }),
      -1,
      true
    );
    const r = withRepeat(
      withTiming(360, { duration: 2200, easing: Easing.linear }),
      -1,
      false
    );
    pulse.value = p;
    rotate.value = r;
    return () => {
      // Cleanup handled by Reanimated's internal mechanism; loops stop when component unmounts
    };
  }, [reduced]);

  const pulseStyle = useAnimatedStyle(() => ({
    opacity: reduced ? 1 : 0.7 + 0.3 * Math.sin(pulse.value * Math.PI),
    transform: [{ scale: reduced ? 1 : 1 + 0.06 * Math.sin(pulse.value * Math.PI) }],
  }));

  const rotateStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: reduced ? '0deg' : `${rotate.value}deg` }],
  }));

  return (
    <View style={styles.container}>
      <Animated.View style={[pulseStyle]}>
        <Animated.View style={[rotateStyle, { width: size, height: size, alignItems: 'center', justifyContent: 'center', borderRadius: size / 2, backgroundColor: theme.highlighter, borderWidth: 2.5, borderColor: theme.ink }]}>
          <Icon name="add" size={size * 0.55} color={theme.ink} />
        </Animated.View>
      </Animated.View>
      {!!label && <Text style={[styles.label, { color: theme.muted, marginTop: 16 }]}>{label}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: 'transparent' },
  label: { fontSize: 13, letterSpacing: 0.6, fontWeight: '600' },
});
