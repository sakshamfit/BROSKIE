import { useMemo } from 'react';
import { Platform, useWindowDimensions, PixelRatio, Dimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/**
 * Breakpoints, in dp width. Chosen to line up with real device classes:
 *  - phones (portrait & landscape) stay single-column
 *  - small tablets (iPad mini portrait, 7-8" Android) get a two-pane layout
 *  - large tablets / foldables unfolded / desktop web get the full sidebar
 */
export const BREAKPOINTS = {
  compact: 0,     // phones
  medium: 600,    // small tablets, phones in landscape
  expanded: 840,  // tablets, foldables, desktop web
  large: 1200,    // wide desktop
};

/**
 * One hook for every screen-size / platform decision so we don't scatter
 * `Platform.OS === 'ios'` / magic breakpoint numbers across every screen.
 */
export default function useResponsive() {
  const { width, height, fontScale } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  return useMemo(() => {
    // Android's adjustResize changes the *window* height every time the IME
    // opens. Device-class decisions based on Math.min(window width, height)
    // therefore oscillated while typing: a normal phone temporarily became a
    // "small phone", card padding changed, and the focused field/cursor jumped
    // up and down. Screen dimensions remain stable while the keyboard opens.
    const screen = Dimensions.get('screen');
    const deviceWidth = screen.width || width;
    const deviceHeight = screen.height || height;
    const orientation = deviceWidth >= deviceHeight ? 'landscape' : 'portrait';
    const deviceShortSide = Math.min(deviceWidth, deviceHeight);

    // Tablet heuristic: physical short-side >= 600dp is the same rule Android
    // uses for its "sw600dp" resource qualifier; the IME cannot change it.
    const isTablet = deviceShortSide >= 600;
    const isLargePhone = deviceShortSide >= 400 && deviceShortSide < 600; // Pro Max / Ultra class phones
    const isSmallPhone = deviceShortSide < 360; // SE-class phones

    let breakpoint = 'compact';
    if (width >= BREAKPOINTS.large) breakpoint = 'large';
    else if (width >= BREAKPOINTS.expanded) breakpoint = 'expanded';
    else if (width >= BREAKPOINTS.medium) breakpoint = 'medium';

    return {
      width,
      height,
      orientation,
      isPortrait: orientation === 'portrait',
      isLandscape: orientation === 'landscape',
      isTablet,
      isLargePhone,
      isSmallPhone,
      isWeb: Platform.OS === 'web',
      isIOS: Platform.OS === 'ios',
      isAndroid: Platform.OS === 'android',
      breakpoint,
      // Split (sidebar + inbox + detail) only when there's room in BOTH
      // dimensions. Without the height gate, a phone in landscape
      // (e.g. 844×390) or a short desktop window would get a cramped
      // 3-pane squeeze — a real messenger keeps the single-column phone
      // layout there instead. shortSide ≥ 600 is the sw600dp tablet rule.
      isSplitCapable: (breakpoint === 'expanded' || breakpoint === 'large') && deviceShortSide >= 600,
      insets,
      fontScale,
      // Clamp fontScale so aggressive OS accessibility settings don't break
      // the hand-drawn layouts (still respects moderate user preference).
      clampedFontScale: Math.min(Math.max(fontScale, 0.9), 1.3),
      pixelRatio: PixelRatio.get(),
    };
  }, [width, height, fontScale, insets.top, insets.bottom, insets.left, insets.right]);
}
