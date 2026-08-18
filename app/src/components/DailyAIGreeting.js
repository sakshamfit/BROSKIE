import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, Pressable, StyleSheet, Modal, ScrollView,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import * as Speech from 'expo-speech';
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
  const [loading, setLoading] = useState(false);
  const [talking, setTalking] = useState(false);
  const spoken = useRef(false);
  const s = makeStyles(theme);

  const now = new Date();
  const period = periodFor(now.getHours());
  const firstName = String(user?.name || user?.username || 'friend').trim().split(/\s+/)[0];
  const dayKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

  useEffect(() => {
    if (!user?.id) return undefined;
    let active = true;
    const key = `+one.ai-greeting.${user.id}.${dayKey}`;
    spoken.current = false;
    AsyncStorage.getItem(key).then((seen) => {
      if (!active || seen) return;
      // Mark immediately so reconnects/re-renders cannot stack the same daily modal.
      AsyncStorage.setItem(key, 'shown').catch(() => {});
      setVisible(true);
    }).catch(() => { if (active) setVisible(true); });
    return () => { active = false; Speech.stop(); };
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
  const speechText = `${period}, ${firstName}. ${weatherSentence} ${notices} Let's find the plus ones.`;

  const speak = () => {
    Speech.stop();
    setTalking(true);
    Speech.speak(speechText, {
      language: 'en-US', rate: 0.92, pitch: 1.02,
      onStart: () => setTalking(true),
      onDone: () => setTalking(false),
      onStopped: () => setTalking(false),
      onError: () => setTalking(false),
    });
  };

  useEffect(() => {
    if (!visible || loading || spoken.current) return;
    spoken.current = true;
    // A short beat lets the wave animation begin before the voice.
    const timer = setTimeout(speak, 520);
    return () => clearTimeout(timer);
  }, [visible, loading, speechText]);

  const close = () => {
    Speech.stop();
    setTalking(false);
    setVisible(false);
  };

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
        <View style={s.topBar}>
          <View style={{ flex: 1 }}>
            <TapeChip label={`${period.toUpperCase()} PROTOCOL`} tone="accent" />
            <Text style={[type.labelXs, { color: theme.muted, marginTop: 7 }]}>+ONE DAILY SIGNAL · {dayKey}</Text>
          </View>
          <Pressable onPress={speak} hitSlop={7} style={({ pressed }) => [s.iconButton, inkBox(theme, 'thin'), pressed && marker(theme, 1)]}>
            <Icon name="volume-high-outline" size={19} color={theme.ink} />
          </Pressable>
          <Pressable onPress={close} hitSlop={7} style={({ pressed }) => [s.iconButton, inkBox(theme, 'thin'), pressed && marker(theme, 1)]}>
            <Icon name="close" size={19} color={theme.ink} />
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={[s.content, isTablet && s.contentWide]}>
          <View style={[s.hero, isTablet && s.heroWide]}>
            <View style={[s.modelCard, isTablet && s.modelWide, inkBox(theme, 'ink')]}> 
              <View style={[s.tape, { backgroundColor: theme.cardAlt }]} />
              <ModelBoundary theme={theme}>
                <AIGreeterModel talking={talking} style={s.model} />
              </ModelBoundary>
              <View style={s.modelStatus}>
                <View style={[s.liveDot, { backgroundColor: talking ? theme.highlighter : theme.graphiteLine, borderColor: theme.ink }]} />
                <Text style={[type.labelXs, { color: theme.muted }]}>{talking ? 'SPEAKING' : 'LISTENING'}</Text>
              </View>
            </View>

            <View style={s.briefing}>
              <Text style={[type.headlineLg, { color: theme.text }]}>{period}, {firstName}.</Text>
              <View style={[s.underline, { backgroundColor: theme.ink }]} />
              <Text style={[type.bodyLg, { color: theme.text, marginTop: 18 }]}>{weatherSentence}</Text>
              <Text style={[type.bodyMd, { color: theme.subtext, marginTop: 12 }]}>{notices}</Text>

              <View style={s.weatherRow}>
                <View style={[s.weatherBadge, inkBox(theme, 'thin')]}>
                  <Icon name={weather ? 'sunny-outline' : 'compass-outline'} size={22} color={theme.ink} />
                  <View>
                    <Text style={[type.labelXs, { color: theme.muted }]}>OUTSIDE</Text>
                    <Text style={[type.headlineSm, { color: theme.text, marginTop: 2 }]}>
                      {loading ? 'Reading the sky…' : weather ? `${Math.round(weather.temperature)}°C · ${weather.condition}` : 'Weather unavailable'}
                    </Text>
                  </View>
                </View>
              </View>
            </View>
          </View>

          <Rule style={{ marginVertical: 22 }} />
          <Text style={[type.labelXs, { color: theme.muted, marginBottom: 10 }]}>YOUR SIGNALS</Text>
          <View style={[s.signalGrid, isTablet && s.signalGridWide]}>
            {cards.map((card) => (
              <PaperCard key={card.label} style={[s.signalCard, isTablet && s.signalCardWide]} weight="pencil">
                <Icon name={card.icon} size={19} color={theme.ink} />
                <Text style={[type.headlineMd, { color: theme.text, marginTop: 10 }]}>{card.value}</Text>
                <Text style={[type.labelXs, { color: theme.muted, marginTop: 4 }]}>{card.label}</Text>
              </PaperCard>
            ))}
          </View>

          <Pressable onPress={close} style={({ pressed }) => [s.finalCard, inkBox(theme, 'bold'), pressed && marker(theme, 2)]}>
            <Icon name="sparkles-outline" size={22} color={theme.ink} />
            <View style={{ flex: 1 }}>
              <Text style={[type.headlineSm, { color: theme.text }]}>Let’s find the +ones.</Text>
              <Text style={[type.bodySm, { color: theme.subtext, marginTop: 3 }]}>Your network is ready when you are.</Text>
            </View>
            <Icon name="arrow-forward" size={20} color={theme.ink} />
          </Pressable>
        </ScrollView>
      </View>
    </Modal>
  );
}

