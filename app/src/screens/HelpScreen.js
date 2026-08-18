import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView, LayoutAnimation, Platform, UIManager } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from '../icons/Icon';
import { useTheme } from '../store/ThemeContext';
import useResponsive from '../hooks/useResponsive';
import { PaperCard, TapeChip, Rule } from '../components/common';
import { radius, type, inkBox, marker, dashedRule } from '../theme';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

/**
 * A real, substantive Help & Guide — not a placeholder. Explains every key
 * feature of +one with plain-language "how to" steps: Chats, See (Status),
 * The Network + Communities, Settings/Privacy, plus a short FAQ. Built as
 * an expandable-sections layout (tap a topic to open it) so it stays
 * scannable on a phone instead of one giant wall of text.
 */
const TOPICS = [
  {
    key: 'chats',
    icon: 'chatbubbles-outline',
    title: 'Chats',
    summary: '1:1 and group messaging, photos, voice notes, reactions',
    body: [
      { h: 'Starting a conversation', p: 'Tap the pencil (bottom-right FAB) on the Chats tab, then pick a person to message directly, or tap the group icon in the top-right to start a group with multiple people.' },
      { h: 'Message requests', p: 'A first message from someone outside your accepted contacts appears under REQUESTS at the top-right of Chats instead of entering your main inbox. Preview it, then Accept & chat, Delete, or Block the sender.' },
      { h: 'Sending things', p: 'Type a message and hit send, or use the camera/photo icon to attach an image. Tap the mic to begin a real voice recording, tap the checkmark to upload and send it, or tap Cancel to discard it.' },
      { h: 'Replies & reactions', p: 'Swipe or long-press a message to reply to it, react with an emoji, or delete your own message. Long-press a chat in the list to archive or unarchive it.' },
      { h: 'Read receipts & typing', p: 'A single check means sent, two greyed checks mean delivered, and two highlighted checks mean read. You\u2019ll see "typing…" live while the other person is composing a reply. Turn off read receipts in Settings \u2192 Privacy if you\u2019d rather not send or see them.' },
      { h: 'Chat list actions', p: 'Long-press a chat to open the blurred actions panel. You can pin, mute, archive, mark read, or Delete chat. Delete chat clears that history only for you; other members keep it, and a later message restores the thread with only new history.' },
      { h: 'Blocking someone', p: 'From that same chat info screen, tap Block. A blocked contact can\u2019t message you and neither of you will see each other\u2019s Status or Network posts anymore — manage the full list from Settings \u2192 Privacy \u2192 Blocked Contacts.' },
    ],
  },
  {
    key: 'see',
    icon: 'eye-outline',
    title: 'See (Status)',
    summary: '24-hour updates, discover feed, songs & photos',
    body: [
      { h: 'Posting a status', p: 'Use the camera or pencil button in See. Photo updates open a frame and crop editor first, then show the exact posting preview with an editable caption. Text updates have switchable backgrounds. Every update disappears after 24 hours.' },
      { h: 'Who can see it', p: 'Before sending, tap the privacy pill to choose Public, My friends, My friends except…, or Only share with…. Inclusion and exclusion lists are enforced by the server, not just hidden in the app.' },
      { h: 'Viewing others\u2019', p: 'Recent and viewed updates appear in separate lists. Tap a person to open the full-screen viewer; tap the left or right side to move through updates, or let them advance automatically.' },
    ],
  },
  {
    key: 'network',
    icon: 'people-outline',
    title: 'The Network',
    summary: 'Public posts, tags, and purpose-based Communities',
    body: [
      { h: 'Posting', p: 'Tap the pencil FAB on the Network tab to write a post — attach a photo, a song, or a #tag, and choose Public / Friends / Selected people. Photos offer Original, Square, Portrait, Wide and Story frames, followed by the native crop editor.' },
      { h: 'Liking & commenting', p: 'Tap the heart to like a post, or the speech bubble to open comments. Tap any #tag chip (yours or someone else\u2019s) to filter the feed to just that tag.' },
      { h: 'Communities', p: 'Switch to the COMMUNITIES tab at the top of Network to create or join purpose-based groups \u2014 Club Night, House Party, Chai Chat, Trip Planning, Running Group, Game Night, Study Group, or something custom.' },
      { h: 'Finding colleagues', p: 'Open the COLLEAGUES tab, then add or join your college, institution, organization, or workplace. People who register the same place appear as colleague cards. Send a connection request; once they accept, tap Message to start a direct chat.' },
      { h: 'Who can join a community', p: 'When you create one, pick: Open (anyone joins instantly), Ask to join (an admin must approve each request), or Invite only (not self-joinable \u2014 an admin adds people directly). Every community gets its own real group chat automatically, so members can talk right away.' },
      { h: 'Running a community', p: 'As an admin, open a community\u2019s detail page to approve/decline pending requests, promote or remove members, edit its details, or disband it entirely.' },
    ],
  },
  {
    key: 'settings',
    icon: 'settings-outline',
    title: 'Settings & your profile',
    summary: 'Profile, account, notifications, privacy, appearance',
    body: [
      { h: 'Profile photo & info', p: 'Tap your avatar at the top of Settings to change your photo. Personal Information lets you edit your name, unique @username, about text, and phone number, and add the colleges, organizations, or workplaces used for colleague discovery.' },
      { h: 'Security', p: 'Change your password from Settings \u2192 Security & Privacy \u2192 Change Password. This app currently uses a single long-lived session per login (no multi-device session list yet).' },
      { h: 'Deleting your One ID', p: 'Settings \u2192 Danger Zone \u2192 Delete One ID permanently removes the account after the current password is verified. Shared groups, communities and institutions transfer safely to remaining members.' },
      { h: 'Notifications', p: 'Settings \u2192 Notifications lets you control, independently: chat messages (and whether previews show the actual text), Status updates, Network posts, and community activity like join requests \u2014 plus a sound on/off switch.' },
      { h: 'Privacy', p: 'Settings \u2192 Privacy controls who can see your last-seen/online dot (Everyone, My contacts, or Nobody), whether you send & see read receipts, and your full list of blocked contacts.' },
      { h: 'Appearance', p: 'Choose Light, Dark, or System (follows your device\u2019s OS theme automatically) \u2014 with a live preview of the exact colors and type scale before you pick.' },
    ],
  },
];

