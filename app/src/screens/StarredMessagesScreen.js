import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, FlatList, Pressable, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from '../icons/Icon';
import Emoji, { EmojiText } from '../icons/Emoji';
import { useTheme } from '../store/ThemeContext';
import { EmptyState, formatChatTime, Rule, InkIconButton } from '../components/common';
import { type, inkBox, marker } from '../theme';
import { api, mediaUrl } from '../api';
import { SpringPressable, motion } from '../motion';

/**
 * Starred messages — every message you've bookmarked across all chats,
 * newest first. Tap one to jump into its chat; tap the star to unstar.
 */
export default function StarredMessagesScreen({ navigation, embedded = false }) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const s = makeStyles(theme);

  const load = useCallback(async () => {
    try {
      const { messages } = await api.starred();
      setItems(messages);
    } catch { /* ignore */ } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const unstar = async (m) => {
    try {
      await api.unstarMessage(m.id);
      setItems((prev) => prev.filter((x) => x.id !== m.id));
    } catch { /* ignore */ }
  };

  const preview = (m) => {
    if (m.type === 'image') return '📷 Photo';
    if (m.type === 'voice') return '🎤 Voice message';
    return m.body;
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <View style={[s.header, !embedded && { paddingTop: 18 + insets.top }]}>
        {!embedded && (
          <Pressable onPress={() => navigation.goBack()} hitSlop={8} style={{ padding: 6 }}>
            <Icon name="arrow-back" size={22} color={theme.ink} />
          </Pressable>
        )}
        <View style={{ flex: 1 }}>
          <Text style={[type.headlineMd, { color: theme.text }]}>Starred messages</Text>
          <Text style={[type.bodySm, { color: theme.subtext }]}>{items.length} saved</Text>
        </View>
        <InkIconButton name="refresh" size={38} iconSize={17} onPress={() => { setLoading(true); load(); }} />
      </View>
      <Rule style={{ marginHorizontal: 20, marginTop: 4 }} />

      <FlatList
        data={items}
        keyExtractor={(m) => m.id}
        contentContainerStyle={[s.list, !items.length && { flexGrow: 1 }]}
        ListEmptyComponent={
          <EmptyState
            icon="star-outline"
            title={loading ? 'Loading…' : 'Nothing starred yet'}
            subtitle="Long-press a message and tap “Star message” to save it here."
          />
        }
        renderItem={({ item }) => (
          <SpringPressable
            style={({ pressed }) => [s.row, pressed ? marker(theme, 1) : null]}
            onPress={() => navigation.navigate('Conversation', { chatId: item.chatId })}
            scaleTo={motion.scale.row}
            haptic="selection"
          >
            <View style={[s.quote, { borderLeftColor: theme.ink }]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Icon name="chatbubble-outline" size={13} color={theme.graphite} />
                <EmojiText style={[type.labelXs, { color: theme.graphite, flex: 1 }]} numberOfLines={1}>
                  {item.chatName?.toUpperCase()}
                </EmojiText>
                <Text style={[type.labelXs, { color: theme.muted }]}>{formatChatTime(item.createdAt)}</Text>
              </View>
              {item.type === 'image' && item.mediaUrl ? (
                <EmojiText style={[type.bodyMd, { color: theme.text, marginTop: 6 }]}>📷 Photo</EmojiText>
              ) : (
                <EmojiText style={[type.bodyMd, { color: theme.text, marginTop: 6 }]} numberOfLines={3}>
                  {preview(item)}
                </EmojiText>
              )}
              {item.edited && <Text style={[type.labelXs, { color: theme.muted, fontStyle: 'italic', marginTop: 4 }]}>edited</Text>}
            </View>
            <Pressable onPress={() => unstar(item)} hitSlop={10} style={{ padding: 6 }}>
              <Icon name="star" size={20} color={theme.highlighter} />
            </Pressable>
          </SpringPressable>
        )}
      />
    </View>
  );
}

const makeStyles = (t) => StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 20, paddingVertical: 14 },
  list: { padding: 20, gap: 14 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  quote: { flex: 1, borderLeftWidth: 3, paddingLeft: 12, paddingVertical: 4 },
});
