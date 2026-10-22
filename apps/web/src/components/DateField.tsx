import React, { useState } from 'react';
import { Platform, Pressable, Text, View } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { localDateKey } from '../domain/calendar';
import { Button, useTheme } from './ui';
import type { DateFieldProps } from './DateField.types';

export default function DateField({ label, value, onChange }: DateFieldProps) {
  const [open, setOpen] = useState(false);
  const { styles, mode } = useTheme();
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day, 12);
  return <View style={{ flex: 1, minWidth: 0, marginBottom: 12 }}>
    <Text style={styles.label}>{label}</Text>
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ expanded: open }} onPress={() => setOpen(true)} style={[styles.input, { minHeight: 44, justifyContent: 'center' }]}>
      <Text style={styles.body}>{date.toLocaleDateString('pl-PL', { day: 'numeric', month: 'long', year: 'numeric' })}</Text>
    </Pressable>
    {open && <>
      <DateTimePicker value={date} mode="date" display={Platform.OS === 'ios' ? 'inline' : 'default'} themeVariant={mode} onChange={(event, selectedDate) => {
        if (Platform.OS === 'android') setOpen(false);
        if (event.type === 'set' && selectedDate) onChange(localDateKey(selectedDate));
      }} />
      {Platform.OS === 'ios' && <Button title="Gotowe" onPress={() => setOpen(false)} />}
    </>}
  </View>;
}
