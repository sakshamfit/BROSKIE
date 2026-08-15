import React from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native';
import Icon from '../icons/Icon';
import { EmojiText } from '../icons/Emoji';
import { useChat } from '../store/ChatContext';
import { useAuth } from '../store/AuthContext';
import { useTheme } from '../store/ThemeContext';
import { Avatar, lastSeenText, ClayCard, ClayBead, handleFor } from '../components/common';
import { radius, type, clayFor } from '../theme';
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
    <Pressable style={({ pressed }) => [s.row, pressed && { opacity: 0.7 }]} onPress={onPress}>
      <View style={[s.rowIcon, { backgroundColor: theme.cardAlt }]}>
        <Icon name={icon} size={19} color={theme.primary} />
      </View>
      <Text style={[type.bodyLg, { color: theme.text, fontFamily: type.fontFamily(500) }]}>{label}</Text>
    </Pressable>
  );

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <ScrollView contentContainerStyle={s.scroll}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={8} style={s.back}>
          <Icon name="arrow-back" size={23} color={theme.primary} />
        </Pressable>

        <ClayCard style={s.hero} level={2}>
          <Avatar uri={chat.avatar} name={chat.name} id={chat.otherUserId || chat.id} group={chat.type === 'group'} size={104} />
          <EmojiText style={[type.displayLg, { fontSize: 26, color: theme.text, marginTop: 18, textAlign: 'center' }]}>{chat.name}</EmojiText>
          {chat.type === 'direct' ? (
            <Text style={[type.labelMd, { color: theme.primary, marginTop: 6, letterSpacing: 0.4 }]}>
              {handleFor(chat.name)}
            </Text>
          ) : null}
          <Text style={[type.bodySm, { color: theme.subtext, marginTop: 8, textAlign: 'center' }]}>
            {chat.type === 'group' ? `Group · ${chat.members.length} participants` : lastSeenText(chat.isOnline, chat.lastSeen)}
          </Text>
        </ClayCard>

        {chat.type === 'direct' && !!chat.about && (
          <ClayCard>
            <Text style={[type.labelMd, { color: theme.muted, marginBottom: 8 }]}>ABOUT</Text>
            <EmojiText style={[type.bodyLg, { color: theme.text }]}>{chat.about}</EmojiText>
          </ClayCard>
        )}

        <ClayCard style={{ padding: 10 }}>
          <Row icon={chat.muted ? 'volume-mute' : 'notifications-outline'} label={chat.muted ? 'Unmute notifications' : 'Mute notifications'} onPress={toggleMute} />
          <Row icon="archive-outline" label={chat.archived ? 'Unarchive chat' : 'Archive chat'} onPress={toggleArchive} />
        </ClayCard>

        {chat.type === 'group' && (
          <ClayCard>
            <Text style={[type.labelMd, { color: theme.muted, marginBottom: 14 }]}>
              {chat.members.length} PARTICIPANTS
            </Text>
            <View style={{ gap: 16 }}>
              {chat.members.map((m) => (
                <View key={m.id} style={s.memberRow}>
                  <Avatar uri={m.avatar} name={m.name} id={m.id} size={46} online={m.isOnline} />
                  <View style={{ flex: 1 }}>
                    <EmojiText style={[type.bodyLg, { color: theme.text, fontFamily: type.fontFamily(500) }]}>
                      {m.id === user.id ? 'You' : m.name}
                    </EmojiText>
                    <Text style={[type.labelMd, { color: theme.primary, marginTop: 2, letterSpacing: 0.3 }]}>
                      {handleFor(m.name, m.phone)}
                    </Text>
                  </View>
                  {m.role === 'admin' && <ClayBead label="Admin" color={theme.accent} textColor={theme.onAccent} small />}
                </View>
              ))}
            </View>
          </ClayCard>
        )}
      </ScrollView>
    </View>
  );
}

const makeStyles = (t) => StyleSheet.create({
  scroll: { padding: 20, paddingTop: 16, paddingBottom: 40, gap: 20 },
  back: { padding: 6, alignSelf: 'flex-start' },
  hero: { alignItems: 'center', paddingVertical: 32 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingHorizontal: 12, paddingVertical: 14 },
  rowIcon: { width: 42, height: 42, borderRadius: radius.full, alignItems: 'center', justifyContent: 'center' },
  memberRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
});
