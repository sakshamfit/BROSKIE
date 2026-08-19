import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api, setToken } from '../api';

const AuthContext = createContext(null);
export const useAuth = () => useContext(AuthContext);

const TOKEN_KEY = 'tomodachi.token';

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [token, setTok] = useState(null);
  const [booting, setBooting] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const saved = await AsyncStorage.getItem(TOKEN_KEY);
        if (saved) {
          setToken(saved);
          const { user } = await api.me();
          setUser(user);
          setTok(saved);
        }
      } catch (error) {
        // A temporary network outage must not erase a valid remembered
        // session. Only a real 401 means the token itself is no longer valid.
        if (error?.status === 401) {
          await AsyncStorage.removeItem(TOKEN_KEY).catch(() => {});
          setToken(null);
        } else if (typeof __DEV__ !== 'undefined' && __DEV__) {
          console.warn('Could not restore session:', error?.technicalMessage || error?.message);
        }
      } finally {
        setBooting(false);
      }
    })();
  }, []);

  const persist = useCallback(async (tok, usr) => {
    // Complete the live sign-in immediately; slow or unavailable device
    // storage should only affect the next launch, never the current session.
    setToken(tok);
    setTok(tok);
    setUser(usr);
    try {
      await AsyncStorage.setItem(TOKEN_KEY, tok);
    } catch (error) {
      if (typeof __DEV__ !== 'undefined' && __DEV__) {
        console.warn('Could not remember this session:', error?.message);
      }
    }
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
    return AsyncStorage.removeItem(TOKEN_KEY).catch((error) => {
      if (typeof __DEV__ !== 'undefined' && __DEV__) {
        console.warn('Could not clear remembered session:', error?.message);
      }
    });
  }, []);

  const refreshUser = useCallback(async () => {
    const { user: fresh } = await api.me();
    setUser(fresh);
    return fresh;
  }, []);

  const updateProfile = useCallback(async (patch) => {
    const { user } = await api.updateMe(patch);
    setUser((prev) => ({ ...prev, ...user }));
    return user;
  }, []);

  const updateSettings = useCallback(async (patch) => {
    const { settings } = await api.updateSettings(patch);
    setUser((prev) => (prev ? { ...prev, settings } : prev));
    return settings;
  }, []);

  return (
    <AuthContext.Provider value={{ user, token, booting, login, register, logout, refreshUser, updateProfile, updateSettings }}>
      {children}
    </AuthContext.Provider>
  );
}
