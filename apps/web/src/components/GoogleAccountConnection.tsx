import React, { useEffect, useRef, useState } from 'react';
import { Linking, Text, View } from 'react-native';
import { Button, useTheme } from './ui';
import {
  disconnectGoogleAccount, getGoogleAccount, getGoogleConnectionStatus, GoogleIntegrationError,
  listGoogleIntegrationCalendars, startGoogleConnection, type GoogleAccountState, type GoogleCalendarInfo,
} from '../services/googleIntegrationApi';

type Phase = 'loading' | 'disconnected' | 'connecting' | 'denied' | 'connected' | 'confirmChange';
const scopeLabels: Record<string, string> = {
  openid: 'Potwierdzenie tożsamości', email: 'Adres e-mail konta',
  'https://www.googleapis.com/auth/calendar': 'Odczyt i zapis wydarzeń w kalendarzu',
  'https://www.googleapis.com/auth/calendar.readonly': 'Odczyt wydarzeń w kalendarzu',
};

export default function GoogleAccountConnection() {
  const { styles, palette } = useTheme();
  const [phase, setPhase] = useState<Phase>('loading');
  const [account, setAccount] = useState<GoogleAccountState | null>(null);
  const [calendars, setCalendars] = useState<GoogleCalendarInfo[] | null>(null);
  const [authUrl, setAuthUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const polling = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopPolling = () => { if (polling.current) clearInterval(polling.current); polling.current = null; };
  useEffect(() => stopPolling, []);

  const loadAccount = async () => {
    const result = await getGoogleAccount();
    setAccount(result);
    setPhase(result.status === 'connected' ? 'connected' : 'disconnected');
    if (result.status === 'connected') {
      setCalendars(null);
      void listGoogleIntegrationCalendars().then((r) => setCalendars(r.calendars)).catch(() => setCalendars([]));
    }
  };
  useEffect(() => { void loadAccount().catch((err) => { setError(err instanceof Error ? err.message : 'Nie udało się wczytać stanu połączenia.'); setPhase('disconnected'); }); }, []);

  // 2-6: start logowania. Ten sam przebieg dla zwykłego połączenia i "Zmień konto" (prompt wymusza wybór konta w Google).
  const connect = async () => {
    setBusy(true); setError('');
    try {
      const started = await startGoogleConnection();
      setAuthUrl(started.authUrl);
      setPhase('connecting');
      await Linking.openURL(started.authUrl);
      let attempts = 0;
      stopPolling();
      polling.current = setInterval(() => {
        attempts += 1;
        getGoogleConnectionStatus(started.connectionId).then(async (status) => {
          if (status.status === 'connected') { stopPolling(); await loadAccount(); }
          else if (status.status === 'denied') { stopPolling(); setPhase('denied'); }
          else if (status.status === 'error') { stopPolling(); setPhase('disconnected'); setError('Google nie potwierdził połączenia. Spróbuj ponownie.'); }
        }).catch(() => undefined);
        if (attempts > 150) { stopPolling(); setPhase('disconnected'); setError('Nie otrzymano zgody w ciągu 5 minut. Spróbuj ponownie.'); } // timeout — bez fałszywego sukcesu
      }, 2000);
    } catch (err) {
      setPhase('disconnected');
      setError(err instanceof Error ? err.message : 'Nie udało się rozpocząć łączenia.');
    } finally { setBusy(false); }
  };

  // Anulowanie w trakcie logowania: tylko przestajemy odpytywać — dotychczasowe połączenie (jeśli było) zostaje bez zmian.
  const cancelConnecting = () => { stopPolling(); setPhase(account && account.status === 'connected' ? 'connected' : 'disconnected'); };

  const disconnect = async () => {
    setBusy(true); setError('');
    try { await disconnectGoogleAccount(); setPhase('disconnected'); setAccount({ status: 'disconnected' }); setCalendars(null); }
    catch (err) { setError(err instanceof GoogleIntegrationError ? err.message : 'Nie udało się odłączyć konta.'); }
    finally { setBusy(false); }
  };

  if (phase === 'loading') return <Text style={styles.muted}>Wczytywanie stanu połączenia z Google…</Text>;

  return <View style={styles.card}>
    <Text style={styles.heading}>Google Calendar</Text>
    {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}

    {phase === 'disconnected' && <View style={{ marginTop: 10 }}>
      <Text style={styles.body}>Aplikacja poprosi o dostęp: odczyt i zapis wydarzeń w Twoim kalendarzu Google.</Text>
      <Button title="Połącz z Google Calendar" primary disabled={busy} onPress={() => void connect()} />
    </View>}

    {phase === 'connecting' && <View style={{ marginTop: 10 }}>
      <Text style={styles.body}>Zaloguj się w Google w otwartej karcie i zatwierdź dostęp. Ta strona sama przejdzie dalej.</Text>
      <View style={[styles.row, { marginTop: 10, flexWrap: 'wrap' }]}>
        <Button title="Otwórz stronę Google ponownie" disabled={busy} onPress={() => void Linking.openURL(authUrl)} />
        <Button title="Anuluj" disabled={busy} onPress={cancelConnecting} />
      </View>
    </View>}

    {phase === 'denied' && <View style={{ marginTop: 10 }}>
      <Text accessibilityRole="alert" style={styles.error}>Nie udzielono dostępu do kalendarza. Bez zgody nie można połączyć konta.</Text>
      <View style={[styles.row, { marginTop: 10, flexWrap: 'wrap' }]}>
        <Button title="Spróbuj ponownie" primary disabled={busy} onPress={() => void connect()} />
        <Button title="Zamknij" disabled={busy} onPress={() => setPhase('disconnected')} />
      </View>
    </View>}

    {phase === 'connected' && account && account.status === 'connected' && <View style={{ marginTop: 10 }}>
      <Text style={[styles.body, { fontWeight: '700' }]}>Połączono: {account.email ?? '(brak adresu)'}</Text>
      <Text style={styles.muted}>Uprawnienia: {account.scopes.map((s) => scopeLabels[s] ?? s).join(', ') || 'brak'}</Text>
      <Text style={styles.muted}>Ostatnia synchronizacja: {account.lastSyncAt ? new Date(account.lastSyncAt).toLocaleString('pl-PL') : '—'}</Text>
      {calendars === null && <Text style={styles.muted}>Wczytywanie kalendarzy…</Text>}
      {!!calendars && (calendars.length
        ? <Text style={styles.muted}>Kalendarze: {calendars.map((c) => c.name).join(', ')}</Text>
        : <Text style={styles.muted}>Na tym koncie nie ma żadnego kalendarza.</Text>)}
      <View style={[styles.row, { marginTop: 10, flexWrap: 'wrap' }]}>
        <Button title="Odłącz" danger disabled={busy} onPress={() => void disconnect()} />
        <Button title="Zmień konto" disabled={busy} onPress={() => setPhase('confirmChange')} />
      </View>
    </View>}

    {phase === 'confirmChange' && account && account.status === 'connected' && <View style={{ marginTop: 10, borderWidth: 1, borderColor: palette.amber, borderRadius: 10, padding: 12 }}>
      <Text style={styles.body}>Obecne połączenie ({account.email}) zostanie zastąpione nowym kontem. Kontynuować?</Text>
      <View style={[styles.row, { marginTop: 10, flexWrap: 'wrap' }]}>
        <Button title="Anuluj" disabled={busy} onPress={() => setPhase('connected')} />
        <Button title="Tak, zmień konto" primary disabled={busy} onPress={() => void connect()} />
      </View>
    </View>}
  </View>;
}