// Synchronizacja korekt opublikowanych zmian z Google Calendar – SYMULACJA (S23KC2S1P2-47, G09 / S23KC2S1P2-292).
//
// GoogleEventSync         – w szczegółach zmiany: stan powiązanego wydarzenia w Google, „Ponów synchronizację” i wynik symulacji
// GoogleCorrectionNotice  – po „Zapisz” albo potwierdzonym „Usuń”: synchronizacja od razu i komunikat (6, 3a, 6b, 3a.1, 6c)
// GoogleDivergences       – w Ustawieniach: rozbieżności KAC ↔ Google, także po usunięciu zmiany w KAC
// Anulowanie edycji albo usunięcia nie wywołuje niczego, więc niczego też nie zleca.

import React, { useEffect, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Button, useTheme } from './ui';
import type { Notice } from '../domain/googleIntegration';
import {
  canRetryCorrection, CORRECTION_SIMULATIONS, correctionNotice, correctionStateLabel, snapshotLabel,
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

/** Szczegóły zmiany: stan publikacji. Wydarzenie, którego nie publikowano, nie pokazuje niczego. */
export function GoogleEventSync({ eventId }: { eventId: string }) {
  const { palette, styles } = useTheme();
  const [items, setItems] = useState<CorrectionItem[] | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [simulate, setSimulate] = useState<CorrectionSimulation | null>(null);
  const [busy, setBusy] = useState(false);
  const mounted = useMounted();

  useEffect(() => {
    setItems(null); setNotice(null);
    getPublishedEvent(eventId).then((status) => { if (mounted.current) setItems(status.items); }).catch(() => { if (mounted.current) setItems(null); });
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
    {items.map((item) => <View key={item.calendar.id} style={{ marginTop: 4 }}>
      <Text style={[styles.body, { color: item.state === 'synced' ? palette.green : item.state === 'missing' ? palette.amber : item.state === 'error' || item.state === 'pending_delete' ? palette.red : palette.ink }]}>
        Opublikowano w „{item.calendar.name}” – {correctionStateLabel(item.state)}
      </Text>
      {!!item.message && item.state !== 'synced' && <Text style={styles.muted}>{item.message}</Text>}
    </View>)}
    {!!notice && <NoticeText notice={notice} />}
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
        ? 'Zmianę usunięto z KAC, ale nie udało się połączyć z serwerem, żeby usunąć ją w Google Calendar.'
        : 'Zmiana jest zapisana w KAC, ale nie udało się połączyć z serwerem, żeby zaktualizować Google Calendar.' });
      setRetryable(true);
    } finally { if (mounted.current) setBusy(false); }
  };
  useEffect(() => { setNotice(null); setRetryable(false); void run(); }, [request?.nonce]);

  if (!notice) return null;
  return <View style={{ marginBottom: 6 }}>
    <NoticeText notice={notice} />
    {retryable && <View style={{ marginTop: 4, alignSelf: 'flex-start' }}><Button title="Ponów synchronizację" primary disabled={busy} onPress={() => void run()} /></View>}
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
  useEffect(() => { void load(); }, [reloadKey]);

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
        <Text style={[styles.muted, { color: item.state === 'missing' ? palette.amber : palette.red }]}>{correctionStateLabel(item.state)}{item.message ? ` – ${item.message}` : ''}</Text>
      </View>
      {canRetryCorrection(item) && <Button title="Ponów synchronizację" disabled={busy !== null} onPress={() => void retry(item)} />}
    </View>)}
    {!!notice && <NoticeText notice={notice} />}
  </View>;
}
