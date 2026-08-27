import React, { useState } from 'react';
import { View, TextInput, Pressable, StyleSheet, Modal } from 'react-native';
import Icon from '../icons/Icon';
import { useTheme } from '../store/ThemeContext';
import { InkButton, InkField, Rule, FrostedBackdrop } from './common';
import { SheetSpringIn, SpringPressable, motion } from '../motion';
import { type, inkBox, marker, raised } from '../theme';
import { Text } from './Text';

const MAX_OPTIONS = 6;

/**
 * Group-chat poll composer: a question + 2–6 options, sent as a 'poll'
 * message via socket `poll:create`.
 */
export default function PollComposer({ visible, onClose, onCreate }) {
  const { theme } = useTheme();
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState(['', '']);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const s = makeStyles(theme);

  const close = () => { setQuestion(''); setOptions(['', '']); setError(null); onClose(); };

  const setOpt = (i, v) => setOptions((prev) => prev.map((o, idx) => (idx === i ? v : o)));

  const submit = async () => {
    setError(null);
    const q = question.trim();
    const opts = options.map((o) => o.trim()).filter(Boolean);
    if (!q) return setError('Write a question for the poll');
    if (opts.length < 2) return setError('Add at least two options');
    setBusy(true);
    try {
      await onCreate(q, opts);
      close();
    } catch (e) {
      setError(e.message || 'Could not create the poll');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={close}>
      <Pressable style={[s.overlay, { backgroundColor: 'transparent' }]} onPress={close}>
        <FrostedBackdrop />
        <SheetSpringIn style={{ width: '100%', maxWidth: 380 }}>
        <Pressable style={[s.sheet, raised(theme, 2), { backgroundColor: theme.bg, borderColor: theme.ink }]}>
          <View style={s.head}>
            <View style={{ flex: 1 }}>
              <Text style={[type.headlineSm, { color: theme.text }]}>Create a poll</Text>
              <Text style={[type.bodySm, { color: theme.subtext }]}>Group members vote live</Text>
            </View>
            <Pressable onPress={close} hitSlop={8}>
              <Icon name="close" size={22} color={theme.muted} />
            </Pressable>
          </View>

          <InkField style={s.field}>
            <TextInput
              value={question}
              onChangeText={setQuestion}
              placeholder="Ask something…"
              placeholderTextColor={theme.muted}
              style={[s.input, { color: theme.text }]}
              maxLength={240}
            />
          </InkField>

          {options.map((opt, i) => (
            <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <InkField style={s.field}>
                <Text style={[type.labelXs, { color: theme.muted }]}>{String.fromCharCode(65 + i)}.</Text>
                <TextInput
                  value={opt}
                  onChangeText={(v) => setOpt(i, v)}
                  placeholder={`Option ${i + 1}`}
                  placeholderTextColor={theme.muted}
                  style={[s.input, { color: theme.text }]}
                  maxLength={80}
                />
              </InkField>
              {options.length > 2 && (
                <Pressable onPress={() => setOptions((prev) => prev.filter((_, idx) => idx !== i))} hitSlop={8}>
                  <Icon name="remove-circle-outline" size={20} color={theme.muted} />
                </Pressable>
              )}
            </View>
          ))}

          {options.length < MAX_OPTIONS && (
            <SpringPressable
              style={({ pressed }) => [s.addRow, pressed ? marker(theme, 1) : null]}
              onPress={() => setOptions((prev) => [...prev, ''])}
              scaleTo={motion.scale.row}
              haptic="selection"
            >
              <Icon name="add-circle-outline" size={18} color={theme.ink} />
              <Text style={[type.bodySm, { color: theme.ink }]}>Add option</Text>
            </SpringPressable>
          )}

          {!!error && <Text style={[type.bodySm, { color: theme.danger }]}>{error}</Text>}

          <Rule style={{ marginVertical: 4 }} />
          <InkButton label={busy ? 'Posting…' : 'Post poll'} onPress={submit} filled busy={busy} />
        </Pressable>
        </SheetSpringIn>
      </Pressable>
    </Modal>
  );
}

const makeStyles = (t) => StyleSheet.create({
  overlay: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28 },
  sheet: {
    width: '100%', maxWidth: 460, borderWidth: 3, padding: 18, gap: 10,
    borderTopLeftRadius: 6, borderTopRightRadius: 12,
    borderBottomRightRadius: 6, borderBottomLeftRadius: 10,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 6 },
  field: { minHeight: 42 },
  input: { flex: 1, ...type.bodyMd, paddingVertical: 10, outlineStyle: 'none' },
  addRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, alignSelf: 'flex-start', paddingHorizontal: 4 },
});
