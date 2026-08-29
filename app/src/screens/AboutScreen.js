import React from 'react';
import { View, Pressable, StyleSheet, ScrollView, Linking, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from '../icons/Icon';
import { useTheme } from '../store/ThemeContext';
import useResponsive from '../hooks/useResponsive';
import { PaperCard, TapeChip, MotionIn } from '../components/common';
import { type, inkBox } from '../theme';
import { Text } from '../components/Text';

/**
 * About +one — who made it and what it stands for.
 * Ink-and-paper styling matches the rest of the app: paper cards, sketched
 * boxes, mono labels. The team section introduces the real people behind
 * the product so the app never feels like it came from nowhere.
 */

const TEAM = [
  {
    name: 'Saksham',
    role: 'Founder',
    initials: 'S',
    icon: 'rocket-outline',
    tag: 'THE VISION KEEPER',
    bio: 'Saksham is the founder and the mind who dreamed up +one from nothing. He set the vision, sketched the soul of the product, and built the foundation everything else stands on — from the ink-and-paper look to the way chats, statuses and the Network feel like one living place. When something feels just right in this app, it is almost always because Saksham refused to ship it any other way. A relentless builder with a founder\u2019s eye for detail and a true believer in shipping real things that real people love.',
  },
  {
    name: 'Raees',
    role: 'Co-founder',
    initials: 'R',
    icon: 'sparkles-outline',
    tag: 'THE CO-PILOT',
    bio: 'Raees is the co-founder and Saksham\u2019s partner in turning an idea into an app. He sharpens every feature, keeps the build honest, and makes sure hard problems actually get solved — reliably, calmly, and without drama. Raees brings the steadiness every young product needs: equal parts builder, thinker and the person who says \u201cthere\u2019s a better way\u201d at exactly the right moment. A lot of +one\u2019s strength behind the scenes exists because Raees put it there.',
  },
  {
    name: 'Jai',
    role: 'Team member',
    initials: 'J',
    icon: 'construct-outline',
    tag: 'THE ALL-ROUNDER',
    bio: 'Jai is the team\u2019s all-rounder — the one who jumps wherever the work is and gets it done. Whether it\u2019s testing, fixing, polishing or pushing a feature over the finish line, Jai brings energy, curiosity and a can-do attitude to every corner of the app. Curious, dependable and always up for learning something new, Jai proves that great products are built by people who care about the small stuff too. The team would not move half as fast without him.',
  },
];

const VALUES = [
  { icon: 'heart-outline', title: 'Built for real people', text: '+one is made for everyday conversations — quick hellos, late-night group chats, the moments in between. No clutter, no noise, just the people who matter.' },
  { icon: 'sparkles-outline', title: 'Craft over shortcuts', text: 'Every screen is hand-drawn and hand-polished. The ink strokes, paper texture and motion details are there because someone cared enough to make them.' },
  { icon: 'people-outline', title: 'A small team, a big dream', text: 'Three people with a vision. No giant corporation, no endless committees — just founders and a friend building something they actually want to use.' },
];

export default function AboutScreen({ navigation, embedded = false }) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const { isTablet } = useResponsive();
  const s = makeStyles(theme);

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <View style={[s.header, !embedded && { paddingTop: 20 + insets.top }]}>
        {!!navigation?.goBack && (
          <Pressable onPress={() => navigation.goBack()} hitSlop={8} style={{ padding: 6 }}>
            <Icon name="arrow-back" size={22} color={theme.ink} />
          </Pressable>
        )}
        <Text style={[type.headlineMd, { color: theme.text }]}>About</Text>
      </View>

      <ScrollView contentContainerStyle={[s.scroll, isTablet && s.scrollWide]}>
        {/* Intro */}
        <MotionIn>
          <View style={s.intro}>
            <View style={[s.introBadge, inkBox(theme, 'ink')]}>
              <Icon name="information-circle-outline" size={28} color={theme.ink} />
            </View>
            <Text style={[type.headlineSm, { color: theme.text, marginTop: 14 }]}>
              The people behind +one
            </Text>
            <Text style={[type.bodySm, { color: theme.subtext, marginTop: 6, textAlign: 'center', lineHeight: 21 }]}>
              +one is a realtime messenger for chats, disappearing statuses, a public Network and communities. It was imagined, sketched and built by a tiny team who wanted a place that actually feels like your people — made in India, for everyone.
            </Text>
          </View>
        </MotionIn>

        {/* Team */}
        <Text style={[type.labelXs, { color: theme.muted, marginTop: 26, marginBottom: 10 }]}>MEET THE TEAM</Text>
        <View style={{ gap: 12 }}>
          {TEAM.map((member, i) => (
            <MotionIn key={member.name} delay={i * 80}>
              <PaperCard weight="thin" style={{ padding: 18 }}>
                <View style={s.memberRow}>
                  <View style={[s.avatar, inkBox(theme, 'ink')]}>
                    <Text style={s.avatarText}>{member.initials}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[type.bodyLg, { color: theme.text, fontFamily: type.body(700) }]}>{member.name}</Text>
                    <View style={s.roleRow}>
                      <Icon name={member.icon} size={13} color={theme.ink} />
                      <Text style={[s.roleText, { color: theme.ink }]}>{member.role}</Text>
                    </View>
                    <Text style={[type.labelXs, { color: theme.muted, marginTop: 3 }]}>{member.tag}</Text>
                  </View>
                </View>
                <Text style={[type.bodySm, { color: theme.subtext, lineHeight: 21, marginTop: 12 }]}>
                  {member.bio}
                </Text>
              </PaperCard>
            </MotionIn>
          ))}
        </View>

        {/* Values */}
        <Text style={[type.labelXs, { color: theme.muted, marginTop: 26, marginBottom: 10 }]}>WHAT WE STAND FOR</Text>
        <PaperCard weight="thin" style={{ padding: 16, gap: 14 }}>
          {VALUES.map((v) => (
            <View key={v.title} style={s.valueRow}>
              <View style={[s.valueIcon, inkBox(theme, 'thin')]}>
                <Icon name={v.icon} size={17} color={theme.ink} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[type.bodyStrong, { color: theme.text }]}>{v.title}</Text>
                <Text style={[type.bodySm, { color: theme.subtext, lineHeight: 20, marginTop: 2 }]}>{v.text}</Text>
              </View>
            </View>
          ))}
        </PaperCard>

        {/* Credit footer */}
        <View style={{ marginTop: 26, alignItems: 'center' }}>
          <TapeChip label="+ONE · SAKSHAMFIT" />
          <Text style={[type.labelXs, { color: theme.muted, marginTop: 10, textAlign: 'center', lineHeight: 16 }]}>
            Founded by Saksham · Co-founded by Raees · Team Jai
          </Text>
          <Pressable onPress={() => Linking.openURL('https://instagram.com/saxamfit')} hitSlop={8} style={{ marginTop: 6 }}>
            <Text style={[type.labelXs, { color: theme.muted, lineHeight: 16 }]}>
              {'FOLLOW THE JOURNEY ON INSTAGRAM · '}
              <Text style={{ color: theme.ink, textDecorationLine: 'underline' }}>@saxamfit</Text>
            </Text>
          </Pressable>
          <Text style={[type.labelXs, { color: theme.muted, marginTop: 10 }]}>
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
  memberRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  avatar: {
    width: 58, height: 58, borderRadius: 16,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarText: {
    fontFamily: type.head(800),
    fontSize: 24,
    color: t.ink,
    ...(Platform.OS === 'web' ? { userSelect: 'none' } : null),
  },
  roleRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  roleText: { fontFamily: type.mono(700), fontSize: 11, letterSpacing: 0.8, textTransform: 'uppercase' },
  valueRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  valueIcon: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
});
