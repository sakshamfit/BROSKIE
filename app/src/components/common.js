import React from 'react';
import { View, Text, Image, StyleSheet, Pressable, ActivityIndicator } from 'react-native';
import Icon from '../icons/Icon';
import Emoji from '../icons/Emoji';
import {
  colorFor, initials, AVATAR_INK, radius, type, tokens,
  clayFor, clayInsetFor, clayPressed, clayAvatar,
} from '../theme';
import { mediaUrl } from '../api';
import { useTheme } from '../store/ThemeContext';

/* ------------------------------------------------------------------ */
/* clay primitives                                                     */
/* ------------------------------------------------------------------ */

/** White, borderless, deeply rounded card lifted by a soft clay shadow. */
export function ClayCard({ children, style, level = 1, radius: r = radius.md, color }) {
  const { theme } = useTheme();
  return (
    <View
      style={[
        { backgroundColor: color || theme.card, borderRadius: r, padding: 24 },
        clayFor(theme, level),
        style,
      ]}
    >
      {children}
    </View>
  );
}

/** Pressable clay surface that squishes on press. */
export function ClaySurface({ children, onPress, onLongPress, style, level = 1, radius: r = radius.md, color, disabled }) {
  const { theme } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      disabled={disabled}
      style={({ pressed }) => [
        { backgroundColor: color || theme.card, borderRadius: r },
        pressed ? clayPressed(theme.shadowTint) : clayFor(theme, level),
        disabled && { opacity: 0.55 },
        style,
      ]}
    >
      {children}
    </Pressable>
  );
}

/** Pill button, mint clay by default. */
export function ClayButton({ label, onPress, icon, style, textStyle, color, textColor, disabled, busy, level = 2 }) {
  const { theme } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || busy}
      style={({ pressed }) => [
        styles.btn,
        { backgroundColor: color || theme.accent, borderRadius: radius.full },
        pressed ? clayPressed(theme.shadowTint) : clayFor(theme, level),
        (disabled || busy) && { opacity: 0.6 },
        style,
      ]}
    >
      {busy ? (
        <ActivityIndicator color={textColor || theme.onAccent} />
      ) : (
        <>
          {!!icon && <Icon name={icon} size={19} color={textColor || theme.onAccent} />}
          <Text style={[type.bodyLg, { fontFamily: type.fontFamily(700), color: textColor || theme.onAccent }, textStyle]}>
            {label}
          </Text>
        </>
      )}
    </Pressable>
  );
}

/** Circular clay icon button. */
export function ClayIconButton({ name, onPress, size = 44, iconSize = 20, color, iconColor, style, level = 1, disabled }) {
  const { theme } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={6}
      style={({ pressed }) => [
        { width: size, height: size, borderRadius: radius.full, alignItems: 'center', justifyContent: 'center', backgroundColor: color || theme.card },
        pressed ? clayPressed(theme.shadowTint) : clayFor(theme, level),
        disabled && { opacity: 0.5 },
        style,
      ]}
    >
      <Icon name={name} size={iconSize} color={iconColor || theme.primary} />
    </Pressable>
  );
}

/** "Carved" inset surface for inputs and search bars. */
export function ClayInset({ children, style, radius: r = radius.full, strength = 1 }) {
  const { theme } = useTheme();
  return (
    <View style={[{ backgroundColor: theme.inputBg, borderRadius: r }, clayInsetFor(theme, strength), style]}>
      {children}
    </View>
  );
}