const FAQ = [
  { q: 'Is my data private?', a: '+one stores your account, messages, statuses and posts on the server so features like search and read receipts work. Data is not end-to-end encrypted in transit between clients \u2014 it travels over HTTPS to the server, which stores it and relays it to recipients. Treat it accordingly: it\u2019s a real working messenger, not a zero-knowledge service.' },
  { q: 'Why did a status/post disappear?', a: 'Status updates always expire after 24 hours by design. A post or status can also vanish from your feed if its author changed its visibility to Friends/Selected and you\u2019re no longer eligible to see it, or if you\u2019ve blocked \u2014 or been blocked by \u2014 that person.' },
  { q: 'Can I recover a deleted message or post?', a: 'No \u2014 deletions are permanent. A deleted chat message shows "message deleted" to other participants but the content is gone server-side.' },
  { q: 'Why can\u2019t I see someone\u2019s online status?', a: 'They\u2019ve likely set their Last Seen privacy to "My contacts" or "Nobody" in Settings \u2192 Privacy. Note that this is mutual for last-seen and fully mutual for read receipts \u2014 hiding yours also hides theirs from you.' },
  { q: 'How do voice/video calls work?', a: '1:1 calls are real WebRTC on desktop web browsers (audio and video, signalled through the server). On the iOS/Android app, ringing, accept/decline and call history work, but live media capture needs a custom dev build with react-native-webrtc \u2014 so on phones the call connects over the network only when both sides are on a browser.' },
  { q: 'I forgot my password.', a: 'There\u2019s no self-serve password reset yet in this build. If you forget your password, contact whoever operates your server \u2014 an admin can reset it for you.' },
];

