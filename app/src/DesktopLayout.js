import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet, Modal, BackHandler, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from './icons/Icon';
import SideNav from './components/SideNav';
import { useTheme } from './store/ThemeContext';
import { useAuth } from './store/AuthContext';
import { useChat } from './store/ChatContext';
import useResponsive from './hooks/useResponsive';
import { type, inkBox, stroke } from './theme';

import ChatListScreen from './screens/ChatListScreen';
import ConversationScreen from './screens/ConversationScreen';
import NewChatScreen from './screens/NewChatScreen';
import SettingsScreen from './screens/SettingsScreen';
import ChatInfoScreen from './screens/ChatInfoScreen';
import NetworkScreen from './screens/NetworkScreen';
import StatusScreen from './screens/StatusScreen';
import PersonalInfoScreen from './screens/PersonalInfoScreen';
import SecurityScreen from './screens/SecurityScreen';
import AppearanceScreen from './screens/AppearanceScreen';

/**
 * Split shell for wide viewports — desktop web AND real tablets/foldables
 * (iPad, Android tablets, unfolded foldables) once there's enough width in
 * either orientation: persistent sidebar + Inbox column + chat canvas,
 * matching the "Graphite & Pulp" web mockup. Screens are unchanged; they're
 * driven by a tiny navigation shim so the exact same components work
 * full-screen on phones and split-pane here.
 */
