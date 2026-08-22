import React, { useState } from 'react';
import { View, Text, StyleSheet, FlatList } from 'react-native';
import Icon from '../icons/Icon';
import { useChat } from '../store/ChatContext';
import { useTheme } from '../store/ThemeContext';
import { Avatar, InkCheckbox, InkButton, EmptyState, Rule, FrostedBackdrop, GoldTick, hasGoldTick } from './common';
import { BottomSheet, SpringPressable, motion } from '../motion';
import { type, inkBox, marker, radius, raised } from '../theme';
import { api } from '../api';

/**
 * Multi-select "forward to…" sheet. The user picks one or more chats, then
 * taps Forward — the copies are created server-side and arrive live via
 * socket `message:new`.
 */
export default function ForwardSheet({ visible, message, onClose }) {
  const { theme } = useTheme();
  const { chats, upsertChat } = useChat();
  const [selected, setSelected] = useState([]);
  const [busy, setBusy] = useState(false);
  const s = makeStyles(theme);

  const toggle = (id) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const submit = async () => {
    if (!selected.length) return;
    setBusy(true);
    try {
      const { forwarded } = await api.forwardMessage(message.id, selected);
      if (forwarded > 0) {
        // Chat previews update live via chat:updated; a gentle refresh keeps
        // the list's sort/recency honest for chats we may not have loaded yet.
        const { chats: fresh } = await api.chats();
        fresh.forEach((c) => upsertChat(c));
      }
      onClose();
    } catch (e) {
      console.warn('forward failed', e.message);
    } finally {
      setBusy(false);
    }
  };

  const close = () => { setSelected([]); onClose(); };

  return (
    <BottomSheet
      visible={visible}
      onClose={close}
      centered
      backdrop={<FrostedBackdrop />}
      style={{ paddingHorizontal: 28 }}
    >
      <View style={{ width: '100%', maxWidth: 420 }}>
        <View style={[s.sheet, raised(theme, 2), { backgroundColor: theme.bg, borderColor: theme.ink }]}>
          <View style={s.head}>
            <View style={{ flex: 1 }}>
              <Text style={[type.headlineSm, { color: theme.text }]}>Forward to…</Text>
              <Text style={[type.bodySm, { color: theme.subtext }]}>
                {selected.length ? `${selected.length} selected` : 'Pick chats'}
              </Text>
            </View>
            <SpringPressable
              accessibilityRole="button"
              accessibilityLabel="Close"
              onPress={close}
              hitSlop={8}
              scaleTo={motion.scale.icon}
              haptic="selection"
            >
              <Icon name="close" size={22} color={theme.muted} />
            </SpringPressable>
          </View>

          <FlatList
            data={chats}
            keyExtractor={(c) => c.id}
            style={{ flexGrow: 0 }}
            contentContainerStyle={{ paddingBottom: 8 }}
            ListEmptyComponent={<EmptyState icon="chatbubbles-outline" title="No chats yet" subtitle="Start a conversation first." />}
            renderItem={({ item }) => {
              const on = selected.includes(item.id);
              return (
                <SpringPressable
                  scaleTo={motion.scale.row}
                  haptic="selection"
                  style={({ pressed }) => [s.row, pressed ? marker(theme, 1) : null]}
                  onPress={() => toggle(item.id)}
                >
                  <Avatar uri={item.avatar} name={item.name} id={item.otherUserId || item.id} group={item.type === 'group'} size={42} />
                  <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, minWidth: 0 }}>
                    <Text style={[type.bodyMd, { color: theme.text, flexShrink: 1 }]} numberOfLines={1}>{item.name}</Text>
                    {hasGoldTick(item) && <GoldTick size={14} />}
                  </View>
                  {item.muted && <Icon name="volume-mute" size={14} color={theme.muted} style={{ marginRight: 10 }} />}
                  <InkCheckbox checked={on} onPress={() => toggle(item.id)} size={22} />
                </SpringPressable>
              );
            }}
          />

          <Rule style={{ marginVertical: 4 }} />
          <InkButton
            label={busy ? 'Forwarding…' : `Forward ${selected.length ? `(${selected.length})` : ''}`}
            onPress={submit}
            filled
            disabled={!selected.length}
            busy={busy}
          />
        </View>
      </View>
    </BottomSheet>
  );
}

const makeStyles = (t) => StyleSheet.create({
  sheet: {
    width: '100%', maxWidth: 420, maxHeight: '78%',
    borderWidth: 3, padding: 18, gap: 12,
    borderTopLeftRadius: 6, borderTopRightRadius: 12,
    borderBottomRightRadius: 6, borderBottomLeftRadius: 10,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 9, paddingHorizontal: 4 },
});
