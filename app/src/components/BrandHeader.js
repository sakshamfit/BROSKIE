import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import Icon from '../icons/Icon';
import { useTheme } from '../store/ThemeContext';
import { useChat } from '../store/ChatContext';
import { type, stroke } from '../theme';
import { SpringPressable, motion } from '../motion';

/**
 * Instagram-style top bar: +one wordmark on the left, heart on the right.
 * Tapping either opens Activity (requests, likes, calls).
 */
export default function BrandHeader({ navigation, onOpenActivity, bordered = true }) {
  const { theme } = useTheme();
  const chat = useChat();
  const unread = chat?.activityUnread || 0;
  const s = makeStyles(theme);

  const open = () => {
    if (onOpenActivity) onOpenActivity();
    else navigation?.navigate?.('Activity');
  };

  return (
    <View style={[s.header, bordered && { borderBottomWidth: stroke.ink, borderBottomColor: theme.ink }]}>
      <SpringPressable
        accessibilityRole="button"
        accessibilityLabel="Open activity"
        onPress={open}
        hitSlop={8}
        style={({ pressed }) => [s.wordmarkHit, pressed && { opacity: 0.55 }]}
        scaleTo={motion.scale.row}
        haptic="selection"
      >
        <Text style={s.wordmark}>+one</Text>
      </SpringPressable>
      <View style={{ flex: 1 }} />
      <SpringPressable
        accessibilityRole="button"
        accessibilityLabel="Activity"
        onPress={open}
        hitSlop={8}
        style={({ pressed }) => [s.heartHit, pressed && { opacity: 0.55 }]}
        scaleTo={motion.scale.row}
        haptic="selection"
      >
        <Icon name="heart-outline" size={26} color={theme.ink} />
        {unread > 0 && <View style={[s.dot, { backgroundColor: '#ED4956', borderColor: theme.bg }]} />}
      </SpringPressable>
    </View>
  );
}

const makeStyles = (t) => StyleSheet.create({
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 18, paddingTop: 14, paddingBottom: 12, minHeight: 52,
  },
  wordmarkHit: { paddingVertical: 4, paddingRight: 10 },
  wordmark: { ...type.headlineMd, color: t.text, fontStyle: 'italic', letterSpacing: -0.5, fontSize: 26 },
  heartHit: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  dot: {
    position: 'absolute', top: 6, right: 6, width: 9, height: 9, borderRadius: 9, borderWidth: 1.5,
  },
});
