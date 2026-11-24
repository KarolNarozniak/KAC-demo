import React from 'react';
import { Pressable, Text, View } from 'react-native';
import PremiumCrown from './PremiumCrown';
import { useTheme } from './ui';

export default function ImportReaderChoice({ value, onChange, disabled = false, isPremium, onPremiumRequest }: {
  value: 'ai' | 'local'; onChange: (value: 'ai' | 'local') => void; disabled?: boolean; isPremium: boolean; onPremiumRequest: () => void;
}) {
  const { palette, styles } = useTheme();
  return <View style={{ gap: 10, marginVertical: 12 }}>
    <Text style={styles.label}>SPOSÓB ODCZYTU</Text>
    <View accessibilityRole="radiogroup" style={[styles.row, { gap: 8 }]}>{([{ id: 'ai', title: 'Odczyt AI' }, { id: 'local', title: 'Odczyt lokalny' }] as const).map(option => <Pressable key={option.id} accessibilityRole="radio"
      accessibilityLabel={option.id === 'ai' ? 'Odczyt AI, funkcja Premium' : option.title}
      accessibilityState={{ checked: value === option.id, disabled }} disabled={disabled}
      onPress={() => { if (option.id === 'ai' && !isPremium) { onPremiumRequest(); return; } onChange(option.id); }}
      style={{ flex: 1, minHeight: 52, padding: 12, paddingRight: option.id === 'ai' ? 42 : 12, borderRadius: 11, borderWidth: 1, borderColor: value === option.id ? palette.blue : palette.line, backgroundColor: value === option.id ? palette.blueSoft : palette.surfaceAlt, justifyContent: 'center', position: 'relative' }}>
      <Text style={[styles.body, { fontSize: 13, fontWeight: '700', color: value === option.id ? palette.blue : palette.ink }]}>{value === option.id ? '● ' : '○ '}{option.title}</Text>
      {option.id === 'ai' && <View style={{ position: 'absolute', top: 7, right: 7 }}><PremiumCrown size={14} /></View>}
    </Pressable>)}</View>
    <Text style={styles.muted}>{value === 'ai' ? 'PDF lub zdjęcie zostanie wysłane do Azure AI Foundry. Oryginał nie jest zapisywany w bazie. Odczyt możesz przerwać.' : 'Plik odczytamy na serwerze aplikacji, bez wysyłania do AI.'}</Text>
    <Text style={[styles.body, { color: palette.green, fontSize: 13 }]}>Najpierw podgląd. Zapiszesz tylko sprawdzone dane.</Text>
  </View>;
}
