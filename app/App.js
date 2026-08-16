import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { View, StyleSheet, Platform } from 'react-native';
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

import { AuthProvider } from './src/store/AuthContext';
import { ChatProvider } from './src/store/ChatContext';
import { ThemeProvider, useTheme } from './src/store/ThemeContext';
import Navigation from './src/Navigation';
import { Loading } from './src/components/common';

/** On web, expand to full browser — no phone frame. */
function PhoneFrame({ children }) {
  const { theme } = useTheme();
  if (Platform.OS !== 'web') return children;
  return (
    <View style={[styles.webRoot, { backgroundColor: theme.bg }]}>
      {children}
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
            <Loading label="LOADING 友達" />
          )}
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  webRoot: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  phone: { flex: 1, width: '100%' },
});
