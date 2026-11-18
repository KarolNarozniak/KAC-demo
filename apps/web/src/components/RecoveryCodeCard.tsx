// Kod odzyskiwania pokazany raz – po rejestracji, po resecie hasła i po utworzeniu nowego w Ustawieniach: duży, czytelny (czcionka
// o stałej szerokości), do zaznaczenia i z przyciskiem kopiowania. Serwer zna tylko skrót kodu, więc drugi raz go nie pokażemy.
import React, { useState } from 'react';
import { Platform, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Button, useTheme } from './ui';

const MONOSPACE = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace' });

export function RecoveryCodeCard({ code }: { code: string }) {
  const { palette, styles } = useTheme();
  const [copy, setCopy] = useState<'idle' | 'copied' | 'failed'>('idle');

  const copyCode = async () => {
    try {
      setCopy((await Clipboard.setStringAsync(code)) === false ? 'failed' : 'copied');
    } catch {
      setCopy('failed');
    }
  };

  return <View style={{ borderWidth: 1.5, borderStyle: 'dashed', borderColor: palette.blue, backgroundColor: palette.blueSoft, borderRadius: 14, paddingVertical: 16, paddingHorizontal: 12, alignItems: 'center' }}>
    <Text style={[styles.label, { marginBottom: 6 }]}>KOD ODZYSKIWANIA</Text>
    <Text selectable testID="recovery-code" style={{ fontFamily: MONOSPACE, fontSize: 20, lineHeight: 28, fontWeight: '700', letterSpacing: 1, color: palette.ink, textAlign: 'center' }}>{code}</Text>
    <View style={{ marginTop: 12 }}>
      <Button title={copy === 'copied' ? 'Skopiowano ✓' : 'Kopiuj kod'} onPress={() => void copyCode()} />
    </View>
    {copy === 'failed' && <Text accessibilityLiveRegion="polite" style={[styles.error, { textAlign: 'center', marginBottom: 0 }]}>Nie udało się skopiować – zaznacz kod i skopiuj go ręcznie albo przepisz.</Text>}
  </View>;
}
