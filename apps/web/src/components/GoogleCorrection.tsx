// Synchronizacja korekt opublikowanych zmian z Google Calendar (S23KC2S1P2-47, G09 / S23KC2S1P2-292). Konto demonstracyjne: symulacja.
//
// GoogleEventSync         – w szczegółach zmiany: stan powiązanego wydarzenia w Google, „Ponów synchronizację” i wynik symulacji
// GoogleCorrectionNotice  – po „Zapisz” albo potwierdzonym „Usuń”: synchronizacja od razu i komunikat (6, 3a, 6b, 3a.1, 6c)
// GoogleDivergences       – w Ustawieniach: rozbieżności KAC ↔ Google, także po usunięciu zmiany w KAC
// Anulowanie edycji albo usunięcia nie wywołuje niczego, więc niczego też nie zleca.
// Stany, rodzaje operacji i przyczyny błędów używają dopuszczalnych wartości z historyjki 47.

import React, { useEffect, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Button, useTheme } from './ui';
import type { Notice } from '../domain/googleIntegration';
import {
  canRetryCorrection, CORRECTION_SIMULATIONS, correctionNotice, errorCause, nextStep, operationLine, operationStatus, snapshotLabel,
  type CorrectionItem, type CorrectionSimulation,
} from '../domain/googleCorrection';
import {
  getPublishedEvent, GoogleIntegrationApiError, listGoogleDivergences, setCorrectionSimulation, syncPublishedEvent,
} from '../services/googleIntegrationApi';

const codeOf = (error: unknown) => (error instanceof GoogleIntegrationApiError ? error.code : 'network');
const useMounted = () => { const mounted = useRef(true); useEffect(() => () => { mounted.current = false; }, []); return mounted; };

function NoticeText({ notice }: { notice: Notice }) {
  const { palette, styles } = useTheme();
  const tone = { success: palette.green, info: palette.amber, error: palette.red };
  return <Text accessibilityRole={notice.tone === 'error' ? 'alert' : undefined} accessibilityLiveRegion="polite"
    style={[styles.body, { color: tone[notice.tone], marginTop: 6 }]}>{notice.text}</Text>;
}

/**
 * Szczegóły zmiany: czy jest opublikowana i czy synchronizacja jest aktualna. Wydarzenie, którego nie publikowano, nie pokazuje niczego.
 * onPublished – nazwa kalendarza Google (i czy to symulacja), żeby ekran mógł opisać edycję i usunięcie jako operację na obu kalendarzach.
 */
