import React, { useEffect } from 'react';
import {
  View, Text, Pressable, StyleSheet, ScrollView, Image, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Defs, Path, Pattern, Rect } from 'react-native-svg';
import Icon from '../icons/Icon';
import { useTheme } from '../store/ThemeContext';
import useResponsive from '../hooks/useResponsive';
import { TapeChip, InkButton } from '../components/common';
import { type, inkBox, pencilBox, raised, stroke } from '../theme';

const HERO_STILL = require('../../assets/landing/hero-still.jpg');
const INK_WASH = require('../../assets/landing/ink-wash.jpg');
const KINETIC = require('../../assets/landing/kinetic-void.jpg');
const LOGO = require('../../assets/icon.png');

const FEATURES = [
  { icon: 'chatbubbles-outline', title: 'Realtime chat', body: '1:1 and groups. Replies, edit, forward, delete-for-everyone, reactions, images, and voice notes with a waveform.' },
  { icon: 'checkmark-done', title: 'Ticks that tell the truth', body: 'Sent, delivered, read. Typing, last-seen, unread beads. Receipts catch up the moment someone reconnects.' },
  { icon: 'mail-unread-outline', title: 'Message requests', body: 'First notes from outside your contacts land in Requests. Accept, delete, or block before they touch the inbox.' },
  { icon: 'videocam-outline', title: 'Voice & video', body: 'Real 1:1 WebRTC calling on the same socket. Ring, mute, hang up, and a Calls tab to dial back.' },
  { icon: 'timer-outline', title: 'Disappearing ink', body: '30s / 5m / 1h / 24h on a chat or a single line. Expired messages are hard-deleted on every device.' },
  { icon: 'bar-chart-outline', title: 'Polls in groups', body: 'A question and two to six options, live bars, live counts. Change your vote and watch it move.' },
  { icon: 'globe-outline', title: 'The Network', body: 'A public worldwide feed. Photos keep the crop you chose. Likes, comments, tags, communities.' },
  { icon: 'school-outline', title: 'Colleagues', body: 'Find people through a college, workplace or organisation you already share. Request, accept, chat.' },
  { icon: 'eye-outline', title: 'See — stories', body: 'Coloured text statuses, viewed rings, tap-through progress. They expire with the day.' },
];

function readStartParam() {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return null;
  try {
    const start = new URLSearchParams(window.location.search).get('start');
    return start === 'login' || start === 'register' ? start : null;
  } catch {
    return null;
  }
}

