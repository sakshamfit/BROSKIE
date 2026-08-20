import React, { createContext, useContext, useEffect, useMemo, useState, useCallback } from 'react';
import { useChat } from './ChatContext';
import { ThemeContext, useTheme } from './ThemeContext';
import { ThemeRegistry, resolveChatTheme } from '../chatThemes';
import { api } from '../api';

const ChatThemeContext = createContext(null);
export const useChatTheme = () => useContext(ChatThemeContext);

/**
 * Per-conversation chat themes.
 *
 * The selected theme lives on the conversation (server-side), so this store
 * keeps a light per-chatId map of the *saved* theme id and re-syncs it from
 * three sources:
 *   - chat summaries (initial load, chat:updated, chat:new)
 *   - the dedicated `chat:theme` socket event (instant realtime updates)
 *   - its own optimistic writes while an apply is in flight
 *
 * `applyTheme` is optimistic with rollback: the chat previews the new theme
 * immediately, and if the server rejects/save fails, the previous persisted
 * theme is restored and an error flag is surfaced for a small non-blocking
 * notice. Unknown ids always fall back to `graphite`.
 */
export function ChatThemeProvider({ children }) {
  const { chats, onChatThemeEvent } = useChat();
  const [live, setLive] = useState({});        // chatId -> { themeId, updatedBy, updatedAt, optimistic? }
  const [applyState, setApplyState] = useState({}); // chatId -> { saving?, error? }

  // Sync from chat summaries (initial fetch + chat:updated/new). Entries
  // marked optimistic are left alone until the server confirms.
  useEffect(() => {
    setLive((prev) => {
      let changed = false;
      const next = { ...prev };
      chats.forEach((c) => {
        if (!c.themeId) return;
        const local = next[c.id];
        if (local?.optimistic) return;
        if (!local || local.themeId !== c.themeId || local.updatedAt !== c.themeUpdatedAt) {
          next[c.id] = { themeId: c.themeId, updatedBy: c.themeUpdatedBy, updatedAt: c.themeUpdatedAt };
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [chats]);

  // Realtime: someone else (or another tab) changed this chat's theme.
  useEffect(() => onChatThemeEvent((ev, payload) => {
    if (ev !== 'chat:theme') return;
    setLive((prev) => ({
      ...prev,
      [payload.chatId]: { themeId: payload.themeId, updatedBy: payload.themeUpdatedBy, updatedAt: payload.themeUpdatedAt },
    }));
  }), [onChatThemeEvent]);

  /** The persisted theme id for a chat (falls back to the chat summary, then graphite). */
  const savedThemeIdFor = useCallback((chatId) => {
    const fromLive = live[chatId]?.themeId;
    if (fromLive) return fromLive;
    const fromChat = chats.find((c) => c.id === chatId)?.themeId;
    return fromChat || 'graphite';
  }, [live, chats]);

  /** Resolved id: picker preview wins; unknown ids collapse to graphite. */
  const themeIdFor = useCallback((chatId, overrideId) => {
    const id = overrideId || savedThemeIdFor(chatId);
    return ThemeRegistry.has(id) ? id : 'graphite';
  }, [savedThemeIdFor]);

  /** Save a theme for a conversation. Optimistic; rolls back on failure. Resolves true on success. */
  const applyTheme = useCallback(async (chatId, themeId) => {
    if (!chatId || !ThemeRegistry.has(themeId)) return false;
    const prevId = savedThemeIdFor(chatId);
    setLive((p) => ({ ...p, [chatId]: { themeId, optimistic: true } }));
    setApplyState((p) => ({ ...p, [chatId]: { saving: true } }));
    try {
      const res = await api.setChatTheme(chatId, themeId);
      setLive((p) => ({
        ...p,
        [chatId]: {
          themeId: res.themeId || themeId,
          updatedBy: res.themeUpdatedBy || null,
          updatedAt: res.themeUpdatedAt || null,
        },
      }));
      setApplyState((p) => ({ ...p, [chatId]: { saving: false } }));
      return true;
    } catch (e) {
      // Never keep a theme that was not actually saved — restore the
      // previous persisted theme and let the UI show a small error.
      setLive((p) => ({ ...p, [chatId]: { themeId: prevId } }));
      setApplyState((p) => ({ ...p, [chatId]: { saving: false, error: true } }));
      return false;
    }
  }, [savedThemeIdFor]);

  const clearApplyError = useCallback((chatId) => {
    setApplyState((p) => (p[chatId]?.error ? { ...p, [chatId]: { ...p[chatId], error: false } } : p));
  }, []);

  const value = useMemo(() => ({
    savedThemeIdFor, themeIdFor, applyTheme, applyState, clearApplyError,
  }), [savedThemeIdFor, themeIdFor, applyTheme, applyState, clearApplyError]);

  return <ChatThemeContext.Provider value={value}>{children}</ChatThemeContext.Provider>;
}

/**
 * Scope that re-provides the app ThemeContext with the resolved chat theme,
 * so every widget rendered inside a conversation (bubbles, composer, sheets)
 * automatically consumes the active ChatTheme — no per-component threading,
 * no scattered hard-coded colors.
 *
 * `overrideThemeId` is the picker's live preview: while set, the chat renders
 * with that theme but nothing is persisted until the user hits Apply.
 */
export function ChatThemeScope({ chatId, overrideThemeId, children }) {
  const { themeIdFor = () => 'graphite' } = useChatTheme() || {};
  const { theme: baseTheme, mode, preference, setThemePreference, toggle } = useTheme();
  const chatTheme = ThemeRegistry.get(themeIdFor(chatId, overrideThemeId));
  const theme = useMemo(() => resolveChatTheme(baseTheme, chatTheme), [baseTheme, chatTheme]);

  const value = useMemo(() => ({
    theme,
    globalTheme: baseTheme,
    mode, preference, setThemePreference, toggle,
  }), [theme, baseTheme, mode, preference, setThemePreference, toggle]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
