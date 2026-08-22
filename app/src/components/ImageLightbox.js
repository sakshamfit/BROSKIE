import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Image, Modal, Pressable, StyleSheet, Animated, PanResponder, useWindowDimensions } from 'react-native';
import Icon from '../icons/Icon';
import { motion, haptic, useReducedMotion } from '../motion';

/** Drag this far (or fling this fast) and the photo is let go. */
const DISMISS_DISTANCE = 110;
const DISMISS_VELOCITY = 0.75;

/**
 * Full-screen photo viewer — one implementation shared by the feed, a post
 * detail, a profile and a conversation, so opening a photo feels identical
 * everywhere.
 *
 * The motion is deliberately physical rather than decorative:
 *   - opening scales the photo up from 94% while the black backdrop fades
 *     in, so the image reads as coming *out of* the page;
 *   - a vertical drag moves the photo with the finger and fades the
 *     backdrop as it goes — the further you pull, the more of the app you
 *     can see behind it, so you always know what letting go will do;
 *   - releasing past ~110px, or flinging, throws the photo out along the
 *     direction it was already travelling;
 *   - releasing short springs it back to centre.
 *
 * Tapping the backdrop still closes it, and the close button is always
 * available for reduced-motion / accessibility users.
 */
export default function ImageLightbox({ uri, onClose, accessibilityLabel = 'Photo' }) {
  const reduced = useReducedMotion();
  const { width: winW, height: winH } = useWindowDimensions();
  const visible = !!uri;
  const [shown, setShown] = useState(visible);

  const enter = useRef(new Animated.Value(0)).current;   // 0 → 1 open
  const dragY = useRef(new Animated.Value(0)).current;   // finger offset

  useEffect(() => {
    if (visible) {
      setShown(true);
      dragY.setValue(0);
      if (reduced) { enter.setValue(1); return undefined; }
      enter.setValue(0);
      const anim = Animated.spring(enter, { toValue: 1, ...motion.springSheet, useNativeDriver: true });
      anim.start();
      return () => anim.stop();
    }
    setShown(false);
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, reduced]);

  const dismiss = useCallback((velocity = 0, direction = 1) => {
    if (reduced) { onClose?.(); return; }
    Animated.parallel([
      Animated.timing(enter, {
        toValue: 0, duration: motion.fast, easing: motion.easing.out, useNativeDriver: true,
      }),
      Animated.spring(dragY, {
        toValue: direction * 460, velocity, ...motion.springSettle,
        overshootClamping: true, useNativeDriver: true,
      }),
    ]).start(({ finished }) => { if (finished) onClose?.(); });
  }, [enter, dragY, onClose, reduced]);

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (e, g) => Math.abs(g.dy) > 8 && Math.abs(g.dy) > Math.abs(g.dx),
      onPanResponderGrant: () => { dragY.stopAnimation(); },
      onPanResponderMove: (e, g) => dragY.setValue(g.dy),
      onPanResponderRelease: (e, g) => {
        const far = Math.abs(g.dy) > DISMISS_DISTANCE;
        const flung = Math.abs(g.vy) > DISMISS_VELOCITY;
        if (far || flung) {
          haptic('selection');
          dismiss(g.vy, g.dy === 0 ? 1 : Math.sign(g.dy) || Math.sign(g.vy) || 1);
          return;
        }
        Animated.spring(dragY, { toValue: 0, velocity: g.vy, ...motion.springBack, useNativeDriver: true }).start();
      },
      onPanResponderTerminate: () => {
        Animated.spring(dragY, { toValue: 0, ...motion.springBack, useNativeDriver: true }).start();
      },
      onPanResponderTerminationRequest: () => false,
    }),
  ).current;

  if (!shown) return null;

  // Backdrop darkness = how "open" it is, minus how far it has been pulled.
  const dragFade = dragY.interpolate({
    inputRange: [-320, 0, 320],
    outputRange: [0.25, 1, 0.25],
    extrapolate: 'clamp',
  });
  const openScale = enter.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1] });
  const dragScale = dragY.interpolate({
    inputRange: [-320, 0, 320],
    outputRange: [0.86, 1, 0.86],
    extrapolate: 'clamp',
  });

  return (
    <Modal visible transparent animationType="none" onRequestClose={() => dismiss()} statusBarTranslucent>
      <Animated.View style={[StyleSheet.absoluteFill, styles.backdrop, { opacity: Animated.multiply(enter, dragFade) }]} />

      <View style={styles.root} {...pan.panHandlers}>
        <Pressable style={StyleSheet.absoluteFill} onPress={() => dismiss()} accessibilityLabel="Close photo" />
        <Animated.View
          pointerEvents="none"
          style={{
            opacity: enter,
            transform: [{ translateY: dragY }, { scale: openScale }, { scale: dragScale }],
          }}
        >
          <Image
            source={{ uri }}
            accessibilityLabel={accessibilityLabel}
            style={{ width: winW * 0.92, height: winH * 0.78 }}
            resizeMode="contain"
          />
        </Animated.View>

        <Animated.View style={[styles.closeWrap, { opacity: Animated.multiply(enter, dragFade) }]}>
          <Pressable onPress={() => dismiss()} hitSlop={12} accessibilityLabel="Close photo" style={styles.close}>
            <Icon name="close" size={22} color="#ffffff" />
          </Pressable>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { backgroundColor: 'rgba(12,12,12,0.96)' },
  root: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  closeWrap: { position: 'absolute', top: 44, right: 18 },
  close: { padding: 8 },
});
