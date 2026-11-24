import React from 'react';
import { Image, View } from 'react-native';
import { useTheme } from './ui';

type Props = { size?: number };

export default function PremiumCrown({ size = 16 }: Props) {
  const { palette } = useTheme();
  return <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" pointerEvents="none"
    style={{ width: size + 8, height: size + 8, borderRadius: (size + 8) / 2, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.amberSoft }}>
    <Image source={require('../../../../crown-icon.png')} resizeMode="contain" style={{ width: size, height: size }} />
  </View>;
}
