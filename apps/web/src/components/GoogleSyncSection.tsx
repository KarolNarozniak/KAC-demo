// Synchronizacja z Google w panelu Ustawienia → Google Calendar (S23KC2S1P2-17, G06 / S23KC2S1P2-290).
//
// 1     „Synchronizuj z Google”
// 2     błąd: przyczyna, czas ostatniej udanej synchronizacji, „Spróbuj ponownie” i „Połącz ponownie konto Google”
// 2a    sukces: informacja o wyniku
// 3–5a „Połącz ponownie” prowadzi przez logowanie panelu (G02); odmowa wyłącza synchronizację, dane lokalne zostają
// 6/6a po ponownym połączeniu panel sam uruchamia synchronizację; kolejny błąd pokazuje komunikat jeszcze raz
// Stany: „Nigdy”, „W trakcie”, „Zsynchronizowano”, „Częściowo”, „Błąd”. W makiecie można wymusić błąd, żeby pokazać przebiegi.
// G05 (S23KC2S1P2-23): synchronizacja pobiera zmiany wydarzeń z wybranych kalendarzy; po próbie panel pokazuje wynik per kalendarz.

import React, { useEffect, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Button, useTheme } from './ui';
import {
  apiErrorMessage, attemptTimeLabel, calendarResultLine, lastSuccessLabel, NO_SOURCES_TEXT, SIMULATIONS, SYNC_DISABLED_TEXT, syncActions, syncErrorLabel, syncResultNotice, syncStateLabel,
  type Notice, type SimulatedFailure, type SyncStatus, type SyncSummary,
} from '../domain/googleIntegration';
import { getGoogleSync, GoogleIntegrationApiError, runGoogleSync } from '../services/googleIntegrationApi';

type Props = {
  mode: 'google' | 'demo';
  connection: 'connected' | 'reconnect_required';
  /** Zmienia się po każdej zmianie połączenia – sekcja odświeża wtedy stan. */
  connectionKey: string;
  /** Zwiększany po udanym „Połącz ponownie” rozpoczętym z tej sekcji – uruchamia synchronizację (krok 6). */
  autoRunSignal: number;
  onReconnect: () => void;
  /** Wynik synchronizacji zmienił stan konta (np. Google odrzucił dostęp) – panel odświeża się, żeby pokazać właściwy widok. */
  onConnectionChange: () => void;
  /** Krok 7 historyjki 23: przejście do zaktualizowanego planu (widok Tydzień). */
  onShowPlan?: () => void;
};

