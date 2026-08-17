import { useMemo } from 'react';
import { Platform, useWindowDimensions, PixelRatio } from 'react-native';
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
    const orientation = width >= height ? 'landscape' : 'portrait';
    const shortSide = Math.min(width, height);

    // Tablet heuristic: short-side >= 600dp is the same rule Android uses
    // for its own "sw600dp" resource qualifier; iPads are always >= that.
    const isTablet = shortSide >= 600;
    const isLargePhone = shortSide >= 400 && shortSide < 600; // Pro Max / Ultra class phones
    const isSmallPhone = shortSide < 360; // SE-class phones

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
      isSplitCapable: (breakpoint === 'expanded' || breakpoint === 'large') && shortSide >= 600,
      insets,
      fontScale,
      // Clamp fontScale so aggressive OS accessibility settings don't break
      // the hand-drawn layouts (still respects moderate user preference).
      clampedFontScale: Math.min(Math.max(fontScale, 0.9), 1.3),
      pixelRatio: PixelRatio.get(),
    };
  }, [width, height, fontScale, insets.top, insets.bottom, insets.left, insets.right]);
}
