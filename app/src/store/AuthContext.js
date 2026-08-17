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
      } catch {
        await AsyncStorage.removeItem(TOKEN_KEY);
        setToken(null);
      } finally {
        setBooting(false);
      }
    })();
  }, []);

  const persist = useCallback(async (tok, usr) => {
    setToken(tok);
    await AsyncStorage.setItem(TOKEN_KEY, tok);
    setTok(tok);
    setUser(usr);
  }, []);

  const login = useCallback(async (username, password) => {
    const { token, user } = await api.login({ username, password });
    await persist(token, user);
  }, [persist]);

  const register = useCallback(async (username, name, password, phone) => {
    const { token, user } = await api.register({ username, name, password, phone });
    await persist(token, user);
  }, [persist]);

  const logout = useCallback(async () => {
    // Always clear in-memory credentials even if device storage is unavailable.
    // Without finally, a storage error left the UI authenticated and made Log out
    // appear to do nothing.
    try {
      await AsyncStorage.removeItem(TOKEN_KEY);
    } finally {
      setToken(null);
      setTok(null);
      setUser(null);
    }
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
    <AuthContext.Provider value={{ user, token, booting, login, register, logout, updateProfile, updateSettings }}>
      {children}
    </AuthContext.Provider>
  );
}
