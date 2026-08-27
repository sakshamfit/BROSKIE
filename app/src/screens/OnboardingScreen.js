/**
 * Basic 3-screen onboarding flow for +one.
 * Each screen uses a Lottie animated illustration (placeholder from
 * LottieFiles library until branded assets are ready) and Reanimated
 * transition animations.
 *
 * TODO: Replace placeholder Lottie assets at src/assets/lottie/onboard-*.json
 * with custom branded animations.
 */
import React, { useState, useRef, useCallback } from 'react';
import { View, Pressable, StyleSheet, Dimensions } from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withTiming, Easing } from 'react-native-reanimated';
import LottieView from 'lottie-react-native';
import Icon from '../icons/Icon';
import { useTheme } from '../store/ThemeContext';
import { type, inkBox, raised } from '../theme';
import { motion, haptic, useReducedMotion } from '../motion';
import { Text } from '../components/Text';

const { width } = Dimensions.get('window');

const PAGES = [
  {
    title: 'Real-time messages',
    subtitle: 'Send ink-and-paper notes that arrive instantly, anywhere.',
    asset: require('../assets/lottie/loading-heart.json'), // placeholder
    color: '#FFE24D',
  },
  {
    title: 'Stories & updates',
    subtitle: 'Share photos and thoughts that live for 24 hours.',
    asset: require('../assets/lottie/loading-heart.json'), // placeholder
    color: '#FF8FA3',
  },
  {
    title: 'Communities',
    subtitle: 'Join group chats and connect with people you follow.',
    asset: require('../assets/lottie/loading-heart.json'), // placeholder
    color: '#5D5F5B',
  },
];

export default function OnboardingFlow({ onDone }) {
  const { theme } = useTheme();
  const reduced = useReducedMotion();
  const [index, setIndex] = useState(0);
  const progress = useSharedValue(0);

  const goNext = useCallback(() => {
    if (index < PAGES.length - 1) {
      haptic('selection');
      progress.value = withTiming(index + 1, { duration: 220, easing: Easing.inOut(Easing.cubic) });
      setIndex((i) => i + 1);
    } else {
      haptic('success');
      onDone?.();
    }
  }, [index, onDone]);

  const page = PAGES[index];

  const dots = PAGES.map((_, i) => {
    const active = i === index;
    return (
      <View
        key={i}
        style={[
          styles.dot,
          { backgroundColor: theme.ink, opacity: active ? 1 : 0.28 },
          reduced ? null : { transform: [{ scale: active ? 1.3 : 1 }] },
        ]}
      />
    );
  });

  return (
    <View style={[styles.container, { backgroundColor: theme.bg }]}>
      {/* Illustration */}
      <View style={styles.illustrationWrap}>
        <LottieView
          source={page.asset}
          autoPlay={!reduced}
          loop={!reduced}
          style={{ width: 220, height: 220 }}
        />
      </View>

      {/* Text */}
      <View style={styles.textArea}>
        <Text style={[type.headlineMd, { color: theme.text, textAlign: 'center', marginBottom: 8 }]}>{page.title}</Text>
        <Text style={[type.bodyMd, { color: theme.subtext, textAlign: 'center', maxWidth: 300 }]}>{page.subtitle}</Text>
      </View>

      {/* Progress dots */}
      <View style={styles.dotsRow}>{dots}</View>

      {/* CTA */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={index === PAGES.length - 1 ? 'Get started' : 'Next'}
        onPress={goNext}
        style={[styles.cta, raised(theme, 2), { backgroundColor: theme.highlighter, borderColor: theme.ink }]}
      >
        <Text style={[type.bodyStrong, { color: theme.ink }]}>{index === PAGES.length - 1 ? 'GET STARTED' : 'NEXT'}</Text>
        <Icon name="chevron-forward-outline" size={18} color={theme.ink} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28 },
  illustrationWrap: { marginBottom: 32, alignItems: 'center', justifyContent: 'center' },
  textArea: { marginBottom: 40, alignItems: 'center' },
  dotsRow: { flexDirection: 'row', gap: 10, marginBottom: 28, alignItems: 'center', justifyContent: 'center' },
  dot: { width: 8, height: 8, borderRadius: 999 },
  cta: {
    flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 22, paddingVertical: 14,
    borderWidth: 2, borderRadius: 999,
  },
});
