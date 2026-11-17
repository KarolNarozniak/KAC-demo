import React from 'react';
import { Platform, Text } from 'react-native';

const paths = [
  'M12 8v4l3 2M21 12a9 9 0 1 1-9-9 9 9 0 0 1 9 9Z',
  'M5 5h14v15H5ZM5 9h14M9 3v4M15 3v4M9 12h1M14 12h1M9 16h1M14 16h1',
  'M8 5V3h8v2M4 6h16v14H4ZM4 11h16M10 11v3h4v-3',
  'M5 5l14 14M21 12a9 9 0 1 1-9-9 9 9 0 0 1 9 9Z',
  'M4 6h16M4 12h16M4 18h16M8 3v6M16 9v6M10 15v6',
  'M12 3l2.4 6.6L21 12l-6.6 2.4L12 21l-2.4-6.6L3 12l6.6-2.4Z',
];
export default function NavigationIcon({ index, color }: { index: number; color: string }) {
  if (Platform.OS !== 'web') return <Text style={{ color, fontSize: 22 }}>{['◷', '▦', '◫', '⊞', '⚙︎', '✧'][index]}</Text>;
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[index]} /></svg>;
}
