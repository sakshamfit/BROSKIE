import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import {
  View, Text, FlatList, TextInput, Pressable, StyleSheet, KeyboardAvoidingView,
  Platform, Modal, Image, ActivityIndicator, Alert, Keyboard,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from '../icons/Icon';
import Emoji, { EmojiText } from '../icons/Emoji';
import * as ImagePicker from 'expo-image-picker';
import {
  RecordingPresets, requestRecordingPermissionsAsync, setAudioModeAsync,
  useAudioRecorder, useAudioRecorderState,
} from 'expo-audio';
import { useChat } from '../store/ChatContext';
import { useAuth } from '../store/AuthContext';
import { useTheme } from '../store/ThemeContext';
import { useChatTheme, ChatThemeScope } from '../store/ChatThemeContext';
import useResponsive from '../hooks/useResponsive';
import {
  Avatar, formatDayLabel, InkField, InkIconButton, Rule, rippleFor,
  FrostedBackdrop, GoldTick, hasGoldTick, PaperCard,
} from '../components/common';
import MessageBubble, { DISAPPEAR_OPTIONS } from '../components/MessageBubble';
import ReplyBar from '../components/ReplyBar';
import ChatBackground from '../components/ChatBackground';
import { ThemeRegistry, alpha } from '../chatThemes';
import { FadeSlide, TypingDots, FloatLoop, SheetSpringIn, SpringPressable, IconSwap, Pop, haptic, motion } from '../motion';
import { api } from '../api';
import { setViewedChat } from '../push/notifications';
import { radius, type, inkBox, marker, dashedRule, stroke, raised } from '../theme';
import { throttle } from '../rateLimit';
import ImageLightbox from '../components/ImageLightbox';
import { lazyComponent } from '../lazy';

const EmojiPicker = lazyComponent(() => import('../components/EmojiPicker'));
const ForwardSheet = lazyComponent(() => import('../components/ForwardSheet'));
const PollComposer = lazyComponent(() => import('../components/PollComposer'));
const ThemePickerSheet = lazyComponent(() => import('../components/ThemePickerSheet'));
const CollabDocumentView = lazyComponent(() => import('../components/CollabDocumentView'));

/**
 * GCChatScreen — the GC chat environment.
 *
 * This is a SEPARATE chat screen from ConversationScreen. It reads only the
 * GC store (gc-chat:{gcId} cache, gc:message events, gc:{id} socket room),
 * shows a GC header (name + member count), and Back always returns to the
 * GC detail/list — never the normal Chats tab. Direct chats stay 100%
 * untouched.
 */
function GCConversationContent({ route, navigation, embedded = false, themePicker = null }) {
  const { chatId } = route.params || {};
  const {
    gcChats, gcMessages, gcMessagesLoaded, gcMessagesLoading, gcMessageErrors,
    gcTyping, refreshGCs, loadGCMessages, loadOlderGCMessages, sendGCMessage, retryGCMessage,
    editGCMessage, markGCRead, setGCTypingState, joinGCRoom, leaveGCRoom,
    react, deleteMessage, createPoll, votePoll, socketRef, setGcMessages,
  } = useChat();
  const socket = socketRef?.current || null;
  const { user } = useAuth();
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useResponsive();
  const audioRecorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const audioRecorderState = useAudioRecorderState(audioRecorder, 100);

  const chat = gcChats.find((c) => c.id === chatId);
  const list = gcMessages[chatId] || [];
  const messageHistoryLoaded = !!gcMessagesLoaded[chatId];
  const messageHistoryLoading = !!gcMessagesLoading[chatId];
  const messageHistoryError = gcMessageErrors[chatId] || null;

  const [text, setText] = useState('');
  const [cursor, setCursor] = useState(0);
  const [replyTo, setReplyTo] = useState(null);
  const [editing, setEditing] = useState(null);
  const [replyHighlightId, setReplyHighlightId] = useState(null);
  const [replyMissing, setReplyMissing] = useState(false);
  const replyHighlightTimer = useRef(null);
  const replyMissingTimer = useRef(null);
  const [showEmoji, setShowEmoji] = useState(false);
  const [lightbox, setLightbox] = useState(null);
  const [reportMsg, setReportMsg] = useState(null);
  const [reportReason, setReportReason] = useState('');
  const [reportNote, setReportNote] = useState('');
  const [reportBusy, setReportBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [recording, setRecording] = useState(false);
  const [voiceBusy, setVoiceBusy] = useState(false);
  const holdStartedAt = useRef(0);
  const pressOwnsRecording = useRef(false);
  const recordingStarting = useRef(false);
  const stopWhileStarting = useRef(null);
  const recordingStartedAt = useRef(0);
  const listRef = useRef(null);
  const inputRef = useRef(null);
  const typingTimer = useRef(null);
  const typingThrottle = useRef(null);
  const suppressFocusScroll = useRef(false);
  const suppressScrollToEnd = useRef(false);
  const recSecs = Math.max(0, Math.floor((audioRecorderState.durationMillis || 0) / 1000));
  const [forwardMsg, setForwardMsg] = useState(null);
  const [timerMsg, setTimerMsg] = useState(null);
  const [pollOpen, setPollOpen] = useState(false);
  const [docsOpen, setDocsOpen] = useState(false);
  const [overflowOpen, setOverflowOpen] = useState(false);
  const loadingOlderRef = useRef(false);

  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const keyboardScrollTimer = useRef(null);
  const scrollToLatest = useCallback((delay = 0) => {
    clearTimeout(keyboardScrollTimer.current);
    keyboardScrollTimer.current = setTimeout(() => {
      listRef.current?.scrollToEnd({ animated: delay > 0 });
    }, delay);
  }, []);

  /* ---- open/close the GC environment: join room, load, leave, cleanup ---- */
  useEffect(() => {
    if (!chatId) return undefined;
    joinGCRoom(chatId);
    loadGCMessages(chatId).catch(() => {});
    setViewedChat(chatId);
    return () => {
      leaveGCRoom(chatId);
      setViewedChat(null);
      setGCTypingState(chatId, false);
      try {
        if (audioRecorder.getStatus?.()?.isRecording) audioRecorder.stop().catch(() => {});
      } catch {}
      setAudioModeAsync({ allowsRecording: false }).catch(() => {});
    };
  }, [chatId, joinGCRoom, leaveGCRoom, loadGCMessages, setGCTypingState, audioRecorder]);

  // Membership revoked (gc:removed) / GC gone → back to GC section.
  useEffect(() => {
    if (!chat && messageHistoryLoaded) {
      const t = setTimeout(() => {
        if (navigation?.canGoBack?.()) navigation.goBack();
      }, 1600);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [chat, messageHistoryLoaded, navigation]);

  useEffect(() => {
    if (!chat && !messageHistoryLoaded && !messageHistoryLoading) {
      refreshGCs().catch(() => {});
    }
  }, [chat, messageHistoryLoaded, messageHistoryLoading, refreshGCs]);

  useEffect(() => {
    if (chatId && list.length) markGCRead(chatId);
  }, [chatId, list.length, markGCRead]);

  /* ---- keyboard handling (same as the direct chat screen) ---- */
  useEffect(() => {
    if (Platform.OS === 'web') return undefined;
    const keyboardHeightFrom = (event) => {
      const eventHeight = Number(event?.endCoordinates?.height) || 0;
      const top = Number(event?.endCoordinates?.screenY);
      const overlapHeight = Number.isFinite(top) && top > 0 && windowHeight > 0
        ? Math.max(0, windowHeight - top)
        : 0;
      const height = overlapHeight > 0 ? overlapHeight : (top > 0 ? 0 : eventHeight);
      if (height > 0) setKeyboardHeight(height);
      if (!suppressFocusScroll.current) scrollToLatest(120);
    };
    const onHide = () => { clearTimeout(keyboardScrollTimer.current); setKeyboardHeight(0); };
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSub = Keyboard.addListener(showEvent, keyboardHeightFrom);
    const hideSub = Keyboard.addListener(hideEvent, onHide);
    const frameSub = Platform.OS === 'android'
      ? Keyboard.addListener('keyboardDidChangeFrame', keyboardHeightFrom)
      : null;
    return () => {
      showSub.remove(); hideSub.remove(); frameSub?.remove();
      clearTimeout(keyboardScrollTimer.current);
    };
  }, [scrollToLatest, windowHeight]);

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined' || !window.visualViewport) return undefined;
    const viewport = window.visualViewport;
    const update = () => {
      const layoutHeight = Number(window.innerHeight) || 0;
      const visualHeight = Number(viewport.height) || layoutHeight;
      const offsetTop = Number(viewport.offsetTop) || 0;
      const inset = Math.max(0, layoutHeight - visualHeight - offsetTop);
      setKeyboardHeight(inset);
      if (inset > 0 && !suppressFocusScroll.current) scrollToLatest(80);
    };
    update();
    viewport.addEventListener('resize', update);
    viewport.addEventListener('scroll', update);
    return () => { viewport.removeEventListener('resize', update); viewport.removeEventListener('scroll', update); };
  }, [scrollToLatest]);

  useEffect(() => () => {
    clearTimeout(replyHighlightTimer.current);
    clearTimeout(replyMissingTimer.current);
  }, []);

  const s = makeStyles(theme);

  if (!chat) {
    return (
      <View style={[s.center, { backgroundColor: theme.bg, padding: 28 }]}>
        <ActivityIndicator color={theme.primary} />
        <Text style={[type.labelSm, { color: theme.muted, marginTop: 14 }]}>OPENING GC…</Text>
        <Pressable onPress={() => refreshGCs().catch(() => {})} style={[inkBox(theme, 'thin'), { marginTop: 18, paddingHorizontal: 16, paddingVertical: 9 }]}>
          <Text style={[type.labelSm, { color: theme.ink }]}>RETRY</Text>
        </Pressable>
        {!embedded && (
          <Pressable onPress={() => navigation.goBack()} style={{ marginTop: 12, padding: 8 }}>
            <Text style={[type.labelSm, { color: theme.subtext }]}>BACK TO GCs</Text>
          </Pressable>
        )}
      </View>
    );
  }

  const typers = Object.values(gcTyping[chatId] || {});
  const subtitle = chat.members
    ? chat.members.map((m) => (m?.id === user.id ? 'You' : String(m?.name || 'Unknown').split(' ')[0])).join(', ')
    : '';

  const nameFor = useCallback((id) => {
    if (id === user.id) return 'You';
    const m = chat?.members?.find((x) => x.id === id);
    return m ? m.name : 'Unknown';
  }, [chat, user]);

  const replyPayload = (msg = replyTo) => (msg ? {
    replyTo: msg.id,
    replyToMessage: {
      id: msg.id, senderId: msg.senderId, senderName: nameFor(msg.senderId),
      type: msg.type, body: msg.body,
    },
  } : {});

  const handleReply = useCallback((message) => {
    if (!message || message.deleted) return;
    setReplyTo(message);
    setShowEmoji(false);
    suppressFocusScroll.current = true;
    setTimeout(() => inputRef.current?.focus(), 180);
    setTimeout(() => { suppressFocusScroll.current = false; }, 700);
  }, []);

  const mentionMatch = text.slice(0, cursor).match(/(?:^|\s)@([a-zA-Z0-9_]{0,30})$/);
  const mentionQuery = mentionMatch ? mentionMatch[1].toLowerCase() : null;
  const mentionSuggestions = mentionQuery === null ? [] : [
    ...(chat?.members || []).filter((m) => m.id !== user.id && m.username && (`${m.username} ${m.name || ''}`).toLowerCase().includes(mentionQuery)).slice(0, 8),
    ...(chat?.members?.some((m) => m.role === 'admin' && m.id === user.id) && 'everyone'.includes(mentionQuery) ? [{ id: 'everyone', username: 'everyone', name: 'Everyone' }] : []),
  ];
  const selectMention = (member) => {
    const start = cursor - (mentionMatch?.[1]?.length || 0) - 1;
    const next = `${text.slice(0, start)}@${member.username} ${text.slice(cursor)}`;
    setText(next); setCursor(start + member.username.length + 2); inputRef.current?.focus();
  };

  const onChangeText = (v) => {
    setText(v);
    if (!typingThrottle.current) {
      typingThrottle.current = throttle((id) => setGCTypingState(id, true), 2000, { leading: true, trailing: false });
    }
    typingThrottle.current(chatId);
    clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() => setGCTypingState(chatId, false), 1600);
  };

  const send = () => {
    const body = text.trim();
    if (!body) return;
    haptic('impact');
    if (editing) {
      editGCMessage(editing.id, body, { baseVersion: editing.otVersion || 0 })
        .then(() => {}).catch((e) => console.warn('gc edit failed', e.message));
      setEditing(null);
      setText('');
      setGCTypingState(chatId, false);
      return;
    }
    const mentionTokens = [...body.matchAll(/@([a-zA-Z0-9_]+)/g)].map((m) => {
      const member = (chat?.members || []).find((x) => x.username?.toLowerCase() === m[1].toLowerCase());
      return member ? { userId: member.id, username: member.username } : null;
    }).filter(Boolean);
    if (body.toLowerCase().includes('@everyone')) mentionTokens.push({ userId: 'everyone', username: 'everyone' });
    sendGCMessage(chatId, { type: 'text', body, mentions: mentionTokens, ...replyPayload() });
    setText(''); setReplyTo(null); setShowEmoji(false); setGCTypingState(chatId, false);
  };

  const pickImage = async () => {
    try {
      const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.55 });
      if (res.canceled || !res.assets?.length) return;
      const asset = res.assets[0];
      sendGCMessage(chatId, {
        type: 'image', mediaUrl: asset.uri, localMediaUri: asset.uri,
        mimeType: asset.mimeType || 'image/jpeg', body: '', ...replyPayload(),
      });
      setReplyTo(null);
    } catch (e) {
      console.warn('gc image send failed', e.message);
    }
  };

  const restorePlaybackAudioMode = () => setAudioModeAsync({
    allowsRecording: false, playsInSilentMode: true, interruptionMode: 'duckOthers',
    shouldPlayInBackground: false, shouldRouteThroughEarpiece: false,
  }).catch(() => {});

  const startRecording = async () => {
    if (recording || voiceBusy || recordingStarting.current) return;
    recordingStarting.current = true;
    stopWhileStarting.current = null;
    setVoiceBusy(true);
    let becameLive = false;
    try {
      const permission = await requestRecordingPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('Microphone permission needed', 'Allow microphone access in your device settings to record voice notes.');
        return;
      }
      await setAudioModeAsync({
        allowsRecording: true, playsInSilentMode: true, interruptionMode: 'doNotMix',
        shouldPlayInBackground: false, shouldRouteThroughEarpiece: false,
      });
      await audioRecorder.prepareToRecordAsync();
      recordingStartedAt.current = Date.now();
      audioRecorder.record();
      becameLive = true;
      setRecording(true);
      setShowEmoji(false);
    } catch (error) {
      console.warn('gc voice recording failed to start', error?.message);
      Alert.alert('Could not record', error?.message || 'The microphone could not be started.');
      await restorePlaybackAudioMode();
    } finally {
      recordingStarting.current = false;
      setVoiceBusy(false);
      if (becameLive && stopWhileStarting.current !== null) {
        const shouldSend = stopWhileStarting.current;
        stopWhileStarting.current = null;
        stopRecording(shouldSend);
      }
    }
  };

  const stopRecording = async (shouldSend = true) => {
    if (recordingStarting.current) {
      stopWhileStarting.current = shouldSend;
      return;
    }
    if (!recording || voiceBusy) return;
    const elapsedMs = Math.max(
      audioRecorderState.durationMillis || 0,
      recordingStartedAt.current ? Date.now() - recordingStartedAt.current : 0
    );
    setVoiceBusy(true);
    try {
      await audioRecorder.stop();
      const uri = audioRecorder.uri || audioRecorder.getStatus?.()?.url;
      setRecording(false);
      await restorePlaybackAudioMode();
      if (!shouldSend) return;
      if (elapsedMs < 600) { Alert.alert('Voice note too short', 'Record for at least one second.'); return; }
      if (!uri) throw new Error('The recording file was not created');
      const web = Platform.OS === 'web';
      const fileName = `voice-${Date.now()}.${web ? 'webm' : 'm4a'}`;
      const mimeType = web ? 'audio/webm' : 'audio/m4a';
      const { url } = await api.uploadFile(uri, fileName, mimeType);
      sendGCMessage(chatId, { type: 'voice', mediaUrl: url, duration: Math.max(1, Math.round(elapsedMs / 1000)), body: '', ...replyPayload() });
      setReplyTo(null);
    } catch (error) {
      console.warn('gc voice note failed', error?.message);
      setRecording(false);
      await restorePlaybackAudioMode();
      Alert.alert('Voice note failed', error?.message || 'The recording could not be sent.');
    } finally {
      recordingStartedAt.current = 0;
      setVoiceBusy(false);
    }
  };

  const cancelRecording = () => stopRecording(false);

  const handleDeleteForMe = useCallback((message) => {
    if (!message) return;
    // GC-only local removal (the direct-chat removeMessageLocal never runs
    // here) — then the server hides it only for me.
    setGcMessages((prev) => {
      const list = prev[chatId] || [];
      const next = list.filter((m) => m.id !== message.id && m.clientId !== message.id);
      return next.length === list.length ? prev : { ...prev, [chatId]: next };
    });
    deleteMessage(message.id, 'me');
  }, [chatId, deleteMessage, setGcMessages]);

  const rows = useMemo(() => {
    const out = [];
    let lastDay = null;
    list.forEach((m) => {
      const ts = m.clientCreatedAt || m.createdAt;
      const day = new Date(ts).toDateString();
      if (day !== lastDay) { out.push({ _type: 'day', id: 'day_' + day, label: formatDayLabel(ts) }); lastDay = day; }
      out.push({ _type: 'msg', ...m });
    });
    return out;
  }, [list]);

  const openReply = useCallback((messageId) => {
    const idx = rows.findIndex((r) => r._type === 'msg' && r.id === messageId);
    if (idx === -1) {
      setReplyMissing(true);
      clearTimeout(replyMissingTimer.current);
      replyMissingTimer.current = setTimeout(() => setReplyMissing(false), 2000);
      return;
    }
    suppressScrollToEnd.current = true;
    listRef.current?.scrollToIndex({ index: idx, viewPosition: 0.4, animated: true });
    setReplyHighlightId(messageId);
    clearTimeout(replyHighlightTimer.current);
    replyHighlightTimer.current = setTimeout(() => {
      setReplyHighlightId(null);
      suppressScrollToEnd.current = false;
    }, 1600);
  }, [rows]);

  const startEdit = (message) => {
    setEditing(message);
    setText(message.body || '');
    setShowEmoji(false);
    if (message.otVersion == null) {
      api.getMessageEditHistory(message.id).then((r) => {
        setEditing((prev) => (prev && prev.id === message.id ? { ...prev, otVersion: r.version || 0 } : prev));
      }).catch(() => {});
    }
  };

  const toggleStar = async (message) => {
    try {
      const { starred } = message.starred ? await api.unstarMessage(message.id) : await api.starMessage(message.id);
      setGcMessages((prev) => {
        const entry = Object.entries(prev).find(([, list]) => list.some((m) => m.id === message.id));
        if (!entry) return prev;
        const [cid, list] = entry;
        return { ...prev, [cid]: list.map((m) => (m.id === message.id ? { ...m, starred } : m)) };
      });
    } catch (e) { console.warn('gc star failed', e.message); }
  };

  const setMessageTimer = async (message, seconds) => {
    try {
      const { expiresAt } = await api.setMessageTimer(message.id, seconds);
      setGcMessages((prev) => {
        const entry = Object.entries(prev).find(([, list]) => list.some((m) => m.id === message.id));
        if (!entry) return prev;
        const [cid, list] = entry;
        return { ...prev, [cid]: list.map((m) => (m.id === message.id ? { ...m, expiresAt } : m)) };
      });
    } catch (e) { console.warn('gc timer failed', e.message); }
  };

  const onVote = async (messageId, pollId, optionIndex) => {
    try { await votePoll(messageId, pollId, optionIndex); } catch (e) { console.warn('gc vote failed', e.message); }
  };

  const openReport = (message) => {
    setReportReason('');
    setReportNote('');
    setReportMsg(message);
  };

  const submitReport = async () => {
    if (!reportReason || reportBusy) return;
    setReportBusy(true);
    try {
      const r = await api.reportMessage(reportMsg.id, reportReason, reportNote.trim() || undefined);
      setReportMsg(null);
      Alert.alert(
        'Report submitted',
        r?.duplicate ? 'You already reported this message — our safety team has it.' : 'Thank you. Our safety team will review this privately.'
      );
    } catch (e) {
      Alert.alert('Could not report', e.message || 'Please try again in a moment.');
    } finally {
      setReportBusy(false);
    }
  };

  const keyboardPad = Platform.OS === 'android' || Platform.OS === 'web' ? keyboardHeight : 0;
  const openInfo = () => navigation?.navigate?.('GCDetail', { chatId });

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: theme.chatBg }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={0}
      enabled={Platform.OS === 'ios'}
    >
      <ChatBackground theme={theme} />

      <View style={s.content}>
        {/* GC header — clearly a group, never a private chat */}
        <FadeSlide key={`gchdr-${chatId}`} from="down" distance={8} duration={260}>
          <View style={[s.headerWrap, !embedded && { paddingTop: 18 + insets.top }]}>
            <View style={s.header}>
              <SpringPressable
                accessibilityRole="button"
                accessibilityLabel="Back to GC"
                onPress={() => navigation?.goBack?.()}
                hitSlop={8}
                scaleTo={motion.scale.icon}
                haptic="selection"
                style={s.backBtn}
              >
                <Icon name="arrow-back" size={22} color={theme.primary} />
              </SpringPressable>
              <Pressable
                style={s.headerInfo}
                onPress={openInfo}
                accessibilityRole="button"
                accessibilityLabel={`GC ${chat.name}, ${chat.members?.length || 1} members`}
              >
                <Avatar uri={chat.avatar} name={chat.name} id={chat.id} group size={42} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <EmojiText style={[type.headlineSm, { color: theme.text, flexShrink: 1 }]} numberOfLines={1}>{chat.name}</EmojiText>
                    {hasGoldTick(chat) && <GoldTick size={16} />}
                  </View>
                  {typers.length ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
                      <TypingDots color={theme.primary} size={4} />
                      <Text style={[type.bodySm, { fontSize: 12.5, color: theme.primary }]} numberOfLines={1}>
                        {typers[0]} is typing
                      </Text>
                    </View>
                  ) : (
                    <Text style={[type.bodySm, { fontSize: 12.5, color: theme.subtext }]} numberOfLines={1}>
                      {chat.members?.length || 1} member{chat.members?.length === 1 ? '' : 's'}{subtitle ? ` · ${subtitle}` : ''}
                    </Text>
                  )}
                </View>
              </Pressable>
              <InkIconButton name="document-text-outline" size={36} iconSize={17} onPress={() => setDocsOpen(true)} />
              <InkIconButton name="bar-chart-outline" size={36} iconSize={17} onPress={() => setPollOpen(true)} />
              <InkIconButton name="ellipsis-horizontal" size={36} iconSize={16} onPress={() => setOverflowOpen(true)} />
            </View>
            <Rule style={{ marginHorizontal: 20, marginTop: 10, marginBottom: 0 }} />
          </View>
        </FadeSlide>

        {!!messageHistoryError && list.length > 0 && (
          <View style={[s.historyError, { backgroundColor: theme.dangerContainer, borderColor: theme.danger }]}>
            <Icon name="alert-circle-outline" size={16} color={theme.danger} />
            <Text style={[type.bodySm, { color: theme.text, flex: 1 }]}>Showing saved messages. Refresh failed.</Text>
            <Pressable onPress={() => loadGCMessages(chatId).catch(() => {})} hitSlop={7}>
              <Text style={[type.labelXs, { color: theme.danger }]}>RETRY</Text>
            </Pressable>
          </View>
        )}

        <FlatList
          ref={listRef}
          style={s.messagesList}
          data={rows}
          keyExtractor={(i) => i.id}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          automaticallyAdjustContentInsets={false}
          contentInsetAdjustmentBehavior="never"
          contentContainerStyle={{ paddingVertical: 14, flexGrow: 1, justifyContent: 'flex-end', paddingBottom: 8 }}
          maintainVisibleContentPosition={{ minIndexForVisible: 1 }}
          onScroll={(event) => {
            const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
            if (contentSize.height <= layoutMeasurement.height + 48) return;
            if (contentOffset.y > 90) return;
            if (loadingOlderRef.current) return;
            loadingOlderRef.current = true;
            suppressScrollToEnd.current = true;
            Promise.resolve(loadOlderGCMessages(chatId)).finally(() => {
              setTimeout(() => { suppressScrollToEnd.current = false; loadingOlderRef.current = false; }, 400);
            });
          }}
          scrollEventThrottle={80}
          onContentSizeChange={() => {
            if (suppressScrollToEnd.current || suppressFocusScroll.current) return;
            listRef.current?.scrollToEnd({ animated: false });
          }}
          onScrollToIndexFailed={(info) => {
            setTimeout(() => {
              listRef.current?.scrollToOffset({ offset: Math.max(0, info.averageItemLength * info.index - 200), animated: false });
            }, 60);
          }}
          renderItem={({ item }) =>
            item._type === 'day' ? (
              <View style={s.dayWrap}>
                <View style={[dashedRule(theme), { flex: 1 }]} />
                <View style={[s.tapeStrip, { backgroundColor: theme.cardAlt, borderColor: theme.graphiteLine }]}>
                  <Text style={[type.labelXs, { color: theme.graphite }]}>{String(item.label || '').toUpperCase()}</Text>
                </View>
                <View style={[dashedRule(theme), { flex: 1 }]} />
              </View>
            ) : (
              <MessageBubble
                message={item}
                animateIn={!!item._new}
                isMine={item.senderId === user.id}
                isGroup
                senderName={nameFor(item.senderId)}
                senderUser={chat?.members?.find((m) => m.id === item.senderId)}
                onReply={handleReply}
                onOpenReply={openReply}
                highlighted={replyHighlightId === item.id}
                onReact={react}
                onDelete={deleteMessage}
                onDeleteForMe={handleDeleteForMe}
                onImagePress={setLightbox}
                onEdit={startEdit}
                onForward={setForwardMsg}
                onStar={toggleStar}
                onSetTimer={setTimerMsg}
                onVotePoll={onVote}
                onReport={openReport}
              />
            )
          }
          ListEmptyComponent={
            !messageHistoryLoaded || messageHistoryLoading ? (
              <View style={s.emptyChat}>
                <ActivityIndicator color={theme.primary} />
                <Text style={[type.labelSm, { color: theme.muted, marginTop: 12 }]}>LOADING GC MESSAGES…</Text>
              </View>
            ) : messageHistoryError ? (
              <View style={s.emptyChat}>
                <Icon name="alert-circle-outline" size={26} color={theme.danger} />
                <Text style={[type.bodyStrong, { color: theme.text, marginTop: 10 }]}>Unable to load GC messages</Text>
                <Text style={[type.bodySm, { color: theme.muted, marginTop: 4, textAlign: 'center' }]}>The GC was not erased. Check your connection.</Text>
                <SpringPressable
                  onPress={() => loadGCMessages(chatId).catch(() => {})}
                  style={({ pressed }) => [s.historyRetry, inkBox(theme, 'thin'), pressed && marker(theme, 1)]}
                  scaleTo={motion.scale.row}
                  haptic="selection"
                >
                  <Icon name="refresh" size={15} color={theme.ink} />
                  <Text style={[type.labelSm, { color: theme.ink }]}>RETRY</Text>
                </SpringPressable>
              </View>
            ) : (
              <View style={s.emptyChat}>
                <FloatLoop amplitude={4} duration={3600}>
                  <View style={{ alignItems: 'center', gap: 10 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
                      <Emoji char="✒️" size={15} />
                      <Text style={[type.bodySm, { color: theme.muted }]}>This is the beginning of this GC.</Text>
                    </View>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
                      <Text style={[type.bodySm, { color: theme.muted }]}>Say hello to the group</Text>
                      <Emoji char="👋" size={16} />
                    </View>
                  </View>
                </FloatLoop>
              </View>
            )
          }
        />

        {/* failed-send retry banner (GC only) */}
        {(() => {
          const failed = list.filter((m) => m.senderId === user.id && m.status === 'failed' && !m.deleted);
          if (!failed.length) return null;
          return (
            <View style={[s.retryBanner, { backgroundColor: theme.dangerContainer, borderColor: theme.danger }]}>
              <Icon name="alert-circle-outline" size={15} color={theme.danger} />
              <Text style={[type.bodySm, { color: theme.text, flex: 1 }]} numberOfLines={1}>
                {failed.length} message{failed.length === 1 ? '' : 's'} couldn't be sent.
              </Text>
              <Pressable onPress={() => failed.forEach((m) => retryGCMessage(chatId, m.id))} hitSlop={7}>
                <Text style={[type.labelXs, { color: theme.danger }]}>RETRY</Text>
              </Pressable>
            </View>
          );
        })()}

        <FadeSlide key={`gccmp-${chatId}`} from="up" distance={10} duration={260} delay={40}>
          <View style={keyboardPad > 0 ? { marginBottom: keyboardPad } : null}>
            <ReplyBar replyTo={replyTo} senderName={replyTo ? nameFor(replyTo.senderId) : null} onClose={() => setReplyTo(null)} />
            {replyMissing && (
              <Pop from={0.5}>
                <View style={[s.missingToast, { backgroundColor: theme.cardAlt, borderColor: theme.ink }]}>
                  <Icon name="alert-circle-outline" size={15} color={theme.muted} />
                  <Text style={[type.bodySm, { color: theme.text }]}>Original message unavailable</Text>
                </View>
              </Pop>
            )}
            {editing && (
              <View style={[s.editBar, { borderColor: theme.ink, backgroundColor: theme.cardAlt }]}>
                <Icon name="create-outline" size={15} color={theme.ink} />
                <Text style={[type.labelXs, { color: theme.ink, flex: 1 }]} numberOfLines={1}>EDITING — {editing.body}</Text>
                <Pressable onPress={() => { setEditing(null); setText(''); }} hitSlop={8}>
                  <Icon name="close" size={18} color={theme.muted} />
                </Pressable>
              </View>
            )}
            <EmojiPicker visible={showEmoji} onSelect={(e) => setText((v) => v + e)} />
            {mentionSuggestions.length > 0 && <View style={[s.mentionPopup, { backgroundColor: theme.card, borderColor: theme.ink }]}>{mentionSuggestions.map((m) => <Pressable key={m.id} onPress={() => selectMention(m)} style={s.mentionItem}><Avatar uri={m.avatar} name={m.name} id={m.id} size={30} /><View><Text style={[type.bodyStrong, { color: theme.text }]}>{m.name}</Text><Text style={[type.labelXs, { color: theme.muted }]}>@{m.username}</Text></View></Pressable>)}</View>}
            <View style={[s.composerWrap, keyboardPad > 0
              ? { paddingBottom: 8 }
              : !embedded ? { paddingBottom: Math.max(insets.bottom, 12) } : null
            ]}>
              {recording ? (
                <InkField style={s.inputBar}>
                  <View style={[s.recDot, { backgroundColor: theme.danger }]} />
                  <Text style={[type.bodyLg, { flex: 1, color: theme.text }]}>
                    Recording… {Math.floor(recSecs / 60)}:{String(recSecs % 60).padStart(2, '0')}
                  </Text>
                  <Pressable accessibilityLabel="Cancel voice recording" onPress={cancelRecording} disabled={voiceBusy} hitSlop={8}>
                    <Text style={[type.labelSm, { color: theme.danger, opacity: voiceBusy ? 0.45 : 1 }]}>CANCEL</Text>
                  </Pressable>
                </InkField>
              ) : (
                <InkField style={s.inputBar}>
                  <SpringPressable
                    accessibilityRole="button"
                    accessibilityLabel={showEmoji ? 'Show keyboard' : 'Show emoji'}
                    onPress={() => setShowEmoji((v) => !v)}
                    hitSlop={6}
                    scaleTo={motion.scale.icon}
                    haptic="selection"
                  >
                    <IconSwap
                      active={showEmoji}
                      size={23}
                      spin={30}
                      on={<Icon name="keypad-outline" size={23} color={theme.muted} />}
                      off={<Icon name="happy-outline" size={23} color={theme.muted} />}
                    />
                  </SpringPressable>
                  <TextInput
                    ref={inputRef}
                    style={s.input}
                    placeholder={editing ? 'Edit message…' : 'Message the GC'}
                    placeholderTextColor={theme.muted}
                    value={text}
                    onChangeText={onChangeText}
                    onSelectionChange={(e) => setCursor(e.nativeEvent.selection.start)}
                    onFocus={() => {
                      if (suppressFocusScroll.current) return;
                      scrollToLatest(120);
                    }}
                    multiline
                    disableFullscreenUI
                    onSubmitEditing={send}
                    blurOnSubmit={false}
                    onKeyPress={(e) => {
                      if (Platform.OS === 'web' && e.nativeEvent.key === 'Enter' && !e.nativeEvent.shiftKey) {
                        e.preventDefault?.();
                        send();
                      }
                    }}
                  />
                  {!editing && (
                    <SpringPressable accessibilityRole="button" accessibilityLabel="Attach a photo" onPress={pickImage} hitSlop={6} disabled={uploading} scaleTo={motion.scale.icon} haptic="selection">
                      {uploading ? <ActivityIndicator size="small" color={theme.muted} /> : <Icon name="attach" size={22} color={theme.muted} style={{ transform: [{ rotate: '45deg' }] }} />}
                    </SpringPressable>
                  )}
                  {!editing && !text.trim() && (
                    <SpringPressable accessibilityRole="button" accessibilityLabel="Take a photo" onPress={pickImage} hitSlop={6} scaleTo={motion.scale.icon} haptic="selection">
                      <Icon name="camera-outline" size={22} color={theme.muted} />
                    </SpringPressable>
                  )}
                </InkField>
              )}
              <SpringPressable
                accessibilityRole="button"
                accessibilityLabel={voiceBusy ? 'Sending voice note' : recording ? 'Send voice note' : text.trim() ? 'Send message' : 'Hold to record a voice note'}
                delayLongPress={250}
                onPressIn={() => {
                  holdStartedAt.current = Date.now();
                  if (!text.trim() && !editing && !recording && !voiceBusy) {
                    pressOwnsRecording.current = true;
                    startRecording();
                  }
                }}
                onPressOut={() => {
                  const startedAt = holdStartedAt.current;
                  holdStartedAt.current = 0;
                  if (!pressOwnsRecording.current) return;
                  pressOwnsRecording.current = false;
                  const heldMs = startedAt ? Date.now() - startedAt : 0;
                  stopRecording(heldMs >= 500);
                }}
                onPress={() => {
                  if (text.trim()) send();
                  else if (editing) { setEditing(null); setText(''); }
                }}
                disabled={voiceBusy}
                android_ripple={rippleFor(theme, { color: alpha(theme.onSendButton, 0.3) })}
                style={({ pressed }) => [
                  s.sendBtn,
                  inkBox(theme, 'bold'),
                  { backgroundColor: pressed && Platform.OS !== 'android' ? theme.highlighter : theme.sendButton },
                  voiceBusy && { opacity: 0.55 },
                ]}
              >
                {voiceBusy ? (
                  <ActivityIndicator size="small" color={theme.onSendButton} />
                ) : (
                  <Pop trigger={editing ? 'checkmark' : text.trim() ? 'send' : recording ? 'checkmark' : 'mic'} firstStatic from={0.7}>
                    <Icon name={editing ? 'checkmark' : text.trim() ? 'send' : recording ? 'checkmark' : 'mic'} size={18} color={theme.onSendButton} />
                  </Pop>
                )}
              </SpringPressable>
            </View>
          </View>
        </FadeSlide>

        {/* report modal */}
        <Modal visible={!!reportMsg} transparent animationType="fade" onRequestClose={() => setReportMsg(null)}>
          {reportMsg && (
            <Pressable style={s.dimOverlay} onPress={() => setReportMsg(null)}>
              <Pressable style={[s.reportSheet, inkBox(theme, 'ink'), { backgroundColor: theme.bg }]} onPress={() => {}}>
                <Text style={[type.headlineSm, { color: theme.text }]}>Report this message</Text>
                <Text style={[type.bodySm, { color: theme.muted, marginTop: 4 }]}>Your report goes to the +one safety team privately.</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14 }}>
                  {[
                    ['harassment', 'Harassment'], ['threat', 'Threat'], ['hate', 'Hate'], ['violence', 'Violence'],
                    ['spam', 'Spam'], ['scam', 'Scam'], ['sexual_exploitation', 'Sexual content'],
                    ['child_safety', 'Child safety'], ['extremism', 'Terrorism'], ['other', 'Other'],
                  ].map(([k, label]) => (
                    <Pressable key={k} onPress={() => setReportReason(k)} style={[s.reportChip, reportReason === k && { backgroundColor: theme.ink, borderColor: theme.ink }]}>
                      <Text style={[type.labelXs, { color: reportReason === k ? theme.onPrimary : theme.ink }]}>{label.toUpperCase()}</Text>
                    </Pressable>
                  ))}
                </View>
                <InkField style={{ marginTop: 12 }} focused={!!reportNote}>
                  <TextInput value={reportNote} onChangeText={setReportNote} placeholder="Anything that helps review (optional)" placeholderTextColor={theme.muted} style={{ flex: 1, fontFamily: 'Karla_400Regular', fontSize: 14, color: theme.text, paddingVertical: 6 }} maxLength={500} />
                </InkField>
                <View style={{ flexDirection: 'row', gap: 10, marginTop: 14 }}>
                  <Pressable onPress={() => setReportMsg(null)} style={[s.reportBtn, { borderColor: theme.ink }]}>
                    <Text style={[type.labelSm, { color: theme.ink }]}>CANCEL</Text>
                  </Pressable>
                  <Pressable onPress={submitReport} disabled={!reportReason || reportBusy} style={[s.reportBtn, { borderColor: theme.danger, opacity: !reportReason || reportBusy ? 0.4 : 1 }]}>
                    <Text style={[type.labelSm, { color: theme.danger }]}>{reportBusy ? 'SENDING…' : 'REPORT'}</Text>
                  </Pressable>
                </View>
              </Pressable>
            </Pressable>
          )}
        </Modal>

        <ImageLightbox uri={lightbox} onClose={() => setLightbox(null)} />

        {/* forward picker — GC message forwarded into chosen chats (server
            verifies the source GC membership) */}
        <ForwardSheet visible={!!forwardMsg} message={forwardMsg} onClose={() => setForwardMsg(null)} />

        {/* per-message disappearing timer */}
        <Modal visible={!!timerMsg} transparent animationType="fade" onRequestClose={() => setTimerMsg(null)}>
          <Pressable style={[s.overlay, { backgroundColor: 'transparent' }]} onPress={() => setTimerMsg(null)}>
            <FrostedBackdrop />
            <SheetSpringIn style={{ width: '100%', maxWidth: 360 }}>
              <Pressable style={[s.timerSheet, raised(theme, 2), { backgroundColor: theme.bg, borderColor: theme.ink }]}>
                <Text style={[type.headlineSm, { color: theme.text }]}>Disappear in…</Text>
                <Text style={[type.bodySm, { color: theme.subtext, marginTop: 4, marginBottom: 12 }]}>The message self-destructs after the timer.</Text>
                <View style={{ gap: 8 }}>
                  {(() => {
                    const remaining = timerMsg?.expiresAt ? Math.round((timerMsg.expiresAt - Date.now()) / 1000) : 0;
                    const isActive = (sec) => (sec === 0 ? remaining === 0 : Math.abs(remaining - sec) < Math.max(2, sec * 0.05));
                    return (
                      <>
                        <SpringPressable style={({ pressed }) => [s.timerOpt, inkBox(theme, 'thin'), pressed ? marker(theme, 1) : null]} onPress={() => { setMessageTimer(timerMsg, 0); setTimerMsg(null); }} scaleTo={motion.scale.row} haptic="selection">
                          <Icon name="time-outline" size={18} color={theme.ink} />
                          <Text style={[type.bodyMd, { color: theme.text, flex: 1 }]}>Off — keep forever</Text>
                          {isActive(0) && <Icon name="checkmark" size={18} color={theme.ink} />}
                        </SpringPressable>
                        {DISAPPEAR_OPTIONS.map((o) => (
                          <SpringPressable key={o.seconds} style={({ pressed }) => [s.timerOpt, inkBox(theme, 'thin'), pressed ? marker(theme, 1) : null]} onPress={() => { setMessageTimer(timerMsg, o.seconds); setTimerMsg(null); }} scaleTo={motion.scale.row} haptic="selection">
                            <Icon name="timer-outline" size={18} color={theme.ink} />
                            <Text style={[type.bodyMd, { color: theme.text, flex: 1 }]}>{o.label}</Text>
                            {isActive(o.seconds) && <Icon name="checkmark" size={18} color={theme.ink} />}
                          </SpringPressable>
                        ))}
                      </>
                    );
                  })()}
                </View>
              </Pressable>
            </SheetSpringIn>
          </Pressable>
        </Modal>

        {/* group poll composer */}
        <PollComposer visible={pollOpen} onClose={() => setPollOpen(false)} onCreate={async (question, options) => { await createPoll(chatId, question, options); }} />

        {/* OT collaborative notes */}
        <Modal visible={docsOpen} animationType="slide" onRequestClose={() => setDocsOpen(false)}>
          <View style={{ flex: 1, backgroundColor: theme.bg, paddingTop: 20 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, borderBottomWidth: 2, borderBottomColor: theme.ink }}>
              <Text style={[type.headlineSm, { color: theme.text }]}>COLLABORATIVE NOTES</Text>
              <Pressable onPress={() => setDocsOpen(false)} style={[inkBox(theme, 'thin'), { paddingHorizontal: 12, paddingVertical: 8 }]}>
                <Text style={[type.labelSm, { color: theme.ink }]}>CLOSE</Text>
              </Pressable>
            </View>
            <CollabDocumentView chatId={chatId} socket={socket} embedded />
          </View>
        </Modal>

        {/* overflow: GC info + theme, all inside the GC environment */}
        <Modal visible={overflowOpen} transparent animationType="fade" onRequestClose={() => setOverflowOpen(false)}>
          <Pressable style={[s.overlay, { backgroundColor: 'transparent' }]} onPress={() => setOverflowOpen(false)}>
            <FrostedBackdrop />
            <PaperCard weight="ink" style={s.overflowMenu}>
              <SpringPressable
                style={({ pressed }) => [s.menuRow, pressed ? marker(theme, 1) : null]}
                onPress={() => { setOverflowOpen(false); themePicker?.setPickerOpen(true); }}
                scaleTo={motion.scale.row}
                haptic="selection"
              >
                <View style={[s.menuIcon, { backgroundColor: alpha(theme.accent, 0.16) }]}>
                  <Icon name="color-palette-outline" size={18} color={theme.accent} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[type.bodyMd, { color: theme.text }]}>GC theme</Text>
                  <Text style={[type.labelXs, { color: theme.muted, marginTop: 2 }]}>
                    {ThemeRegistry.get(theme.chatThemeId || 'graphite').name}
                  </Text>
                </View>
              </SpringPressable>
              <Rule style={{ marginVertical: 6 }} />
              <SpringPressable
                style={({ pressed }) => [s.menuRow, pressed ? marker(theme, 1) : null]}
                onPress={() => { setOverflowOpen(false); openInfo(); }}
                scaleTo={motion.scale.row}
                haptic="selection"
              >
                <Icon name="information-circle-outline" size={18} color={theme.ink} style={{ width: 26 }} />
                <Text style={[type.bodyMd, { color: theme.text }]}>GC info & members</Text>
              </SpringPressable>
              <Rule style={{ marginVertical: 6 }} />
              <SpringPressable
                style={({ pressed }) => [s.menuRow, pressed ? marker(theme, 1) : null]}
                onPress={() => { setOverflowOpen(false); navigation?.navigate?.('GCDetail', { chatId }); }}
                scaleTo={motion.scale.row}
                haptic="selection"
              >
                <Icon name="people-outline" size={18} color={theme.ink} style={{ width: 26 }} />
                <Text style={[type.bodyMd, { color: theme.text }]}>Admin controls</Text>
              </SpringPressable>
            </PaperCard>
          </Pressable>
        </Modal>

        {themePicker && (
          <ThemePickerSheet
            visible={themePicker.pickerOpen}
            savedThemeId={themePicker.savedThemeId}
            previewThemeId={themePicker.previewThemeId}
            onPreview={themePicker.setPreviewThemeId}
            onApply={themePicker.handleApply}
            applying={themePicker.applying}
            globalTheme={themePicker.globalTheme}
            onClose={() => { themePicker.setPreviewThemeId(null); themePicker.setPickerOpen(false); }}
          />
        )}
        {themePicker?.themeToast && (
          <View pointerEvents="none" style={[s.toastWrap, { top: (embedded ? 10 : 10 + insets.top) + 84 }]}>
            <Pop trigger={themePicker.themeToast} from={0.5}>
              <View style={[s.toast, raised(theme, 2), { backgroundColor: theme.card, borderColor: themePicker.themeToast === 'success' ? theme.accent : theme.danger }]}>
                {themePicker.themeToast === 'success' ? (
                  <>
                    <Icon name="checkmark-circle" size={16} color={theme.accent} />
                    <Text style={[type.bodySm, { color: theme.text, flex: 1 }]}>Theme applied.</Text>
                  </>
                ) : (
                  <>
                    <Icon name="alert-circle-outline" size={15} color={theme.danger} />
                    <Text style={[type.bodySm, { color: theme.text, flex: 1 }]}>Couldn't save the theme. Check your connection and try again.</Text>
                  </>
                )}
              </View>
            </Pop>
          </View>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

class GCErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError() { return { error: true }; }
  componentDidCatch(error, info) { console.error('[gc chat render]', error, info); }
  render() {
    const { error } = this.state;
    const { theme, navigation, embedded } = this.props;
    if (!error) return this.props.children;
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28, backgroundColor: theme.bg }}>
        <Icon name="alert-circle-outline" size={34} color={theme.danger} />
        <Text style={[type.headlineSm, { color: theme.text, marginTop: 14 }]}>GC chat hit a snag</Text>
        <Text style={[type.bodySm, { color: theme.subtext, textAlign: 'center', marginTop: 7, maxWidth: 320 }]}>
          The GC could not render. Retry, or return to the GC section.
        </Text>
        <Pressable onPress={() => this.setState({ error: null })} style={[inkBox(theme, 'ink'), { marginTop: 18, paddingHorizontal: 18, paddingVertical: 10 }]}>
          <Text style={[type.labelSm, { color: theme.ink }]}>TRY AGAIN</Text>
        </Pressable>
        {!embedded && (
          <Pressable onPress={() => navigation.goBack()} style={{ marginTop: 10, padding: 9 }}>
            <Text style={[type.labelSm, { color: theme.subtext }]}>BACK TO GCs</Text>
          </Pressable>
        )}
      </View>
    );
  }
}

