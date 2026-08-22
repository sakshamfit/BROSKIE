import React, { useEffect, useRef } from 'react';
import { Pressable, Animated, StyleSheet, Easing } from 'react-native';
import Icon from '../icons/Icon';
import { haptic } from '../motion';

const DOUBLE_TAP_WINDOW_MS = 300;
const INSTAGRAM_HEART = '#ED4956';

/**
 * Instagram-style double-tap-to-like.
 *
 * Wrap any likeable surface (a post card, a photo) and pass `onDoubleTap`.
 * Two quick taps fire it and pop a big heart in the middle of the surface;
 * a single tap optionally fires `onSingleTap` after the double-tap window
 * closes (used for the photo lightbox, so a double tap likes instead of
 * opening the image).
 *
 * Inner Pressables (like/comment buttons, follow, tag chips) keep working —
 * they capture their own touches, so only taps on the "body" of the card
 * reach this wrapper.
 */
export default function DoubleTapLike({
  children, onDoubleTap, onSingleTap, style, heartSize = 84, disabled = false,
}) {
  const lastTap = useRef(0);
  const singleTimer = useRef(null);
  const scale = useRef(new Animated.Value(0)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => () => clearTimeout(singleTimer.current), []);

  const burst = () => {
    scale.setValue(0.35);
    opacity.setValue(0);
    Animated.parallel([
      Animated.spring(scale, { toValue: 1, friction: 4, tension: 210, useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 1, duration: 70, useNativeDriver: true }),
    ]).start(() => {
      Animated.parallel([
        Animated.timing(scale, { toValue: 1.18, duration: 260, delay: 260, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0, duration: 260, delay: 260, useNativeDriver: true }),
      ]).start();
    });
  };

  const handlePress = () => {
    if (disabled) {
      onSingleTap?.();
      return;
    }
    const nowTs = Date.now();
    if (nowTs - lastTap.current < DOUBLE_TAP_WINDOW_MS) {
      // double tap!
      lastTap.current = 0;
      clearTimeout(singleTimer.current);
      haptic('impact');
      burst();
      onDoubleTap?.();
      return;
    }
    lastTap.current = nowTs;
    if (onSingleTap) {
      clearTimeout(singleTimer.current);
      singleTimer.current = setTimeout(() => onSingleTap(), DOUBLE_TAP_WINDOW_MS);
    }
  };

  return (
    <Pressable onPress={handlePress} style={style}>
      {children}
      <Animated.View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFill,
          styles.heartWrap,
          { opacity, transform: [{ scale }] },
        ]}
      >
        <Icon name="heart" size={heartSize} color={INSTAGRAM_HEART} />
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  heartWrap: { alignItems: 'center', justifyContent: 'center', zIndex: 30 },
});
