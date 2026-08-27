import React from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import Icon from '../icons/Icon';
import { useTheme } from '../store/ThemeContext';
import { useAuth } from '../store/AuthContext';
import { useChatRealtime } from '../store/ChatContext';
import { type, stroke } from '../theme';
import { SpringPressable, motion } from '../motion';
import { openProfile } from '../push/routing';
import { Text } from './Text';

/**
 * Instagram-style top bar: +one wordmark on the left, heart on the right.
 * The wordmark is the quick way to see your own public profile; the heart
 * remains Activity (requests, likes, calls).
 */
export default function BrandHeader({ navigation, onOpenActivity, bordered = true }) {
  const { theme } = useTheme();
  const { user } = useAuth();
  const { activityUnread = 0 } = useChatRealtime();
  const unread = activityUnread || 0;
  // Memoized: the header re-renders on every activity-badge change.
  const s = React.useMemo(() => makeStyles(theme), [theme]);

  const openActivity = () => {
    if (onOpenActivity) onOpenActivity();
    else navigation?.navigate?.('Activity');
  };

  const openOwnProfile = () => {
    if (user?.id) openProfile(user.id);
  };

  return (
    <View style={[s.header, bordered && { borderBottomWidth: stroke.ink, borderBottomColor: theme.ink }]}>
      <SpringPressable
        accessibilityRole="button"
        accessibilityLabel="Open your profile"
        onPress={openOwnProfile}
        hitSlop={8}
        style={({ pressed }) => [s.wordmarkHit, pressed && { opacity: 0.7 }]}
        scaleTo={motion.scale.chip}
        haptic="selection"
      >
        <Text style={s.wordmark}>+one</Text>
      </SpringPressable>
      <View style={{ flex: 1 }} />
      <SpringPressable
        accessibilityRole="button"
        accessibilityLabel="Activity"
        onPress={openActivity}
        hitSlop={8}
        style={s.heartHit}
        scaleTo={motion.scale.icon}
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