export default function HelpScreen({ navigation, embedded = false }) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const { isTablet } = useResponsive();
  const s = makeStyles(theme);
  const [openTopic, setOpenTopic] = useState('chats');
  const [openFaq, setOpenFaq] = useState(null);

  const toggleTopic = (key) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setOpenTopic((prev) => (prev === key ? null : key));
  };
  const toggleFaq = (i) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setOpenFaq((prev) => (prev === i ? null : i));
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <View style={[s.header, !embedded && { paddingTop: 20 + insets.top }]}>
        {!!navigation?.goBack && (
          <Pressable onPress={() => navigation.goBack()} hitSlop={8} style={{ padding: 6 }}>
            <Icon name="arrow-back" size={22} color={theme.ink} />
          </Pressable>
        )}
        <Text style={[type.headlineMd, { color: theme.text }]}>Help &amp; Guide</Text>
      </View>

      <ScrollView contentContainerStyle={[s.scroll, isTablet && s.scrollWide]}>
        <View style={s.intro}>
          <View style={[s.introBadge, inkBox(theme, 'ink')]}>
            <Icon name="bulb-outline" size={26} color={theme.ink} />
          </View>
          <Text style={[type.headlineSm, { color: theme.text, marginTop: 14 }]}>
            Everything you need to know about +one
          </Text>
          <Text style={[type.bodySm, { color: theme.subtext, marginTop: 6, textAlign: 'center' }]}>
            {'Tap a topic below to expand it. +one is a realtime messenger for Chats, disappearing Status updates, a public Network feed, Communities, and colleague discovery.'}
          </Text>
        </View>

        <Text style={[type.labelXs, { color: theme.muted, marginTop: 26, marginBottom: 10 }]}>KEY FEATURES</Text>
        <View style={{ gap: 10 }}>
          {TOPICS.map((t) => {
            const open = openTopic === t.key;
            return (
              <PaperCard key={t.key} style={{ padding: 0, overflow: 'hidden' }} weight={open ? 'ink' : 'thin'}>
                <Pressable onPress={() => toggleTopic(t.key)} style={({ pressed }) => [s.topicHead, pressed && marker(theme, 1)]}>
                  <View style={[s.topicIcon, inkBox(theme, 'thin')]}>
                    <Icon name={t.icon} size={18} color={theme.ink} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[type.bodyLg, { color: theme.text, fontFamily: type.body(700) }]}>{t.title}</Text>
                    <Text style={[type.bodySm, { color: theme.subtext, marginTop: 2 }]}>{t.summary}</Text>
                  </View>
                  <Icon name={open ? 'chevron-forward-outline' : 'chevron-down-outline'} size={16} color={theme.muted} style={{ transform: [{ rotate: open ? '-90deg' : '0deg' }] }} />
                </Pressable>

                {open && (
                  <View style={s.topicBody}>
                    <View style={[dashedRule(theme), { marginBottom: 14 }]} />
                    {t.body.map((section, i) => (
                      <View key={i} style={i > 0 ? { marginTop: 14 } : null}>
                        <Text style={[type.bodyStrong, { color: theme.text, marginBottom: 4 }]}>{section.h}</Text>
                        <Text style={[type.bodySm, { color: theme.subtext, lineHeight: 20 }]}>{section.p}</Text>
                      </View>
                    ))}
                  </View>
                )}
              </PaperCard>
            );
          })}
        </View>

        <Text style={[type.labelXs, { color: theme.muted, marginTop: 26, marginBottom: 10 }]}>FREQUENTLY ASKED</Text>
        <View style={{ gap: 8 }}>
          {FAQ.map((f, i) => {
            const open = openFaq === i;
            return (
              <PaperCard key={i} style={{ padding: 0, overflow: 'hidden' }} weight={open ? 'ink' : 'thin'}>
                <Pressable onPress={() => toggleFaq(i)} style={({ pressed }) => [s.faqHead, pressed && marker(theme, 1)]}>
                  <Text style={[type.bodyMd, { color: theme.text, flex: 1, fontFamily: type.body(700) }]}>{f.q}</Text>
                  <Icon name={open ? 'chevron-forward-outline' : 'chevron-down-outline'} size={15} color={theme.muted} style={{ transform: [{ rotate: open ? '-90deg' : '0deg' }] }} />
                </Pressable>
                {open && (
                  <View style={s.faqBody}>
                    <Text style={[type.bodySm, { color: theme.subtext, lineHeight: 20 }]}>{f.a}</Text>
                  </View>
                )}
              </PaperCard>
            );
          })}
        </View>

        <View style={{ marginTop: 26, alignItems: 'center' }}>
          <TapeChip label="+ONE · GRAPHITE & PULP" />
          <Text style={[type.labelXs, { color: theme.muted, marginTop: 10, textAlign: 'center' }]}>
            Not affiliated with WhatsApp.
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

const makeStyles = (t) => StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingHorizontal: 20, paddingTop: 20, paddingBottom: 14 },
  scroll: { padding: 20, paddingBottom: 40 },
  scrollWide: { maxWidth: 620, width: '100%', alignSelf: 'center' },
  intro: { alignItems: 'center', paddingVertical: 8 },
  introBadge: { width: 60, height: 60, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  topicHead: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16 },
  topicIcon: { width: 38, height: 38, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  topicBody: { paddingHorizontal: 16, paddingBottom: 16 },
  faqHead: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14 },
  faqBody: { paddingHorizontal: 14, paddingBottom: 14 },
});
