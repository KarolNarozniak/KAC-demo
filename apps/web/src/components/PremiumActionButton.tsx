import React from 'react';
import { View } from 'react-native';
import PremiumCrown from './PremiumCrown';
import { Button } from './ui';

type Props = { title: string; onPress: () => void; primary?: boolean; disabled?: boolean; accessibilityLabel?: string };

export default function PremiumActionButton(props: Props) {
  return <View style={{ alignSelf: 'stretch', position: 'relative' }}>
    <Button {...props} />
    <View pointerEvents="none" style={{ position: 'absolute', top: -8, right: -7, zIndex: 2 }}><PremiumCrown size={14} /></View>
  </View>;
}
