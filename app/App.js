import React, { useEffect, useRef } from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { View, StyleSheet, Platform, Animated, Easing } from 'react-native';
import Svg, { Defs, Pattern, Path, Rect } from 'react-native-svg';
import { useFonts } from 'expo-font';
import {
  BricolageGrotesque_600SemiBold,
  BricolageGrotesque_700Bold,
  BricolageGrotesque_800ExtraBold,
} from '@expo-google-fonts/bricolage-grotesque';
import {
  Karla_400Regular,
  Karla_500Medium,
  Karla_700Bold,
} from '@expo-google-fonts/karla';
import {
  JetBrainsMono_500Medium,
  JetBrainsMono_700Bold,
} from '@expo-google-fonts/jetbrains-mono';
import {
  Anybody_800ExtraBold,
  Anybody_900Black,
} from '@expo-google-fonts/anybody';
import {
  SpaceMono_400Regular,
  SpaceMono_700Bold,
} from '@expo-google-fonts/space-mono';
import { HankenGrotesk_400Regular } from '@expo-google-fonts/hanken-grotesk';
import { Caveat_600SemiBold, Caveat_700Bold } from '@expo-google-fonts/caveat';
import { Analytics } from '@vercel/analytics/react';

import { AuthProvider } from './src/store/AuthContext';
import { ChatProvider } from './src/store/ChatContext';
import { ThemeProvider, useTheme } from './src/store/ThemeContext';
import Navigation from './src/Navigation';
import { Loading } from './src/components/common';
import OrientationManager from './src/components/OrientationManager';
import CallOverlay from './src/components/CallOverlay';
import { setupMedianBridge, setMedianTheme } from './src/web/medianStatusBar';

/** On web, expand to full browser — no phone frame.
 *  We still wrap in a flex View because React Navigation's container needs
 *  an explicit parent to fill — without it, alignItems: center on webRoot
 *  collapses the container to its content's width (0). */
function PhoneFrame({ children }) {
  const { theme } = useTheme();
  if (Platform.OS !== 'web') return children;
  return (
    <View style={[styles.webRoot, { backgroundColor: theme.bg }]}>
      <View style={styles.fullBleed}>{children}</View>
    </View>
  );
}

/**
 * A faint, slowly drifting 24px drafting grid over every screen. The pattern
 * is intentionally subtle and pointer-events are disabled, so the app keeps
 * full contrast and touch performance while the paper feels gently alive.
 */
function LivingGrid() {
  const { theme } = useTheme();
  const drift = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(drift, {
        toValue: 1, duration: 16000, easing: Easing.linear, useNativeDriver: Platform.OS !== 'web',
      })
    );
    loop.start();
    return () => loop.stop();
  }, [drift]);

  const offset = drift.interpolate({ inputRange: [0, 1], outputRange: [0, 24] });
  return (
    <Animated.View
      style={[
        styles.gridOverlay,
        {
          pointerEvents: 'none',
          opacity: theme.dark ? 0.28 : 0.36,
          transform: [{ translateX: offset }, { translateY: offset }],
        },
      ]}
    >
      <Svg width="100%" height="100%">
        <Defs>
          <Pattern id="app-grid-minor" width="24" height="24" patternUnits="userSpaceOnUse">
            <Path d="M 24 0 L 0 0 0 24" fill="none" stroke={theme.graphiteLine} strokeWidth="0.8" />
          </Pattern>
          <Pattern id="app-grid-major" width="96" height="96" patternUnits="userSpaceOnUse">
            <Path d="M 96 0 L 0 0 0 96" fill="none" stroke={theme.graphite} strokeWidth="1.15" />
          </Pattern>
        </Defs>
        <Rect width="100%" height="100%" fill="url(#app-grid-minor)" />
        <Rect width="100%" height="100%" fill="url(#app-grid-major)" />
      </Svg>
    </Animated.View>
  );
}

function Root() {
  const { theme, mode } = useTheme();

  // On web, keep the page shell (html/body/#root backgrounds + the mobile
  // browser-chrome "theme-color") in lockstep with the app theme, so there
  // is never a white page showing through behind or beside the UI — including
  // during resizes, overscroll, and in dark mode. Also drive the Median
  // browser's native status bar (edge-to-edge overlay, theme-matched color
  // and icon style) so the app syncs with the system chrome there too.
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    const paint = (el) => { if (el) el.style.backgroundColor = theme.bg; };
    paint(document.documentElement);
    paint(document.body);
    paint(document.getElementById('root'));
    let meta = document.querySelector('meta[name="theme-color"]');
    if (!meta) {
      meta = document.createElement('meta');
      meta.name = 'theme-color';
      document.head.appendChild(meta);
    }
    meta.content = theme.bg;

    setupMedianBridge();
    setMedianTheme(mode, theme.bg);
  }, [theme.bg, mode]);

  return (
    <>
      <StatusBar style={theme.dark ? 'light' : 'dark'} backgroundColor={theme.bg} />
      <OrientationManager />
      {/* Vercel Web Analytics — page views only load the tracking script in a
          real browser (it injects a <script> tag into document.head), so it's
          gated to web. It silently no-ops if the app isn't served from
          Vercel (the /_vercel/insights/script.js request just 404s quietly). */}
      {Platform.OS === 'web' && <Analytics />}
      <PhoneFrame>
        <View style={styles.appCanvas}>
          <Navigation />
          <LivingGrid />
        </View>
      </PhoneFrame>
      <CallOverlay />
    </>
  );
}

export default function App() {
  // Aliases keep theme.js font names short (Bricolage_800ExtraBold etc.)
  const [fontsLoaded] = useFonts({
    Bricolage_600SemiBold: BricolageGrotesque_600SemiBold,
    Bricolage_700Bold: BricolageGrotesque_700Bold,
    Bricolage_800ExtraBold: BricolageGrotesque_800ExtraBold,
    Karla_400Regular,
    Karla_500Medium,
    Karla_700Bold,
    JetBrainsMono_500Medium,
    JetBrainsMono_700Bold,
    Anybody_800ExtraBold,
    Anybody_900Black,
    SpaceMono_400Regular,
    SpaceMono_700Bold,
    Hanken_400Regular: HankenGrotesk_400Regular,
    Caveat_600SemiBold,
    Caveat_700Bold,
  });

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider>
          {fontsLoaded ? (
            <AuthProvider>
              <ChatProvider>
                <Root />
              </ChatProvider>
            </AuthProvider>
          ) : (
            <Loading label="LOADING +ONE" />
          )}
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  webRoot: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  fullBleed: { flex: 1, width: '100%', height: '100%' },
  appCanvas: { flex: 1, width: '100%', height: '100%' },
  gridOverlay: {
    position: 'absolute', top: -24, right: -24, bottom: -24, left: -24,
    zIndex: 9999,
  },
});
