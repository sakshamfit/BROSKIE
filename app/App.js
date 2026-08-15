import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { View, StyleSheet, Platform } from 'react-native';
import {
  useFonts,
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
} from '@expo-google-fonts/inter';

import { AuthProvider } from './src/store/AuthContext';
import { ChatProvider } from './src/store/ChatContext';
import { ThemeProvider, useTheme } from './src/store/ThemeContext';
import Navigation from './src/Navigation';
import { Loading } from './src/components/common';

/** On wide screens (web preview) centre the app in a phone-sized frame. */
function PhoneFrame({ children }) {
  const { theme } = useTheme();
  if (Platform.OS !== 'web') return children;
  return (
    <View style={[styles.webRoot, { backgroundColor: theme.dark ? '#0a1210' : '#e7edf3' }]}>
      <View style={[styles.phone, { backgroundColor: theme.bg }]}>{children}</View>
    </View>
  );
}

function Root() {
  const { theme, mode } = useTheme();
  return (
    <>
      <StatusBar style={mode === 'dark' ? 'light' : 'dark'} backgroundColor={theme.bg} />
      <PhoneFrame>
        <Navigation />
      </PhoneFrame>
    </>
  );
}

export default function App() {
  const [fontsLoaded] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
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
            <Loading label="Loading BROSKIE…" />
          )}
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  webRoot: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  phone: { flex: 1, width: '100%', maxWidth: 460, maxHeight: 960, overflow: 'hidden' },
});
