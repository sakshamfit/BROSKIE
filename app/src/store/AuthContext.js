import React, { createContext, useContext, useEffect, useState, useCallback, useMemo } from 'react';
import { AppState } from 'react-native';
import { appStorage } from '../storage';
import { api, setToken } from '../api';

const AuthContext = createContext(null);
export const useAuth = () => useContext(AuthContext);

const TOKEN_KEY = 'tomodachi.token';
const USER_KEY = 'tomodachi.user';

function parseCachedUser(raw) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed?.id ? parsed : null;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [token, setTok] = useState(null);
  const [booting, setBooting] = useState(true);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const [saved, cachedRaw] = await Promise.all([
          appStorage.getItem(TOKEN_KEY),
          appStorage.getItem(USER_KEY),
        ]);
        if (!saved) return;

        const cachedUser = parseCachedUser(cachedRaw);
        setToken(saved);
        setTok(saved);
        if (cachedUser) {
          // The token + user snapshot is enough to draw the signed-in shell.
          // Restore the authoritative account in the background instead of
          // holding the whole app on a spinner during a slow/cold Railway boot.
          setUser(cachedUser);
          if (active) setBooting(false);
        }

        try {
          const { user: restored } = await api.restoreSession();
          if (!active) return;
          setUser(restored);
          appStorage.setItem(USER_KEY, JSON.stringify(restored)).catch(() => {});
        } catch (error) {
          // A temporary network outage must not erase a valid remembered
          // session. Only a real 401 means the token itself is no longer valid.
          if (error?.status === 401) {
            await Promise.all([
              appStorage.removeItem(TOKEN_KEY).catch(() => {}),
              appStorage.removeItem(USER_KEY).catch(() => {}),
            ]);
            setToken(null);
            setTok(null);
            setUser(null);
          } else if (typeof __DEV__ !== 'undefined' && __DEV__) {
            console.warn('Could not restore session:', error?.technicalMessage || error?.message);
          }
        }
      } finally {
        if (active) setBooting(false);
      }
    })();
    return () => { active = false; };
  }, []);

  const persist = useCallback(async (tok, usr) => {
    // Complete the live sign-in immediately; slow or unavailable device
    // storage should only affect the next launch, never the current session.
    setToken(tok);
    setTok(tok);
    setUser(usr);
    // Device storage is only for the next launch. Do not make the user wait
    // for a slow AsyncStorage/IndexedDB write after the live session is ready.
    Promise.all([
      appStorage.setItem(TOKEN_KEY, tok),
      appStorage.setItem(USER_KEY, JSON.stringify(usr)),
    ]).catch((error) => {
      if (typeof __DEV__ !== 'undefined' && __DEV__) {
        console.warn('Could not remember this session:', error?.message);
      }
    });
  }, []);

  const login = useCallback(async (username, password) => {
    const { token, user } = await api.login({ username, password });
    await persist(token, user);
  }, [persist]);

  const register = useCallback(async (username, name, password, phone) => {
    const { token, user } = await api.register({ username, name, password, phone });
    await persist(token, user);
  }, [persist]);

  const logout = useCallback(() => {
    // Clear the active app session first. This must never wait on device
    // storage: browser privacy modes or a storage failure previously kept the
    // old screen mounted and made Log out appear to do nothing.
    setToken(null);
    setTok(null);
    setUser(null);

    // Removing the remembered token is best-effort; a failure here must not
    // prevent the current session from ending.
    return (async () => {
      try {
        await Promise.all([
          appStorage.removeItem(TOKEN_KEY),
          appStorage.removeItem(USER_KEY),
        ]);
      } catch (error) {
        if (typeof __DEV__ !== 'undefined' && __DEV__) {
          console.warn('Could not clear remembered session:', error?.message);
        }
      }
    })();
  }, []);

  const refreshUser = useCallback(async () => {
    const { user: fresh } = await api.me();
    setUser(fresh);
    appStorage.setItem(USER_KEY, JSON.stringify(fresh)).catch(() => {});
    return fresh;
  }, []);

  // Settings and profile data can change from another device while this app
  // remains installed. Refresh the account whenever the app returns to the
  // foreground so screens do not keep displaying a stale settings snapshot.
  useEffect(() => {
    if (!token) return undefined;

    let disposed = false;
    let refreshing = false;
    const refreshOnForeground = async () => {
      if (disposed || refreshing) return;
      refreshing = true;
      try {
        await refreshUser();
      } catch (error) {
        // A temporary offline period must not log the user out or interrupt
        // the current screen; the next foreground transition retries it.
        if (typeof __DEV__ !== 'undefined' && __DEV__) {
          console.warn('Could not refresh account settings:', error?.technicalMessage || error?.message);
        }
      } finally {
        refreshing = false;
      }
    };

    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') refreshOnForeground();
    });

    return () => {
      disposed = true;
      subscription.remove();
    };
  }, [token, refreshUser]);

  const updateProfile = useCallback(async (patch) => {
    const { user } = await api.updateMe(patch);
    setUser((prev) => {
      const next = { ...prev, ...user };
      appStorage.setItem(USER_KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });
    return user;
  }, []);

  const applySettings = useCallback((settings) => {
    if (!settings) return;
    setUser((prev) => {
      if (!prev) return prev;
      const next = { ...prev, settings };
      appStorage.setItem(USER_KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });
  }, []);

  const updateSettings = useCallback(async (patch) => {
    const { settings } = await api.updateSettings(patch);
    setUser((prev) => {
      if (!prev) return prev;
      const next = { ...prev, settings };
      appStorage.setItem(USER_KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });
    return settings;
  }, []);

  const value = useMemo(() => ({
    user, token, booting, login, register, logout, refreshUser, updateProfile, applySettings, updateSettings,
  }), [user, token, booting, login, register, logout, refreshUser, updateProfile, applySettings, updateSettings]);

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}
