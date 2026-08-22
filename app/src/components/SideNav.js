import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { SpringPressable, IconSwap, motion } from '../motion';
import Icon from '../icons/Icon';
import { useTheme } from '../store/ThemeContext';
import { useAuth } from '../store/AuthContext';
import { Avatar } from './common';
import { type, inkBox, marker, stroke } from '../theme';
import { openProfile } from '../push/routing';

/**
 * Persistent sidebar — the "SideNavBar" from the web mockup. Logo + New-chat
 * CTA, primary nav (Chats / See / Network / Settings), and a Help / Logout
 * footer pinned to the bottom.
 *
 * `railOnly` collapses it to an icon-only rail (labels + wordmark hidden)
 * for narrower "expanded" breakpoints — e.g. an iPad in portrait or a
 * medium Android tablet — so the list + detail panes still have room to
 * breathe, the same way native iPad apps collapse their sidebar.
 */
export default function SideNav({ active, onNavigate, onNewChat, onSettings, onHelp, onLogout, onOpenProfile, railOnly = false }) {
  const { theme } = useTheme();
  const { user } = useAuth();
  const s = makeStyles(theme);

  const openOwnProfile = () => {
    if (!user?.id) return;
    if (onOpenProfile) onOpenProfile(user.id);
    else openProfile(user.id);
  };

  const ITEMS = [
    { key: 'network', label: 'Network', icon: 'people' },
    { key: 'status', label: 'See', icon: 'eye' },
    { key: 'chats', label: 'Chats', icon: 'chatbubbles' },
    { key: 'colleagues', label: 'Colleagues', icon: 'school-outline', outlineOnly: true },
    { key: 'calls', label: 'Calls', icon: 'call' },
    { key: 'settings', label: 'Settings', icon: 'settings' },
  ];

  return (
    <View
      style={[
        s.wrap,
        railOnly && s.wrapRail,
        { backgroundColor: theme.bg, borderRightWidth: stroke.ink, borderRightColor: theme.ink },
      ]}
    >
      <View style={[s.brandRow, railOnly && s.brandRowRail]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open your profile"
          onPress={openOwnProfile}
          hitSlop={6}
          style={railOnly && { alignItems: 'center' }}
        >
          <Avatar uri={user?.avatar} name={user?.name} id={user?.id} size={railOnly ? 34 : 40} />
        </Pressable>
        {!railOnly && (
          <Pressable accessibilityRole="button" accessibilityLabel="Open your profile" onPress={openOwnProfile} style={{ flex: 1 }}>
            <Text style={s.wordmark}>+one</Text>
            <Text style={[type.labelXs, { color: theme.muted }]}>YOUR PROFILE</Text>
          </Pressable>
        )}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Activity"
          onPress={() => onNavigate?.('activity')}
          hitSlop={6}
          style={railOnly ? { marginTop: 12, alignItems: 'center' } : s.activityHit}
        >
          <Icon name="heart-outline" size={railOnly ? 20 : 22} color={theme.ink} />
        </Pressable>
      </View>

      <SpringPressable
        accessibilityRole="button"
        accessibilityLabel="find +ones"
        onPress={onNewChat}
        hitSlop={4}
        style={({ pressed }) => [
          s.newBtn,
          railOnly && s.newBtnRail,
          inkBox(theme, 'ink'),
          pressed ? marker(theme, 2) : null,
        ]}
        scaleTo={motion.scale.row}
        haptic="selection"
      >
        <Icon name="search" size={17} color={theme.ink} />
        {!railOnly && <Text style={[type.bodyStrong, { color: theme.ink }]}>find +ones</Text>}
      </SpringPressable>

      <View style={s.nav}>
        {ITEMS.map((item) => {
          const isActive = active === item.key;
          return (
            <SpringPressable
              key={item.key}
              accessibilityRole="button"
              accessibilityLabel={item.label}
              onPress={() => (item.key === 'settings' ? onSettings?.() : onNavigate?.(item.key))}
              hitSlop={4}
              scaleTo={motion.scale.row}
              haptic="selection"
              style={({ pressed, hovered }) => [
                s.navItem,
                railOnly && s.navItemRail,
                (pressed || hovered) && !isActive ? marker(theme, 1) : null,
              ]}
            >
              {/* same outline → filled morph as the phone tab bar, so the two
                  navigations feel like the same product */}
              {item.outlineOnly ? (
                <Icon name={item.icon} size={19} color={isActive ? theme.ink : theme.graphite} />
              ) : (
                <IconSwap
                  active={isActive}
                  size={19}
                  pop={false}
                  on={<Icon name={item.icon} size={19} color={theme.ink} />}
                  off={<Icon name={`${item.icon}-outline`} size={19} color={theme.graphite} />}
                />
              )}
              {!railOnly && (
                <Text
                  style={[
                    type.bodyLg,
                    { color: isActive ? theme.ink : theme.graphite, fontWeight: isActive ? '700' : '400' },
                    isActive && s.navActiveText,
                  ]}
                >
                  {item.label}
                </Text>
              )}
            </SpringPressable>
          );
        })}
      </View>

      <View style={[s.footer, railOnly && s.footerRail, { borderTopColor: theme.graphiteLine }]}>
        <SpringPressable accessibilityRole="button" accessibilityLabel="Help" onPress={onHelp} hitSlop={4} scaleTo={motion.scale.row} haptic="selection" style={({ pressed }) => [s.footerRow, railOnly && s.footerRowRail, pressed ? { opacity: 0.6 } : null]}>
          <Icon name="help-circle-outline" size={18} color={theme.graphite} />
          {!railOnly && <Text style={[type.bodyMd, { color: theme.graphite }]}>Help</Text>}
        </SpringPressable>
        <SpringPressable accessibilityRole="button" accessibilityLabel="Logout" onPress={onLogout} hitSlop={4} scaleTo={motion.scale.row} haptic="warning" style={({ pressed }) => [s.footerRow, railOnly && s.footerRowRail, pressed ? { opacity: 0.6 } : null]}>
          <Icon name="log-out-outline" size={18} color={theme.graphite} />
          {!railOnly && <Text style={[type.bodyMd, { color: theme.graphite }]}>Logout</Text>}
        </SpringPressable>
      </View>
    </View>
  );
}

const makeStyles = (t) => StyleSheet.create({
  wrap: { width: 264, height: '100%', paddingVertical: 28, paddingHorizontal: 20 },
  wrapRail: { width: 76, paddingHorizontal: 12 },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 20 },
  brandRowRail: { flexDirection: 'column', justifyContent: 'center', alignItems: 'center', marginBottom: 24 },
  wordmark: { ...type.headlineSm, fontSize: 22, color: t.text, fontStyle: 'italic' },
  activityHit: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  newBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingVertical: 11, marginBottom: 24,
  },
  newBtnRail: { paddingVertical: 12, paddingHorizontal: 0, aspectRatio: 1 },
  nav: { flexGrow: 1, gap: 4 },
  navItem: { flexDirection: 'row', alignItems: 'center', gap: 13, paddingVertical: 10, paddingHorizontal: 8 },
  navItemRail: { justifyContent: 'center', paddingVertical: 13, paddingHorizontal: 0 },
  navActiveText: { textDecorationLine: 'underline', textDecorationStyle: 'solid' },
  footer: { borderTopWidth: 1, borderStyle: 'dashed', paddingTop: 16, gap: 4 },
  footerRail: { alignItems: 'center' },
  footerRow: { flexDirection: 'row', alignItems: 'center', gap: 13, paddingVertical: 9, paddingHorizontal: 8 },
  footerRowRail: { justifyContent: 'center', paddingHorizontal: 0, width: '100%' },
});