/** Per-GC theme scope — same per-conversation themes as direct chats. */
function ThemedGCConversation(props) {
  const chatId = props.route?.params?.chatId || null;
  const { theme: globalTheme } = useTheme();
  const chatThemeApi = useChatTheme();
  const {
    themeIdFor = () => 'graphite',
    applyTheme = async () => false,
    applyState = {},
    clearApplyError = () => {},
  } = chatThemeApi || {};
  const [previewThemeId, setPreviewThemeId] = useState(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [themeToast, setThemeToast] = useState(null);
  const toastTimer = useRef(null);
  const savedThemeId = chatId ? themeIdFor(chatId) : 'graphite';

  useEffect(() => () => clearTimeout(toastTimer.current), []);

  const handleApply = async (id) => {
    const ok = await applyTheme(chatId, id);
    setPreviewThemeId(null);
    setPickerOpen(false);
    setThemeToast(ok ? 'success' : 'error');
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setThemeToast(null), ok ? 1600 : 4200);
    clearApplyError(chatId);
  };

  const themePicker = {
    savedThemeId, previewThemeId, setPreviewThemeId, pickerOpen, setPickerOpen,
    handleApply, applying: !!applyState[chatId]?.saving, themeToast, globalTheme,
  };

  return (
    <ChatThemeScope chatId={chatId} overrideThemeId={previewThemeId || undefined}>
      <GCConversationContent {...props} themePicker={themePicker} />
    </ChatThemeScope>
  );
}