export default function SplitLayout() {
  const { theme } = useTheme();
  const { logout } = useAuth();
  const { chats } = useChat();
  const { breakpoint, insets, isWeb } = useResponsive();
  const [tab, setTab] = useState('chats');
  const [selectedChatId, setSelectedChatId] = useState(null);
  const [overlay, setOverlay] = useState(null); // { name, params }

  // On native tablets the sidebar sits inside the device's safe area
  // (status bar / notch / home indicator); web ignores this (insets are 0).
  const s = makeStyles(theme, insets, isWeb);

  // Narrower "expanded" tablets get an icon-only rail to leave more room
  // for the list + detail panes; "large" (wide desktop / big tablets in
  // landscape) gets the full labeled sidebar.
  const railOnly = breakpoint === 'expanded';

  const openOverlay = (name, params) => setOverlay({ name, params });
  const closeOverlay = () => setOverlay(null);

  // Settings is a full-screen top-level section here (like Chats/See/
  // Network) — NOT a popup — with its own little navigation stack for the
  // Personal Information / Security / Appearance drill-downs.
  const [settingsSub, setSettingsSub] = useState(null);

  const settingsNav = {
    navigate: (name) => {
      if (['PersonalInfo', 'Security', 'Appearance'].includes(name)) setSettingsSub(name);
    },
    goBack: () => (settingsSub ? setSettingsSub(null) : setTab('chats')),
    replace: () => {},
  };

  const listNav = {
    navigate: (name, params) => {
      if (name === 'Conversation') setSelectedChatId(params.chatId);
      else if (name === 'Settings') { setSettingsSub(null); setTab('settings'); }
      else if (name === 'NewChat') openOverlay('NewChat');
    },
    goBack: () => {},
    replace(name, params) { this.navigate(name, params); },
  };

  const convNav = {
    navigate: (name, params) => {
      if (name === 'ChatInfo') openOverlay('ChatInfo', params);
    },
    goBack: () => setSelectedChatId(null),
    replace: () => {},
  };

  const overlayNav = {
    navigate: (name, params) => {
      if (name === 'Conversation') { setSelectedChatId(params.chatId); closeOverlay(); setTab('chats'); }
      else openOverlay(name, params);
    },
    goBack: closeOverlay,
    replace: (name, params) => {
      if (name === 'Conversation') { setSelectedChatId(params.chatId); closeOverlay(); setTab('chats'); }
    },
  };

  const selectedChat = chats.find((c) => c.id === selectedChatId);

  // Android hardware back: close whatever is on top instead of exiting the
  // app (matches how the native stack navigator behaves on phones).
  useEffect(() => {
    if (Platform.OS !== 'android') return undefined;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (overlay) {
        closeOverlay();
        return true;
      }
      if (tab === 'settings' && settingsSub) {
        setSettingsSub(null);
        return true;
      }
      if (tab === 'settings') {
        setTab('chats');
        return true;
      }
      if (selectedChatId) {
        setSelectedChatId(null);
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [overlay, tab, settingsSub, selectedChatId]);

  return (
    <View style={[s.root, { backgroundColor: theme.bg }]}>
      <SideNav
        active={tab}
        railOnly={railOnly}
        onNavigate={(key) => { setSettingsSub(null); setTab(key); }}
        onNewChat={() => openOverlay('NewChat')}
        onSettings={() => { setSettingsSub(null); setTab('settings'); }}
        onHelp={() => openOverlay('Help')}
        onLogout={logout}
      />

      <View style={s.main}>
        {tab === 'chats' && (
          <>
            <View style={[s.listPane, { borderRightColor: theme.graphiteLine }]}>
              <ChatListScreen navigation={listNav} embedded />
            </View>
            <View style={s.detailPane}>
              {selectedChat ? (
                <ConversationScreen
                  navigation={convNav}
                  route={{ params: { chatId: selectedChatId } }}
                  embedded
                />
              ) : (
                <EmptyDetail />
              )}
            </View>
          </>
        )}

        {tab === 'status' && (
          <View style={s.fullPane}>
            <StatusScreen />
          </View>
        )}

        {tab === 'network' && (
          <View style={[s.fullPane, s.centeredPane]}>
            <NetworkScreen />
          </View>
        )}

        {/* Settings is a full-screen section, same as Chats/See/Network —
            not a centered popup — matching the mockup's own full-page layout. */}
        {tab === 'settings' && (
          <View style={s.fullPane}>
            {settingsSub === 'PersonalInfo' && <PersonalInfoScreen navigation={settingsNav} embedded />}
            {settingsSub === 'Security' && <SecurityScreen navigation={settingsNav} embedded />}
            {settingsSub === 'Appearance' && <AppearanceScreen navigation={settingsNav} embedded />}
            {!settingsSub && <SettingsScreen navigation={settingsNav} embedded />}
          </View>
        )}
      </View>

      <OverlayPanel visible={overlay?.name === 'NewChat'} onClose={closeOverlay} width={480}>
        <NewChatScreen navigation={overlayNav} />
      </OverlayPanel>

      <OverlayPanel visible={overlay?.name === 'ChatInfo'} onClose={closeOverlay} width={420}>
        {overlay?.name === 'ChatInfo' && (
          <ChatInfoScreen navigation={overlayNav} route={{ params: overlay.params }} />
        )}
      </OverlayPanel>

      <Modal visible={overlay?.name === 'Help'} transparent animationType="fade" onRequestClose={closeOverlay}>
        <Pressable style={s.helpBackdrop} onPress={closeOverlay}>
          <Pressable style={[s.helpCard, inkBox(theme, 'bold'), { backgroundColor: theme.bg }]}>
            <Text style={[type.headlineSm, { color: theme.text, marginBottom: 10 }]}>友達 · Graphite &amp; Pulp</Text>
            <Text style={[type.bodyMd, { color: theme.subtext, marginBottom: 6 }]}>
              A realtime messenger sketched in ink on paper. Long-press messages to react,
              reply or delete. Long-press a chat to archive it.
            </Text>
            <Text style={[type.bodySm, { color: theme.muted }]}>Not affiliated with WhatsApp.</Text>
            <Pressable onPress={closeOverlay} style={[s.helpClose, inkBox(theme, 'thin')]}>
              <Icon name="close" size={16} color={theme.ink} />
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

function EmptyDetail() {
  const { theme } = useTheme();
  return (
    <View style={styles.emptyWrap}>
      <View style={[styles.emptyBadge, inkBox(theme, 'ink')]}>
        <Icon name="chatbubbles-outline" size={34} color={theme.ink} />
      </View>
      <Text style={[type.headlineSm, { color: theme.text, marginTop: 18 }]}>Pick a page to open</Text>
      <Text style={[type.bodySm, { color: theme.subtext, marginTop: 8, textAlign: 'center', maxWidth: 280 }]}>
        Select a conversation from the inbox, or start a new sketch.
      </Text>
    </View>
  );
}

function OverlayPanel({ visible, onClose, width = 480, children }) {
  const { theme } = useTheme();
  if (!visible) return null;
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={[styles.overlayBackdrop, { backgroundColor: theme.overlay }]} onPress={onClose}>
        <Pressable
          style={[
            styles.overlayPanel,
            inkBox(theme, 'bold'),
            { width, maxWidth: '92%', backgroundColor: theme.bg },
          ]}
        >
          <View style={{ flex: 1 }}>{children}</View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const makeStyles = (t, insets, isWeb) => StyleSheet.create({
  root: {
    flex: 1, flexDirection: 'row', height: '100%',
    // Native tablets: respect the notch/status bar/home-indicator; web ignores (0).
    paddingTop: isWeb ? 0 : insets.top,
    paddingBottom: isWeb ? 0 : insets.bottom,
  },
  main: { flex: 1, flexDirection: 'row' },
  listPane: { width: 360, maxWidth: '42%', borderRightWidth: stroke.thin, borderStyle: 'dashed', height: '100%' },
  detailPane: { flex: 1, height: '100%' },
  fullPane: { flex: 1, height: '100%' },
  centeredPane: { alignItems: 'center' },
  helpBackdrop: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  helpCard: { width: '100%', maxWidth: 420, padding: 24 },
  helpClose: { position: 'absolute', top: 12, right: 12, width: 30, height: 30, alignItems: 'center', justifyContent: 'center' },
});

const styles = StyleSheet.create({
  overlayBackdrop: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  overlayPanel: { maxHeight: '88%', minHeight: 320, overflow: 'hidden' },
  emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 },
  emptyBadge: { width: 84, height: 84, alignItems: 'center', justifyContent: 'center' },
});
