import React from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView } from 'react-native';
import Icon from '../icons/Icon';
import { useTheme } from '../store/ThemeContext';
import { PaperCard } from '../components/common';
import { type, inkBox, marker, lightTheme, darkTheme } from '../theme';

/** "Appearance" — theme mode picker + a live preview of the type scale. */
export default function AppearanceScreen({ navigation }) {
  const { theme, mode, toggle } = useTheme();
  const s = makeStyles(theme);

  const setMode = (target) => {
    if (target !== mode) toggle();
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <View style={s.header}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={8} style={{ padding: 6 }}>
          <Icon name="arrow-back" size={22} color={theme.ink} />
        </Pressable>
        <Text style={[type.headlineMd, { color: theme.text }]}>Appearance</Text>
      </View>

      <ScrollView contentContainerStyle={s.scroll}>
        <Text style={[type.labelXs, { color: theme.muted, marginBottom: 10 }]}>THEME</Text>
        <View style={s.themeRow}>
          <ThemePreviewCard
            label="Light"
            active={mode === 'light'}
            onPress={() => setMode('light')}
            bg={lightTheme.bg}
            ink={lightTheme.ink}
            card={lightTheme.card}
            outerTheme={theme}
          />
          <ThemePreviewCard
            label="Dark"
            active={mode === 'dark'}
            onPress={() => setMode('dark')}
            bg={darkTheme.bg}
            ink={darkTheme.ink}
            card={darkTheme.card}
            outerTheme={theme}
          />
        </View>

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
          The Graphite &amp; Pulp type scale is fixed across the app to keep the hand-drawn,
          ink-on-paper feel consistent — only the palette switches between light and dark.
        </Text>
      </ScrollView>
    </View>
  );
}

function ThemePreviewCard({ label, active, onPress, bg, ink, card, outerTheme }) {
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
      <View style={[s.swatch, { backgroundColor: bg, borderColor: ink }]}>
        <View style={[s.swatchInner, { backgroundColor: card, borderColor: ink }]} />
      </View>
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
  themeRow: { flexDirection: 'row', gap: 14 },
  themeCard: { flex: 1, padding: 12 },
  swatch: { width: '100%', aspectRatio: 1.4, borderWidth: 2, padding: 10, justifyContent: 'flex-end' },
  swatchInner: { height: '55%', borderWidth: 1.5, borderRadius: 3 },
  themeLabelRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 10 },
});
