import React, { useEffect, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { View, Text, Pressable, StyleSheet, Platform } from 'react-native';
import Svg, { Circle, Defs, Pattern, Path, Rect } from 'react-native-svg';
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

import { AuthProvider, useAuth } from './src/store/AuthContext';
import { ChatProvider } from './src/store/ChatContext';
import { ChatThemeProvider } from './src/store/ChatThemeContext';
import { ThemeProvider, useTheme } from './src/store/ThemeContext';
import Navigation from './src/Navigation';
import { Loading } from './src/components/common';
import OrientationManager from './src/components/OrientationManager';
import CallOverlay from './src/components/CallOverlay';
import DailyAIGreeting from './src/components/DailyAIGreeting';
import { setupMedianBridge, setMedianTheme } from './src/web/medianStatusBar';
import { WEB_BUILD, startUpdateLifecycle } from './src/updates';

/**
 * Keep +one current without the user thinking about it.
 *
 * The update centre (src/updates.js) checks on launch and on every return to
 * the foreground, downloads new releases in the background, and installs a
 * pending one the next time the app is reopened — so a build no longer waits
 * for a true cold start that may never happen. Settings ▸ App Updates exposes
 * the same engine with an explicit "Update now" button.
 */
function useAutoUpdates() {
  useEffect(() => startUpdateLifecycle(), []);
}

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
 * Hand-sketched graph paper for signed-in screens only. Slightly uneven
 * pencil lines sit under organic fibres and smudges; Auth keeps its original
 * manga halftone/speed-line backdrop with no graph overlay.
 */
function SketchGraphPaper() {
  const { theme } = useTheme();
  return (
    <View style={[styles.paperOverlay, { pointerEvents: 'none', opacity: theme.dark ? 0.18 : 0.09 }]}>
      <Svg width="100%" height="100%">
        <Defs>
          <Pattern id="sketch-grid-minor" width="28" height="28" patternUnits="userSpaceOnUse">
            <Path d="M0 0.7 C7 0.1 19 1.1 28 0.55 M0.65 0 C0.15 8 1.05 20 0.55 28" fill="none" stroke={theme.graphiteLine} strokeWidth="0.55" strokeLinecap="round" />
          </Pattern>
          <Pattern id="sketch-grid-major" width="112" height="112" patternUnits="userSpaceOnUse">
            <Path d="M0 1 C31 0.15 78 1.5 112 0.7 M1 0 C0.15 34 1.45 79 0.65 112" fill="none" stroke={theme.graphite} strokeWidth="0.75" strokeLinecap="round" />
          </Pattern>
          <Pattern id="paper-fibres" width="260" height="214" patternUnits="userSpaceOnUse">
            <Path d="M11 19 l14 -1 M54 12 l6 1 M96 37 l19 -2 M166 21 l9 1 M221 44 l13 -1 M31 91 l8 -2 M79 68 l15 1 M136 112 l18 -1 M198 84 l7 2 M238 126 l11 -2 M47 173 l17 -1 M112 195 l9 -2 M181 164 l13 1 M229 201 l8 -1" fill="none" stroke={theme.graphiteLine} strokeWidth="0.65" strokeLinecap="round" />
            <Path d="M23 52 l5 -1 M72 139 l9 -1 M149 55 l6 1 M205 151 l10 -1 M249 70 l4 1 M15 204 l7 -1" fill="none" stroke={theme.graphite} strokeWidth="0.42" strokeLinecap="round" />
            <Circle cx="38" cy="31" r="0.6" fill={theme.graphite} />
            <Circle cx="87" cy="102" r="0.48" fill={theme.graphiteLine} />
            <Circle cx="157" cy="78" r="0.55" fill={theme.graphite} />
            <Circle cx="216" cy="183" r="0.45" fill={theme.graphiteLine} />
            <Circle cx="129" cy="151" r="0.5" fill={theme.graphite} />
          </Pattern>
        </Defs>
        <Rect width="100%" height="100%" fill="url(#sketch-grid-minor)" opacity="0.72" />
        <Rect width="100%" height="100%" fill="url(#sketch-grid-major)" opacity="0.48" />
        <Rect width="100%" height="100%" fill="url(#paper-fibres)" />
        <Path d="M-40 782 C180 765 390 790 610 772 S980 770 1260 785" fill="none" stroke={theme.graphiteLine} strokeWidth="0.8" opacity="0.12" />
      </Svg>
    </View>
  );
}

function Root() {
  const { theme, mode } = useTheme();
  const { user } = useAuth();

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

    // Some installed PWAs kept an old hashed conversation bundle even after
    // Vercel deployed the fix. Retire stale service workers/cache storage once
    // per build; technical auth/session storage is deliberately untouched.
    try {
      if (window.localStorage?.getItem('+one.web-build') !== WEB_BUILD) {
        window.localStorage?.setItem('+one.web-build', WEB_BUILD);
        window.navigator?.serviceWorker?.getRegistrations?.()
          .then((registrations) => registrations.forEach((registration) => registration.unregister()))
          .catch(() => {});
        if (window.caches?.keys) {
          window.caches.keys()
            .then((keys) => Promise.all(keys.map((key) => window.caches.delete(key))))
            .catch(() => {});
        }
      }
    } catch {}

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
          {user && <SketchGraphPaper />}
        </View>
      </PhoneFrame>
      <DailyAIGreeting />
      <CallOverlay />
    </>
  );
}

class AppErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (this.state.failed) {
      return (
        <View style={styles.startupError}>
          <Text style={styles.startupBrand}>+one</Text>
          <Text style={styles.startupTitle}>The app could not finish starting.</Text>
          <Text style={styles.startupBody}>
            Force-stop +one and open it again. If this remains, clear the app cache and retry.
          </Text>
          <Pressable onPress={() => this.setState({ failed: false })} style={styles.startupRetry}>
            <Text style={styles.startupRetryText}>RETRY</Text>
          </Pressable>
        </View>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  useAutoUpdates();

  // Aliases keep theme.js font names short (Bricolage_800ExtraBold etc.)
  const [fontsLoaded, fontError] = useFonts({
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
  const [fontGraceExpired, setFontGraceExpired] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setFontGraceExpired(true), 2500);
    return () => clearTimeout(timer);
  }, []);
  const canRenderApp = fontsLoaded || !!fontError || fontGraceExpired;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <AppErrorBoundary>
        <SafeAreaProvider>
          <ThemeProvider>
            {canRenderApp ? (
              <AuthProvider>
                <ChatProvider>
                  <ChatThemeProvider>
                    <Root />
                  </ChatThemeProvider>
                </ChatProvider>
              </AuthProvider>
            ) : (
              <Loading label="LOADING +ONE" />
            )}
          </ThemeProvider>
        </SafeAreaProvider>
      </AppErrorBoundary>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  webRoot: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  fullBleed: { flex: 1, width: '100%', height: '100%' },
  appCanvas: { flex: 1, width: '100%', height: '100%' },
  paperOverlay: {
    position: 'absolute', top: 0, right: 0, bottom: 0, left: 0,
    zIndex: 9999,
  },
  startupError: {
    flex: 1, backgroundColor: '#131313', alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 28,
  },
  startupBrand: { color: '#FFE24D', fontSize: 42, fontWeight: '900', fontStyle: 'italic' },
  startupTitle: { color: '#f4f0ef', fontSize: 20, fontWeight: '700', textAlign: 'center', marginTop: 20 },
  startupBody: { color: '#bdb8b5', fontSize: 15, lineHeight: 22, textAlign: 'center', marginTop: 10, maxWidth: 360 },
  startupRetry: {
    minWidth: 150, minHeight: 48, alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#FFE24D', borderWidth: 2, borderColor: '#000000', borderRadius: 8, marginTop: 24,
  },
  startupRetryText: { color: '#131313', fontSize: 14, fontWeight: '800', letterSpacing: 1.2 },
});
