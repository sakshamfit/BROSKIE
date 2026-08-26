import React, { useEffect, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { View, Text, Pressable, StyleSheet, Platform } from 'react-native';
import Svg, { Circle, Defs, Pattern, Path, Rect } from 'react-native-svg';
import { loadAsync, useFonts } from 'expo-font';
import { BricolageGrotesque_600SemiBold } from '@expo-google-fonts/bricolage-grotesque/600SemiBold';
import { BricolageGrotesque_700Bold } from '@expo-google-fonts/bricolage-grotesque/700Bold';
import { BricolageGrotesque_800ExtraBold } from '@expo-google-fonts/bricolage-grotesque/800ExtraBold';
import { Karla_400Regular } from '@expo-google-fonts/karla/400Regular';
import { Karla_500Medium } from '@expo-google-fonts/karla/500Medium';
import { Karla_700Bold } from '@expo-google-fonts/karla/700Bold';
import { JetBrainsMono_500Medium } from '@expo-google-fonts/jetbrains-mono/500Medium';
import { JetBrainsMono_700Bold } from '@expo-google-fonts/jetbrains-mono/700Bold';
import { Anybody_800ExtraBold } from '@expo-google-fonts/anybody/800ExtraBold';
import { Anybody_900Black } from '@expo-google-fonts/anybody/900Black';
import { SpaceMono_400Regular } from '@expo-google-fonts/space-mono/400Regular';
import { SpaceMono_700Bold } from '@expo-google-fonts/space-mono/700Bold';
import { HankenGrotesk_400Regular } from '@expo-google-fonts/hanken-grotesk/400Regular';
import { Caveat_600SemiBold } from '@expo-google-fonts/caveat/600SemiBold';
import { Caveat_700Bold } from '@expo-google-fonts/caveat/700Bold';

import { AuthProvider, useAuth } from './src/store/AuthContext';
import { ChatProvider } from './src/store/ChatContext';
import { ChatThemeProvider } from './src/store/ChatThemeContext';
import { ThemeProvider, useTheme } from './src/store/ThemeContext';
import Navigation from './src/Navigation';
import OrientationManager from './src/components/OrientationManager';
import { setupMedianBridge, setMedianTheme } from './src/web/medianStatusBar';
import VercelObservability from './src/web/VercelObservability';
import { WEB_BUILD, startUpdateLifecycle } from './src/updates';

import PushController from './src/push/PushController';
import CallOverlay from './src/components/CallOverlay';
import DailyAIGreeting from './src/components/DailyAIGreeting';

// Keep the authentication path small: the original app requested every font
// (including the handwriting and chat-only families) before the first signed-in
// screen could settle. The remaining families are loaded once, after auth, in
// the background. `Font.loadAsync` is used instead of another `useFonts` hook so
// this work never gates the first paint.
const AUTH_FONTS = {
  Bricolage_600SemiBold: BricolageGrotesque_600SemiBold,
  Anybody_800ExtraBold,
  Anybody_900Black,
  SpaceMono_700Bold,
  Hanken_400Regular: HankenGrotesk_400Regular,
};
const APP_FONTS = {
  Bricolage_700Bold: BricolageGrotesque_700Bold,
  Bricolage_800ExtraBold: BricolageGrotesque_800ExtraBold,
  Karla_400Regular,
  Karla_500Medium,
  Karla_700Bold,
  JetBrainsMono_500Medium,
  JetBrainsMono_700Bold,
  SpaceMono_400Regular,
  Caveat_600SemiBold,
  Caveat_700Bold,
};
let appFontsPromise = null;

function useAuthenticatedFonts(enabled) {
  useEffect(() => {
    if (!enabled || appFontsPromise) return undefined;
    appFontsPromise = loadAsync(APP_FONTS).catch(() => {
      // Font loading is cosmetic. System fallbacks keep the app usable if a
      // device cannot finish downloading the optional families.
    });
    return undefined;
  }, [enabled]);
}

function DeferredDailyAIGreeting({ user }) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!user?.id) {
      setReady(false);
      return undefined;
    }
    let cancelled = false;
    let timer;
    const reveal = () => {
      if (!cancelled) setReady(true);
    };
    if (Platform.OS === 'web' && typeof window !== 'undefined' && window.requestIdleCallback) {
      const idleId = window.requestIdleCallback(reveal, { timeout: 1400 });
      return () => {
        cancelled = true;
        window.cancelIdleCallback?.(idleId);
      };
    }
    // Let the first authenticated frame and its essential data requests win.
    timer = setTimeout(reveal, 900);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [user?.id]);

  return ready && user ? <DailyAIGreeting /> : null;
}

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
  useAuthenticatedFonts(!!user);

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
        (async () => {
          try {
            const registrations = await window.navigator?.serviceWorker?.getRegistrations?.();
            registrations?.forEach((registration) => registration.unregister());
          } catch {}
        })();
        if (window.caches?.keys) {
          (async () => {
            try {
              const keys = await window.caches.keys();
              await Promise.all(keys.map((key) => window.caches.delete(key)));
            } catch {}
          })();
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
      <VercelObservability />
      <PhoneFrame>
        <View style={[styles.appCanvas, { backgroundColor: theme.bg }]}>
          {/* Paper lives BEHIND the UI so posts, photos and status sit on
              top of it. A zIndex of 9999 used to paint the grid over the
              feed. */}
          {user && <SketchGraphPaper />}
          <View style={styles.appForeground}>
            <Navigation />
          </View>
        </View>
      </PhoneFrame>
      {/* Registers this device for push, syncs the unread badge, and routes
          notification taps to the exact screen. No-op on web. */}
      {user && <PushController />}
      {user && <DeferredDailyAIGreeting user={user} />}
      {user && <CallOverlay />}
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
  // Fonts load in the background; we deliberately do not gate first paint on
  // them (see the comment before the return below).
  useFonts(AUTH_FONTS);
  // Fonts load in the background. Instead of holding the first paint until
  // every TTF arrives (which made the auth screen sit on "LOADING +ONE" for
  // up to 2.5s on cold visits), we render the shell immediately with the
  // system fallback and swap in the brand fonts as they finish. This gets
  // content in front of users much sooner — the Speed Insights win — while
  // keeping the same custom type once loaded.
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <AppErrorBoundary>
        <SafeAreaProvider>
          <ThemeProvider>
            <AuthProvider>
              <ChatProvider>
                <ChatThemeProvider>
                  <Root />
                </ChatThemeProvider>
              </ChatProvider>
            </AuthProvider>
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
  appForeground: { flex: 1, width: '100%', height: '100%', zIndex: 1 },
  paperOverlay: {
    position: 'absolute', top: 0, right: 0, bottom: 0, left: 0,
    zIndex: 0,
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