export default function GoogleSyncSection({ mode, connection, connectionKey, autoRunSignal, onReconnect, onConnectionChange, onShowPlan }: Props) {
  const { palette, styles } = useTheme();
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [summary, setSummary] = useState<SyncSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [simulate, setSimulate] = useState<SimulatedFailure | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const mounted = useRef(true);
  const busyRef = useRef(false);

  const load = async () => {
    try {
      const next = await getGoogleSync();
      if (mounted.current) setStatus(next);
    } catch (error) {
      if (mounted.current) setNotice({ tone: 'error', text: apiErrorMessage(error instanceof GoogleIntegrationApiError ? error.code : 'network') });
    }
  };

  useEffect(() => {
    mounted.current = true;
    void load();
    return () => { mounted.current = false; };
  }, [connectionKey]);

  const run = async () => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setNotice(null); setSummary(null);
    setStatus((current) => (current ? { ...current, state: 'running' } : current));
    try {
      const result = await runGoogleSync(mode === 'demo' ? simulate ?? undefined : undefined);
      if (!mounted.current) return;
      setStatus(result.status);
      setNotice(syncResultNotice(result.attempt));
      setSummary(result.summary);
      if (result.status.connection !== connection) onConnectionChange();
    } catch (error) {
      if (!mounted.current) return;
      const code = error instanceof GoogleIntegrationApiError ? error.code : 'network';
      // Brak wybranych kalendarzy (historyjka 23, 3a): po odświeżeniu stanu sekcja sama prosi o wskazanie kalendarza – bez drugiego komunikatu.
      if (code !== 'no_calendars_selected') setNotice({ tone: 'error', text: apiErrorMessage(code) });
      await load();
    } finally {
      busyRef.current = false;
      if (mounted.current) setBusy(false);
    }
  };

  // Krok 6: po udanym ponownym połączeniu synchronizacja rusza sama.
  useEffect(() => { if (autoRunSignal > 0) void run(); }, [autoRunSignal]);

  // Stanu nie udało się wczytać: komunikat i – przy wygasłym logowaniu – sam przycisk ponownego połączenia.
  if (!status) return notice ? <View style={{ marginTop: 16 }}>
    <Text accessibilityRole="alert" style={styles.error}>{notice.text}</Text>
    {connection === 'reconnect_required' && <Button title="Połącz ponownie konto Google" primary onPress={onReconnect} />}
  </View> : null;
  const actions = syncActions(status);
  const last = status.lastAttempt;
  const stateColor = { never: palette.muted, running: palette.blue, success: palette.green, partial: palette.amber, error: palette.red }[status.state];
  const tone = { success: palette.green, info: palette.ink, error: palette.red };

  return (
    <View style={{ marginTop: 16, paddingTop: 14, borderTopWidth: 1, borderColor: palette.line }}>
      <View style={[styles.row, { justifyContent: 'space-between', flexWrap: 'wrap' }]}>
        <Text style={styles.label}>SYNCHRONIZACJA</Text>
        <Text accessibilityLabel={`Stan synchronizacji: ${syncStateLabel(status.state)}`} style={{ fontSize: 12, fontWeight: '800', color: stateColor }}>
          {busy ? 'W trakcie…' : syncStateLabel(status.state)}
        </Text>
      </View>
      <Text style={styles.muted}>{lastSuccessLabel(status)}</Text>

      {!status.enabled && <Text style={[styles.body, { color: palette.amber, marginTop: 8 }]}>{SYNC_DISABLED_TEXT}</Text>}
      {status.enabled && status.connection === 'connected' && status.sourcesSelected === 0 &&
        <Text style={[styles.body, { color: palette.amber, marginTop: 8 }]}>{NO_SOURCES_TEXT}</Text>}

      {!!notice && <Text accessibilityRole={notice.tone === 'error' ? 'alert' : undefined} accessibilityLiveRegion="polite"
        style={[styles.body, { color: tone[notice.tone], marginTop: 8 }]}>{notice.text}</Text>}
      {!!summary?.calendars.length && <View accessibilityLabel="Wynik pobierania zmian" style={{ marginTop: 6 }}>
        {summary.calendars.map((calendar) => {
          const line = calendarResultLine(calendar);
          return <Text key={calendar.calendarId} style={[styles.muted, { color: line.tone === 'error' ? palette.red : line.tone === 'info' ? palette.amber : palette.muted }]}>• {line.text}</Text>;
        })}
        {summary.calendars.some((calendar) => !calendar.errorCode) && !!onShowPlan &&
          <View style={{ marginTop: 6, alignSelf: 'flex-start' }}><Button title="Pokaż zaktualizowany plan" onPress={onShowPlan} /></View>}
      </View>}
      {!notice && last && last.status === 'error' && <Text style={[styles.body, { color: palette.red, marginTop: 8 }]}>
        Ostatnia próba ({attemptTimeLabel(last)}): {syncErrorLabel(last)}.
      </Text>}

      {mode === 'demo' && status.enabled && status.connection === 'connected' && <View style={{ marginTop: 10 }}>
        <Text style={styles.muted}>Makieta – wynik następnej synchronizacji:</Text>
        <View accessibilityRole="radiogroup" accessibilityLabel="Symulacja wyniku synchronizacji" style={[styles.row, { flexWrap: 'wrap', gap: 6, marginTop: 6 }]}>
          {SIMULATIONS.map((option) => {
            const selected = simulate === option.id;
            return <Pressable key={option.label} accessibilityRole="radio" accessibilityState={{ checked: selected, disabled: busy }} disabled={busy}
              onPress={() => setSimulate(option.id)}
              style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 99, borderWidth: 1, borderColor: selected ? palette.blue : palette.line,
                backgroundColor: selected ? palette.blueSoft : 'transparent' }}>
              <Text style={{ fontSize: 12, fontWeight: '700', color: selected ? palette.blue : palette.muted }}>{option.label}</Text>
            </Pressable>;
          })}
        </View>
      </View>}

      <View style={[styles.row, { marginTop: 12, flexWrap: 'wrap' }]}>
        {actions.sync && <Button title="Synchronizuj z Google" primary disabled={busy} onPress={() => void run()} />}
        {actions.retry && <Button title="Spróbuj ponownie" primary disabled={busy} onPress={() => void run()} />}
        {actions.reconnect && <Button title="Połącz ponownie konto Google" primary={!actions.retry} disabled={busy} onPress={onReconnect} />}
        {status.history.length > 0 && <Button title={showHistory ? 'Ukryj historię' : 'Historia prób'} disabled={busy} onPress={() => setShowHistory((value) => !value)} />}
      </View>

      {showHistory && <View style={{ marginTop: 10 }}>
        {status.history.slice(0, 5).map((attempt) => <View key={attempt.id} style={[styles.row, { paddingVertical: 7, borderTopWidth: 1, borderColor: palette.line }]}>
          <Text style={[styles.muted, { width: 120 }]}>{attemptTimeLabel(attempt)}</Text>
          <Text style={[styles.body, { flex: 1, minWidth: 0 }]} numberOfLines={2}>
            {attempt.status === 'error' ? syncErrorLabel(attempt) : attempt.message ?? syncStateLabel(attempt.status === 'running' ? 'running' : attempt.status)}
            {attempt.tries > 1 ? ` · próby: ${attempt.tries}` : ''}
          </Text>
        </View>)}
      </View>}
    </View>
  );
}
