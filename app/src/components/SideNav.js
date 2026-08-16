import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import Icon from '../icons/Icon';
import { useTheme } from '../store/ThemeContext';
import { useAuth } from '../store/AuthContext';
import { Avatar } from './common';
import { type, inkBox, marker, stroke } from '../theme';

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
export default function SideNav({ active, onNavigate, onNewChat, onSettings, onHelp, onLogout, railOnly = false }) {
  const { theme } = useTheme();
  const { user } = useAuth();
  const s = makeStyles(theme);

  const ITEMS = [
    { key: 'chats', label: 'Chats', icon: 'chatbubbles' },
    { key: 'status', label: 'See', icon: 'eye' },
    { key: 'network', label: 'Network', icon: 'people' },
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
        <Avatar uri={user?.avatar} name={user?.name} id={user?.id} size={railOnly ? 34 : 40} />
        {!railOnly && (
          <View style={{ flex: 1 }}>
            <Text style={s.wordmark}>友達</Text>
            <Text style={[type.labelXs, { color: theme.muted }]}>ONLINE</Text>
          </View>
        )}
      </View>

      <Pressable
        onPress={onNewChat}
        hitSlop={4}
        style={({ pressed }) => [
          s.newBtn,
          railOnly && s.newBtnRail,
          inkBox(theme, 'ink'),
          pressed ? marker(theme, 2) : null,
        ]}
      >
        <Icon name="create-outline" size={17} color={theme.ink} />
        {!railOnly && <Text style={[type.bodyStrong, { color: theme.ink }]}>New sketch</Text>}
      </Pressable>

      <View style={s.nav}>
        {ITEMS.map((item) => {
          const isActive = active === item.key;
          return (
            <Pressable
              key={item.key}
              onPress={() => (item.key === 'settings' ? onSettings?.() : onNavigate?.(item.key))}
              hitSlop={4}
              style={({ pressed, hovered }) => [
                s.navItem,
                railOnly && s.navItemRail,
                (pressed || hovered) && !isActive ? marker(theme, 1) : null,
              ]}
            >
              <Icon name={isActive ? item.icon : `${item.icon}-outline`} size={19} color={isActive ? theme.ink : theme.graphite} />
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
            </Pressable>
          );
        })}
      </View>

      <View style={[s.footer, railOnly && s.footerRail, { borderTopColor: theme.graphiteLine }]}>
        <Pressable onPress={onHelp} hitSlop={4} style={({ pressed }) => [s.footerRow, railOnly && s.footerRowRail, pressed ? { opacity: 0.6 } : null]}>
          <Icon name="help-circle-outline" size={18} color={theme.graphite} />
          {!railOnly && <Text style={[type.bodyMd, { color: theme.graphite }]}>Help</Text>}
        </Pressable>
        <Pressable onPress={onLogout} hitSlop={4} style={({ pressed }) => [s.footerRow, railOnly && s.footerRowRail, pressed ? { opacity: 0.6 } : null]}>
          <Icon name="log-out-outline" size={18} color={theme.graphite} />
          {!railOnly && <Text style={[type.bodyMd, { color: theme.graphite }]}>Logout</Text>}
        </Pressable>
      </View>
    </View>
  );
}

const makeStyles = (t) => StyleSheet.create({
  wrap: { width: 264, height: '100%', paddingVertical: 28, paddingHorizontal: 20 },
  wrapRail: { width: 76, paddingHorizontal: 12 },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 20 },
  brandRowRail: { justifyContent: 'center', marginBottom: 24 },
  wordmark: { ...type.headlineSm, fontSize: 22, color: t.text, fontStyle: 'italic' },
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