export default function GCChatScreen(props) {
  const { theme } = useTheme();
  const chatId = props.route?.params?.chatId || 'unknown';
  return (
    <GCErrorBoundary key={chatId} theme={theme} navigation={props.navigation} embedded={props.embedded}>
      <ThemedGCConversation {...props} />
    </GCErrorBoundary>
  );
}

const makeStyles = (t) => StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { flex: 1, zIndex: 1 },
  headerWrap: { paddingTop: 18, paddingBottom: 4 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 20, paddingVertical: 10 },
  backBtn: { padding: 4 },
  headerInfo: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  dayWrap: { flexDirection: 'row', alignItems: 'center', gap: 12, marginVertical: 16, paddingHorizontal: 24 },
  tapeStrip: {
    borderWidth: 1, borderStyle: 'dashed', paddingHorizontal: 10, paddingVertical: 5,
    borderTopLeftRadius: 5, borderTopRightRadius: 3, borderBottomRightRadius: 6, borderBottomLeftRadius: 4,
    transform: [{ rotate: '-1deg' }],
  },
  messagesList: { flex: 1, minHeight: 0 },
  emptyChat: { alignItems: 'center', justifyContent: 'center', padding: 40 },
  historyError: { flexDirection: 'row', alignItems: 'center', gap: 9, borderWidth: 1, marginHorizontal: 20, marginBottom: 8, paddingHorizontal: 11, paddingVertical: 8 },
  historyRetry: { minHeight: 38, flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 14, paddingVertical: 8, marginTop: 14 },
  missingToast: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 20, marginBottom: 8, paddingHorizontal: 12, paddingVertical: 9, borderWidth: 1, borderRadius: 8, justifyContent: 'center' },
  overflowMenu: { width: '100%', maxWidth: 320, padding: 14 },
  menuRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 6, paddingVertical: 11 },
  menuIcon: { width: 30, height: 30, alignItems: 'center', justifyContent: 'center', borderRadius: 999 },
  toastWrap: { position: 'absolute', left: 20, right: 20, alignItems: 'center', zIndex: 50 },
  toast: { flexDirection: 'row', alignItems: 'center', gap: 9, maxWidth: 420, paddingHorizontal: 14, paddingVertical: 10, borderWidth: 2, borderRadius: 999 },
  editBar: { flexDirection: 'row', alignItems: 'center', gap: 10, marginHorizontal: 20, marginBottom: 8, paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderStyle: 'dashed' },
  mentionPopup: { marginHorizontal: 20, maxHeight: 260, borderWidth: 1, borderRadius: 10, paddingVertical: 4 },
  mentionItem: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 8 },
  composerWrap: { flexDirection: 'row', alignItems: 'flex-end', paddingHorizontal: 20, paddingBottom: 22, paddingTop: 12, gap: 12, borderTopWidth: 1, borderTopColor: t.graphiteLine, borderStyle: 'dashed' },
  inputBar: { flex: 1, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, gap: 12, minHeight: 48, borderTopLeftRadius: 5, borderTopRightRadius: 3, borderBottomRightRadius: 6, borderBottomLeftRadius: 4, backgroundColor: t.inputBackground },
  input: { flex: 1, ...type.bodyLg, color: t.text, maxHeight: 110, paddingVertical: 11, outlineStyle: 'none' },
  sendBtn: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  recDot: { width: 9, height: 9, borderRadius: radius.full },
  retryBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 20, marginBottom: 8, paddingHorizontal: 11, paddingVertical: 7, borderWidth: 1 },
  dimOverlay: { flex: 1, backgroundColor: 'rgba(28,27,27,0.95)', alignItems: 'center', justifyContent: 'center' },
  reportSheet: { width: '92%', maxWidth: 460, borderRadius: radius.md, padding: 18 },
  reportChip: { borderWidth: 1.5, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 7 },
  reportBtn: { flex: 1, alignItems: 'center', borderWidth: 1.5, borderRadius: 999, paddingVertical: 10 },
  overlay: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28 },
  timerSheet: { width: '100%', maxWidth: 360, borderWidth: 3, padding: 20, borderTopLeftRadius: 6, borderTopRightRadius: 12, borderBottomRightRadius: 6, borderBottomLeftRadius: 10 },
  timerOpt: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 12, paddingVertical: 11 },
});
