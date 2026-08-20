import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, Animated, StyleSheet } from 'react-native';
import Icon from '../icons/Icon';
import Emoji, { EmojiText } from '../icons/Emoji';
import { useTheme } from '../store/ThemeContext';
import { type, inkBox } from '../theme';
import { motion, useReducedMotion } from '../motion';

/**
 * ReplyBar — the "replying to…" strip above the composer.
 *
 * Enters with a translateY + opacity + scale spring; exits with a quick
 * fade/slide whether the user taps × or a message is sent. Fully themed via
 * the active ChatTheme (no hard-coded colors) and never touches the composer
 * text, so cancelling a reply keeps whatever is typed.
 */
export default function ReplyBar({ replyTo, senderName, onClose }) {
  const { theme } = useTheme();
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(replyTo ? { replyTo, senderName } : null);
  const enter = useRef(new Animated.Value(0)).current;
  const wasShown = useRef(false);

  useEffect(() => {
    if (replyTo) {
      // Keep the last non-null reply visible while it animates out; only run
      // the entrance spring the first time the bar appears (re-replies just
      // swap the content in place instead of flashing back to zero).
      setShown({ replyTo, senderName });
      if (wasShown.current) return undefined;
      wasShown.current = true;
      if (reduced) { enter.setValue(1); return undefined; }
      enter.setValue(0);
      const anim = Animated.spring(enter, { toValue: 1, ...motion.springSheet, useNativeDriver: true });
      anim.start();
      return () => anim.stop();
    }
    // replyTo cleared (× tapped or message sent) → quick fade/slide out.
    wasShown.current = false;
    if (!shown) return undefined;
    if (reduced) { setShown(null); return undefined; }
    const anim = Animated.timing(enter, {
      toValue: 0, duration: motion.fast, easing: motion.easing.inOut, useNativeDriver: true,
    });
    anim.start(() => setShown(null));
    return () => anim.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [replyTo]);

  if (!shown) return null;

  const translateY = enter.interpolate({ inputRange: [0, 1], outputRange: [10, 0] });
  const scale = enter.interpolate({ inputRange: [0, 1], outputRange: [0.97, 1] });
  const opacity = enter.interpolate({ inputRange: [0, 1], outputRange: [0, 1] });
  const body = shown.replyTo;
  const name = (shown.senderName || body.senderName || 'Message').toUpperCase();

  return (
    <Animated.View
      style={[
        s.bar,
        inkBox(theme, 'thin'),
        { backgroundColor: theme.replyPreview, opacity, transform: [{ translateY }, { scale }] },
      ]}
    >
      <View style={[s.accent, { backgroundColor: theme.primary }]} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[type.labelXs, { color: theme.graphite }]} numberOfLines={1}>{name}</Text>
        {body.type === 'image' || body.type === 'voice' ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Emoji char={body.type === 'image' ? '📷' : '🎤'} size={13} />
            <Text style={[type.bodySm, { color: theme.subtext }]}>
              {body.type === 'image' ? 'Photo' : 'Voice message'}
            </Text>
          </View>
        ) : (
          <EmojiText style={[type.bodySm, { color: theme.subtext }]} numberOfLines={1}>{body.body}</EmojiText>
        )}
      </View>
      <Pressable accessibilityLabel="Cancel reply" accessibilityRole="button" onPress={onClose} hitSlop={8}>
        <Icon name="close" size={20} color={theme.muted} />
      </Pressable>
    </Animated.View>
  );
}

const s = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 20, marginBottom: 8, padding: 10, gap: 12 },
  accent: { width: 3.5, alignSelf: 'stretch', borderRadius: 2 },
});
