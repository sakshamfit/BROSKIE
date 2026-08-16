import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet, Modal } from 'react-native';
import Icon from './icons/Icon';
import SideNav from './components/SideNav';
import { useTheme } from './store/ThemeContext';
import { useAuth } from './store/AuthContext';
import { useChat } from './store/ChatContext';
import { type, inkBox, stroke } from './theme';

import ChatListScreen from './screens/ChatListScreen';
import ConversationScreen from './screens/ConversationScreen';
import NewChatScreen from './screens/NewChatScreen';
import SettingsScreen from './screens/SettingsScreen';
import ChatInfoScreen from './screens/ChatInfoScreen';
import NetworkScreen from './screens/NetworkScreen';
import StatusScreen from './screens/StatusScreen';

/**
 * Desktop web shell — persistent sidebar + master/detail split, matching the
 * "Graphite & Pulp" web mockup: SideNavBar | Inbox column | Chat canvas.
 * Screens are unchanged; they're driven by a tiny navigation shim so the
 * exact same components work full-screen on mobile and split-pane here.
 */
export default function DesktopLayout() {
  const { theme } = useTheme();
  const { logout } = useAuth();
  const { chats } = useChat();
  const [tab, setTab] = useState('chats');
  const [selectedChatId, setSelectedChatId] = useState(null);
  const [overlay, setOverlay] = useState(null); // { name, params }

  const s = makeStyles(theme);

  const openOverlay = (name, params) => setOverlay({ name, params });
  const closeOverlay = () => setOverlay(null);

  const listNav = {
    navigate: (name, params) => {
      if (name === 'Conversation') setSelectedChatId(params.chatId);
      else if (name === 'Settings') openOverlay('Settings');
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

  return (
    <View style={[s.root, { backgroundColor: theme.bg }]}>
      <SideNav
        active={tab}
        onNavigate={setTab}
        onNewChat={() => openOverlay('NewChat')}
        onSettings={() => openOverlay('Settings')}
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
      </View>

      <OverlayPanel visible={overlay?.name === 'NewChat'} onClose={closeOverlay} width={480}>
        <NewChatScreen navigation={overlayNav} />
      </OverlayPanel>

      <OverlayPanel visible={overlay?.name === 'Settings'} onClose={closeOverlay} width={480}>
        <SettingsScreen navigation={overlayNav} />
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
            { width, backgroundColor: theme.bg },
          ]}
        >
          <View style={{ flex: 1 }}>{children}</View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const makeStyles = (t) => StyleSheet.create({
  root: { flex: 1, flexDirection: 'row', height: '100%' },
  main: { flex: 1, flexDirection: 'row' },
  listPane: { width: 360, borderRightWidth: stroke.thin, borderStyle: 'dashed', height: '100%' },
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
