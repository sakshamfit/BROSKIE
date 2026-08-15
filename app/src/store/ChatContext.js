import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import { io } from 'socket.io-client';
import { API_URL, api } from '../api';
import { useAuth } from './AuthContext';

const ChatContext = createContext(null);
export const useChat = () => useContext(ChatContext);

export function ChatProvider({ children }) {
  const { token, user } = useAuth();
  const [chats, setChats] = useState([]);
  const [messages, setMessages] = useState({});   // chatId -> message[]
  const [typing, setTyping] = useState({});       // chatId -> { userId: name }
  const [connected, setConnected] = useState(false);
  const socketRef = useRef(null);

  const sortChats = (list) =>
    [...list].sort((a, b) => (b.lastMessage?.createdAt || b.updatedAt) - (a.lastMessage?.createdAt || a.updatedAt));

  const upsertChat = useCallback((chat) => {
    setChats((prev) => {
      const idx = prev.findIndex((c) => c.id === chat.id);
      if (idx === -1) return sortChats([chat, ...prev]);
      const next = [...prev];
      next[idx] = chat;
      return sortChats(next);
    });
  }, []);

  /* ---------------- socket lifecycle ---------------- */
  useEffect(() => {
    if (!token) {
      socketRef.current?.disconnect();
      socketRef.current = null;
      setChats([]); setMessages({}); setConnected(false);
      return;
    }

    // API_URL === '' means same-origin (single-host deploy); socket.io handles
    // undefined by connecting to the page origin.
    const socket = io(API_URL || undefined, { auth: { token }, transports: ['websocket', 'polling'] });
    socketRef.current = socket;

    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));
    socket.on('connect_error', () => setConnected(false));

    socket.on('message:new', ({ message, tempId }) => {
      setMessages((prev) => {
        const list = prev[message.chatId] || [];
        // replace optimistic copy if present
        const withoutTemp = tempId ? list.filter((m) => m.id !== tempId) : list;
        if (withoutTemp.some((m) => m.id === message.id)) return prev;
        return { ...prev, [message.chatId]: [...withoutTemp, message] };
      });
    });

    socket.on('message:updated', (message) => {
      setMessages((prev) => {
        const list = prev[message.chatId];
        if (!list) return prev;
        return { ...prev, [message.chatId]: list.map((m) => (m.id === message.id ? message : m)) };
      });
    });

    socket.on('chat:updated', upsertChat);
    socket.on('chat:new', upsertChat);

    socket.on('presence', ({ userId, isOnline, lastSeen }) => {
      setChats((prev) => prev.map((c) => (c.otherUserId === userId ? { ...c, isOnline, lastSeen } : c)));
    });

    socket.on('typing', ({ chatId, userId, name, isTyping }) => {
      setTyping((prev) => {
        const forChat = { ...(prev[chatId] || {}) };
        if (isTyping) forChat[userId] = name; else delete forChat[userId];
        return { ...prev, [chatId]: forChat };
      });
    });

    api.chats().then(({ chats }) => setChats(sortChats(chats))).catch(() => {});

    return () => { socket.disconnect(); socketRef.current = null; };
  }, [token, upsertChat]);

  /* ---------------- actions ---------------- */

  const refreshChats = useCallback(async () => {
    const { chats } = await api.chats();
    setChats(sortChats(chats));
  }, []);

  const loadMessages = useCallback(async (chatId) => {
    const { messages: list } = await api.messages(chatId);
    setMessages((prev) => ({ ...prev, [chatId]: list }));
  }, []);

  const sendMessage = useCallback((chatId, payload) => {
    const socket = socketRef.current;
    if (!socket) return;
    const tempId = 'tmp_' + Math.random().toString(36).slice(2);

    const optimistic = {
      id: tempId,
      chatId,
      senderId: user.id,
      type: payload.type || 'text',
      body: payload.body || '',
      mediaUrl: payload.mediaUrl || null,
      duration: payload.duration || 0,
      createdAt: Date.now(),
      status: 'sending',
      reactions: [],
      replyTo: payload.replyToMessage || null,
      pending: true,
    };
    setMessages((prev) => ({ ...prev, [chatId]: [...(prev[chatId] || []), optimistic] }));

    socket.emit('message:send', { ...payload, chatId, tempId }, (res) => {
      if (res?.error) {
        setMessages((prev) => ({
          ...prev,
          [chatId]: (prev[chatId] || []).map((m) => (m.id === tempId ? { ...m, status: 'failed' } : m)),
        }));
      }
    });
  }, [user]);

  const markRead = useCallback((chatId) => {
    socketRef.current?.emit('message:read', { chatId });
    setChats((prev) => prev.map((c) => (c.id === chatId ? { ...c, unread: 0 } : c)));
  }, []);

  const setTypingState = useCallback((chatId, isTyping) => {
    socketRef.current?.emit('typing', { chatId, isTyping });
  }, []);

  const react = useCallback((messageId, emoji) => {
    socketRef.current?.emit('message:react', { messageId, emoji });
  }, []);

  const deleteMessage = useCallback((messageId) => {
    socketRef.current?.emit('message:delete', { messageId });
  }, []);

  return (
    <ChatContext.Provider
      value={{
        chats, messages, typing, connected,
        refreshChats, loadMessages, sendMessage, markRead,
        setTypingState, react, deleteMessage, upsertChat,
      }}
    >
      {children}
    </ChatContext.Provider>
  );
}
