// Ekran z kodem odzyskiwania przed wejściem do aplikacji: po założeniu konta i po ustawieniu nowego hasła kodem.
// Przejście dalej dopiero po potwierdzeniu, że kod jest zapisany – to jedyny moment, w którym go widać.
import React, { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { RecoveryCodeCard } from '../components/RecoveryCodeCard';
import SelectionMark from '../components/SelectionMark';
import { Button, useTheme } from '../components/ui';

export type RecoveryCodeReason = 'registered' | 'recovered';

export default function RecoveryCodeScreen({ code, reason, onContinue }: { code: string; reason: RecoveryCodeReason; onContinue: () => void }) {
  const { palette, styles } = useTheme();
  const [saved, setSaved] = useState(false);

  return <SafeAreaView style={{ flex: 1, backgroundColor: palette.bg }}>
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', paddingHorizontal: 16, paddingVertical: 28 }}>
      <View style={[styles.card, { width: '100%', maxWidth: 440, alignSelf: 'center' }]}>
        <Text accessibilityRole="header" style={[styles.title, { fontSize: 24, lineHeight: 30 }]}>
          {reason === 'registered' ? 'Zapisz kod odzyskiwania' : 'Hasło zmienione – zapisz nowy kod'}
        </Text>
        <Text style={[styles.subtitle, { marginBottom: 16 }]}>
          {reason === 'registered'
            ? 'Gdy zapomnisz hasła, ustawisz nowe tym kodem na ekranie logowania („Nie pamiętasz hasła?”). Bez kodu nowe hasło ustawi tylko administrator KAC.'
            : 'Poprzedni kod już nie działa, a wszystkie inne urządzenia zostały wylogowane. Ten kod przyda się, gdy znowu zapomnisz hasła.'}
        </Text>
        <RecoveryCodeCard code={code} />
        <Text style={[styles.muted, { marginTop: 14 }]}>
          Zapisz go w menedżerze haseł albo na kartce. Kod działa raz i nie pojawi się ponownie – nowy utworzysz w Ustawienia → Konto.
          Kto zna kod i Twój e-mail, może ustawić nowe hasło, więc nie wysyłaj go nikomu.
        </Text>
        <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: saved }} onPress={() => setSaved((value) => !value)}
          style={[styles.row, { minHeight: 44, marginTop: 10, marginBottom: 8 }]}>
          <SelectionMark checked={saved} /><Text style={[styles.body, { flexShrink: 1 }]}>Zapisałem kod w bezpiecznym miejscu</Text>
        </Pressable>
        <Button title="Przejdź do aplikacji" primary disabled={!saved} onPress={onContinue} />
      </View>
    </ScrollView>
  </SafeAreaView>;
}
