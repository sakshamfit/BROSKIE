import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import Icon from '../icons/Icon';
import { useTheme } from '../store/ThemeContext';
import { useAuth } from '../store/AuthContext';
import { useChat } from '../store/ChatContext';
import { type, stroke } from '../theme';
import { openProfile } from '../push/routing';

/**
 * Instagram-style top bar: +one wordmark on the left, heart on the right.
 * The wordmark is the quick way to see your own public profile; the heart
 * remains Activity (requests, likes, calls).
 */
export default function BrandHeader({ navigation, onOpenActivity, bordered = true }) {
  const { theme } = useTheme();
  const { user } = useAuth();
  const chat = useChat();
  const unread = chat?.activityUnread || 0;
  const s = makeStyles(theme);

  const openActivity = () => {
    if (onOpenActivity) onOpenActivity();
    else navigation?.navigate?.('Activity');
  };

  const openOwnProfile = () => {
    if (user?.id) openProfile(user.id);
  };

  return (
    <View style={[s.header, bordered && { borderBottomWidth: stroke.ink, borderBottomColor: theme.ink }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Open your profile"
        onPress={openOwnProfile}
        hitSlop={8}
        style={({ pressed }) => [s.wordmarkHit, pressed && { opacity: 0.55 }]}
      >
        <Text style={s.wordmark}>+one</Text>
      </Pressable>
      <View style={{ flex: 1 }} />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Activity"
        onPress={openActivity}
        hitSlop={8}
        style={({ pressed }) => [s.heartHit, pressed && { opacity: 0.55 }]}
      >
        <Icon name="heart-outline" size={26} color={theme.ink} />
        {unread > 0 && <View style={[s.dot, { backgroundColor: '#ED4956', borderColor: theme.bg }]} />}
      </Pressable>
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
