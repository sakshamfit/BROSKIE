import { useEffect } from 'react';
import { Platform } from 'react-native';
import useResponsive from '../hooks/useResponsive';

let ScreenOrientation = null;
if (Platform.OS !== 'web') {
  try {
    // eslint-disable-next-line global-require
    ScreenOrientation = require('expo-screen-orientation');
  } catch {
    ScreenOrientation = null;
  }
}

/**
 * Phones stay portrait-locked (the hand-drawn layouts are tuned for that,
 * same as every major messenger). Tablets/foldables unlock rotation so the
 * split-pane layout can adapt to landscape, matching native iPad/Android
 * tablet app conventions. No-op on web — the browser owns orientation there.
 */
export default function OrientationManager() {
  const { isTablet } = useResponsive();

  useEffect(() => {
    if (!ScreenOrientation) return;
    (async () => {
      try {
        if (isTablet) {
          await ScreenOrientation.unlockAsync();
        } else {
          await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
        }
      } catch {
        // Some devices/emulators don't support orientation locking — harmless.
      }
    })();
  }, [isTablet]);

  return null;
}
