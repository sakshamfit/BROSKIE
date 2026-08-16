import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet, Platform } from 'react-native';
import { NavigationContainer, DefaultTheme, DarkTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaView } from 'react-native-safe-area-context';
import Icon from './icons/Icon';

import { useAuth } from './store/AuthContext';
import { useTheme } from './store/ThemeContext';
import { useChat } from './store/ChatContext';
import { Loading, EmptyState, CountBead, Rule } from './components/common';
import { radius, type, inkBox, marker, dashedRule, stroke } from './theme';

import AuthScreen from './screens/AuthScreen';
import ChatListScreen from './screens/ChatListScreen';
import ConversationScreen from './screens/ConversationScreen';
import NewChatScreen from './screens/NewChatScreen';
import StatusScreen from './screens/StatusScreen';
import NetworkScreen from './screens/NetworkScreen';
import SettingsScreen from './screens/SettingsScreen';
import ChatInfoScreen from './screens/ChatInfoScreen';

const Stack = createNativeStackNavigator();

/** Floating clay tab bar */
function HomeTabs({ navigation }) {
  const { theme } = useTheme();
  const { chats } = useChat();
  const [tab, setTab] = useState('chats');
  const unread = chats.reduce((n, c) => n + (c.archived ? 0 : c.unread), 0);
  const s = makeStyles(theme);

  const TABS = [
    { key: 'chats', label: 'Chats', icon: 'chatbubble', badge: unread },
    { key: 'status', label: 'See', icon: 'eye' },
    { key: 'network', label: 'Network', icon: 'people' },
    { key: 'settings', label: 'Settings', icon: 'settings' },
  ];

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <View style={{ flex: 1 }}>
        {tab === 'chats' && <ChatListScreen navigation={navigation} />}
        {tab === 'network' && <NetworkScreen navigation={navigation} />}
        {tab === 'status' && <StatusScreen navigation={navigation} />}
        {tab === 'calls' && <CallsPlaceholder />}
      </View>

      <SafeAreaView edges={['bottom']} style={{ backgroundColor: 'transparent' }}>
        <View style={[s.tabBar, { backgroundColor: theme.bg, borderTopWidth: stroke.ink, borderTopColor: theme.ink }]}>
          {TABS.map((t) => {
            const active = tab === t.key;
            return (
              <Pressable
                key={t.key}
                onPress={() => (t.key === 'settings' ? navigation.navigate('Settings') : setTab(t.key))}
                style={({ pressed }) => [
                  s.tabItem,
                  active ? [s.tabActive, { backgroundColor: theme.tabActiveBg, borderColor: theme.ink }] : null,
                  pressed && !active ? marker(theme, 1) : null,
                ]}
              >
                <View>
                  <Icon
                    name={active ? t.icon : `${t.icon}-outline`}
                    size={20}
                    color={active ? theme.ink : theme.muted}
                  />
                  {!!t.badge && t.badge > 0 && (
                    <View style={s.tabBadge}>
                      <CountBead label={t.badge > 9 ? '9+' : String(t.badge)} small />
                    </View>
                  )}
                </View>
                <Text style={[type.labelXs, { color: active ? theme.ink : theme.muted }]}>
                  {t.label.toUpperCase()}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </SafeAreaView>
    </View>
  );
}

function CallsPlaceholder() {
  const { theme } = useTheme();
  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <View style={{ paddingHorizontal: 20, paddingTop: 20, paddingBottom: 16, minHeight: 84, justifyContent: 'center' }}>
        <Text style={[type.headlineLg, { color: theme.text }]}>Calls</Text>
      </View>
      <EmptyState
        icon="call-outline"
        title="No recent calls"
        subtitle="Voice and video calling would need WebRTC — the signalling layer is ready on the server."
      />
    </View>
  );
}

export default function Navigation() {
  const { user, booting } = useAuth();
  const { theme, mode } = useTheme();

  if (booting) return <Loading label="STARTING 友達" />;

  const navTheme = {
    ...(mode === 'dark' ? DarkTheme : DefaultTheme),
    colors: {
      ...(mode === 'dark' ? DarkTheme : DefaultTheme).colors,
      background: theme.bg,
      card: theme.card,
      text: theme.text,
      border: 'transparent',
      primary: theme.primary,
    },
  };

  return (
    <NavigationContainer theme={navTheme}>
      <Stack.Navigator screenOptions={{ headerShown: false, animation: Platform.OS === 'web' ? 'none' : 'default', contentStyle: { backgroundColor: theme.bg } }}>
        {!user ? (
          <Stack.Screen name="Auth" component={AuthScreen} />
        ) : (
          <>
            <Stack.Screen name="Home" component={HomeTabs} />
            <Stack.Screen name="Conversation" component={ConversationScreen} />
            <Stack.Screen name="NewChat" component={NewChatScreen} />
            <Stack.Screen name="ChatInfo" component={ChatInfoScreen} />
            <Stack.Screen name="Settings" component={SettingsScreen} />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}

const makeStyles = (t) => StyleSheet.create({
  tabBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingTop: 10, paddingBottom: 6, paddingHorizontal: 12,
  },
  tabItem: {
    flex: 1, alignItems: 'center', justifyContent: 'center', gap: 5,
    paddingVertical: 8, marginHorizontal: 5,
  },
  tabActive: { borderWidth: 1, borderRadius: 999 },
  tabBadge: { position: 'absolute', right: -11, top: -7 },
});
