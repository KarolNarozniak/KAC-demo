import React, { useEffect, useState } from 'react';
import { Platform, Pressable, Text, View } from 'react-native';
import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { localDateKey } from '../domain/calendar';
import { Button, useTheme } from './ui';
import type { DateFieldProps } from './DateField.types';

export default function DateField({ label, value, onChange }: DateFieldProps) {
  const [open, setOpen] = useState(false);
  const { styles, mode } = useTheme();
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day, 12);
  useEffect(() => {
    if (Platform.OS === 'android') return () => { void DateTimePickerAndroid.dismiss('date'); };
  }, []);
  const showPicker = () => {
    setOpen(true);
    if (Platform.OS === 'android') {
      // Open once on tap; clock-driven renders must not update the Android dialog.
      DateTimePickerAndroid.open({
        value: date, mode: 'date', display: 'default',
        onValueChange: (_event, selected) => { setOpen(false); onChange(localDateKey(selected)); },
        onDismiss: () => setOpen(false),
        onError: () => setOpen(false),
      });
    }
  };
  return <View style={{ flex: 1, minWidth: 0, marginBottom: 12 }}>
    <Text style={styles.label}>{label}</Text>
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ expanded: open }} onPress={showPicker} disabled={open} style={[styles.input, { minHeight: 44, justifyContent: 'center' }]}>
      <Text style={styles.body}>{date.toLocaleDateString('pl-PL', { day: 'numeric', month: 'long', year: 'numeric' })}</Text>
    </Pressable>
    {open && Platform.OS === 'ios' && <>
      <DateTimePicker value={date} mode="date" display="inline" themeVariant={mode} onValueChange={(_event, selected) => onChange(localDateKey(selected))} />
      <Button title="Gotowe" onPress={() => setOpen(false)} />
    </>}
  </View>;
}
