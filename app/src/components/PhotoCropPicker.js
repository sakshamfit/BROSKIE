import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet, Modal, ActivityIndicator, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import Icon from '../icons/Icon';
import { useTheme } from '../store/ThemeContext';
import { type, inkBox, marker, stroke } from '../theme';

const RATIOS = [
  { key: 'original', label: 'Original', note: 'Fit', aspect: null, pair: null, preview: 1.25 },
  { key: 'square', label: 'Square', note: '1:1', aspect: 1, pair: [1, 1], preview: 1 },
  { key: 'portrait', label: 'Portrait', note: '4:5', aspect: 4 / 5, pair: [4, 5], preview: 4 / 5 },
  { key: 'landscape', label: 'Wide', note: '16:9', aspect: 16 / 9, pair: [16, 9], preview: 16 / 9 },
  { key: 'story', label: 'Story', note: '9:16', aspect: 9 / 16, pair: [9, 16], preview: 9 / 16 },
];

/** Ratio chooser followed by the platform's native crop editor. */
export default function PhotoCropPicker({ visible, onClose, onPick, title = 'Frame your photo', quality = 0.82 }) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState('');
  const s = makeStyles(theme);

  const choose = async (option) => {
    setBusy(option.key);
    setError('');
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality,
        allowsEditing: !!option.pair,
        aspect: option.pair || undefined,
        presentationStyle: 'fullScreen',
      });
      if (result.canceled || !result.assets?.length) return;
      const asset = result.assets[0];
      const naturalAspect = asset.width && asset.height ? asset.width / asset.height : 1;
      onPick?.({ ...asset, displayAspect: option.aspect || naturalAspect, ratioKey: option.key });
      onClose?.();
    } catch (e) {
      setError(e.message || 'Could not open this photo.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={[s.root, { backgroundColor: theme.bg, paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <View style={s.header}>
          <Pressable onPress={onClose} hitSlop={9} style={{ padding: 6 }}>
            <Icon name="close" size={22} color={theme.ink} />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={[type.headlineMd, { color: theme.text }]}>{title}</Text>
            <Text style={[type.labelXs, { color: theme.muted, marginTop: 3 }]}>CHOOSE THE BOX · THEN CROP</Text>
          </View>
          <Icon name="image-outline" size={22} color={theme.ink} />
        </View>

        <View style={s.content}>
          <Text style={[type.bodyMd, { color: theme.subtext, marginBottom: 20 }]}>
            Pick how the photo should appear. On Android and iOS, the crop editor opens next so you can move and resize the image inside that frame.
          </Text>

          <View style={s.grid}>
            {RATIOS.map((option, index) => (
              <Pressable
                key={option.key}
                onPress={() => choose(option)}
                disabled={!!busy}
                style={({ pressed }) => [
                  s.option,
                  inkBox(theme, option.key === 'portrait' ? 'ink' : 'thin'),
                  pressed && marker(theme, 1),
                  !!busy && busy !== option.key && { opacity: 0.4 },
                  { transform: [{ rotate: index % 2 ? '0.5deg' : '-0.5deg' }] },
                ]}
              >
                <View style={s.previewArea}>
                  <View
                    style={[
                      s.ratioBox,
                      {
                        borderColor: theme.ink,
                        aspectRatio: option.preview,
                        maxWidth: option.preview > 1 ? 84 : 58,
                        maxHeight: option.preview < 1 ? 84 : 58,
                      },
                    ]}
                  >
                    {busy === option.key
                      ? <ActivityIndicator color={theme.ink} />
                      : <Icon name="image-outline" size={18} color={theme.graphite} />}
                  </View>
                </View>
                <Text style={[type.bodyStrong, { color: theme.text, textAlign: 'center' }]}>{option.label}</Text>
                <Text style={[type.labelXs, { color: theme.muted, textAlign: 'center', marginTop: 3 }]}>{option.note}</Text>
              </Pressable>
            ))}
          </View>

          {Platform.OS === 'web' && (
            <Text style={[type.bodySm, { color: theme.muted, marginTop: 20 }]}>
              Web keeps the selected frame and uses a centred cover crop. Native apps additionally provide drag-and-resize editing.
            </Text>
          )}
          {!!error && <Text style={[type.bodySm, { color: theme.danger, marginTop: 14 }]}>{error}</Text>}
        </View>
      </View>
    </Modal>
  );
}

const makeStyles = (t) => StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 13,
    paddingHorizontal: 18, paddingVertical: 15,
    borderBottomWidth: stroke.ink, borderBottomColor: t.ink,
  },
  content: { width: '100%', maxWidth: 680, alignSelf: 'center', padding: 22 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  option: { width: '47%', minHeight: 170, padding: 14, alignItems: 'center', justifyContent: 'center' },
  previewArea: { height: 92, width: '100%', alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  ratioBox: { borderWidth: 2, borderStyle: 'dashed', width: '100%', alignItems: 'center', justifyContent: 'center' },
});
