// Ustawienia → Google Calendar (S23KC2S1P2-12, G02 / S23KC2S1P2-286).
//
// 1–2  stan połączenia i zakres dostępu, o który poprosi aplikacja; 1a: przy połączonym koncie „Zmień konto”
// 2a   brak internetu albo serwera KAC – komunikat i „Spróbuj ponownie”
// 3–5  „Zaloguj się przez Google” → strona zgody Google w nowej karcie (albo makieta: wybór konta 5b, zgoda albo odmowa 5a)
// 6/6a zapis połączenia albo komunikat błędu; anulowanie i odmowa nie zmieniają dotychczasowego połączenia
// 7/7a połączone konto, realnie przyznany dostęp i lista kalendarzy (także pusta – połączenie zostaje)
// „Odłącz konto Google” z potwierdzeniem i cofnięciem zgody w Google: S23KC2S1P2-35 (G03). Synchronizację i jej błędy pokazuje GoogleSyncSection (S23KC2S1P2-17, G06).

import React, { useEffect, useRef, useState } from 'react';
import { Linking, Pressable, Text, View } from 'react-native';
import { Button, useTheme } from './ui';
import GoogleSyncSection from './GoogleSyncSection';
import GoogleCalendarSelection from './GoogleCalendarSelection';
import { GoogleDivergences } from './GoogleCorrection';
import {
  apiErrorMessage, ATTEMPT_POLL_MS, attemptFinished, attemptNotice, attemptOverdue, calendarsSummary, changeAccountWarning,
  connectedAtLabel, disconnectNotice, disconnectWarning, grantedAccessLines, grantedAccessWarning, panelState, requestedAccessLines, sortCalendars, unavailableMessage,
  type AttemptPurpose, type GoogleIntegrationStatus, type IntegrationAttempt, type IntegrationCalendar, type Notice, type PanelState,
} from '../domain/googleIntegration';
import {
  cancelGoogleIntegrationAttempt, disconnectGoogleIntegration, getGoogleIntegration, getGoogleIntegrationAttempt, giveGoogleIntegrationDemoConsent, GoogleIntegrationApiError,
  listGoogleIntegrationCalendars, startGoogleIntegration,
} from '../services/googleIntegrationApi';

const codeOf = (error: unknown) => (error instanceof GoogleIntegrationApiError ? error.code : 'network');
const timeLabel = (iso: string) => {
  const date = new Date(iso);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
};

/**
 * onShowPlan – „Pokaż zaktualizowany plan” po synchronizacji (krok 7 historyjki 23) przełącza na widok Tydzień.
 * active – czy zakładka Ustawienia jest widoczna; zakładki zostają zamontowane, więc po powrocie panel odświeża stan.
 */
