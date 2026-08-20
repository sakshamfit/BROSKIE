import React, { createContext, useContext, useEffect, useState, useMemo } from 'react';
import { useColorScheme } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { lightTheme, darkTheme, kineticInkTheme } from '../theme';

const ThemeContext = createContext(null);
export const useTheme = () => useContext(ThemeContext);
// Raw context export: ChatThemeScope (per-conversation chat themes) re-provides
// a chat-resolved theme to everything rendered inside a conversation.
export { ThemeContext };

const KEY = 'tomodachi.theme';

/**
 * `preference` is what's persisted: 'light' | 'dark' | 'kinetic' | 'system'.
 * `mode` is the RESOLVED value ('light' | 'dark') the rest of the app reads,
 * so screens don't need to know about 'system' at all — it's already
 * followed the OS appearance (iOS Settings / Android system theme) by the
 * time `theme` is handed out.
 */
export function ThemeProvider({ children }) {
  const systemScheme = useColorScheme(); // 'light' | 'dark' | null, live-updates on OS change
  // Light is the default so first launch (and anyone who never picked a theme)
  // always opens on the brighter paper palette instead of following a dark OS.
  const [preference, setPreference] = useState('light');

  useEffect(() => {
    AsyncStorage.getItem(KEY).then((v) => {
      if (v === 'light' || v === 'dark' || v === 'kinetic' || v === 'system') setPreference(v);
    });
  }, []);

  const mode = preference === 'system' ? (systemScheme === 'dark' ? 'dark' : 'light') : preference;

  const setThemePreference = (next) => {
    setPreference(next);
    AsyncStorage.setItem(KEY, next);
  };

  /** Back-compat: cycles light <-> dark, opting OUT of following the system. */
  const toggle = () => setThemePreference(mode === 'dark' ? 'light' : 'dark');

  const theme = useMemo(() => (mode === 'kinetic' ? kineticInkTheme : mode === 'dark' ? darkTheme : lightTheme), [mode]);

  return (
    <ThemeContext.Provider value={{ theme, mode, preference, setThemePreference, toggle }}>
      {children}
    </ThemeContext.Provider>
  );
}
