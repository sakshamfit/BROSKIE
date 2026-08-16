import React, { createContext, useContext, useEffect, useState, useMemo } from 'react';
import { useColorScheme } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { lightTheme, darkTheme } from '../theme';

const ThemeContext = createContext(null);
export const useTheme = () => useContext(ThemeContext);

const KEY = 'tomodachi.theme';

/**
 * `preference` is what's persisted: 'light' | 'dark' | 'system'.
 * `mode` is the RESOLVED value ('light' | 'dark') the rest of the app reads,
 * so screens don't need to know about 'system' at all — it's already
 * followed the OS appearance (iOS Settings / Android system theme) by the
 * time `theme` is handed out.
 */
export function ThemeProvider({ children }) {
  const systemScheme = useColorScheme(); // 'light' | 'dark' | null, live-updates on OS change
  const [preference, setPreference] = useState('system');

  useEffect(() => {
    AsyncStorage.getItem(KEY).then((v) => {
      if (v === 'light' || v === 'dark' || v === 'system') setPreference(v);
    });
  }, []);

  const mode = preference === 'system' ? (systemScheme === 'dark' ? 'dark' : 'light') : preference;

  const setThemePreference = (next) => {
    setPreference(next);
    AsyncStorage.setItem(KEY, next);
  };

  /** Back-compat: cycles light <-> dark, opting OUT of following the system. */
  const toggle = () => setThemePreference(mode === 'dark' ? 'light' : 'dark');

  const theme = useMemo(() => (mode === 'dark' ? darkTheme : lightTheme), [mode]);

  return (
    <ThemeContext.Provider value={{ theme, mode, preference, setThemePreference, toggle }}>
      {children}
    </ThemeContext.Provider>
  );
}