export default function GoogleIntegrationPanel({ onShowPlan, active = true }: { onShowPlan?: () => void; active?: boolean } = {}) {
  const { palette, styles } = useTheme();
  const [status, setStatus] = useState<GoogleIntegrationStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState<IntegrationAttempt | null>(null);
  const [demoAccount, setDemoAccount] = useState('');
  const [calendars, setCalendars] = useState<{ list: IntegrationCalendar[]; complete: boolean } | null>(null);
  const [calendarError, setCalendarError] = useState('');
  const [notice, setNotice] = useState<Notice | null>(null);
  const [confirmChange, setConfirmChange] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  // Historyjka 12, krok 1–2: najpierw „Połącz z Google Calendar”, potem informacja o zakresie dostępu i „Zaloguj się przez Google”.
  const [connectOpen, setConnectOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  // „Połącz ponownie konto Google” z sekcji synchronizacji: po udanym połączeniu synchronizacja rusza sama (historyjka 17, krok 6).
  const [syncSignal, setSyncSignal] = useState(0);
  // Zapis wyboru kalendarzy (G04) zmienia liczbę źródeł w sekcji synchronizacji – licznik wymusza jej odświeżenie.
  const [selectionSaves, setSelectionSaves] = useState(0);
  const [calendarsLoads, setCalendarsLoads] = useState(0);
  const syncAfterReconnect = useRef(false);
  const mounted = useRef(true);
  const busyRef = useRef(false);
  const polling = useRef<ReturnType<typeof setInterval> | null>(null);
  // Id próby, której wynik czekamy – chroni przed podwójnym zakończeniem (odpytywanie + anulowanie).
  const activeAttempt = useRef<string | null>(null);

  const stopPolling = () => {
    if (polling.current) clearInterval(polling.current);
    polling.current = null;
  };

  const refresh = async () => {
    setLoadError(null);
    let next: GoogleIntegrationStatus;
    try {
      next = await getGoogleIntegration();
    } catch (error) {
      if (mounted.current) { setStatus(null); setLoadError(codeOf(error)); }
      return;
    }
    if (!mounted.current) return;
    setStatus(next);
    setCalendarError('');
    if (next.status !== 'connected' || !next.ready || !next.account?.access.calendarsRead) { setCalendars(null); return; }
    try {
      const listed = await listGoogleIntegrationCalendars();
      if (mounted.current) { setCalendars({ list: sortCalendars(listed.calendars), complete: listed.complete }); setCalendarsLoads((value) => value + 1); }
    } catch (error) {
      if (!mounted.current) return;
      const code = codeOf(error);
      // Google odrzucił zapisany dostęp przy odczycie listy – serwer oznaczył konto, pokazujemy „Połącz ponownie”.
      if (code === 'reconnect_required') { setStatus({ ...next, status: 'reconnect_required' }); setCalendars(null); return; }
      setCalendars(null);
      setCalendarError(apiErrorMessage(code));
    }
  };

  useEffect(() => {
    mounted.current = true;
    void refresh();
    return () => { mounted.current = false; stopPolling(); };
  }, []);

  // Powrót do Ustawień z innej zakładki: stan połączenia mógł się zmienić (np. wygasłe logowanie wykryte przy publikacji – historyjka 30),
  // a lista rozbieżności – po korekcie w widoku tygodnia (historyjka 47). Odświeżenie przeładowuje też wybór i rozbieżności.
  const wasActive = useRef(active);
  useEffect(() => {
    if (active && !wasActive.current && !busyRef.current && !activeAttempt.current) void refresh();
    wasActive.current = active;
  }, [active]);

  const run = async (action: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true);
    try {
      await action();
    } catch (error) {
      if (mounted.current) setNotice({ tone: 'error', text: error instanceof Error ? error.message : apiErrorMessage('network') });
    } finally {
      busyRef.current = false;
      if (mounted.current) setBusy(false);
    }
  };

  const finish = async (result: IntegrationAttempt) => {
    if (activeAttempt.current !== result.attemptId) return;
    activeAttempt.current = null;
    stopPolling();
    setAttempt(null); setDemoAccount(''); setConfirmChange(false);
    setNotice(attemptNotice(result));
    // 5a: odmowa albo zamknięcie okna – powrót do kroku 1; połączenie – przy kolejnym odłączeniu też zaczynamy od kroku 1.
    // 6a (błąd autoryzacji) wraca do kroku 3, więc informacja o zakresie i „Zaloguj się przez Google” zostają widoczne.
    if (result.status !== 'error') setConnectOpen(false);
    await refresh();
    if (result.status === 'connected' && syncAfterReconnect.current) setSyncSignal((value) => value + 1);
    syncAfterReconnect.current = false;
  };

  // Strona zgody Google jest w innej karcie: co 2 s pytamy serwer o wynik próby, najdłużej do jej terminu.
  const poll = (started: IntegrationAttempt) => {
    stopPolling();
    polling.current = setInterval(() => {
      if (attemptOverdue(started, Date.now())) { void finish({ ...started, status: 'expired' }); return; }
      getGoogleIntegrationAttempt(started.attemptId).then((current) => {
        if (!mounted.current) return;
        if (attemptFinished(current.status)) void finish(current);
        else setAttempt((previous) => (previous?.attemptId === current.attemptId ? { ...previous, status: current.status } : previous));
      }).catch(() => undefined); // chwilowy brak sieci (2a) – próbujemy dalej do terminu próby
    }, ATTEMPT_POLL_MS);
  };

  // Kroki 3–4: początek logowania (connect, change_account albo reconnect).
  const begin = (purpose: AttemptPurpose) => run(async () => {
    setNotice(null); setConfirmChange(false); setConfirmDisconnect(false);
    if (purpose !== 'reconnect') syncAfterReconnect.current = false;
    let started: IntegrationAttempt;
    try {
      started = await startGoogleIntegration(purpose);
    } catch (error) {
      // Np. konto połączono w innej karcie (1a) – odświeżamy stan, żeby pokazać właściwe przyciski.
      if (codeOf(error) === 'already_connected' || codeOf(error) === 'not_connected') await refresh();
      throw error;
    }
    activeAttempt.current = started.attemptId;
    setAttempt(started);
    setDemoAccount('');
    if (started.mode === 'demo') return;
    if (started.authUrl) await Linking.openURL(started.authUrl).catch(() => undefined);
    poll(started);
  });

  // 5a: zamknięcie przebiegu bez decyzji. Spóźniony powrót z Google dla tej próby niczego już nie zapisze.
  const cancel = () => run(async () => {
    if (!attempt) return;
    stopPolling();
    try {
      const result = await cancelGoogleIntegrationAttempt(attempt.attemptId);
      // Jeśli Google zdążył zakończyć próbę przed anulowaniem, pokazujemy prawdziwy wynik.
      await finish(result.status === 'pending' || result.status === 'processing' ? { ...result, status: 'cancelled' } : result);
    } catch (error) {
      if (attempt.mode === 'google') poll(attempt);
      throw error;
    }
  });

  // Makieta strony Google: wybór konta (5b) i zgoda albo odmowa (5a).
  const decide = (allow: boolean) => run(async () => {
    if (!attempt) return;
    if (allow && !demoAccount) throw new Error('Wybierz konto Google.');
    await finish(await giveGoogleIntegrationDemoConsent(attempt.attemptId, allow, allow ? demoAccount : undefined));
  });

  // „Odłącz konto Google” po potwierdzeniu (historyjka 35). Wynik opisuje osobno stan w KAC i w Google.
  const disconnect = () => run(async () => {
    const result = await disconnectGoogleIntegration();
    setConfirmDisconnect(false);
    setNotice(disconnectNotice(result));
    await refresh();
  });

  const state = panelState({ status, loadError, attempt });
  const account = status?.account ?? null;
  const badge = BADGES[state];
  const tone = { success: palette.green, info: palette.ink, error: palette.red };

  const confirmBox = (text: string, confirm: React.ReactNode, cancel: React.ReactNode) =>
    <View style={{ marginTop: 14, padding: 14, borderRadius: 11, borderWidth: 1, borderColor: palette.line, backgroundColor: palette.amberSoft }}>
      <Text style={styles.body}>{text}</Text>
      <View style={[styles.row, { marginTop: 10, flexWrap: 'wrap' }]}>{confirm}{cancel}</View>
    </View>;
  // Przyciski konta: zmiana (1a) i odłączenie (historyjka 35) zawsze z potwierdzeniem; „Anuluj” niczego nie zmienia.
  const accountActions = (email: string, extra: React.ReactNode) => {
    if (confirmChange) return confirmBox(changeAccountWarning(email),
      <Button title="Zmień konto" primary disabled={busy} onPress={() => void begin('change_account')} />,
      <Button title="Nie zmieniaj" disabled={busy} onPress={() => setConfirmChange(false)} />);
    if (confirmDisconnect) return confirmBox(disconnectWarning(email, status?.mode ?? 'demo'),
      <Button title="Potwierdź" danger disabled={busy} onPress={() => void disconnect()} />,
      <Button title="Anuluj" disabled={busy} onPress={() => setConfirmDisconnect(false)} />);
    return <View style={[styles.row, { marginTop: 14, flexWrap: 'wrap' }]}>
      {extra}
      <Button title="Zmień konto" disabled={busy} onPress={() => { setNotice(null); setConfirmDisconnect(false); setConfirmChange(true); }} />
      <Button title="Odłącz konto Google" danger disabled={busy} onPress={() => { setNotice(null); setConfirmChange(false); setConfirmDisconnect(true); }} />
    </View>;
  };

  const accessList = (lines: string[]) => lines.map((line) => <Text key={line} style={[styles.body, { marginTop: 4 }]}>•  {line}</Text>);

  return (
    <View style={[styles.card, { marginTop: 20 }]}>
      <View style={[styles.row, { justifyContent: 'space-between', flexWrap: 'wrap' }]}>
        <Text style={styles.heading}>Google Calendar</Text>
        <View accessibilityLabel={`Stan połączenia: ${badge.text}`} style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 99, backgroundColor: palette[badge.soft] }}>
          <Text style={{ fontSize: 12, fontWeight: '800', color: palette[badge.color] }}>{badge.text}</Text>
        </View>
      </View>

      {!!notice && <Text accessibilityRole={notice.tone === 'error' ? 'alert' : undefined} accessibilityLiveRegion="polite"
        style={[styles.body, { color: tone[notice.tone], marginTop: 10 }]}>{notice.text}</Text>}

      {state === 'loading' && <Text accessibilityLiveRegion="polite" style={[styles.muted, { marginTop: 8 }]}>Sprawdzanie połączenia z Google…</Text>}

      {(state === 'offline' || state === 'unavailable') && <View style={{ marginTop: 8 }}>
        <Text accessibilityRole="alert" style={styles.error}>{state === 'offline' ? apiErrorMessage('network') : unavailableMessage(status, loadError)}</Text>
        {!!account && <Text style={styles.muted}>Połączone konto: {account.email}</Text>}
        <View style={[styles.row, { marginTop: 8 }]}><Button title="Spróbuj ponownie" disabled={busy} onPress={() => void run(refresh)} /></View>
      </View>}

      {state === 'not_connected' && status && !connectOpen && <View style={{ marginTop: 8 }}>
        <Text style={styles.body}>Połącz konto Google, żeby KAC mógł korzystać z Twoich kalendarzy – na przykład publikować zaakceptowany grafik pracy.</Text>
        <View style={[styles.row, { marginTop: 12 }]}><Button title="Połącz z Google Calendar" primary disabled={busy} onPress={() => setConnectOpen(true)} /></View>
      </View>}

      {state === 'not_connected' && status && connectOpen && <View style={{ marginTop: 8 }}>
        <Text style={[styles.label, { marginTop: 6 }]}>KAC POPROSI O DOSTĘP DO</Text>
        {accessList(requestedAccessLines(status.requestedAccess))}
        <Text style={[styles.muted, { marginTop: 10 }]}>Samo połączenie niczego nie zmienia w Twoich kalendarzach. Dane dostępu są przechowywane na serwerze w postaci zaszyfrowanej i nie trafiają do aplikacji.</Text>
        {status.mode === 'demo' && <Text style={[styles.muted, { marginTop: 4 }]}>Tryb demonstracyjny: serwer nie ma klienta Google, więc logowanie i zgoda są symulowane.</Text>}
        <View style={[styles.row, { marginTop: 12, flexWrap: 'wrap' }]}>
          <Button title="Zaloguj się przez Google" primary disabled={busy} onPress={() => void begin('connect')} />
          <Button title="Anuluj" disabled={busy} onPress={() => setConnectOpen(false)} />
        </View>
      </View>}

      {state === 'connecting' && attempt && <View style={{ marginTop: 8 }}>
        {attempt.mode === 'google' ? <>
          <Text style={styles.body}>Dokończ logowanie na stronie Google, która otworzyła się w nowej karcie: wybierz konto i zdecyduj o dostępie.</Text>
          <Text style={[styles.muted, { marginTop: 6 }]}>Ten panel sam pokaże wynik. Jeśli strona Google się nie otworzyła, użyj przycisku poniżej. Link jest ważny do {timeLabel(attempt.expiresAt)}.</Text>
          <Text style={[styles.muted, { marginTop: 6 }]}>Google pokazuje „Dostęp zablokowany” (błąd 403: access_denied)? To konto Google nie jest jeszcze dopuszczone do testów aplikacji KAC – poproś zespół o dodanie go albo korzystaj z KAC bez Google Calendar. Anuluj wtedy tę próbę.</Text>
          <View style={[styles.row, { marginTop: 12, flexWrap: 'wrap' }]}>
            {!!attempt.authUrl && <Button title="Otwórz stronę Google ponownie" primary disabled={busy} onPress={() => void Linking.openURL(attempt.authUrl!)} />}
            <Button title="Anuluj" disabled={busy} onPress={() => void cancel()} />
          </View>
        </> : <>
          <Text style={styles.body}>{attempt.purpose === 'change_account' ? 'Wybierz konto Google, na które chcesz zmienić połączenie.' : 'Wybierz konto Google.'}</Text>
          <Text style={[styles.muted, { marginTop: 4 }]}>Makieta strony Google – w tym trybie nie ma prawdziwego logowania.</Text>
          <View accessibilityRole="radiogroup" accessibilityLabel="Konto Google" style={{ gap: 8, marginTop: 10 }}>
            {(status?.demoAccounts ?? []).map((email) => {
              const selected = demoAccount === email;
              const current = account?.email === email;
              return <Pressable key={email} accessibilityRole="radio" accessibilityState={{ checked: selected, disabled: busy }} disabled={busy} onPress={() => setDemoAccount(email)}
                style={{ padding: 12, minHeight: 44, borderRadius: 10, borderWidth: 1, borderColor: selected ? palette.blue : palette.line, backgroundColor: selected ? palette.blueSoft : palette.surface }}>
                <Text style={[styles.body, selected && { color: palette.blue, fontWeight: '700' }]}>{selected ? '◉' : '○'}  {email}{current ? ' (obecnie połączone)' : ''}</Text>
              </Pressable>;
            })}
          </View>
          <Text style={[styles.label, { marginTop: 14 }]}>KAC PROSI O DOSTĘP DO</Text>
          {accessList(requestedAccessLines(status?.requestedAccess ?? { calendarsRead: true, eventsWrite: true }))}
          <View style={[styles.row, { marginTop: 12, flexWrap: 'wrap' }]}>
            <Button title="Zezwól" primary disabled={busy || !demoAccount} onPress={() => void decide(true)} />
            <Button title="Odmów" disabled={busy} onPress={() => void decide(false)} />
            <Button title="Anuluj" disabled={busy} onPress={() => void cancel()} />
          </View>
        </>}
      </View>}

      {state === 'connected' && account && <View style={{ marginTop: 8 }}>
        <Text style={[styles.body, { fontWeight: '800' }]}>{account.email}</Text>
        <Text style={styles.muted}>{[connectedAtLabel(account.connectedAt), status?.mode === 'demo' ? 'konto demonstracyjne' : ''].filter(Boolean).join(' · ')}</Text>

        <Text style={[styles.label, { marginTop: 14 }]}>PRZYZNANY DOSTĘP</Text>
        {grantedAccessLines(account.access).map((line) => <Text key={line.text} style={[styles.body, { marginTop: 4, color: line.granted ? palette.green : palette.muted }]}>
          {line.granted ? '✓' : '✕'}  {line.text}{line.granted ? '' : ' – nie przyznano'}
        </Text>)}
        {!!grantedAccessWarning(account.access) && <Text style={[styles.body, { color: palette.amber, marginTop: 8 }]}>{grantedAccessWarning(account.access)}</Text>}

        {account.access.calendarsRead && <>
          <Text style={[styles.label, { marginTop: 14 }]}>KALENDARZE</Text>
          {!calendars && !calendarError && <Text accessibilityLiveRegion="polite" style={styles.muted}>Wczytywanie kalendarzy…</Text>}
          {!!calendarError && <Text accessibilityRole="alert" style={styles.error}>{calendarError}</Text>}
          {calendars && <Text style={[styles.muted, { marginBottom: 6 }]}>{calendarsSummary(calendars.list, calendars.complete)}</Text>}
          {/* Wybór kalendarzy do planowania i kalendarza publikacji (S23KC2S1P2-41, G04) – lista po odczycie z Google. */}
          {calendars && <GoogleCalendarSelection reloadKey={`${account.email}|${calendarsLoads}`} onSaved={(saved, sourcesChanged) => {
            setSelectionSaves((value) => value + 1);
            if (sourcesChanged && saved.sourceCalendarIds.length) setSyncSignal((value) => value + 1);
          }} />}
        </>}

        <GoogleSyncSection mode={status?.mode ?? 'demo'} connection={state}
          connectionKey={`${account.email}|${state}|${account.connectedAt ?? ''}|${account.grantedScopes.join(' ')}|${selectionSaves}`} autoRunSignal={syncSignal} onShowPlan={onShowPlan}
          onConnectionChange={() => void refresh()} onReconnect={() => { syncAfterReconnect.current = true; void begin('reconnect'); }} />
        {/* Rozbieżności po edycji albo usunięciu opublikowanych zmian (S23KC2S1P2-47, G09). */}
        <GoogleDivergences reloadKey={`${account.email}|${calendarsLoads}|${selectionSaves}`} />
        {accountActions(account.email, <>
          {account.access.calendarsRead && <Button title="Odśwież listę" disabled={busy} onPress={() => void run(refresh)} />}
          {(!account.access.calendarsRead || !account.access.eventsWrite) && <Button title="Połącz ponownie" disabled={busy} onPress={() => void begin('reconnect')} />}
        </>)}
      </View>}

      {state === 'reconnect_required' && account && <View style={{ marginTop: 8 }}>
        <Text style={styles.body}>Google nie przyjmuje już zapisanego dostępu do konta <Text style={{ fontWeight: '800' }}>{account.email}</Text> – wygasł albo cofnięto zgodę w ustawieniach Google.</Text>
        <Text style={[styles.muted, { marginTop: 6 }]}>Twoje wydarzenia w KAC są bez zmian. Po ponownym zalogowaniu połączenie znowu zacznie działać.</Text>
        <GoogleSyncSection mode={status?.mode ?? 'demo'} connection={state}
          connectionKey={`${account.email}|${state}|${account.connectedAt ?? ''}|${account.grantedScopes.join(' ')}|${selectionSaves}`} autoRunSignal={syncSignal} onShowPlan={onShowPlan}
          onConnectionChange={() => void refresh()} onReconnect={() => { syncAfterReconnect.current = true; void begin('reconnect'); }} />
        {/* „Połącz ponownie konto Google” jest w sekcji synchronizacji – po połączeniu od razu synchronizuje (historyjka 17, krok 6). */}
        {accountActions(account.email, null)}
      </View>}
    </View>
  );
}

type Tone = 'green' | 'amber' | 'blue' | 'red' | 'muted';
const BADGES: Record<PanelState, { text: string; color: Tone; soft: 'greenSoft' | 'amberSoft' | 'blueSoft' | 'redSoft' | 'surfaceAlt' }> = {
  loading: { text: 'Sprawdzanie…', color: 'muted', soft: 'surfaceAlt' },
  offline: { text: 'Brak połączenia', color: 'red', soft: 'redSoft' },
  unavailable: { text: 'Niedostępne', color: 'red', soft: 'redSoft' },
  connecting: { text: 'Łączenie…', color: 'blue', soft: 'blueSoft' },
  not_connected: { text: 'Niepołączone', color: 'muted', soft: 'surfaceAlt' },
  connected: { text: 'Połączone', color: 'green', soft: 'greenSoft' },
  reconnect_required: { text: 'Wymaga ponownego logowania', color: 'amber', soft: 'amberSoft' },
};
