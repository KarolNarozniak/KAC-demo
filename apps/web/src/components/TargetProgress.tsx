import React from 'react';
import { Text, View } from 'react-native';
import { formatMinutes, targetProgress } from '../domain/workProfile';
import { useTheme } from './ui';

/** Licznik zaplanowanych minut względem celu godzin (S23KC2S1P2-156) – w podglądzie proponowanego grafiku. */
export default function TargetProgress({ plannedMinutes, targetMinutes, label, note }: { plannedMinutes: number; targetMinutes: number; label: string; note?: string }) {
  const { palette, styles } = useTheme();
  const progress = targetProgress(plannedMinutes, targetMinutes);
  const color = progress.status === 'above' ? palette.amber : progress.status === 'reached' ? palette.green : palette.blue;
  const summary = progress.status === 'below' ? `Brakuje ${formatMinutes(progress.difference)}`
    : progress.status === 'reached' ? 'Cel osiągnięty' : `Cel przekroczony o ${formatMinutes(progress.difference)}`;
  return <View accessible accessibilityLabel={`${label}: zaplanowano ${formatMinutes(plannedMinutes)} z ${formatMinutes(targetMinutes)}. ${summary}.`} style={{ marginTop: 14 }}>
    <Text style={styles.label}>{label.toUpperCase()}</Text>
    <Text style={styles.body}>Zaplanowano <Text style={{ fontWeight: '800' }}>{formatMinutes(plannedMinutes)}</Text> z {formatMinutes(targetMinutes)} ({progress.percent}%)</Text>
    <View style={{ height: 8, borderRadius: 99, backgroundColor: palette.surfaceAlt, marginVertical: 8, overflow: 'hidden' }}>
      <View style={{ width: `${Math.min(100, progress.percent)}%`, height: '100%', borderRadius: 99, backgroundColor: color }} />
    </View>
    <Text style={[styles.muted, { color }]}>{summary}{note ? ` · ${note}` : ''}</Text>
  </View>;
}
