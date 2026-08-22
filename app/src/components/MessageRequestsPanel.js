import React, { useState } from 'react';
import {
  View, Text, Pressable, StyleSheet, Modal, FlatList, ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from '../icons/Icon';
import { EmojiText } from '../icons/Emoji';
import { api } from '../api';
import { useChat } from '../store/ChatContext';
import { useTheme } from '../store/ThemeContext';
import { confirm } from '../hooks/confirm';
import { Avatar, EmptyState, Rule, TapeChip, formatChatTime, handleFor, GoldTick, hasGoldTick } from './common';
import { type, inkBox, marker, stroke } from '../theme';
import { SpringPressable, motion } from '../motion';

/** Full-height inbox for first messages from people outside accepted contacts. */
export default function MessageRequestsPanel({ visible, onClose, requests, onChanged, navigation }) {
  const { theme } = useTheme();
  const { upsertChat, refreshChats } = useChat();
  const insets = useSafeAreaInsets();
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState('');
  const s = makeStyles(theme);

  const respond = async (item, action) => {
    if (action !== 'accept') {
      const label = action === 'block' ? `Block ${item.requester?.name || 'this person'} and delete the request?` : 'Delete this message request?';
      const ok = await confirm(label, {
        title: action === 'block' ? 'Block sender' : 'Delete request',
        confirmLabel: action === 'block' ? 'Block' : 'Delete',
        destructive: true,
      });
      if (!ok) return;
    }

    setBusy(`${item.chatId}:${action}`);
    setError('');
    try {
      const result = await api.respondChatRequest(item.chatId, action);
      onChanged?.(item.chatId);
      if (action === 'accept' && result.chat) {
        upsertChat(result.chat);
        await refreshChats();
        onClose();
        navigation.navigate('Conversation', { chatId: result.chat.id });
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  };

  const renderItem = ({ item, index }) => {
    const person = item.requester || {};
    const message = item.chat?.lastMessage;
    return (
      <View style={[s.card, inkBox(theme, index % 2 ? 'thin' : 'ink'), { transform: [{ rotate: index % 2 ? '0.35deg' : '-0.35deg' }] }]}>
        <View style={s.cardHead}>
          <Avatar uri={person.avatar} name={person.name} id={person.id} size={52} weight="ink" profileId={person.id} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <EmojiText style={[type.headlineSm, { color: theme.text, flexShrink: 1 }]} numberOfLines={1}>{person.name || 'Unknown'}</EmojiText>
              {hasGoldTick(person) && <GoldTick size={15} />}
            </View>
            <Text style={[type.labelXs, { color: theme.muted, marginTop: 3 }]}>{handleFor(person)}</Text>
          </View>
          <TapeChip label={formatChatTime(message?.createdAt || item.requestedAt) || 'NEW'} tone="accent" />
        </View>

        <Rule style={{ marginVertical: 11 }} />
        <Text style={[type.labelXs, { color: theme.muted, marginBottom: 5 }]}>FIRST MESSAGE</Text>
        <EmojiText style={[type.bodyMd, { color: theme.text }]} numberOfLines={3}>
          {message?.deleted ? 'This message was deleted.' : message?.body || 'Started a conversation with you.'}
        </EmojiText>
        <Text style={[type.bodySm, { color: theme.subtext, marginTop: 9 }]}>
          They will not enter your main chat list until you accept.
        </Text>

        <View style={s.actions}>
          <RequestButton
            theme={theme}
            label="Accept & chat"
            icon="checkmark"
            filled
            busy={busy === `${item.chatId}:accept`}
            disabled={!!busy}
            onPress={() => respond(item, 'accept')}
          />
          <RequestButton
            theme={theme}
            label="Delete"
            icon="trash-outline"
            disabled={!!busy}
            busy={busy === `${item.chatId}:delete`}
            onPress={() => respond(item, 'delete')}
          />
          <SpringPressable onPress={() => respond(item, 'block')} disabled={!!busy} hitSlop={7} style={({ pressed }) => [s.block, pressed && marker(theme, 1)]} scaleTo={motion.scale.row} haptic="warning">
            <Icon name="ban-outline" size={15} color={theme.danger} />
            <Text style={[type.labelXs, { color: theme.danger }]}>BLOCK</Text>
          </SpringPressable>
        </View>
      </View>
    );
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={[s.root, { backgroundColor: theme.bg, paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <View style={s.header}>
          <Pressable onPress={onClose} hitSlop={9} style={{ padding: 6 }}>
            <Icon name="arrow-back" size={22} color={theme.ink} />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={[type.headlineMd, { color: theme.text }]}>Message requests</Text>
            <Text style={[type.labelXs, { color: theme.muted, marginTop: 3 }]}>{requests.length} WAITING</Text>
          </View>
          <Icon name="mail-unread-outline" size={23} color={theme.ink} />
        </View>

        {!!error && (
          <View style={[s.error, { borderColor: theme.danger, backgroundColor: theme.dangerContainer }]}>
            <Icon name="alert-circle-outline" size={16} color={theme.danger} />
            <Text style={[type.bodySm, { color: theme.danger, flex: 1 }]}>{error}</Text>
          </View>
        )}

        <FlatList
          data={requests}
          keyExtractor={(item) => item.chatId}
          renderItem={renderItem}
          contentContainerStyle={[s.list, !requests.length && { flexGrow: 1 }]}
          ListHeaderComponent={requests.length ? (
            <Text style={[type.bodySm, { color: theme.subtext, marginBottom: 18 }]}>
              Messages from people outside your accepted contacts stay private here. Accept, delete, or block each request.
            </Text>
          ) : null}
          ListEmptyComponent={
            <EmptyState icon="mail-unread-outline" title="No message requests" subtitle="New messages from people outside your contacts will appear here." />
          }
        />
      </View>
    </Modal>
  );
}

function RequestButton({ theme, label, icon, filled, busy, disabled, onPress }) {
  return (
    <SpringPressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.requestButton,
        inkBox(theme, filled ? 'ink' : 'thin'),
        filled && { backgroundColor: theme.ink },
        pressed && !filled && marker(theme, 1),
        disabled && { opacity: busy ? 1 : 0.5 },
      ]}
      scaleTo={motion.scale.row}
      haptic="selection"
    >
      {busy ? <ActivityIndicator size="small" color={filled ? theme.onPrimary : theme.ink} /> : (
        <>
          <Icon name={icon} size={15} color={filled ? theme.onPrimary : theme.ink} />
          <Text style={[type.labelXs, { color: filled ? theme.onPrimary : theme.ink }]}>{label.toUpperCase()}</Text>
        </>
      )}
    </SpringPressable>
  );
}

const makeStyles = (t) => StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 13, paddingHorizontal: 18, paddingVertical: 15,
    borderBottomWidth: stroke.ink, borderBottomColor: t.ink,
  },
  list: { width: '100%', maxWidth: 680, alignSelf: 'center', padding: 20, paddingBottom: 70 },
  card: { padding: 17, marginBottom: 18, backgroundColor: t.card },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  actions: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 9, marginTop: 17 },
  block: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 8, paddingVertical: 9 },
  error: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, padding: 10, marginHorizontal: 20, marginTop: 12 },
});

const styles = StyleSheet.create({
  requestButton: { minHeight: 38, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingVertical: 9, paddingHorizontal: 12 },
});
