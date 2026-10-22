import React, { useState } from 'react';
import { Modal, Platform, Pressable, Text, View } from 'react-native';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { Button, useTheme } from './ui';
import type { TimeFieldProps } from './TimeField.types';

export default function TimeField({ label, value, onChange }: TimeFieldProps) {
  const [open, setOpen] = useState(false);
  const { styles, palette, mode } = useTheme();
  const [hours, minutes] = value.split(':').map(Number);
  const date = new Date();
  date.setHours(hours, minutes, 0, 0);
  const change = (event: DateTimePickerEvent, selected?: Date) => {
    if (Platform.OS === 'android') setOpen(false);
    if (event.type === 'set' && selected) onChange(`${String(selected.getHours()).padStart(2, '0')}:${String(selected.getMinutes()).padStart(2, '0')}`);
  };
  return <View style={{ flex: 1, minWidth: 0, marginBottom: 12 }}>
    <Text style={styles.label}>{label}</Text>
    <Pressable accessibilityRole="button" accessibilityLabel={`${label}: ${value}`} accessibilityState={{ expanded: open }} onPress={() => setOpen(true)} style={[styles.input, { minHeight: 44, justifyContent: 'center' }]}>
      <Text style={styles.body}>{value}</Text>
    </Pressable>
    {open && Platform.OS === 'android' && <DateTimePicker value={date} mode="time" is24Hour display="default" onChange={change} />}
    {Platform.OS === 'ios' && <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
      <View style={{ flex: 1, backgroundColor: palette.scrim, justifyContent: 'center', alignItems: 'center', padding: 16 }}>
        <View style={{ width: '100%', maxWidth: 360, borderRadius: 16, padding: 16, backgroundColor: palette.surface }}>
          <Text style={styles.heading}>{label}</Text>
          <DateTimePicker value={date} mode="time" display="spinner" locale="pl-PL" themeVariant={mode} onChange={change} />
          <Button title="Gotowe" onPress={() => setOpen(false)} />
        </View>
      </View>
    </Modal>}
  </View>;
}
