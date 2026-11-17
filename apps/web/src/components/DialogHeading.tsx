import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { useTheme } from './ui';

export default function DialogHeading({ title, onClose, disabled = false }: { title: string; onClose: () => void; disabled?: boolean }) {
  const { palette, styles } = useTheme();
  return <View style={[styles.row, { justifyContent: 'space-between', gap: 16, marginBottom: 8 }]}>
    <Text accessibilityRole="header" style={[styles.heading, { flex: 1, lineHeight: 24 }]}>{title}</Text>
    <Pressable accessibilityRole="button" accessibilityLabel="Zamknij" disabled={disabled} onPress={onClose} style={{ width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.surfaceAlt, opacity: disabled ? 0.5 : 1 }}><Text style={{ color: palette.ink, fontSize: 26, lineHeight: 30 }}>×</Text></Pressable>
  </View>;
}
