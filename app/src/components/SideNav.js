import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import Icon from '../icons/Icon';
import { useTheme } from '../store/ThemeContext';
import { useAuth } from '../store/AuthContext';
import { Avatar } from './common';
import { type, inkBox, marker, stroke } from '../theme';

/**
 * Persistent desktop sidebar — the "SideNavBar" from the web mockup.
 * Logo + New-chat CTA, primary nav (Chats / See / Network / Settings),
 * and a Help / Logout footer pinned to the bottom.
 */
export default function SideNav({ active, onNavigate, onNewChat, onSettings, onHelp, onLogout }) {
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
    <View style={[s.wrap, { backgroundColor: theme.bg, borderRightWidth: stroke.ink, borderRightColor: theme.ink }]}>
      <View style={s.brandRow}>
        <Avatar uri={user?.avatar} name={user?.name} id={user?.id} size={40} />
        <View style={{ flex: 1 }}>
          <Text style={s.wordmark}>友達</Text>
          <Text style={[type.labelXs, { color: theme.muted }]}>ONLINE</Text>
        </View>
      </View>

      <Pressable
        onPress={onNewChat}
        style={({ pressed }) => [s.newBtn, inkBox(theme, 'ink'), pressed ? marker(theme, 2) : null]}
      >
        <Icon name="create-outline" size={17} color={theme.ink} />
        <Text style={[type.bodyStrong, { color: theme.ink }]}>New sketch</Text>
      </Pressable>

      <View style={s.nav}>
        {ITEMS.map((item) => {
          const isActive = active === item.key;
          return (
            <Pressable
              key={item.key}
              onPress={() => (item.key === 'settings' ? onSettings?.() : onNavigate?.(item.key))}
              style={({ pressed, hovered }) => [
                s.navItem,
                (pressed || hovered) && !isActive ? marker(theme, 1) : null,
              ]}
            >
              <Icon name={isActive ? item.icon : `${item.icon}-outline`} size={19} color={isActive ? theme.ink : theme.graphite} />
              <Text
                style={[
                  type.bodyLg,
                  { color: isActive ? theme.ink : theme.graphite, fontWeight: isActive ? '700' : '400' },
                  isActive && s.navActiveText,
                ]}
              >
                {item.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <View style={[s.footer, { borderTopColor: theme.graphiteLine }]}>
        <Pressable onPress={onHelp} style={({ pressed }) => [s.footerRow, pressed ? { opacity: 0.6 } : null]}>
          <Icon name="help-circle-outline" size={18} color={theme.graphite} />
          <Text style={[type.bodyMd, { color: theme.graphite }]}>Help</Text>
        </Pressable>
        <Pressable onPress={onLogout} style={({ pressed }) => [s.footerRow, pressed ? { opacity: 0.6 } : null]}>
          <Icon name="log-out-outline" size={18} color={theme.graphite} />
          <Text style={[type.bodyMd, { color: theme.graphite }]}>Logout</Text>
        </Pressable>
      </View>
    </View>
  );
}

const makeStyles = (t) => StyleSheet.create({
  wrap: { width: 264, height: '100%', paddingVertical: 28, paddingHorizontal: 20 },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 20 },
  wordmark: { ...type.headlineSm, fontSize: 22, color: t.text, fontStyle: 'italic' },
  newBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingVertical: 11, marginBottom: 24,
  },
  nav: { flexGrow: 1, gap: 4 },
  navItem: { flexDirection: 'row', alignItems: 'center', gap: 13, paddingVertical: 10, paddingHorizontal: 8 },
  navActiveText: { textDecorationLine: 'underline', textDecorationStyle: 'solid' },
  footer: { borderTopWidth: 1, borderStyle: 'dashed', paddingTop: 16, gap: 4 },
  footerRow: { flexDirection: 'row', alignItems: 'center', gap: 13, paddingVertical: 9, paddingHorizontal: 8 },
});
