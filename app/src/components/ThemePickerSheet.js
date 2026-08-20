import React, { useMemo, useState } from 'react';
import {
  View, Text, Pressable, StyleSheet, Modal, ScrollView, ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from '../icons/Icon';
import useResponsive from '../hooks/useResponsive';
import { ThemeRegistry, resolveChatTheme, alpha } from '../chatThemes';
import { SpringPressable, Pop, haptic } from '../motion';
import { type, inkBox, marker, raised } from '../theme';

/**
 * "Chat theme" picker — the familiar chat-menu flow (⋯ → Theme), built with
 * BROSKIE's Graphite & Pulp language. The sheet chrome uses the global app
 * theme so the picker stays neutral; every preview card renders a miniature
 * conversation in the candidate theme (dark-mode aware), and tapping a card
 * live-previews it on the chat behind the sheet without persisting anything
 * until "Apply theme" is pressed.
 */
export default function ThemePickerSheet({
  visible, savedThemeId, previewThemeId,
  onPreview, onApply, applying, globalTheme, onClose,
}) {
  const g = globalTheme;
  const insets = useSafeAreaInsets();
  const { isTablet } = useResponsive();
  const [category, setCategory] = useState('Recommended');
  const [mood, setMood] = useState(null);

  const visibleThemes = useMemo(() => {
    const moodIds = mood ? new Set(ThemeRegistry.forMood(mood) || []) : null;
    return ThemeRegistry.themes.filter((t) => {
      if (category === 'Recommended' && !ThemeRegistry.recommendedIds.includes(t.id)) return false;
      if (category !== 'Recommended' && t.category !== category) return false;
      if (moodIds && !moodIds.has(t.id)) return false;
      return true;
    });
  }, [category, mood]);

  const saved = ThemeRegistry.get(savedThemeId || 'graphite');
  const previewing = previewThemeId && previewThemeId !== savedThemeId;
  const s = makeStyles(g);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={[s.overlay, isTablet ? s.overlayCenter : s.overlayBottom]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close theme picker" />
        <View
          style={[
            s.sheet,
            raised(g, 2),
            {
              backgroundColor: g.bg,
              borderColor: g.ink,
              paddingBottom: Math.max(insets.bottom, 16),
              maxHeight: isTablet ? 640 : '88%',
            },
          ]}
        >
          {/* header */}
          <View style={s.header}>
            <View style={{ flex: 1 }}>
              <Text style={[type.headlineSm, { color: g.text }]}>Chat theme</Text>
              <Text style={[type.bodySm, { color: g.subtext, marginTop: 2 }]}>
                Choose a vibe for this chat
              </Text>
            </View>
            <Pressable onPress={onClose} hitSlop={8} style={({ pressed }) => [s.closeBtn, pressed ? marker(g, 1) : null]}>
              <Icon name="close" size={20} color={g.ink} />
            </Pressable>
          </View>

          {/* category chips */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={s.chipRow}
          >
            {ThemeRegistry.categories.map((c) => {
              const active = category === c && !mood;
              return (
                <Pressable
                  key={c}
                  onPress={() => { setCategory(c); setMood(null); }}
                  style={({ pressed }) => [
                    s.chip,
                    inkBox(g, active ? 'bold' : 'thin'),
                    { backgroundColor: active ? g.highlighter : g.card },
                    pressed ? marker(g, 1) : null,
                  ]}
                >
                  <Text style={[type.labelXs, { color: g.ink, letterSpacing: 0.5 }]}>{c.toUpperCase()}</Text>
                </Pressable>
              );
            })}
          </ScrollView>

          {/* mood selector — recommends themes, never a separate system */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={s.chipRow}
          >
            {ThemeRegistry.moods.map((m) => {
              const active = mood === m.id;
              return (
                <Pressable
                  key={m.id}
                  onPress={() => setMood(active ? null : m.id)}
                  style={({ pressed }) => [
                    s.moodChip,
                    active ? { borderColor: g.ink, backgroundColor: g.highlighterWash } : { borderColor: g.graphiteLine },
                    pressed ? marker(g, 1) : null,
                  ]}
                >
                  <Text style={[type.labelXs, { color: g.ink }]}>
                    {m.emoji} {m.label.toUpperCase()}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>

          {/* horizontally scrollable miniature conversation previews */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={s.cardsRow}
          >
            {visibleThemes.map((t) => {
              const resolved = resolveChatTheme(g, t);
              const active = (previewThemeId || savedThemeId) === t.id;
              return (
                <ThemeCard
                  key={t.id}
                  theme={t}
                  resolved={resolved}
                  globalTheme={g}
                  active={active}
                  onPress={() => onPreview(t.id)}
                />
              );
            })}
            {!visibleThemes.length && (
              <Text style={[type.bodySm, { color: g.muted, paddingVertical: 30 }]}>
                No themes here yet.
              </Text>
            )}
          </ScrollView>

          {/* footer — current selection + Apply */}
          <View style={s.footer}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[type.labelXs, { color: g.muted }]}>
                {previewing ? 'PREVIEWING' : 'CURRENTLY SET'}
              </Text>
              <Text style={[type.bodyMd, { color: g.text, marginTop: 2 }]} numberOfLines={1}>
                {previewing ? `${saved.name} → ${ThemeRegistry.get(previewThemeId).name}` : saved.name}
              </Text>
              <Text style={[type.labelXs, { color: g.muted, marginTop: 3 }]}>
                THEME APPLIES TO EVERYONE IN THIS CHAT
              </Text>
            </View>
            <SpringPressable
              accessibilityRole="button"
              disabled={applying}
              onPress={() => { haptic('impact'); onApply(previewThemeId || savedThemeId); }}
              android_ripple={{ color: 'rgba(255,255,255,0.25)' }}
              style={({ pressed }) => [
                s.applyBtn,
                raised(g, 2),
                inkBox(g, 'bold'),
                { backgroundColor: g.ink },
                pressed && { opacity: 0.82 },
                applying && { opacity: 0.55 },
              ]}
            >
              {applying ? (
                <ActivityIndicator size="small" color={g.onPrimary} />
              ) : (
                <>
                  <Icon name="checkmark" size={17} color={g.onPrimary} />
                  <Text style={[type.labelSm, { color: g.onPrimary, letterSpacing: 0.8 }]}>APPLY THEME</Text>
                </>
              )}
            </SpringPressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

/** A miniature conversation rendered in one candidate theme. */
function ThemeCard({ theme, resolved, globalTheme: g, active, onPress }) {
  return (
    <SpringPressable
      onPress={() => { haptic('selection'); onPress(); }}
      scaleTo={0.96}
      style={styles.cardWrap}
    >
      <View style={[styles.card, inkBox(resolved, active ? 'bold' : 'thin', active ? resolved.accent : resolved.ink), { backgroundColor: resolved.chatBg }]}>
        {/* soft atmosphere washes */}
        <View pointerEvents="none" style={[styles.cardWashA, { backgroundColor: resolved.backgroundWashA }]} />
        <View pointerEvents="none" style={[styles.cardWashB, { backgroundColor: resolved.backgroundWashB }]} />

        {/* mock header */}
        <View style={styles.cardHeader}>
          <View style={[styles.cardAvatar, { backgroundColor: alpha(resolved.accent, 0.22), borderColor: resolved.ink }]}>
            <View style={[styles.cardAvatarDot, { backgroundColor: resolved.accent }]} />
          </View>
          <View style={{ flex: 1, gap: 4 }}>
            <View style={[styles.bar, { width: '70%', backgroundColor: alpha(resolved.text, 0.8) }]} />
            <View style={[styles.bar, { width: '42%', backgroundColor: alpha(resolved.subtext, 0.55) }]} />
          </View>
        </View>

        {/* incoming bubble */}
        <View style={[styles.bubbleIn, { backgroundColor: resolved.bubbleIn, borderColor: resolved.ink }]}>
          <View style={[styles.bar, { width: '86%', backgroundColor: alpha(resolved.onBubbleIn, 0.85) }]} />
          <View style={[styles.bar, { width: '55%', backgroundColor: alpha(resolved.onBubbleIn, 0.5) }]} />
        </View>

        {/* outgoing bubble */}
        <View style={[styles.bubbleOut, { backgroundColor: resolved.bubbleOut, borderColor: resolved.ink }]}>
          <View style={[styles.bar, { width: '70%', backgroundColor: alpha(resolved.onBubbleOut, 0.85) }]} />
        </View>

        {active && (
          // check pops in with a tiny spring when the theme becomes selected
          <Pop trigger="active" from={0.3} style={styles.activeBadge}>
            <View style={[styles.activeBadgeInner, { backgroundColor: resolved.accent, borderColor: resolved.ink }]}>
              <Icon name="checkmark" size={11} color={resolved.onAccent} />
            </View>
          </Pop>
        )}
      </View>
      <View style={styles.cardLabelRow}>
        <Text style={[type.labelXs, { color: g.text, letterSpacing: 0.4 }]} numberOfLines={1}>
          {theme.name.toUpperCase()}
        </Text>
      </View>
    </SpringPressable>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1 },
  overlayBottom: { justifyContent: 'flex-end' },
  overlayCenter: { alignItems: 'center', justifyContent: 'center', padding: 24 },
  sheet: {
    width: '100%',
    maxWidth: 480,
    borderWidth: 3,
    paddingHorizontal: 18,
    paddingTop: 16,
    borderTopLeftRadius: 10,
    borderTopRightRadius: 16,
    borderBottomRightRadius: 8,
    borderBottomLeftRadius: 12,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  closeBtn: { padding: 8, borderWidth: 1, borderColor: 'transparent' },
  chipRow: { gap: 8, paddingVertical: 12, paddingRight: 24 },
  chip: { paddingHorizontal: 13, paddingVertical: 7 },
  moodChip: { paddingHorizontal: 12, paddingVertical: 7, borderWidth: 1, borderRadius: 999 },
  cardsRow: { gap: 14, paddingVertical: 4, paddingBottom: 14, paddingRight: 24 },
  cardWrap: { width: 148 },
  card: {
    height: 186, padding: 10, overflow: 'hidden',
    borderTopLeftRadius: 5, borderTopRightRadius: 11,
    borderBottomRightRadius: 5, borderBottomLeftRadius: 8,
  },
  cardWashA: {
    position: 'absolute', top: -34, right: -26, width: 110, height: 110, borderRadius: 999,
  },
  cardWashB: {
    position: 'absolute', bottom: -28, left: -22, width: 90, height: 90, borderRadius: 999,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 9 },
  cardAvatar: {
    width: 22, height: 22, borderRadius: 999, borderWidth: 1,
    alignItems: 'center', justifyContent: 'center',
  },
  cardAvatarDot: { width: 6, height: 6, borderRadius: 999 },
  bar: { height: 4, borderRadius: 2 },
  bubbleIn: {
    borderWidth: 1, paddingHorizontal: 8, paddingVertical: 7, gap: 5,
    borderTopLeftRadius: 2, borderTopRightRadius: 8,
    borderBottomRightRadius: 2, borderBottomLeftRadius: 6,
    marginBottom: 7, alignSelf: 'flex-start', maxWidth: '86%',
  },
  bubbleOut: {
    borderWidth: 1, paddingHorizontal: 8, paddingVertical: 7, gap: 5,
    borderTopLeftRadius: 8, borderTopRightRadius: 2,
    borderBottomRightRadius: 6, borderBottomLeftRadius: 2,
    alignSelf: 'flex-end', maxWidth: '78%',
  },
  activeBadge: { position: 'absolute', top: 6, right: 6 },
  activeBadgeInner: {
    width: 19, height: 19, borderRadius: 999,
    borderWidth: 1, alignItems: 'center', justifyContent: 'center',
  },
  cardLabelRow: { marginTop: 7, paddingHorizontal: 2 },
  footer: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    paddingTop: 12, marginTop: 2,
  },
  applyBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 18, paddingVertical: 13,
  },
});