export function GoogleEventSync({ eventId, onPublished }: { eventId: string; onPublished?: (calendarName: string | null, simulated: boolean) => void }) {
  const { palette, styles } = useTheme();
  const [items, setItems] = useState<CorrectionItem[] | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [simulate, setSimulate] = useState<CorrectionSimulation | null>(null);
  const [busy, setBusy] = useState(false);
  const mounted = useMounted();

  useEffect(() => {
    setItems(null); setNotice(null); onPublished?.(null, false);
    getPublishedEvent(eventId).then((status) => {
      if (!mounted.current) return;
      setItems(status.items);
      const current = status.items.find((item) => item.state !== 'deleted');
      onPublished?.(current?.calendar.name ?? null, current?.simulated ?? false);
    }).catch(() => { if (mounted.current) setItems(null); });
  }, [eventId]);

  if (!items?.length) return null;
  const retry = async () => {
    setBusy(true); setNotice(null);
    try {
      const result = await syncPublishedEvent(eventId);
      if (!mounted.current) return;
      setItems(result.items); setNotice(correctionNotice(result, 'update'));
    } catch (error) { if (mounted.current) setNotice({ tone: 'error', text: `Nie udało się ponowić synchronizacji (${codeOf(error)}).` }); }
    finally { if (mounted.current) setBusy(false); }
  };
  const chooseSimulation = async (value: CorrectionSimulation | null) => {
    try { await setCorrectionSimulation(value); if (mounted.current) setSimulate(value); }
    catch (error) { if (mounted.current) setNotice({ tone: 'error', text: `Nie udało się ustawić symulacji (${codeOf(error)}).` }); }
  };

  return <View accessibilityLabel="Synchronizacja z Google Calendar" style={{ marginTop: 12, padding: 10, borderRadius: 10, borderWidth: 1, borderColor: palette.line }}>
    <Text style={styles.label}>GOOGLE CALENDAR{items.some((item) => item.simulated) ? ' · SYMULACJA' : ''}</Text>
    {items.map((item) => {
      const status = operationStatus(item, busy);
      const step = status === 'Błąd' ? nextStep(errorCause(item)) : null;
      return <View key={item.calendar.id} style={{ marginTop: 4 }}>
        <Text style={styles.body}>Opublikowano w kalendarzu „{item.calendar.name}”.</Text>
        <Text style={[styles.body, { color: status === 'Zakończona' ? palette.green : status === 'Błąd' ? palette.red : palette.amber }]}>
          {operationLine(item, busy).replace(/^./, (letter) => letter.toUpperCase())}
        </Text>
        {status === 'Zakończona' && <Text style={styles.muted}>Oba kalendarze odzwierciedlają zmianę.</Text>}
        {!!item.message && status === 'Błąd' && <Text style={styles.muted}>{item.message}</Text>}
        {!!step && <Text style={styles.muted}>{step}</Text>}
      </View>;
    })}
    {!!notice && <NoticeText notice={notice} />}
    {items.some((item) => item.simulated) && <>
    <Text style={[styles.muted, { marginTop: 8 }]}>Wynik symulacji następnej synchronizacji (po „Zapisz” albo „Usuń”):</Text>
    <View accessibilityRole="radiogroup" accessibilityLabel="Wynik symulacji synchronizacji korekty" style={[styles.row, { flexWrap: 'wrap', gap: 6, marginTop: 6 }]}>
      {CORRECTION_SIMULATIONS.map((option) => {
        const selected = simulate === option.id;
        return <Pressable key={option.label} accessibilityRole="radio" accessibilityLabel={option.label} accessibilityState={{ checked: selected }}
          onPress={() => void chooseSimulation(option.id)}
          style={{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: 99, borderWidth: 1, borderColor: selected ? palette.blue : palette.line, backgroundColor: selected ? palette.blueSoft : 'transparent' }}>
          <Text style={{ fontSize: 12, fontWeight: '700', color: selected ? palette.blue : palette.muted }}>{option.label}</Text>
        </Pressable>;
      })}
    </View>
    </>}
    {items.some(canRetryCorrection) && <View style={{ marginTop: 8 }}><Button title="Ponów synchronizację" primary disabled={busy} onPress={() => void retry()} /></View>}
  </View>;
}

export type CorrectionRequest = { eventId: string; kind: 'update' | 'delete'; nonce: number };

