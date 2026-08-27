import React from 'react';
import { Platform, Text as RNText } from 'react-native';

/**
 * App-wide ceiling for the operating system's "text size" accessibility
 * setting.
 *
 * WHY THIS EXISTS
 * ---------------
 * React Native's <Text> follows the phone's system text size by default
 * (`allowFontScaling` is true unless you say otherwise). Nothing in this app
 * overrode that, so on a device with a large system text size every label
 * grew while every *fixed* element stayed put — 48dp avatars, 22px icons,
 * the 48×48 send button, 32dp chips, 1dp hairlines. Text and chrome then
 * drift apart by different amounts on every screen, which reads to a user
 * as "the app zoomed in / the layout is wrong", even though no pinch
 * gesture was ever involved.
 *
 * WHY A CAP AND NOT A HARD DISABLE
 * --------------------------------
 * `allowFontScaling={false}` would pin the UI pixel-perfect but is an
 * accessibility regression: low-vision users who set a larger system text
 * size would get none of it. `maxFontSizeMultiplier` keeps scaling working
 * up to a ceiling we have actually laid out for. Both platforms honour it
 * natively — iOS in `RCTTextAttributes.effectiveFontSizeMultiplier`
 * (`fminf(maxFontSizeMultiplier, fontSizeMultiplier)`) and Android in
 * `TextAttributes.effectiveMaxFontSizeMultiplier`.
 *
 * lineHeight needs no manual compensation: iOS multiplies `_lineHeight` by
 * the same `effectiveFontSizeMultiplier` (RCTTextAttributes.mm) and Android
 * by the same multiplier (TextAttributes.kt), so text and its line box grow
 * together and nothing clips.
 *
 * On web this prop is a no-op — react-native-web has no font-scaling
 * implementation. The web shell handles the browser equivalent instead:
 * public/index.html sets `-webkit-text-size-adjust: 100%` /
 * `text-size-adjust: 100%`, a `maximum-scale=1, user-scalable=no` viewport
 * and `touch-action: manipulation`.
 */
export const MAX_FONT_SCALE = 1.2;

const isWeb = Platform.OS === 'web';

/**
 * Drop-in replacement for React Native's <Text>.
 *
 * Imported as `Text` by every screen and component, so the cap is applied
 * structurally rather than by remembering a prop in 688 places — the same
 * reason the chat composer is a shared component instead of a copied style.
 *
 * A caller can still opt out per-instance:
 *   <Text maxFontSizeMultiplier={0}>      → uncapped (inherit / no max)
 *   <Text maxFontSizeMultiplier={1.6}>    → its own higher ceiling
 *   <Text allowFontScaling={false}>       → fixed size, no scaling at all
 */
export const Text = React.forwardRef(function Text(
  { maxFontSizeMultiplier, ...rest },
  ref,
) {
  return (
    <RNText
      {...rest}
      ref={ref}
      maxFontSizeMultiplier={
        maxFontSizeMultiplier === undefined ? MAX_FONT_SCALE : maxFontSizeMultiplier
      }
    />
  );
});

Text.displayName = 'Text';

export default Text;
