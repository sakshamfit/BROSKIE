import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, Pressable, StyleSheet, FlatList, ActivityIndicator, TextInput, Modal, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { useTheme } from '../store/ThemeContext';
import { useChatActions } from '../store/ChatContext';
import { useAuth } from '../store/AuthContext';
import Icon from '../icons/Icon';
import { PaperCard, Avatar, Rule } from './common';
import { type, inkBox, alpha, radius } from '../theme';
import { api } from '../api';
import { SpringPressable, motion } from '../motion';
import CollabEditor from './CollabEditor';

/**
 * CollabDocumentView - Lists and manages collaborative documents in a chat
 * Integrated into ChatInfo or as standalone screen
 */

export function CollabDocumentView({ chatId, embedded = false, socket: socketProp }) {
  const { theme } = useTheme();
  const { user } = useAuth();
  const { socketRef } = useChatActions();
  const socket = socketProp || socketRef?.current || null;
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [editingDoc, setEditingDoc] = useState(null); // { id, title, content, version }
  const [showCreate, setShowCreate] = useState(false);

  const s = makeStyles(theme);

  const loadDocuments = useCallback(async () => {
    if (!chatId) return;
    setLoading(true);
    try {
      const res = await api.getChatDocuments(chatId);
      setDocuments(res.documents || []);
    } catch (e) {
      console.warn('[OT] load docs failed', e.message);
    } finally {
      setLoading(false);
    }
  }, [chatId]);

  useEffect(() => {
    loadDocuments();
  }, [loadDocuments]);

  // Listen for real-time doc events
  useEffect(() => {
    if (!socket) return;
    const onCreated = (payload) => {
      if (payload.chatId === chatId) {
        setDocuments(prev => {
          if (prev.some(d => d.id === payload.document.id)) return prev;
          return [payload.document, ...prev];
        });
      }
    };
    const onDeleted = (payload) => {
      if (payload.chatId === chatId) {
        setDocuments(prev => prev.filter(d => d.id !== payload.documentId));
        if (editingDoc?.id === payload.documentId) setEditingDoc(null);
      }
    };
    const onUpdated = (payload) => {
      setDocuments(prev => prev.map(d => d.id === payload.documentId ? { ...d, title: payload.title } : d));
      if (editingDoc?.id === payload.documentId) {
        setEditingDoc(prev => ({ ...prev, title: payload.title }));
      }
    };

    socket.on('doc:created', onCreated);
    socket.on('doc:deleted', onDeleted);
    socket.on('doc:updated', onUpdated);
    return () => {
      socket.off('doc:created', onCreated);
      socket.off('doc:deleted', onDeleted);
      socket.off('doc:updated', onUpdated);
    };
  }, [socket, chatId, editingDoc]);

  const handleCreate = async () => {
    if (!newTitle.trim()) {
      Alert.alert('Title needed', 'Give your collaborative note a title');
      return;
    }
    setCreating(true);
    try {
      const res = await api.createChatDocument(chatId, { title: newTitle.trim(), content: '' });
      setDocuments(prev => [res.document, ...prev]);
      setNewTitle('');
      setShowCreate(false);
      setEditingDoc({ id: res.document.id, title: res.document.title, content: res.document.content || '', version: res.document.version || 0 });
    } catch (e) {
      Alert.alert('Could not create', e.message);
    } finally {
      setCreating(false);
    }
  };

  const handleOpen = async (doc) => {
    try {
      const res = await api.getDocument(doc.id);
      setEditingDoc({
        id: res.document.id,
        title: res.document.title,
        content: res.document.content || doc.content || '',
        version: res.document.version || 0
      });
    } catch (e) {
      // Fallback to local doc data
      setEditingDoc({ id: doc.id, title: doc.title, content: doc.content || '', version: doc.version || 0 });
    }
  };

  const handleDelete = (doc) => {
    Alert.alert('Delete note?', `"${doc.title}" will be deleted for everyone.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await api.deleteDocument(doc.id);
            setDocuments(prev => prev.filter(d => d.id !== doc.id));
          } catch (e) {
            Alert.alert('Could not delete', e.message);
          }
        }
      }
    ]);
  };

  // If editing a document, show full-screen editor
  if (editingDoc) {
    // We need to get socket from ChatContext - use a hack to access via window if available
    // Actually we pass socket via prop from parent that has access
    return (
      <CollabEditor
        documentId={editingDoc.id}
        initialContent={editingDoc.content}
        initialVersion={editingDoc.version}
        socket={socket}
        title={editingDoc.title || 'Untitled'}
        onClose={() => {
          setEditingDoc(null);
          loadDocuments();
        }}
        chatId={chatId}
      />
    );
  }

  return (
    <View style={[s.container, !embedded && { backgroundColor: theme.bg, flex: 1 }]}>
      {!embedded && (
        <View style={[s.header, { borderBottomColor: theme.ink }]}>
          <Text style={[type.headlineSm, { color: theme.text }]}>COLLABORATIVE NOTES</Text>
          <Text style={[type.bodySm, { color: theme.muted, marginTop: 4 }]}>
            Real-time docs powered by Operational Transformation. Everyone in this chat can edit together.
          </Text>
        </View>
      )}

      <View style={s.toolbar}>
        <SpringPressable onPress={() => setShowCreate(true)} style={({ pressed }) => [s.createBtn, inkBox(theme, 'thin'), { backgroundColor: pressed ? theme.highlighter : theme.card }]} scaleTo={motion.scale.row} haptic="selection">
          <Icon name="add" size={18} color={theme.ink} />
          <Text style={[type.labelSm, { color: theme.ink }]}>NEW NOTE</Text>
        </SpringPressable>
        <Pressable onPress={loadDocuments} style={s.refreshBtn}>
          <Icon name="refresh" size={18} color={theme.muted} />
        </Pressable>
      </View>

      {loading ? (
        <View style={s.center}>
          <ActivityIndicator color={theme.primary} />
          <Text style={[type.labelSm, { color: theme.muted, marginTop: 10 }]}>LOADING NOTES…</Text>
        </View>
      ) : documents.length === 0 ? (
        <View style={s.empty}>
          <Icon name="document-text-outline" size={32} color={theme.muted} />
          <Text style={[type.bodyStrong, { color: theme.text, marginTop: 12 }]}>No collaborative notes yet</Text>
          <Text style={[type.bodySm, { color: theme.muted, marginTop: 4, textAlign: 'center', maxWidth: 280 }]}>
            Create a shared note that everyone in this chat can edit together in real time. OT ensures no conflicts.
          </Text>
        </View>
      ) : (
        <FlatList
          data={documents}
          keyExtractor={d => d.id}
          contentContainerStyle={{ padding: 16, gap: 12 }}
          renderItem={({ item }) => (
            <PaperCard weight="thin" style={s.docCard}>
              <Pressable onPress={() => handleOpen(item)} style={s.docMain}>
                <View style={[s.docIcon, { backgroundColor: alpha(theme.accent, 0.15) }]}>
                  <Icon name="document-text" size={20} color={theme.accent} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[type.bodyStrong, { color: theme.text }]} numberOfLines={1}>
                    {item.title || 'Untitled'}
                  </Text>
                  <Text style={[type.bodySm, { color: theme.subtext, marginTop: 2 }]} numberOfLines={2}>
                    {item.content ? item.content.slice(0, 120) : 'Empty — tap to start writing together'}
                  </Text>
                  <View style={s.docMeta}>
                    <Text style={[type.labelXs, { color: theme.muted }]}>V{item.version} • {item.content?.length || 0} CHARS</Text>
                  </View>
                </View>
                <Icon name="chevron-forward" size={18} color={theme.muted} />
              </Pressable>
              <Rule style={{ marginVertical: 8 }} />
              <View style={s.docActions}>
                <Pressable onPress={() => handleOpen(item)} style={s.actionBtn}>
                  <Icon name="create-outline" size={16} color={theme.ink} />
                  <Text style={[type.labelXs, { color: theme.ink }]}>EDIT LIVE</Text>
                </Pressable>
                <Pressable onPress={() => handleDelete(item)} style={s.actionBtn}>
                  <Icon name="trash-outline" size={16} color={theme.danger} />
                  <Text style={[type.labelXs, { color: theme.danger }]}>DELETE</Text>
                </Pressable>
              </View>
            </PaperCard>
          )}
        />
      )}

      <Modal visible={showCreate} transparent animationType="fade" onRequestClose={() => setShowCreate(false)}>
        <KeyboardAvoidingView style={s.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setShowCreate(false)} accessibilityLabel="Close new note panel" />
          <View style={[s.modalSheet, { backgroundColor: theme.bg, borderColor: theme.ink }]}>
            <Text style={[type.headlineSm, { color: theme.text }]}>New Collaborative Note</Text>
            <Text style={[type.bodySm, { color: theme.muted, marginTop: 4 }]}>
              Powered by Operational Transformation — edits from everyone merge conflict-free.
            </Text>
            <View style={[s.inputWrap, { borderColor: theme.graphiteLine, backgroundColor: theme.inputBackground }]}>
              <TextInput
                value={newTitle}
                onChangeText={setNewTitle}
                placeholder="Note title (e.g., Meeting notes, Shopping list)"
                placeholderTextColor={theme.muted}
                style={[s.textInput, { color: theme.text }]}
                autoFocus
                returnKeyType="done"
                onSubmitEditing={handleCreate}
                blurOnSubmit={false}
                maxLength={120}
              />
            </View>
            <View style={s.modalActions}>
              <Pressable onPress={() => setShowCreate(false)} style={[s.modalBtn, { borderColor: theme.ink }]}>
                <Text style={[type.labelSm, { color: theme.ink }]}>CANCEL</Text>
              </Pressable>
              <Pressable onPress={handleCreate} disabled={creating} style={[s.modalBtn, { backgroundColor: theme.ink, opacity: creating ? 0.6 : 1 }]}>
                {creating ? <ActivityIndicator size="small" color={theme.onPrimary} /> : <Text style={[type.labelSm, { color: theme.onPrimary }]}>CREATE</Text>}
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const makeStyles = (t) => StyleSheet.create({
  container: { flex: 1 },
  header: { padding: 20, borderBottomWidth: 2 },
  toolbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, gap: 12 },
  createBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingVertical: 10 },
  refreshBtn: { padding: 8 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 },
  docCard: { padding: 14 },
  docMain: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  docIcon: { width: 40, height: 40, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  docMeta: { marginTop: 6, flexDirection: 'row', gap: 8 },
  docActions: { flexDirection: 'row', gap: 12 },
  actionBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6, paddingHorizontal: 8 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center', padding: 20 },
  modalSheet: { width: '100%', maxWidth: 400, borderWidth: 3, padding: 20, borderTopLeftRadius: 6, borderTopRightRadius: 12, borderBottomRightRadius: 6, borderBottomLeftRadius: 10 },
  inputWrap: { marginTop: 16, borderWidth: 1, borderBottomWidth: 2, paddingHorizontal: 12, paddingVertical: 4 },
  textInput: { fontFamily: 'Karla_400Regular', fontSize: 16, paddingVertical: 10 },
  modalActions: { flexDirection: 'row', gap: 10, marginTop: 18 },
  modalBtn: { flex: 1, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderRadius: 999, paddingVertical: 12, minHeight: 44 }
});

export default CollabDocumentView;