export default function LandingScreen({ navigation }) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const { width, isSplitCapable } = useResponsive();
  const s = makeStyles(theme);
  const wide = isSplitCapable || width >= 840;

  useEffect(() => {
    const start = readStartParam();
    if (start) navigation.replace('Auth', { mode: start, fromLanding: true });
  }, [navigation]);

  const open = (mode) => navigation.navigate('Auth', { mode, fromLanding: true });

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      <PaperGrain />
      <ScrollView
        contentContainerStyle={[s.scroll, { paddingBottom: 64 + insets.bottom }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={s.nav}>
          <View style={s.brand}>
            <Image source={LOGO} style={s.logo} />
            <Text style={s.wordmark}>+one</Text>
          </View>
          <Pressable onPress={() => open('login')} style={({ pressed }) => [s.navBtn, inkBox(theme, 'ink'), pressed && { backgroundColor: theme.highlighter }]}>
            <Text style={[type.labelSm, { color: theme.ink }]}>SIGN IN</Text>
          </Pressable>
        </View>

        <View style={[s.hero, wide && s.heroWide]}>
          <View style={s.heroCopy}>
            <View style={s.chipRow}>
              <TapeChip label="AN INK-AND-PAPER MESSENGER" tone="accent" />
              <TapeChip label="V1.2" />
              <TapeChip label="IOS · ANDROID · WEB" />
            </View>
            <Text style={s.headline}>Find your{'\n'}+ones.</Text>
            <View style={[s.brush, { backgroundColor: theme.ink }]} />
            <Text style={[type.bodyLg, { color: theme.subtext, maxWidth: 560, marginTop: 8 }]}>
              A realtime messenger drawn like a sketchbook. Chats that feel handwritten.
              A public Network. Colleagues from the places you actually share.
              Voice, video, stories — and a daily greeting that knows the weather.
            </Text>
            <View style={s.ctaRow}>
              <InkButton label="Create a One ID" filled onPress={() => open('register')} />
              <InkButton label="Sign in" onPress={() => open('login')} />
            </View>
            <Text style={[type.labelXs, { color: theme.muted }]}>
              NO SEED ACCOUNTS. NO FAKE FRIENDS. JUST PEOPLE WHO SHOW UP.
            </Text>
          </View>

          <View style={s.heroVisual}>
            <Image source={HERO_STILL} style={s.heroImage} />
            <PhonePreview theme={theme} />
          </View>
        </View>

        <View style={s.marquee}>
          <Text style={s.marqueeText} numberOfLines={1}>
            REALTIME CHAT  +  GROUPS & POLLS  +  THE NETWORK  +  COLLEAGUES  +  COMMUNITIES  +  VOICE & VIDEO  +  SEE  +  DISAPPEARING INK  +  DAILY AI GREETING
          </Text>
        </View>

        <View style={s.section}>
          <Text style={[type.labelSm, { color: theme.graphite }]}>THE WHOLE ROLL</Text>
          <Text style={s.sectionTitle}>Everything a messenger needs. Nothing a sketchbook wouldn’t allow.</Text>
          <View style={[s.featGrid, wide && s.featGridWide]}>
            {FEATURES.map((feat, i) => (
              <View
                key={feat.title}
                style={[
                  s.featCard,
                  wide && s.featCardWide,
                  i % 3 === 2 ? inkBox(theme, 'ink') : pencilBox(theme),
                  raised(theme, 1),
                  { transform: [{ rotate: i % 2 ? '0.5deg' : '-0.6deg' }] },
                ]}
              >
                <View style={[s.featIco, inkBox(theme, 'thin')]}>
                  <Icon name={feat.icon} size={18} color={theme.ink} />
                </View>
                <Text style={[type.headlineSm, { color: theme.text }]}>{feat.title}</Text>
                <Text style={[type.bodySm, { color: theme.subtext }]}>{feat.body}</Text>
              </View>
            ))}
          </View>
        </View>

        <View style={[s.section, s.dive, wide && s.diveWide]}>
          <View style={s.diveCopy}>
            <TapeChip label="THE NETWORK" tone="accent" />
            <Text style={s.sectionTitle}>A public page the whole world can pin things to.</Text>
            <Text style={[type.bodyLg, { color: theme.subtext }]}>
              Post text, a photograph, a song, a tag. Keep the crop you chose.
              Likes and threaded comments update live. Communities for club nights, trips, chai, runs.
            </Text>
          </View>
          <Image source={INK_WASH} style={[s.diveImage, inkBox(theme, 'ink'), raised(theme, 2)]} />
        </View>

        <View style={[s.section, s.dive, wide && s.diveWide]}>
          <Image source={HERO_STILL} style={[s.diveImage, inkBox(theme, 'ink'), raised(theme, 2)]} />
          <View style={s.diveCopy}>
            <TapeChip label="COLLEAGUES" />
            <Text style={s.sectionTitle}>Find people through the places you already share.</Text>
            <Text style={[type.bodyLg, { color: theme.subtext }]}>
              Add a college, institution or workplace. Search its members. Send a request.
              Accepted colleagues become contacts — and a chat opens immediately.
            </Text>
          </View>
        </View>

        <View style={s.section}>
          <Text style={[type.labelSm, { color: theme.graphite }]}>GRAPHITE & PULP</Text>
          <Text style={s.sectionTitle}>No shadows-as-elevation. Depth is a thicker line.</Text>
          <View style={[s.themeGrid, wide && s.themeGridWide]}>
            <ThemeCard theme={theme} name="Light" note="Warm pulp, India ink, graphite rules." swatch={theme.bg} ink={theme.ink} />
            <ThemeCard theme={theme} name="Dark" note="Ink-on-slate. Chalk letters, highlighter ticks." swatch="#1c1b1b" ink="#f4f0ef" />
            <ThemeCard theme={theme} name="Kinetic Ink" note="Manga-tech. Cyan action, red for what matters." image={KINETIC} ink="#dbfcff" />
          </View>
        </View>

        <View style={[s.finale, inkBox(theme, 'bold'), raised(theme, 2)]}>
          <Image source={INK_WASH} style={s.finaleWash} />
          <TapeChip label="READY WHEN YOU ARE" tone="accent" />
          <Text style={s.finaleTitle}>Let’s find the +ones.</Text>
          <Text style={[type.bodyLg, { color: theme.subtext, maxWidth: 520 }]}>
            Create a One ID. Add a place. Write to someone. The first page is yours.
          </Text>
          <View style={s.ctaRow}>
            <InkButton label="Create a One ID" filled onPress={() => open('register')} />
            <InkButton label="I already have one" onPress={() => open('login')} />
          </View>
        </View>

        <View style={s.footer}>
          <View style={s.brand}>
            <Image source={LOGO} style={[s.logo, { width: 32, height: 32 }]} />
            <Text style={[s.wordmark, { fontSize: 22 }]}>+one</Text>
          </View>
          <Text style={[type.bodySm, { color: theme.muted, maxWidth: 420 }]}>
            An original ink-and-paper messenger. Not affiliated with WhatsApp. MIT · v1.2.0
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

function ThemeCard({ theme, name, note, swatch, ink, image }) {
  return (
    <View style={[styles.themeCard, inkBox(theme, 'ink'), raised(theme, 1)]}>
      {image ? (
        <Image source={image} style={styles.themeSwatch} />
      ) : (
        <View style={[styles.themeSwatch, { backgroundColor: swatch, justifyContent: 'flex-end', padding: 14 }]}>
          <Text style={{ fontFamily: type.head(800), fontSize: 26, fontStyle: 'italic', color: ink }}>+one</Text>
        </View>
      )}
      <View style={{ padding: 16, gap: 6 }}>
        <Text style={[type.headlineSm, { color: theme.text }]}>{name}</Text>
        <Text style={[type.bodySm, { color: theme.subtext }]}>{note}</Text>
      </View>
    </View>
  );
}

function PhonePreview({ theme }) {
  return (
    <View style={[styles.phone, raised(theme, 2)]}>
      <View style={styles.phoneNotch} />
      <View style={styles.phoneBar}>
        <Text style={styles.phoneWord}>+one</Text>
        <Text style={[type.labelXs, { color: '#fdf8f8' }]}>REQUESTS</Text>
      </View>
      <View style={styles.tile}>
        <View style={styles.av}><Text style={styles.avT}>MY</Text></View>
        <View style={{ flex: 1 }}>
          <Text style={styles.tileName}>Maya</Text>
          <Text style={styles.tileLive}>typing…</Text>
        </View>
      </View>
      <View style={[styles.tile, { borderColor: '#000', transform: [{ rotate: '0.2deg' }] }]}>
        <View style={styles.av}><Text style={styles.avT}>SC</Text></View>
        <View style={{ flex: 1 }}>
          <Text style={styles.tileName}>Studio crew</Text>
          <Text style={styles.tilePrev}>Friday critique — in or out?</Text>
        </View>
      </View>
    </View>
  );
}

function PaperGrain() {
  const { theme } = useTheme();
  return (
    <View pointerEvents="none" style={styles.grain}>
      <Svg width="100%" height="100%">
        <Defs>
          <Pattern id="land-grid" width="28" height="28" patternUnits="userSpaceOnUse">
            <Path d="M0 0.7 C7 0.1 19 1.1 28 0.55 M0.65 0 C0.15 8 1.05 20 0.55 28" fill="none" stroke={theme.graphiteLine} strokeWidth="0.55" />
          </Pattern>
        </Defs>
        <Rect width="100%" height="100%" fill="url(#land-grid)" opacity="0.45" />
        <Circle cx="38" cy="31" r="0.6" fill={theme.graphite} />
      </Svg>
    </View>
  );
}

const makeStyles = (t) => StyleSheet.create({
  root: { flex: 1, backgroundColor: t.bg },
  scroll: { paddingHorizontal: 20 },
  nav: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 16, borderBottomWidth: stroke.ink, borderBottomColor: t.ink, marginBottom: 28,
  },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  logo: { width: 36, height: 36, borderRadius: 8, borderWidth: 2, borderColor: t.ink },
  wordmark: { ...type.headlineMd, color: t.text, fontStyle: 'italic', letterSpacing: -0.5 },
  navBtn: { paddingHorizontal: 12, paddingVertical: 9, backgroundColor: t.card },

  hero: { gap: 28, marginBottom: 36 },
  heroWide: { flexDirection: 'row', alignItems: 'center', gap: 40 },
  heroCopy: { flex: 1, gap: 14 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  headline: { ...type.headlineLg, fontSize: 52, lineHeight: 54, color: t.text, transform: [{ rotate: '-1deg' }] },
  brush: { height: 5, width: 180, borderRadius: 5, transform: [{ rotate: '-1.2deg' }] },
  ctaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 6 },
  heroVisual: { flex: 1, minHeight: 280, position: 'relative' },
  heroImage: {
    width: '100%', height: 240, borderWidth: 2, borderColor: t.ink,
    transform: [{ rotate: '-1.4deg' }],
  },

  marquee: {
    backgroundColor: t.ink, paddingVertical: 12, paddingHorizontal: 8, marginHorizontal: -20, marginBottom: 36,
  },
  marqueeText: { ...type.labelSm, color: t.highlighter, letterSpacing: 1.6, textAlign: 'center' },

  section: { marginBottom: 48, gap: 14 },
  sectionTitle: { ...type.headlineMd, color: t.text, maxWidth: 640, transform: [{ rotate: '-0.6deg' }] },
  featGrid: { gap: 16, marginTop: 8 },
  featGridWide: { flexDirection: 'row', flexWrap: 'wrap' },
  featCard: { padding: 18, gap: 8, backgroundColor: t.card, width: '100%' },
  featCardWide: { width: '31%', minWidth: 220, flexGrow: 1 },
  featIco: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center' },

  dive: { gap: 22 },
  diveWide: { flexDirection: 'row', alignItems: 'center' },
  diveCopy: { flex: 1, gap: 12 },
  diveImage: { flex: 1, width: '100%', height: 240 },

  themeGrid: { gap: 16, marginTop: 8 },
  themeGridWide: { flexDirection: 'row' },

  finale: { padding: 28, gap: 14, overflow: 'hidden', marginBottom: 36, backgroundColor: t.card },
  finaleWash: { ...StyleSheet.absoluteFillObject, opacity: 0.18 },
  finaleTitle: { ...type.headlineLg, color: t.text, maxWidth: 420 },

  footer: { gap: 10, paddingTop: 8, borderTopWidth: 1, borderTopColor: t.graphiteLine },
});

const styles = StyleSheet.create({
  grain: { ...StyleSheet.absoluteFillObject, opacity: 0.35 },
  themeCard: { flex: 1, overflow: 'hidden', backgroundColor: '#fdf8f8' },
  themeSwatch: { width: '100%', height: 140 },
  phone: {
    position: 'absolute', right: 8, bottom: -28, width: 196,
    backgroundColor: '#fdf8f8', borderWidth: 3, borderColor: '#000',
    borderRadius: 22, padding: 10, paddingTop: 18, gap: 8,
    transform: [{ rotate: '3deg' }],
  },
  phoneNotch: { position: 'absolute', top: 8, alignSelf: 'center', width: 54, height: 6, backgroundColor: '#000', borderRadius: 99, left: '50%', marginLeft: -27 },
  phoneBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingBottom: 6, borderBottomWidth: 2, borderBottomColor: '#000' },
  phoneWord: { fontFamily: 'Bricolage_700Bold', fontStyle: 'italic', fontSize: 16, color: '#1c1b1b' },
  tile: {
    backgroundColor: '#090909', borderWidth: 2, borderColor: '#FFE24D',
    borderRadius: 10, padding: 8, flexDirection: 'row', gap: 8, alignItems: 'center',
  },
  av: { width: 28, height: 28, borderRadius: 14, borderWidth: 1.5, borderColor: '#fdf8f8', alignItems: 'center', justifyContent: 'center' },
  avT: { color: '#fdf8f8', fontFamily: 'Bricolage_700Bold', fontSize: 9 },
  tileName: { color: '#fdf8f8', fontFamily: 'Bricolage_700Bold', fontSize: 12 },
  tileLive: { color: '#FFE24D', fontStyle: 'italic', fontSize: 11 },
  tilePrev: { color: '#bdb9b7', fontSize: 11 },
});
