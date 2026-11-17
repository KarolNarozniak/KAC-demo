import React, { useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { Button, useTheme } from './ui';
import TimeField from './TimeField';
import type { PreferredWorkWindow } from '../services/workProfileApi';

const days = ['Poniedziałek', 'Wtorek', 'Środa', 'Czwartek', 'Piątek', 'Sobota', 'Niedziela'];
const WEIGHT_OPTIONS = [{ label: 'Niska', value: 25 }, { label: 'Normalna', value: 50 }, { label: 'Wysoka', value: 100 }];

/** Lustrzane odbicie AvailabilityEditor — kontrolowana część profilu, bez osobnego zapisu (zapisuje się z całym formularzem). */
export default function PreferredWorkWindowsEditor({ value, messages = {}, disabled = false, onChange }: {
  value: PreferredWorkWindow[]; messages?: Record<string, string>; disabled?: boolean; onChange: (value: PreferredWorkWindow[]) => void;
}) {
  const { styles, palette } = useTheme();
  const [selectedDay,setSelectedDay]=useState(1);
  const change = (rows: PreferredWorkWindow[]) => onChange(rows);
  const update = (id: string, patch: Partial<PreferredWorkWindow>) => change(value.map((row) => row.id === id ? { ...row, ...patch } : row));

  return <View style={{ gap: 10 }}>
    {!!messages.preferredWorkWindows && <Text style={styles.error}>{messages.preferredWorkWindows}</Text>}
    <Text style={styles.muted}>Generator w pierwszej kolejności układa pracę w tych godzinach — to nie jest twardy limit. Zapisuje się razem z całym profilem.</Text>
    <View style={[styles.row,{gap:4}]}>{days.map((day,index)=><Pressable key={day} accessibilityRole="button" accessibilityLabel={day} accessibilityState={{selected:selectedDay===index+1}} onPress={()=>setSelectedDay(index+1)} style={[styles.button,{flex:1,paddingHorizontal:0,backgroundColor:selectedDay===index+1?palette.blueSoft:palette.surfaceAlt,borderColor:selectedDay===index+1?palette.blue:palette.line}]}><Text style={styles.buttonText}>{['Pn','Wt','Śr','Cz','Pt','So','Nd'][index]}</Text></Pressable>)}</View>
    {days.map((day, index) => selectedDay===index+1&&<View key={day} style={{gap:12}}><Text style={styles.heading}>{day}</Text>
      {value.filter((row) => row.dayOfWeek === index + 1).map((row) => <View key={row.id} style={[styles.row, { flexWrap: 'wrap' }]}>
        <TimeField invalid={!!messages[`preferredWorkWindows.${value.indexOf(row)}`]} label="Od" disabled={disabled} value={row.startTime} onChange={(time) => update(row.id, { startTime: time })} />
        <TimeField invalid={!!messages[`preferredWorkWindows.${value.indexOf(row)}`]} label="Do" disabled={disabled} value={row.endTime} onChange={(time) => update(row.id, { endTime: time })} />
        <View accessibilityRole="radiogroup" style={[styles.row, { flexWrap: 'wrap' }]}>
          {WEIGHT_OPTIONS.map((option) => <Button key={option.label} title={`${option.label}${row.weight === option.value ? ' ✓' : ''}`} disabled={disabled} onPress={() => update(row.id, { weight: option.value })} />)}
        </View>
        <Button title="Usuń" danger disabled={disabled} onPress={() => change(value.filter((item) => item.id !== row.id))} />
        {!!messages[`preferredWorkWindows.${value.indexOf(row)}`] && <Text accessibilityRole="alert" style={styles.error}>{messages[`preferredWorkWindows.${value.indexOf(row)}`]}</Text>}
      </View>)}
      <Button title="Dodaj przedział" disabled={disabled} onPress={() => change([...value, { id: `preferred-${Date.now()}-${index}`, dayOfWeek: index + 1, startTime: '16:00', endTime: '20:00', weight: 50 }])} />
    </View>)}
  </View>;
}