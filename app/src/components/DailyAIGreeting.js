import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, Pressable, StyleSheet, Modal, ScrollView, Platform,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import * as Speech from 'expo-speech';
import { setAudioModeAsync } from 'expo-audio';
import Icon from '../icons/Icon';
import { useAuth } from '../store/AuthContext';
import { useTheme } from '../store/ThemeContext';
import useResponsive from '../hooks/useResponsive';
import { api } from '../api';
import AIGreeterModel from './AIGreeterModel';
import { Avatar, PaperCard, Rule, TapeChip } from './common';
import { type, inkBox, marker, stroke } from '../theme';

const EMPTY_SUMMARY = {
  unreadMessages: 0, unreadChats: 0, messageRequests: 0,
  colleagueRequests: 0, communityRequests: 0, total: 0,
};

const periodFor = (hour) => hour < 5 ? 'Good night' : hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : hour < 22 ? 'Good evening' : 'Good night';

function conditionFor(code, temperature) {
  let condition = 'clear';
  if ([1, 2].includes(code)) condition = 'partly cloudy';
  else if (code === 3) condition = 'cloudy';
  else if ([45, 48].includes(code)) condition = 'foggy';
  else if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) condition = 'rainy';
  else if ((code >= 71 && code <= 77) || [85, 86].includes(code)) condition = 'snowy';
  else if (code >= 95) condition = 'stormy';
  const feel = temperature >= 32 ? 'hot' : temperature <= 14 ? 'cold' : temperature >= 26 ? 'warm' : 'mild';
  return { condition, feel };
}

function notificationSentence(summary) {
  const parts = [];
  if (summary.unreadMessages) parts.push(`${summary.unreadMessages} unread message${summary.unreadMessages === 1 ? '' : 's'}`);
  if (summary.messageRequests) parts.push(`${summary.messageRequests} message request${summary.messageRequests === 1 ? '' : 's'}`);
  if (summary.colleagueRequests) parts.push(`${summary.colleagueRequests} colleague request${summary.colleagueRequests === 1 ? '' : 's'}`);
  if (summary.communityRequests) parts.push(`${summary.communityRequests} community request${summary.communityRequests === 1 ? '' : 's'}`);
  if (!parts.length) return "You're all caught up. There are no new notifications.";
  if (parts.length === 1) return `You have ${parts[0]}.`;
  return `You have ${parts.slice(0, -1).join(', ')}, and ${parts[parts.length - 1]}.`;
}

async function preferredFemaleVoice() {
  try {
    const voices = await Speech.getAvailableVoicesAsync();
    const english = voices.filter((voice) => /^en([-_]|$)/i.test(voice.language || ''));
    const femaleHint = /(female|samantha|victoria|karen|moira|tessa|ava|aria|jenny|zira|susan|sangeeta|veena|en[-_]in[-_]x[-_](ena|end|ene)|en[-_]us[-_]x[-_](sfg|tpf|iob))/i;
    const maleHint = /(male|daniel|fred|rishi|en[-_]in[-_]x[-_]enc)/i;
    return english.find((voice) => femaleHint.test(`${voice.name || ''} ${voice.identifier || ''}`))
      || english.find((voice) => !maleHint.test(`${voice.name || ''} ${voice.identifier || ''}`))
      || english[0]
      || voices[0]
      || null;
  } catch {
    return null;
  }
}

class ModelBoundary extends React.Component {
  constructor(props) { super(props); this.state = { failed: false }; }
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error) { console.warn('[AI model]', error?.message); }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <View style={styles.modelFallback}>
        <Avatar name="+one AI" id="plus-one-ai" size={112} shape="sketch" weight="bold" />
        <Text style={[type.labelSm, { color: this.props.theme.muted, marginTop: 12 }]}>AI MODEL PLACEHOLDER</Text>
      </View>
    );
  }
}

