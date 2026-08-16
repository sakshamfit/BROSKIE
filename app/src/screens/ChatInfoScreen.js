import React from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native';
import Icon from '../icons/Icon';
import { EmojiText } from '../icons/Emoji';
import { useChat } from '../store/ChatContext';
import { useAuth } from '../store/AuthContext';
import { useTheme } from '../store/ThemeContext';
import { Avatar, lastSeenText, PaperCard, TapeChip, handleFor, Rule } from '../components/common';
import { radius, type, inkBox, marker, dashedRule } from '../theme';
import { api } from '../api';

export default function ChatInfoScreen({ route, navigation }) {
  const { chatId } = route.params;
  const { chats, refreshChats } = useChat();
  const { user } = useAuth();
  const { theme } = useTheme();
  const chat = chats.find((c) => c.id === chatId);
  const s = makeStyles(theme);

  if (!chat) return <View style={{ flex: 1, backgroundColor: theme.bg }} />;

  const toggleMute = async () => { await api.mute(chatId, !chat.muted); refreshChats(); };
  const toggleArchive = async () => { await api.archive(chatId, !chat.archived); refreshChats(); navigation.goBack(); };

  const Row = ({ icon, label, onPress }) => (
    <Pressable style={({ pressed }) => [s.row, pressed && marker(theme, 1)]} onPress={onPress}>
      <Icon name={icon} size={19} color={theme.ink} style={{ width: 26 }} />
      <Text style={[type.bodyMd, { color: theme.text }]}>{label}</Text>
    </Pressable>
  );

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <ScrollView contentContainerStyle={s.scroll}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={8} style={s.back}>
          <Icon name="arrow-back" size={22} color={theme.ink} />
        </Pressable>

        <PaperCard style={s.hero} weight="ink">
          <Avatar uri={chat.avatar} name={chat.name} id={chat.otherUserId || chat.id} group={chat.type === 'group'} size={104} />
          <EmojiText style={[type.headlineMd, { color: theme.text, marginTop: 16, textAlign: 'center' }]}>{chat.name}</EmojiText>
          {chat.type === 'direct' ? (
            <Text style={[type.labelSm, { color: theme.graphite, marginTop: 6 }]}>
              {handleFor(chat)}
            </Text>
          ) : null}
          <Text style={[type.bodySm, { color: theme.subtext, marginTop: 8, textAlign: 'center' }]}>
            {chat.type === 'group' ? `Group · ${chat.members.length} participants` : lastSeenText(chat.isOnline, chat.lastSeen)}
          </Text>
        </PaperCard>

        {chat.type === 'direct' && !!chat.about && (
          <PaperCard>
            <Text style={[type.labelXs, { color: theme.muted, marginBottom: 8 }]}>ABOUT</Text>
            <EmojiText style={[type.bodyLg, { color: theme.text }]}>{chat.about}</EmojiText>
          </PaperCard>
        )}

        <PaperCard style={{ padding: 6 }}>
          <Row icon={chat.muted ? 'volume-mute' : 'notifications-outline'} label={chat.muted ? 'Unmute notifications' : 'Mute notifications'} onPress={toggleMute} />
          <Row icon="archive-outline" label={chat.archived ? 'Unarchive chat' : 'Archive chat'} onPress={toggleArchive} />
        </PaperCard>

        {chat.type === 'group' && (
          <PaperCard>
            <Text style={[type.labelXs, { color: theme.muted, marginBottom: 14 }]}>
              {chat.members.length} PARTICIPANTS
            </Text>
            <View style={{ gap: 16 }}>
              {chat.members.map((m) => (
                <View key={m.id} style={s.memberRow}>
                  <Avatar uri={m.avatar} name={m.name} id={m.id} size={46} online={m.isOnline} />
                  <View style={{ flex: 1 }}>
                    <EmojiText style={[type.bodyMd, { color: theme.text }]}>
                      {m.id === user.id ? 'You' : m.name}
                    </EmojiText>
                    <Text style={[type.labelXs, { color: theme.graphite, marginTop: 2 }]}>
                      {handleFor(m)}
                    </Text>
                  </View>
                  {m.role === 'admin' && <TapeChip label="ADMIN" tone="accent" />}
                </View>
              ))}
            </View>
          </PaperCard>
        )}
      </ScrollView>
    </View>
  );
}

const makeStyles = (t) => StyleSheet.create({
  scroll: { padding: 20, paddingTop: 16, paddingBottom: 40, gap: 20 },
  back: { padding: 6, alignSelf: 'flex-start' },
  hero: { alignItems: 'center', paddingVertical: 28 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 12, paddingVertical: 13 },
  memberRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
});