const makeStyles = (t) => StyleSheet.create({
  root: { flex: 1 },
  topBar: {
    flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: 20, paddingTop: 18, paddingBottom: 14,
    borderBottomWidth: stroke.ink, borderBottomColor: t.ink,
  },
  iconButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  content: { padding: 20, paddingBottom: 54 },
  contentWide: { maxWidth: 980, width: '100%', alignSelf: 'center', paddingTop: 34 },
  hero: { gap: 22 },
  heroWide: { flexDirection: 'row', alignItems: 'center' },
  modelCard: { height: 310, position: 'relative', backgroundColor: t.card, overflow: 'hidden' },
  modelWide: { width: '44%', height: 390 },
  model: { width: '100%', height: '100%' },
  tape: { position: 'absolute', top: -7, left: '42%', width: 56, height: 17, transform: [{ rotate: '-4deg' }], zIndex: 2 },
  modelStatus: { position: 'absolute', left: 14, bottom: 12, flexDirection: 'row', alignItems: 'center', gap: 7 },
  liveDot: { width: 10, height: 10, borderRadius: 99, borderWidth: 1 },
  modelFallback: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  briefing: { flex: 1, minWidth: 0 },
  underline: { height: 5, width: 230, maxWidth: '80%', marginTop: 7, borderRadius: 5, transform: [{ rotate: '-1deg' }] },
  weatherRow: { flexDirection: 'row', marginTop: 20 },
  weatherBadge: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 13, backgroundColor: t.card },
  signalGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  signalGridWide: { flexWrap: 'nowrap' },
  signalCard: { width: '48%', padding: 13 },
  signalCardWide: { width: 'auto', flex: 1, minWidth: 0 },
  finalCard: { flexDirection: 'row', alignItems: 'center', gap: 13, padding: 16, marginTop: 22, backgroundColor: t.card },
});

const styles = StyleSheet.create({
  modelFallback: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