/** Once-per-local-day spoken briefing shown after authentication. */
export default function DailyAIGreeting() {
  const { user } = useAuth();
  const { theme } = useTheme();
  const { isTablet } = useResponsive();
  const [visible, setVisible] = useState(false);
  const [weather, setWeather] = useState(null);
  const [weatherState, setWeatherState] = useState('loading');
  const [summary, setSummary] = useState(EMPTY_SUMMARY);
  // Start true so the auto-speech effect cannot race ahead of weather/summary
  // loading and cancel its own scheduled utterance on the next render.
  const [loading, setLoading] = useState(true);
  const [talking, setTalking] = useState(false);
  const started = useRef(false);
  const sequenceId = useRef(0);
  const timers = useRef(new Set());
  const s = makeStyles(theme);

  const now = new Date();
  const period = periodFor(now.getHours());
  const firstName = String(user?.name || user?.username || 'friend').trim().split(/\s+/)[0];
  const dayKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

  useEffect(() => {
    if (!user?.id) return undefined;
    let active = true;
    const key = `+one.ai-greeting.${user.id}.${dayKey}`;
    started.current = false;
    AsyncStorage.getItem(key).then((seen) => {
      if (!active || seen) return;
      // Mark immediately so reconnects/re-renders cannot stack the same daily modal.
      AsyncStorage.setItem(key, 'shown').catch(() => {});
      setLoading(true);
      setVisible(true);
    }).catch(() => {
      if (active) {
        setLoading(true);
        setVisible(true);
      }
    });
    return () => {
      active = false;
      sequenceId.current += 1;
      timers.current.forEach(clearTimeout);
      timers.current.clear();
      Speech.stop();
    };
  }, [user?.id, dayKey]);

  useEffect(() => {
    if (!visible) return undefined;
    let active = true;
    setLoading(true);
    Promise.all([
      api.greetingSummary().then((result) => result.summary || EMPTY_SUMMARY).catch(() => EMPTY_SUMMARY),
      (async () => {
        try {
          const permission = await Location.requestForegroundPermissionsAsync();
          if (permission.status !== 'granted') return { state: 'denied' };
          const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
          const { latitude, longitude } = position.coords;
          const response = await fetch(
            `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,apparent_temperature,weather_code&timezone=auto`
          );
          if (!response.ok) throw new Error('Weather unavailable');
          const data = await response.json();
          const temperature = Number(data.current?.temperature_2m);
          const code = Number(data.current?.weather_code || 0);
          if (!Number.isFinite(temperature)) throw new Error('Weather unavailable');
          return { state: 'ready', temperature, apparent: Number(data.current?.apparent_temperature), code, ...conditionFor(code, temperature) };
        } catch {
          return { state: 'unavailable' };
        }
      })(),
    ]).then(([briefing, localWeather]) => {
      if (!active) return;
      setSummary(briefing);
      setWeatherState(localWeather.state);
      setWeather(localWeather.state === 'ready' ? localWeather : null);
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [visible]);

  const weatherSentence = weather
    ? `It is ${weather.feel} and ${weather.condition} outside. The temperature is ${Math.round(weather.temperature)} degrees Celsius.`
    : weatherState === 'denied'
      ? 'Location is off, so I will skip the weather for today.'
      : 'I could not read the local weather right now.';
  const notices = notificationSentence(summary);
  const speechSegments = useMemo(() => [
    `${period}, ${firstName}.`,
    weatherSentence,
    notices,
    "Let's find the plus ones.",
  ], [period, firstName, weatherSentence, notices]);

  const schedule = (fn, delay) => {
    const timer = setTimeout(() => {
      timers.current.delete(timer);
      fn();
    }, delay);
    timers.current.add(timer);
    return timer;
  };

  const close = () => {
    sequenceId.current += 1;
    timers.current.forEach(clearTimeout);
    timers.current.clear();
    Speech.stop();
    setTalking(false);
    setVisible(false);
  };

  const speakAutomatically = async () => {
    const run = ++sequenceId.current;
    Speech.stop();
    await setAudioModeAsync({
      playsInSilentMode: true,
      interruptionMode: 'duckOthers',
      allowsRecording: false,
      shouldPlayInBackground: false,
      shouldRouteThroughEarpiece: false,
    }).catch(() => {});
    const voice = await Promise.race([
      preferredFemaleVoice(),
      new Promise((resolve) => setTimeout(() => resolve(null), 900)),
    ]);
    if (run !== sequenceId.current) return;
    let index = 0;

    const next = () => {
      if (run !== sequenceId.current) return;
      if (index >= speechSegments.length) {
        setTalking(false);
        schedule(close, 850);
        return;
      }

      const segment = speechSegments[index];
      setTalking(true);
      let finished = false;
      let safetyTimer;
      const complete = () => {
        if (finished || run !== sequenceId.current) return;
        finished = true;
        if (safetyTimer) {
          clearTimeout(safetyTimer);
          timers.current.delete(safetyTimer);
        }
        index += 1;
        schedule(next, 130);
      };

      // Some web/device voices fail to fire onDone. Continue and close the
      // greeting automatically instead of leaving a frozen overlay.
      safetyTimer = schedule(() => {
        Speech.stop();
        complete();
      }, Math.max(2400, segment.length * 78));

      try {
        if (Platform.OS === 'web' && typeof window !== 'undefined' && window.speechSynthesis) {
          const utterance = new window.SpeechSynthesisUtterance(segment);
          const browserVoices = window.speechSynthesis.getVoices?.() || [];
          const selected = browserVoices.find((item) => item.voiceURI === voice?.identifier);
          if (selected) utterance.voice = selected;
          utterance.lang = voice?.language || 'en-IN';
          utterance.rate = 0.9;
          utterance.pitch = 1.12;
          utterance.onstart = () => { if (run === sequenceId.current) setTalking(true); };
          utterance.onend = complete;
          utterance.onerror = complete;
          window.speechSynthesis.speak(utterance);
        } else {
          Speech.speak(segment, {
            voice: voice?.identifier,
            language: voice?.language || 'en-IN',
            rate: 0.9,
            pitch: 1.16,
            onStart: () => { if (run === sequenceId.current) setTalking(true); },
            onDone: complete,
            onStopped: complete,
            onError: complete,
          });
        }
      } catch {
        complete();
      }
    };

    next();
  };

  useEffect(() => {
    if (!visible || loading || started.current) return undefined;
    started.current = true;
    const timer = schedule(speakAutomatically, 480);
    return () => {
      clearTimeout(timer);
      timers.current.delete(timer);
    };
  }, [visible, loading, speechSegments]);

  const cards = useMemo(() => [
    { icon: 'chatbubbles-outline', value: summary.unreadMessages, label: 'UNREAD MESSAGES' },
    { icon: 'mail-unread-outline', value: summary.messageRequests, label: 'MESSAGE REQUESTS' },
    { icon: 'person-add-outline', value: summary.colleagueRequests, label: 'COLLEAGUE REQUESTS' },
    { icon: 'people-outline', value: summary.communityRequests, label: 'COMMUNITY REQUESTS' },
  ], [summary]);

  if (!user || !visible) return null;

  return (
    <Modal visible animationType="fade" onRequestClose={close}>
      <View style={[s.root, { backgroundColor: theme.bg }]}>
        {/* Character owns the full canvas. The briefing floats over the page;
            there is deliberately no card/bracket around the model. */}
        <View style={s.fullModel}>
          <ModelBoundary theme={theme}>
            <AIGreeterModel
              horizontalOffset={isTablet ? -0.28 : 0}
              style={s.model}
            />
          </ModelBoundary>
        </View>

        <View style={s.topBar}>
          <View style={{ flex: 1 }}>
            <TapeChip label={`${period.toUpperCase()} PROTOCOL`} tone="accent" />
            <Text style={[type.labelXs, { color: theme.muted, marginTop: 7 }]}>+ONE DAILY SIGNAL · {dayKey}</Text>
          </View>
          <Pressable accessibilityLabel="Skip greeting" onPress={close} hitSlop={7} style={({ pressed }) => [s.iconButton, inkBox(theme, 'thin'), pressed && marker(theme, 1)]}>
            <Icon name="close" size={19} color={theme.ink} />
          </Pressable>
        </View>

        <View style={s.modelStatus}>
          <View style={[s.liveDot, { backgroundColor: talking ? theme.highlighter : theme.graphiteLine, borderColor: theme.ink }]} />
          <Text style={[type.labelXs, { color: theme.muted }]}>ORIGINAL ANIMATION · LIVE</Text>
        </View>

        <ScrollView contentContainerStyle={[s.content, isTablet && s.contentWide]}>
          <View style={[s.briefing, isTablet && s.briefingWide]}>
            <Text style={[type.headlineMd, { color: theme.text, opacity: 0.84 }]}>{period}, {firstName}.</Text>
            <View style={[s.underline, { backgroundColor: theme.ink }]} />
            <Text style={[type.bodyMd, { color: theme.text, marginTop: 13, opacity: 0.76 }]}>{weatherSentence}</Text>
            <Text style={[type.bodySm, { color: theme.subtext, marginTop: 9, opacity: 0.76 }]}>{notices}</Text>

            <View style={s.weatherRow}>
              <View style={[s.weatherBadge, inkBox(theme, 'thin')]}>
                <Icon name={weather ? 'sunny-outline' : 'compass-outline'} size={22} color={theme.ink} />
                <View>
                  <Text style={[type.labelXs, { color: theme.muted }]}>OUTSIDE</Text>
                  <Text style={[type.bodyStrong, { color: theme.text, marginTop: 2 }]}>
                    {loading ? 'Reading the sky…' : weather ? `${Math.round(weather.temperature)}°C · ${weather.condition}` : 'Weather unavailable'}
                  </Text>
                </View>
              </View>
            </View>

            <Rule style={{ marginVertical: 18 }} />
            <Text style={[type.labelXs, { color: theme.muted, marginBottom: 10 }]}>YOUR SIGNALS</Text>
            <View style={s.signalGrid}>
              {cards.map((card) => (
                <PaperCard
                  key={card.label}
                  style={[s.signalCard, { backgroundColor: theme.dark ? 'rgba(28,27,27,0.58)' : 'rgba(253,248,248,0.62)' }]}
                  weight="pencil"
                >
                  <Icon name={card.icon} size={17} color={theme.ink} />
                  <Text style={[type.bodyStrong, { color: theme.text, marginTop: 6 }]}>{card.value}</Text>
                  <Text style={[type.labelXs, { color: theme.muted, marginTop: 3 }]}>{card.label}</Text>
                </PaperCard>
              ))}
            </View>

            <View style={s.finalCard}>
              <Icon name="sparkles-outline" size={22} color={theme.ink} />
              <View style={{ flex: 1 }}>
                <Text style={[type.bodyStrong, { color: theme.text }]}>Let’s find the +ones.</Text>
                <Text style={[type.labelXs, { color: theme.subtext, marginTop: 3 }]}>OPENING YOUR NETWORK AFTER THIS LINE</Text>
              </View>
            </View>
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

const makeStyles = (t) => StyleSheet.create({
  root: { flex: 1, overflow: 'hidden' },
  fullModel: {
    position: 'absolute', top: 0, right: 0, bottom: 0, left: 0,
    zIndex: 2, pointerEvents: 'none',
  },
  model: { width: '100%', height: '100%' },
  topBar: {
    zIndex: 4, flexDirection: 'row', alignItems: 'center', gap: 9,
    paddingHorizontal: 20, paddingTop: 18, paddingBottom: 14,
    borderBottomWidth: stroke.ink, borderBottomColor: t.ink,
    backgroundColor: t.bg,
  },
  iconButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  modelStatus: {
    position: 'absolute', zIndex: 3, left: 22, top: 92,
    flexDirection: 'row', alignItems: 'center', gap: 7,
  },
  liveDot: { width: 10, height: 10, borderRadius: 99, borderWidth: 1 },
  content: { zIndex: 1, flexGrow: 1, paddingHorizontal: 14, paddingTop: 315, paddingBottom: 28 },
  contentWide: { paddingTop: 96, paddingHorizontal: '4%' },
  briefing: {
    padding: 14, minWidth: 0, opacity: 0.9,
  },
  briefingWide: {
    width: '41%', alignSelf: 'flex-end', padding: 18,
  },
  underline: { height: 3, width: 165, maxWidth: '70%', marginTop: 6, borderRadius: 5, transform: [{ rotate: '-1deg' }], opacity: 0.7 },
  weatherRow: { flexDirection: 'row', marginTop: 14 },
  weatherBadge: { flexDirection: 'row', alignItems: 'center', gap: 9, padding: 9, backgroundColor: 'transparent' },
  signalGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  signalCard: { width: '48%', padding: 9, opacity: 0.76 },
  finalCard: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: 14, marginTop: 7, opacity: 0.78 },
});

const styles = StyleSheet.create({
  modelFallback: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
