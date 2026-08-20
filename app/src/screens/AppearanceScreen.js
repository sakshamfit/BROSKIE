import React from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from '../icons/Icon';
import { useTheme } from '../store/ThemeContext';
import useResponsive from '../hooks/useResponsive';
import { PaperCard } from '../components/common';
import { type, inkBox, marker, lightTheme, darkTheme, kineticInkTheme } from '../theme';

const SYSTEM_SETTING_NAME = Platform.select({
  ios: 'your iOS Display & Brightness setting',
  android: 'your Android system theme',
  default: 'your device theme',
});

/** "Appearance" — theme mode picker (Light / Dark / System) + a live preview of the type scale. */
export default function AppearanceScreen({ navigation, embedded = false }) {
  const { theme, preference, setThemePreference } = useTheme();
  const insets = useSafeAreaInsets();
  const { isTablet } = useResponsive();
  const s = makeStyles(theme);

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <View style={[s.header, !embedded && { paddingTop: 20 + insets.top }]}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={8} style={{ padding: 6 }}>
          <Icon name="arrow-back" size={22} color={theme.ink} />
        </Pressable>
        <Text style={[type.headlineMd, { color: theme.text }]}>Appearance</Text>
      </View>

      <ScrollView contentContainerStyle={[s.scroll, isTablet && s.scrollWide]}>
        <Text style={[type.labelXs, { color: theme.muted, marginBottom: 10 }]}>THEME</Text>
        <View style={s.themeRow}>
          <ThemePreviewCard
            label="Light"
            active={preference === 'light'}
            onPress={() => setThemePreference('light')}
            bg={lightTheme.bg}
            ink={lightTheme.ink}
            card={lightTheme.card}
            outerTheme={theme}
          />
          <ThemePreviewCard
            label="Dark"
            active={preference === 'dark'}
            onPress={() => setThemePreference('dark')}
            bg={darkTheme.bg}
            ink={darkTheme.ink}
            card={darkTheme.card}
            outerTheme={theme}
          />
          <ThemePreviewCard
            label="Kinetic"
            active={preference === 'kinetic'}
            onPress={() => setThemePreference('kinetic')}
            bg={kineticInkTheme.bg}
            ink={kineticInkTheme.ink}
            card={kineticInkTheme.primary}
            outerTheme={theme}
          />
          <ThemePreviewCard
            label="System"
            icon="phone-portrait-outline"
            active={preference === 'system'}
            onPress={() => setThemePreference('system')}
            bg={theme.bg}
            ink={theme.ink}
            card={theme.card}
            outerTheme={theme}
            split
          />
        </View>
        {preference === 'system' ? (
          <Text style={[type.bodySm, { color: theme.subtext, marginTop: 10 }]}>
            Follows {SYSTEM_SETTING_NAME} automatically.
          </Text>
        ) : preference === 'light' ? (
          <Text style={[type.bodySm, { color: theme.subtext, marginTop: 10 }]}>
            Light is the default — the brighter paper palette.
          </Text>
        ) : null}

        <Text style={[type.labelXs, { color: theme.muted, marginTop: 28, marginBottom: 10 }]}>TYPOGRAPHY</Text>
        <PaperCard weight="thin" style={{ gap: 16 }}>
          <View>
            <Text style={[type.headlineLg, { color: theme.text }]}>Headline</Text>
            <Text style={[type.labelXs, { color: theme.muted, marginTop: 2 }]}>BRICOLAGE GROTESQUE · HEADLINES</Text>
          </View>
          <View>
            <Text style={[type.bodyLg, { color: theme.text }]}>Body text reads like this, comfortable for long messages.</Text>
            <Text style={[type.labelXs, { color: theme.muted, marginTop: 2 }]}>KARLA · BODY</Text>
          </View>
          <View>
            <Text style={[type.labelSm, { color: theme.text, textTransform: 'uppercase' }]}>Metadata & timestamps</Text>
            <Text style={[type.labelXs, { color: theme.muted, marginTop: 2 }]}>JETBRAINS MONO · LABELS</Text>
          </View>
        </PaperCard>

        <Text style={[type.bodySm, { color: theme.muted, marginTop: 20, lineHeight: 19 }]}>
          Light is the default appearance. Choose Kinetic Ink for the high-contrast cyan-and-red manga-tech palette. Theme preference is saved and applied across every screen.
        </Text>
      </ScrollView>
    </View>
  );
}

function ThemePreviewCard({ label, active, onPress, bg, ink, card, outerTheme, split, icon }) {
  const s = makeStyles(outerTheme);
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        s.themeCard,
        inkBox(outerTheme, active ? 'bold' : 'thin'),
        pressed ? marker(outerTheme, 1) : null,
      ]}
    >
      {split ? (
        <View style={[s.swatch, s.swatchSplit, { borderColor: ink }]}>
          <View style={[s.swatchHalf, { backgroundColor: lightTheme.bg }]} />
          <View style={[s.swatchHalf, { backgroundColor: darkTheme.bg }]} />
          <Icon name={icon} size={16} color={outerTheme.ink} style={s.swatchIcon} />
        </View>
      ) : (
        <View style={[s.swatch, { backgroundColor: bg, borderColor: ink }]}>
          <View style={[s.swatchInner, { backgroundColor: card, borderColor: ink }]} />
        </View>
      )}
      <View style={s.themeLabelRow}>
        <Text style={[type.bodyStrong, { color: outerTheme.text }]}>{label}</Text>
        {active && <Icon name="checkmark-circle" size={16} color={outerTheme.ink} />}
      </View>
    </Pressable>
  );
}

const makeStyles = (t) => StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingHorizontal: 20, paddingTop: 20, paddingBottom: 14 },
  scroll: { padding: 20, paddingBottom: 40 },
  scrollWide: { maxWidth: 560, width: '100%', alignSelf: 'center' },
  themeRow: { flexDirection: 'row', gap: 8 },
  themeCard: { flex: 1, padding: 10 },
  swatch: { width: '100%', aspectRatio: 1.1, borderWidth: 2, padding: 8, justifyContent: 'flex-end', overflow: 'hidden' },
  swatchInner: { height: '55%', borderWidth: 1.5, borderRadius: 3 },
  swatchSplit: { flexDirection: 'row', padding: 0, position: 'relative' },
  swatchHalf: { flex: 1, height: '100%' },
  swatchIcon: { position: 'absolute', top: '50%', left: '50%', marginTop: -8, marginLeft: -8 },
  themeLabelRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 10 },
});
