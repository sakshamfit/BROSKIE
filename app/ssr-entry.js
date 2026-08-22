/* SSR entry — evaluated in a Node-like environment WITHOUT window/document.
 *
 * Mirrors what any server-side / static pre-render does: import every module
 * in the app graph, mount the real component tree, and render it to HTML with
 * react-dom/server. If any module touches a browser-only global at import or
 * first-render time, this file throws instead of the production website going
 * blank.
 *
 * Built only by scripts/ssr-smoke.js (it temporarily becomes package.json
 * "main"); never part of the native or web client bundles.
 */
import React from 'react';
import { AppRegistry, Text, View } from 'react-native';
import { renderToStaticMarkup } from 'react-dom/server';
// Direct file import — Metro resolves package subpath exports unreliably,
// but platform-specific file paths always resolve. Same module instance the
// bundled expo-font uses, so the AsyncLocalStorage store is shared.
import { withServerContext } from 'expo-font/build/serverContext.web.js';

import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeProvider } from './src/store/ThemeContext';
import { AuthProvider } from './src/store/AuthContext';
import { ChatProvider } from './src/store/ChatContext';
import { ChatThemeProvider } from './src/store/ChatThemeContext';
import { Loading } from './src/components/common';
import Navigation from './src/Navigation';
import AuthScreen from './src/screens/AuthScreen';

import App from './App';

AppRegistry.registerComponent('main', () => App);

const failures = [];

const ZERO_METRICS = {
  insets: { top: 0, bottom: 0, left: 0, right: 0 },
  frame: { x: 0, y: 0, width: 0, height: 0 },
};

function probe(name, element) {
  try {
    const out = renderToStaticMarkup(element);
    if (out.length < 40) failures.push(`PROBE ${name} rendered suspiciously small (${out.length}): ${out.slice(0, 200)}`);
  } catch (error) {
    failures.push(`PROBE ${name} THREW: ${String((error && error.stack) || error).slice(0, 600)}`);
  }
}

function run() {
  // Layer-by-layer probes: pinpoint which provider/screen breaks a server
  // render instead of debugging one giant empty tree.
  probe('plain', <View><Text>hello-ssr</Text></View>);
  probe('ghroot', <GestureHandlerRootView style={{ flex: 1 }}><View><Text>inside-gh</Text></View></GestureHandlerRootView>);
  probe('safearea', <SafeAreaProvider initialMetrics={ZERO_METRICS}><View><Text>inside-safe</Text></View></SafeAreaProvider>);
  probe('providers', (
    <ThemeProvider>
      <AuthProvider>
        <ChatProvider>
          <ChatThemeProvider>
            <SafeAreaProvider initialMetrics={ZERO_METRICS}>
              <Loading label="PROBE-ALL" />
            </SafeAreaProvider>
          </ChatThemeProvider>
        </ChatProvider>
      </AuthProvider>
    </ThemeProvider>
  ));
  probe('nav', (
    <ThemeProvider>
      <AuthProvider>
        <SafeAreaProvider initialMetrics={ZERO_METRICS}>
          <Navigation />
        </SafeAreaProvider>
      </AuthProvider>
    </ThemeProvider>
  ));
  // The signed-out first paint — exactly what a static pre-render captures.
  probe('auth', (
    <ThemeProvider>
      <AuthProvider>
        <SafeAreaProvider initialMetrics={ZERO_METRICS}>
          <AuthScreen />
        </SafeAreaProvider>
      </AuthProvider>
    </ThemeProvider>
  ));

  const application = AppRegistry.getApplication('main', {});

  // expo-font's server context collects @font-face CSS during a server
  // render; SSR hosts wrap the render in withServerContext().
  return withServerContext(() => {
    // Style extraction runs the full RNW StyleSheet server path.
    const css = renderToStaticMarkup(application.getStyleElement());
    if (typeof css !== 'string' || css.length < 100) {
      failures.push('style element rendered empty');
    }

    const html = renderToStaticMarkup(application.element);
    if (typeof html !== 'string' || html.length < 500) {
      failures.push(`app markup suspiciously small (${html.length}): ${html.slice(0, 400)}`);
    }
    return html;
  });
}

try {
  const html = run();
  globalThis.__SSR_RESULT__ = {
    ok: failures.length === 0,
    failures,
    length: html.length,
    showsBootScreen: html.includes('LOADING +ONE') || html.includes('STARTING +ONE'),
    preview: html.slice(0, 600),
  };
} catch (error) {
  globalThis.__SSR_RESULT__ = {
    ok: false,
    failures: [...failures, String((error && error.stack) || error)],
    length: 0,
    showsBootScreen: false,
    preview: '',
  };
}
