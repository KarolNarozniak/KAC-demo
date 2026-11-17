import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { useTheme } from './ui';

export default function ImportReaderChoice({ value, onChange, disabled = false }: { value: 'ai' | 'local'; onChange: (value: 'ai' | 'local') => void; disabled?: boolean }) {
  const { palette, styles } = useTheme();
  return <View style={{ gap: 10, marginVertical: 12 }}>
    <Text style={styles.label}>SPOSÓB ODCZYTU</Text>
    <View accessibilityRole="radiogroup" style={[styles.row, { gap: 8 }]}>{([{ id: 'ai', title: 'Odczyt AI' }, { id: 'local', title: 'Odczyt lokalny' }] as const).map(option => <Pressable key={option.id} accessibilityRole="radio" accessibilityLabel={option.title} accessibilityState={{ checked: value === option.id, disabled }} disabled={disabled} onPress={() => onChange(option.id)} style={{ flex: 1, minHeight: 48, padding: 12, borderRadius: 11, borderWidth: 1, borderColor: value === option.id ? palette.blue : palette.line, backgroundColor: value === option.id ? palette.blueSoft : palette.surfaceAlt, justifyContent: 'center' }}><Text style={[styles.body, { fontSize: 13, fontWeight: '700', color: value === option.id ? palette.blue : palette.ink }]}>{value === option.id ? '● ' : '○ '}{option.title}</Text></Pressable>)}</View>
    <Text style={styles.muted}>{value === 'ai' ? 'PDF lub zdjęcie zostanie wysłane do Azure AI Foundry. Oryginał nie jest zapisywany w bazie. Odczyt możesz przerwać.' : 'Plik odczytamy na serwerze aplikacji, bez wysyłania do AI.'}</Text>
    <Text style={[styles.body, { color: palette.green, fontSize: 13 }]}>Najpierw podgląd. Zapiszesz tylko sprawdzone dane.</Text>
  </View>;
}
