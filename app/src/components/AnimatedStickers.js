/**
 * Animated story sticker (Lottie-based) placeholder.
 * Reuses the existing sticker placement/drag logic from Stories.js.
 *
 * TODO: Replace placeholder Lottie assets at src/assets/lottie/sticker-*.json
 * with custom branded animated stickers (e.g. pulsing heart, sparkle loop).
 */
import React from 'react';
import { View, StyleSheet } from 'react-native';
import LottieView from 'lottie-react-native';
import { useTheme } from '../store/ThemeContext';
import Emoji from '../icons/Emoji';

export function AnimatedSticker({ sticker, style }) {
  const { theme } = useTheme();
  return (
    <View style={[styles.stickerWrap, style]} pointerEvents="box-none">
      <LottieView
        source={require('../assets/lottie/loading-heart.json')}
        autoPlay
        loop
        style={{ width: 64, height: 64 }}
      />
      <View style={[styles.stickerLabel, { backgroundColor: theme.ink }]}>
        <Emoji char={sticker?.glyph || '❤️'} size={10} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  stickerWrap: { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
  stickerLabel: { position: 'absolute', bottom: -4, paddingHorizontal: 4, paddingVertical: 2, borderRadius: 4 },
});
