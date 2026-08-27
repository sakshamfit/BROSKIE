import React, { useEffect, useRef, useState, useCallback } from 'react';
import { View, TextInput, Pressable, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import { useTheme } from '../store/ThemeContext';
import Icon from '../icons/Icon';
import { Avatar } from './common';
import { radius, type, inkBox, alpha } from '../theme';
import useOTDocument from '../hooks/useOTDocument';
import { Text } from './Text';

/**
 * CollabEditor - Real-time collaborative text editor with OT
 * 
 * Features:
 * - OT-based concurrent editing (insert/delete/retain transformation)
 * - Live cursors and selections from collaborators
 * - Offline queuing with automatic sync on reconnect
 * - Version tracking and conflict resolution
 * - Presence indicators
 */

export function CollabEditor({ documentId, initialContent = '', initialVersion = 0, socket, title = 'Collaborative Note', onClose, chatId }) {
  const { theme } = useTheme();
  const [localContent, setLocalContent] = useState(initialContent);
  const [isSaving, setIsSaving] = useState(false);
  const lastContentRef = useRef(initialContent);
  const inputRef = useRef(null);
  const debounceTimer = useRef(null);

  const {
    content,
    version,
    hasPending,
    collaborators,
    connected,
    applyLocalEdit,
    updateSelection,
    reset
  } = useOTDocument({
    documentId,
    initialContent,
    initialVersion,
    socket,
    onContentChange: (newContent, operation, isRemote) => {
      if (isRemote) {
        setLocalContent(newContent);
        lastContentRef.current = newContent;
      }
    }
  });

  useEffect(() => {
    setLocalContent(content);
    lastContentRef.current = content;
  }, [content]);

  // Debounced OT operation submission on text change
  const handleChangeText = useCallback((newText) => {
    setLocalContent(newText);
    
    clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      const oldText = lastContentRef.current;
      if (oldText !== newText) {
        setIsSaving(true);
        const op = applyLocalEdit(oldText, newText);
        if (op) {
          lastContentRef.current = newText;
        }
        setTimeout(() => setIsSaving(false), 400);
      }
    }, 300);
  }, [applyLocalEdit]);

  const handleSelectionChange = useCallback((event) => {
    const { selection } = event.nativeEvent;
    if (selection) {
      updateSelection(selection.start, selection);
    }
  }, [updateSelection]);

  const collabList = Object.entries(collaborators);
  const s = makeStyles(theme);

  return (
    <View style={[s.container, { backgroundColor: theme.bg }]}>
      {/* Header */}
      <View style={[s.header, { borderBottomColor: theme.ink, backgroundColor: theme.card }]}>
        <View style={s.headerLeft}>
          <Pressable onPress={onClose} hitSlop={8} style={s.iconBtn}>
            <Icon name="close" size={22} color={theme.ink} />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={[type.headlineSm, { color: theme.text }]} numberOfLines={1}>
              {title}
            </Text>
            <View style={s.statusRow}>
              <View style={[s.dot, { backgroundColor: connected ? theme.accent : theme.muted }]} />
              <Text style={[type.labelXs, { color: theme.muted }]}>
                {connected ? `V${version} • ${collabList.length + 1} EDITING` : 'CONNECTING…'} 
                {hasPending ? ' • SYNCING' : ''} {isSaving ? ' • SAVING' : ''}
              </Text>
            </View>
          </View>
        </View>
        <View style={s.headerRight}>
          {hasPending && <ActivityIndicator size="small" color={theme.accent} />}
        </View>
      </View>

      {/* Collaborators bar */}
      {collabList.length > 0 && (
        <View style={[s.collabBar, { backgroundColor: theme.cardAlt, borderBottomColor: theme.graphiteLine }]}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.collabScroll}>
            {collabList.map(([userId, data]) => (
              <View key={userId} style={s.collabChip}>
                <Avatar name={data.name} id={userId} size={24} />
                <Text style={[type.labelXs, { color: theme.text, maxWidth: 80 }]} numberOfLines={1}>
                  {data.name?.split(' ')[0]}
                </Text>
                <View style={[s.liveDot, { backgroundColor: theme.accent }]} />
              </View>
            ))}
          </ScrollView>
        </View>
      )}

      {/* Editor */}
      <View style={s.editorWrap}>
        <TextInput
          ref={inputRef}
          multiline
          value={localContent}
          onChangeText={handleChangeText}
          onSelectionChange={handleSelectionChange}
          placeholder="Start writing… Your changes sync live with everyone in this chat."
          placeholderTextColor={theme.muted}
          style={[s.input, { color: theme.text }]}
          textAlignVertical="top"
          autoFocus
        />

        {/* Remote cursors overlay - simplified: show names where they are typing */}
        {collabList.map(([userId, data]) => {
          if (data.cursor == null) return null;
          return (
            <View key={`cursor-${userId}`} style={s.remoteCursorNote}>
              <Text style={[type.labelXs, { color: theme.accent }]}>
                {data.name} is here • {data.cursor}
              </Text>
            </View>
          );
        })}
      </View>

      {/* Footer with OT info */}
      <View style={[s.footer, { borderTopColor: theme.graphiteLine, backgroundColor: theme.card }]}>
        <View style={s.footerLeft}>
          <Icon name="git-merge-outline" size={14} color={theme.muted} />
          <Text style={[type.labelXs, { color: theme.muted }]}>
            OT ENABLED • CONFLICT-FREE • VERSION {version}
          </Text>
        </View>
        <View style={s.footerRight}>
          <Text style={[type.labelXs, { color: theme.muted }]}>
            {localContent.length} CHARS
          </Text>
        </View>
      </View>
    </View>
  );
}

const makeStyles = (t) => StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 2, gap: 12 },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  iconBtn: { padding: 6, borderRadius: 999 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  dot: { width: 7, height: 7, borderRadius: 999 },
  collabBar: { flexDirection: 'row', paddingVertical: 8, paddingHorizontal: 12, borderBottomWidth: 1, borderStyle: 'dashed' },
  collabScroll: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  collabChip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, borderWidth: 1, borderColor: t.graphiteLine, backgroundColor: t.bg },
  liveDot: { width: 6, height: 6, borderRadius: 999, marginLeft: 2 },
  editorWrap: { flex: 1, padding: 16 },
  input: { flex: 1, fontFamily: 'Karla_400Regular', fontSize: 16, lineHeight: 24, textAlignVertical: 'top' },
  remoteCursorNote: { marginTop: 8, paddingHorizontal: 4 },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 10, borderTopWidth: 1, borderStyle: 'dashed' },
  footerLeft: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  footerRight: { flexDirection: 'row', alignItems: 'center' }
});

export default CollabEditor;