/** Small high-contrast bead (unread counts, status chips). */
export function ClayBead({ label, color, textColor, style, small }) {
  const { theme } = useTheme();
  return (
    <View
      style={[
        {
          minWidth: small ? 18 : 24,
          height: small ? 18 : 24,
          borderRadius: radius.full,
          paddingHorizontal: small ? 5 : 8,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: color || theme.badge,
        },
        clayFor(theme, 1),
        style,
      ]}
    >
      <Text style={[type.labelMd, { color: textColor || theme.onBadge, fontSize: small ? 10 : 12, letterSpacing: 0 }]}>
        {label}
      </Text>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* avatar                                                              */
/* ------------------------------------------------------------------ */

export function Avatar({ uri, name, id, size = 52, group = false, online = false }) {
  const { theme } = useTheme();
  const src = mediaUrl(uri);
  const fill = group ? tokens.primaryContainer : colorFor(id || name || '');

  return (
    <View style={{ width: size, height: size }}>
      <View style={[{ width: size, height: size, borderRadius: radius.full, overflow: 'hidden', backgroundColor: fill }, clayAvatar()]}>
        {src ? (
          <Image source={{ uri: src }} style={{ width: size, height: size, borderRadius: radius.full }} />
        ) : (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            {group ? (
              <Icon name="people" size={size * 0.46} color={AVATAR_INK} />
            ) : (
              <Text style={{ color: AVATAR_INK, fontFamily: type.fontFamily(700), fontSize: size * 0.34, letterSpacing: 0.2 }}>
                {initials(name)}
              </Text>
            )}
          </View>
        )}
      </View>
      {online && (
        <View
          style={[
            {
              position: 'absolute', right: -1, bottom: -1,
              width: size * 0.3, height: size * 0.3, borderRadius: radius.full,
              backgroundColor: theme.badge, borderWidth: 2.5, borderColor: theme.card,
            },
            clayFor(theme, 1),
          ]}
        />
      )}
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* misc                                                                */
/* ------------------------------------------------------------------ */

export function Ticks({ status, color, size = 15 }) {
  const { theme } = useTheme();
  if (status === 'sending') return <Icon name="time-outline" size={size} color={color || theme.muted} />;
  if (status === 'failed') return <Icon name="alert-circle-outline" size={size} color={theme.danger} />;
  const tickColor = status === 'read' ? theme.tickRead : color || theme.muted;
  return (
    <View style={{ flexDirection: 'row', width: size + 4 }}>
      <Icon name="checkmark" size={size} color={tickColor} />
      {(status === 'delivered' || status === 'read') && (
        <Icon name="checkmark" size={size} color={tickColor} style={{ marginLeft: -size * 0.62 }} />
      )}
    </View>
  );
}

export function Screen({ children, style }) {
  const { theme } = useTheme();
  return <View style={[{ flex: 1, backgroundColor: theme.bg }, style]}>{children}</View>;
}

export function Loading({ label }) {
  const { theme } = useTheme();
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.bg, gap: 16 }}>
      <ActivityIndicator size="large" color={theme.primary} />
      {!!label && <Text style={[type.bodySm, { color: theme.subtext }]}>{label}</Text>}
    </View>
  );
}

export function EmptyState({ icon = 'chatbubbles-outline', title, subtitle }) {
  const { theme } = useTheme();
  return (
    <View style={{ alignItems: 'center', justifyContent: 'center', padding: 40, flex: 1 }}>
      <View style={[{ width: 96, height: 96, borderRadius: radius.full, backgroundColor: theme.card, alignItems: 'center', justifyContent: 'center', marginBottom: 20 }, clayFor(theme, 1)]}>
        <Icon name={icon} size={40} color={theme.primary} />
      </View>
      <Text style={[type.headlineSm, { color: theme.text, textAlign: 'center' }]}>{title}</Text>
      {!!subtitle && (
        <Text style={[type.bodySm, { marginTop: 8, color: theme.subtext, textAlign: 'center', maxWidth: 300 }]}>{subtitle}</Text>
      )}
    </View>
  );
}

export function IconButton({ name, onPress, size = 22, color, style }) {
  const { theme } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [{ padding: 8, borderRadius: radius.full, opacity: pressed ? 0.55 : 1 }, style]}
      hitSlop={6}
    >
      <Icon name={name} size={size} color={color || theme.headerText} />
    </Pressable>
  );
}

export const EMOJIS = [
  '😀','😂','🥰','😍','😎','🤔','😢','😭','😡','👍','👎','🙏','👏','🔥','💯','🎉',
  '❤️','💔','✨','⭐','🌙','☀️','🍕','☕','🏃','💪','🚀','📱','💻','🎵','⚽','🏔️',
];

export function EmojiPicker({ visible, onSelect }) {
  const { theme } = useTheme();
  if (!visible) return null;
  return (
    <View style={[styles.emojiWrap, { backgroundColor: theme.card, borderRadius: radius.md, marginHorizontal: 16, marginBottom: 8 }, clayFor(theme, 1)]}>
      {EMOJIS.map((e) => (
        <Pressable key={e} onPress={() => onSelect(e)} style={styles.emojiBtn}>
          <Emoji char={e} size={28} />
        </Pressable>
      ))}
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* time helpers                                                        */
/* ------------------------------------------------------------------ */

export function formatTime(ts) {
  const d = new Date(ts);
  let h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, '0');
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${m} ${ampm}`;
}

export function formatChatTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const today = new Date();
  const yesterday = new Date(Date.now() - 86400000);
  if (d.toDateString() === today.toDateString()) return formatTime(ts);
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString(undefined, { day: '2-digit', month: '2-digit', year: '2-digit' });
}

export function formatDayLabel(ts) {
  const d = new Date(ts);
  const today = new Date();
  const yesterday = new Date(Date.now() - 86400000);
  if (d.toDateString() === today.toDateString()) return 'TODAY';
  if (d.toDateString() === yesterday.toDateString()) return 'YESTERDAY';
  return d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
}

export function lastSeenText(isOnline, lastSeen) {
  if (isOnline) return 'online';
  if (!lastSeen) return '';
  const diff = Date.now() - lastSeen;
  if (diff < 60000) return 'last seen just now';
  if (diff < 3600000) return `last seen ${Math.floor(diff / 60000)}m ago`;
  const d = new Date(lastSeen);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return `last seen today at ${formatTime(lastSeen)}`;
  return `last seen ${formatChatTime(lastSeen)}`;
}

/** @username convention from the spec */
export function handleFor(name = '', phone = '') {
  const base = String(name).toLowerCase().replace(/[^a-z0-9]+/g, '');
  return '@' + (base || String(phone).replace(/\D/g, '').slice(-6) || 'user');
}

const styles = StyleSheet.create({
  btn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, paddingVertical: 16, paddingHorizontal: 24 },
  emojiWrap: { flexDirection: 'row', flexWrap: 'wrap', paddingVertical: 12, paddingHorizontal: 10, maxHeight: 230 },
  emojiBtn: { width: '12.5%', alignItems: 'center', paddingVertical: 7 },
});