/** Po zapisie albo usunięciu: synchronizacja od razu (bez czekania na worker) i komunikat z „Ponów synchronizację” przy błędzie. */
export function GoogleCorrectionNotice({ request }: { request: CorrectionRequest | null }) {
  const [notice, setNotice] = useState<Notice | null>(null);
  const [retryable, setRetryable] = useState(false);
  const [busy, setBusy] = useState(false);
  const mounted = useMounted();

  const run = async () => {
    if (!request) return;
    setBusy(true);
    try {
      const result = await syncPublishedEvent(request.eventId);
      if (!mounted.current) return;
      setNotice(correctionNotice(result, request.kind)); setRetryable(result.result === 'error' && result.items.some(canRetryCorrection));
    } catch (error) {
      if (!mounted.current) return;
      // Wydarzenie nie było publikowane – nie ma czego synchronizować.
      if (codeOf(error) === 'publication_not_found') { setNotice(null); setRetryable(false); return; }
      setNotice({ tone: 'error', text: request.kind === 'delete'
        ? 'Usunięcie – stan synchronizacji: Błąd (Brak połączenia). Zmianę usunięto z kalendarza aplikacji, ale wydarzenie może nadal być widoczne w Google Calendar. Sprawdź połączenie z internetem i ponów synchronizację.'
        : 'Aktualizacja – stan synchronizacji: Błąd (Brak połączenia). Zmiana jest zapisana w kalendarzu aplikacji, ale wydarzenie w Google Calendar może być nieaktualne. Sprawdź połączenie z internetem i ponów synchronizację.' });
      setRetryable(true);
    } finally { if (mounted.current) setBusy(false); }
  };
  useEffect(() => { setNotice(null); setRetryable(false); void run(); }, [request?.nonce]);

  if (!notice) return null;
  // Historyjka 47: po błędzie „Ponów synchronizację” albo „Zamknij komunikat”. Zamknięcie nie usuwa informacji o niewykonanej operacji –
  // zostaje w szczegółach zmiany i na liście rozbieżności w Ustawieniach.
  return <View style={{ marginBottom: 6 }}>
    {busy ? <NoticeText notice={{ tone: 'info', text: `${request?.kind === 'delete' ? 'Usunięcie' : 'Aktualizacja'} – stan synchronizacji: W trakcie…` }} /> : <NoticeText notice={notice} />}
    <View style={[{ marginTop: 4, flexDirection: 'row', flexWrap: 'wrap', gap: 8 }]}>
      {retryable && <Button title="Ponów synchronizację" primary disabled={busy} onPress={() => void run()} />}
      {notice.tone !== 'success' && <Button title="Zamknij komunikat" disabled={busy} onPress={() => setNotice(null)} />}
    </View>
  </View>;
}

/** Ustawienia: lista rozbieżności z Google (także dla zmian usuniętych w KAC) z ponowieniem dla każdej pozycji. */
export function GoogleDivergences({ reloadKey }: { reloadKey: string }) {
  const { palette, styles } = useTheme();
  const [items, setItems] = useState<CorrectionItem[]>([]);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const mounted = useMounted();
  const load = () => listGoogleDivergences().then((result) => { if (mounted.current) setItems(result.items); }).catch(() => { if (mounted.current) setItems([]); });
  // Nowe wczytanie (np. powrót do Ustawień) pokazuje aktualną listę – wynik wcześniejszego ponowienia już jej nie dotyczy.
  useEffect(() => { setNotice(null); void load(); }, [reloadKey]);

  if (!items.length && !notice) return null;
  const retry = async (item: CorrectionItem) => {
    setBusy(item.eventId); setNotice(null);
    try {
      const result = await syncPublishedEvent(item.eventId);
      if (mounted.current) setNotice(correctionNotice(result, item.state === 'pending_delete' ? 'delete' : 'update'));
    } catch (error) { if (mounted.current) setNotice({ tone: 'error', text: `Nie udało się ponowić synchronizacji (${codeOf(error)}).` }); }
    finally { if (mounted.current) { setBusy(null); void load(); } }
  };
  return <View style={{ marginTop: 16, paddingTop: 14, borderTopWidth: 1, borderColor: palette.line }}>
    <Text style={styles.label}>ROZBIEŻNOŚCI Z GOOGLE CALENDAR</Text>
    {!items.length && <Text style={styles.muted}>Brak rozbieżności.</Text>}
    {items.map((item) => <View key={`${item.eventId}|${item.calendar.id}`} style={[styles.row, { paddingVertical: 8, borderTopWidth: 1, borderColor: palette.line, flexWrap: 'wrap' }]}>
      <View style={{ flex: 1, minWidth: 180 }}>
        <Text style={styles.body} numberOfLines={1}>{snapshotLabel(item)}</Text>
        <Text style={[styles.muted, { color: operationStatus(item) === 'Błąd' ? palette.red : palette.amber }]}>{operationLine(item, busy === item.eventId)}</Text>
        {!!nextStep(errorCause(item)) && <Text style={styles.muted}>{nextStep(errorCause(item))}</Text>}
      </View>
      {canRetryCorrection(item) && <Button title="Ponów synchronizację" disabled={busy !== null} onPress={() => void retry(item)} />}
    </View>)}
    {!!notice && <NoticeText notice={notice} />}
  </View>;
}
