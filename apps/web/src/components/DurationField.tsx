import React from 'react';
import { Text, TextInput, View } from 'react-native';
import { useTheme } from './ui';

/** The profile stores minutes; users edit a duration as hours and minutes. */
export default function DurationField({ label, value, onChange, disabled, invalid }: { label: string; value: string; onChange: (minutes: string) => void; disabled?: boolean; invalid?: boolean }) {
  const { palette, styles } = useTheme();
  const total = Number(value) || 0;
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  const update = (part: 'hours' | 'minutes', text: string) => {
    if (!text) { onChange(''); return; }
    if (!/^\d+$/.test(text) || (part === 'minutes' && Number(text) > 59)) return;
    onChange(String(part === 'hours' ? Number(text) * 60 + minutes : hours * 60 + Number(text)));
  };
  return <View style={{ marginBottom: 16, gap: 8 }}>
    <Text style={[styles.body, { fontWeight: '700' }]}>{label}</Text>
    <View style={styles.row}>{(['hours', 'minutes'] as const).map(part => <View key={part} style={{ flex: 1 }}>
      <Text style={styles.label}>{part === 'hours' ? 'Godziny' : 'Minuty'}</Text>
      <TextInput accessibilityLabel={`${label} – ${part === 'hours' ? 'godziny' : 'minuty'}`} editable={!disabled} keyboardType="number-pad" maxLength={part === 'hours' ? 4 : 2} value={value === '' ? '' : String(part === 'hours' ? hours : minutes)} onChangeText={text => update(part, text)} style={[styles.input, invalid && { borderColor: palette.red }]} />
    </View>)}</View>
  </View>;
}
