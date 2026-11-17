import React from 'react';
import { Text, View } from 'react-native';
import { useTheme } from './ui';

/** Visual mark only; the parent owns checkbox/radio semantics and the touch target. */
export default function SelectionMark({ checked, radio = false }: { checked: boolean; radio?: boolean }) {
  const { palette } = useTheme();
  return <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ width: 20, height: 20, flexShrink: 0, borderRadius: radio ? 10 : 5, borderWidth: 1.5, borderColor: checked ? palette.blue : palette.muted, backgroundColor: checked ? palette.blueSoft : palette.input, alignItems: 'center', justifyContent: 'center' }}>
    {checked && (radio ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: palette.blue }} /> : <Text style={{ color: palette.blue, fontSize: 14, fontWeight: '800', lineHeight: 18 }}>✓</Text>)}
  </View>;
}
