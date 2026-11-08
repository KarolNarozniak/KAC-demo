// Jednorazowy import wydarzeń z Google Calendar (historyjka S23KC2S1P2-27).
//
// Kroki: połączenie z kontem Google i zgoda na odczyt (3a – odmowa) → wybór kalendarza i zakresu dat (6a – brak
// wydarzeń) → podgląd wydarzeń z duplikatami i kolizjami → „Importuj” / „Anuluj” → liczba zaimportowanych.
// Bez skonfigurowanego klienta Google na serwerze działa przykładowe konto (makieta), z tym samym przebiegiem.
// Import jest jednorazowy: późniejsze zmiany w Google Calendar nie aktualizują wydarzeń w aplikacji.

import React, { useEffect, useRef, useState } from 'react';
import { Linking, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { Button, useTheme } from './ui';
import DateField from './DateField';
import { addCalendarDays, localDateKey } from '../domain/calendar';
import { cancelImport, confirmImport, previewImport, type DuplicateDecision, type ImportCategory, type ImportPreviewRow, type ImportSummary } from '../services/importApi';
import {
  forgetGoogleConnection, giveDemoConsent, googleConnectionStatus, GoogleImportError, listGoogleCalendars, readGoogleEvents, startGoogleConnection,
  type GoogleCalendar, type GoogleReadResult, type GoogleRow,
} from '../services/googleImportApi';

type Props = { visible: boolean; onClose: () => void; onImported: () => void };
type Step = 'start' | 'consent' | 'waiting' | 'denied' | 'choose' | 'preview' | 'done';

const categoryLabels: Record<ImportCategory, string> = { Class: 'Zajęcia', Work: 'Praca', Personal: 'Prywatne' };
const decisionLabels: Record<DuplicateDecision, string> = { skip: 'Pomiń', replace: 'Zastąp', keepBoth: 'Zachowaj oba' };
const when = (row: GoogleRow) => `${row.date.split('-').reverse().join('.')} · ${row.startTime}–${row.endTime}${row.endDate ? ` (${row.endDate.split('-').reverse().join('.')})` : ''}`;

export default function GoogleCalendarImport({ visible, onClose, onImported }: Props) {
  const { palette, styles } = useTheme();
  const [step, setStep] = useState<Step>('start');
  const [connectionId, setConnectionId] = useState<string | null>(null);
  const [mode, setMode] = useState<'google' | 'demo'>('demo');
  const [account, setAccount] = useState('');
  const [authUrl, setAuthUrl] = useState('');
  const [calendars, setCalendars] = useState<GoogleCalendar[]>([]);
  const [calendarId, setCalendarId] = useState('');
  const [from, setFrom] = useState(localDateKey(new Date()));
  const [to, setTo] = useState(localDateKey(addCalendarDays(new Date(), 30)));
  const [category, setCategory] = useState<ImportCategory>('Personal');
  const [result, setResult] = useState<GoogleReadResult | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [decisions, setDecisions] = useState<Record<string, DuplicateDecision>>({});
  const [preview, setPreview] = useState<Record<string, ImportPreviewRow>>({});
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const polling = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = () => { if (polling.current) clearInterval(polling.current); polling.current = null; };
  useEffect(() => stopPolling, []);

  const reset = () => {
    stopPolling();
    setStep('start'); setConnectionId(null); setAccount(''); setAuthUrl(''); setCalendars([]); setCalendarId('');
    setResult(null); setSelected(new Set()); setDecisions({}); setPreview({}); setError(''); setInfo('');
  };

  const run = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true); setError('');
    try { await action(); }
    catch (err) { setError(err instanceof Error ? err.message : 'Operacja nie powiodła się.'); }
    finally { setBusy(false); }
  };

  const loadCalendars = async (id: string) => {
    const list = await listGoogleCalendars(id);
    setAccount(list.email ?? '');
    setCalendars(list.calendars);
    setCalendarId((list.calendars.find((calendar) => calendar.primary) ?? list.calendars[0])?.id ?? '');
    setStep('choose');
  };

  // 1–2: przycisk „Importuj z Google Calendar” → ekran połączenia z kontem Google.
  const connect = () => run(async () => {
    setSummary(null); setInfo('');
    const started = await startGoogleConnection();
    setConnectionId(started.connectionId); setMode(started.mode);
    if (started.mode === 'demo') { setAccount(started.demoAccount); setStep('consent'); return; }
    setAuthUrl(started.authUrl);
    setStep('waiting');
    await Linking.openURL(started.authUrl);
    // Zgoda odbywa się na stronie Google – sprawdzamy stan połączenia co 2 s (najwyżej 5 minut).
    let attempts = 0;
    stopPolling();
    polling.current = setInterval(() => {
      attempts += 1;
      googleConnectionStatus(started.connectionId).then((status) => {
        if (status.status === 'connected') { stopPolling(); void run(() => loadCalendars(started.connectionId)); }
        else if (status.status === 'denied') { stopPolling(); setStep('denied'); }
        else if (status.status === 'error') { stopPolling(); setStep('start'); setError('Google nie potwierdził połączenia. Spróbuj ponownie.'); }
      }).catch(() => undefined);
      if (attempts > 150) { stopPolling(); setStep('start'); setError('Nie otrzymano zgody w ciągu 5 minut. Spróbuj ponownie.'); }
    }, 2000);
  });

  // 3 / 3a (konto demonstracyjne): zgoda albo odmowa dostępu.
  const consent = (allow: boolean) => run(async () => {
    if (!connectionId) return;
    const status = await giveDemoConsent(connectionId, allow);
    if (status.status === 'denied') { setStep('denied'); return; }
    await loadCalendars(connectionId);
  });

  // 5–6: kalendarz i zakres dat → podgląd. 6a: brak wydarzeń – zostajemy na wyborze zakresu.
  const next = () => run(async () => {
    if (!connectionId || !calendarId) return;
    setInfo('');
    try {
      const read = await readGoogleEvents(connectionId, calendarId, from, to, category);
      setResult(read);
      setSelected(new Set(read.rows.map((row) => row.id)));
      setPreview(Object.fromEntries(read.preview.map((item) => [item.id, item])));
      setDecisions({});
      setStep('preview');
    } catch (err) {
      if (err instanceof GoogleImportError && err.code === 'no-events') {
        const allDay = Number(err.details.skippedAllDay ?? 0);
        setInfo(`W wybranym zakresie nie ma wydarzeń do zaimportowania${allDay ? ` (pominięto ${allDay} całodniowych)` : ''}. Zmień zakres dat lub kalendarz.`);
        return;
      }
      throw err;
    }
  });

  const rowsChosen = () => (result?.rows ?? []).filter((row) => selected.has(row.id));
  const toInput = (row: GoogleRow) => ({ id: row.id, title: row.title, date: row.date, startTime: row.startTime, endTime: row.endTime,
    ...(row.endDate ? { endDate: row.endDate } : {}), category: row.category, location: row.location, duplicateDecision: decisions[row.id] });

  // Po zmianie zaznaczenia/decyzji podgląd jest sprawdzany ponownie przez API (przedłuża też sesję importu).
  useEffect(() => {
    if (step !== 'preview' || !result) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      previewImport(rowsChosen().map(toInput), result.importSessionId, controller.signal)
        .then((items) => setPreview((current) => ({ ...current, ...Object.fromEntries(items.map((item) => [item.id, item])) })))
        .catch(() => undefined);
    }, 300);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [selected, decisions, step]);

  const undecided = rowsChosen().filter((row) => {
    const item = preview[row.id];
    return item && (item.duplicateOfEvents.length > 0 || item.duplicateOfRows.length > 0) && !decisions[row.id];
  });
  const invalid = rowsChosen().filter((row) => preview[row.id]?.status === 'error');

  // 7–8: „Importuj” – zapis w całości albo wcale, potem liczba zaimportowanych wydarzeń.
  const save = () => run(async () => {
    if (!result) return;
    if (undecided.length) throw new Error('Wybierz, co zrobić z każdym duplikatem (Pomiń, Zastąp lub Zachowaj oba).');
    if (invalid.length) throw new Error('Odznacz wydarzenia z błędnymi danymi (np. bez tytułu).');
    const saved = await confirmImport(result.importSessionId, rowsChosen().map(toInput));
    if (saved.kind === 'saved') {
      setSummary(saved.summary ?? { added: saved.saved, replaced: 0, skipped: 0, rejected: saved.rejected });
      setStep('done');
      onImported();
      return;
    }
    if (saved.kind === 'expired' || saved.kind === 'closed') throw new Error('Sesja importu wygasła (15 minut bez akcji). Nic nie zapisano – rozpocznij import ponownie.');
    throw new Error('Nie zapisano importu – kalendarz zmienił się w międzyczasie albo dane wymagają decyzji. Spróbuj ponownie.');
  });

  // 7a: „Anuluj” – podgląd zamknięty bez dodawania wydarzeń.
  const cancel = () => run(async () => {
    if (result) await cancelImport(result.importSessionId).catch(() => undefined);
    if (connectionId) await forgetGoogleConnection(connectionId);
    reset();
    setInfo('Import anulowany. Kalendarz pozostał bez zmian.');
  });

  const close = async () => {
    if (busy) return;
    if (result && step === 'preview') await cancelImport(result.importSessionId).catch(() => undefined);
    if (connectionId) await forgetGoogleConnection(connectionId);
    reset(); setSummary(null);
    onClose();
  };

  const option = (text: string, active: boolean, onPress: () => void, key?: string) => (
    <Pressable key={key ?? text} accessibilityRole="radio" accessibilityState={{ selected: active }} onPress={onPress} disabled={busy}
      style={{ paddingHorizontal: 12, paddingVertical: 10, minHeight: 44, justifyContent: 'center', borderRadius: 10, borderWidth: 1, borderColor: active ? palette.blue : palette.line, backgroundColor: active ? palette.blueSoft : 'transparent', marginBottom: 6 }}>
      <Text style={{ color: active ? palette.blue : palette.ink, fontWeight: '700' }}>{text}</Text>
    </Pressable>
  );

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={() => void close()}>
      <View style={{ flex: 1, backgroundColor: palette.scrim, alignItems: 'center', justifyContent: 'center', padding: 16 }}>
        <ScrollView style={{ backgroundColor: palette.surface, borderRadius: 18, width: '100%', maxWidth: 640, maxHeight: '92%' }} contentContainerStyle={{ padding: 21 }}>
          <View style={[styles.row, { justifyContent: 'space-between' }]}>
            <Text style={[styles.heading, { flex: 1 }]}>Importuj z Google Calendar</Text>
            <Button title="Zamknij" disabled={busy} onPress={() => void close()} />
          </View>
          <Text style={styles.subtitle}>Import jednorazowy: wydarzenia zostaną skopiowane do KAC. Późniejsze zmiany w Google Calendar nie aktualizują ich w aplikacji.</Text>
          {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
          {!!info && <Text accessibilityLiveRegion="polite" style={[styles.body, { marginTop: 10 }]}>{info}</Text>}
          {busy && <Text accessibilityLiveRegion="polite" style={styles.muted}>Proszę czekać…</Text>}

          {step === 'start' && <View style={{ marginTop: 14 }}>
            <Button title="Połącz z kontem Google" primary disabled={busy} onPress={() => void connect()} />
            <Text style={[styles.muted, { marginTop: 8 }]}>Aplikacja poprosi tylko o odczyt kalendarzy i wydarzeń. Dostęp wygasa po imporcie.</Text>
          </View>}

          {step === 'consent' && <View style={{ marginTop: 14, borderWidth: 1, borderColor: palette.line, borderRadius: 14, padding: 16 }}>
            <Text style={styles.label}>KONTO GOOGLE (PRZYKŁADOWE)</Text>
            <Text style={[styles.body, { fontWeight: '700' }]}>{account}</Text>
            <Text style={[styles.body, { marginTop: 10 }]}>Aplikacja KAC chce uzyskać dostęp do Twojego konta Google:</Text>
            <Text style={styles.body}>• Wyświetlanie Twoich kalendarzy i wydarzeń (tylko odczyt)</Text>
            <Text style={[styles.muted, { marginTop: 6 }]}>Serwer działa bez połączenia z prawdziwym Google (brak GOOGLE_CLIENT_ID), więc używane jest konto przykładowe.</Text>
            <View style={[styles.row, { justifyContent: 'flex-end', marginTop: 12, flexWrap: 'wrap' }]}>
              <Button title="Odmów" disabled={busy} onPress={() => void consent(false)} />
              <Button title="Zezwól" primary disabled={busy} onPress={() => void consent(true)} />
            </View>
          </View>}

          {step === 'waiting' && <View style={{ marginTop: 14 }}>
            <Text style={styles.body}>Zaloguj się w Google w otwartej karcie, wybierz konto i zezwól na odczyt wydarzeń. Ta strona sama przejdzie dalej.</Text>
            <View style={[styles.row, { marginTop: 10, flexWrap: 'wrap' }]}>
              <Button title="Otwórz stronę Google ponownie" disabled={busy} onPress={() => void Linking.openURL(authUrl)} />
              <Button title="Anuluj" disabled={busy} onPress={() => void cancel()} />
            </View>
          </View>}

          {step === 'denied' && <View style={{ marginTop: 14 }}>
            <Text accessibilityRole="alert" style={styles.error}>Nie udzielono dostępu do wydarzeń. Bez tej zgody import z Google Calendar nie jest możliwy.</Text>
            <View style={[styles.row, { marginTop: 10, flexWrap: 'wrap' }]}>
              <Button title="Spróbuj ponownie" primary disabled={busy} onPress={() => { reset(); void connect(); }} />
              <Button title="Zamknij" disabled={busy} onPress={() => void close()} />
            </View>
          </View>}

          {step === 'choose' && <View style={{ marginTop: 14 }}>
            <Text style={styles.muted}>Połączone konto: {account || 'Google'}{mode === 'demo' ? ' (przykładowe)' : ''}</Text>
            <Text style={[styles.label, { marginTop: 10 }]}>KALENDARZ</Text>
            <View accessibilityRole="radiogroup">{calendars.map((calendar) => option(`${calendar.name}${calendar.primary ? ' (główny)' : ''}`, calendarId === calendar.id, () => setCalendarId(calendar.id), calendar.id))}</View>
            <View style={[styles.row, { marginTop: 8 }]}>
              <DateField label="OD" value={from} invalid={from > to} onChange={setFrom} />
              <DateField label="DO" value={to} invalid={from > to} onChange={setTo} />
            </View>
            <Text style={styles.label}>KATEGORIA ZAIMPORTOWANYCH WYDARZEŃ</Text>
            <View style={[styles.row, { flexWrap: 'wrap' }]}>{(['Personal', 'Class', 'Work'] as ImportCategory[]).map((value) => option(categoryLabels[value], category === value, () => setCategory(value), value))}</View>
            <View style={[styles.row, { justifyContent: 'flex-end', marginTop: 12, flexWrap: 'wrap' }]}>
              <Button title="Anuluj" disabled={busy} onPress={() => void cancel()} />
              <Button title="Dalej" primary disabled={busy || !calendarId || from > to} onPress={() => void next()} />
            </View>
          </View>}

          {step === 'preview' && result && <View style={{ marginTop: 14 }}>
            <Text style={styles.body}>{result.calendarName} · {result.from.split('-').reverse().join('.')} – {result.to.split('-').reverse().join('.')}</Text>
            <Text style={styles.muted}>Wybrano {rowsChosen().length} z {result.rows.length} wydarzeń · kategoria: {categoryLabels[category]}{result.skippedAllDay ? ` · pominięto całodniowe: ${result.skippedAllDay}` : ''}</Text>
            {result.rows.map((row) => {
              const item = preview[row.id];
              const isSelected = selected.has(row.id);
              const duplicate = item && (item.duplicateOfEvents.length > 0 || item.duplicateOfRows.length > 0);
              const collisions = result.collisions[row.id] ?? [];
              return <View key={row.id} style={{ borderTopWidth: 1, borderColor: palette.line, paddingVertical: 10, opacity: isSelected ? 1 : 0.6 }}>
                <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: isSelected }} disabled={busy} style={{ minHeight: 44, justifyContent: 'center' }}
                  onPress={() => setSelected((current) => { const nextSet = new Set(current); if (nextSet.has(row.id)) nextSet.delete(row.id); else nextSet.add(row.id); return nextSet; })}>
                  <Text style={[styles.body, { fontWeight: '700' }]}>{isSelected ? '☑' : '☐'} {row.title || '(bez tytułu)'}</Text>
                  <Text style={styles.muted}>{when(row)}{row.location ? ` · ${row.location}` : ''}</Text>
                </Pressable>
                {item?.status === 'error' && <Text style={styles.error}>Brak tytułu lub błędne godziny – odznacz to wydarzenie.</Text>}
                {collisions.length > 0 && <Text style={[styles.muted, { color: palette.amber }]}>Koliduje z: {collisions.map((other) => other.title).join(', ')}</Text>}
                {duplicate && isSelected && <View>
                  <Text style={[styles.muted, { color: palette.amber }]}>Duplikat: {item.duplicateOfEvents[0]?.title ?? 'to samo wydarzenie w tym imporcie'}</Text>
                  <View style={[styles.row, { flexWrap: 'wrap' }]}>
                    {(['skip', 'replace', 'keepBoth'] as DuplicateDecision[]).filter((decision) => decision !== 'replace' || item.duplicateOfEvents.length === 1)
                      .map((decision) => <Button key={decision} title={decisionLabels[decision]} primary={decisions[row.id] === decision} disabled={busy}
                        onPress={() => setDecisions((current) => ({ ...current, [row.id]: decision }))} />)}
                  </View>
                </View>}
              </View>;
            })}
            <View style={[styles.row, { justifyContent: 'flex-end', marginTop: 12, flexWrap: 'wrap' }]}>
              <Button title="Anuluj" disabled={busy} onPress={() => void cancel()} />
              <Button title={`Importuj (${rowsChosen().length})`} primary disabled={busy || rowsChosen().length === 0} onPress={() => void save()} />
            </View>
          </View>}

          {step === 'done' && summary && <View style={{ marginTop: 14 }}>
            <Text accessibilityLiveRegion="polite" style={[styles.body, { fontWeight: '700' }]}>Zaimportowano {summary.added + summary.replaced} wydarzeń z Google Calendar.</Text>
            <Text style={styles.muted}>Dodano: {summary.added} · Zastąpiono: {summary.replaced} · Pominięto duplikaty: {summary.skipped} · Niewybrane: {summary.rejected}</Text>
            <Text style={[styles.muted, { marginTop: 6 }]}>Wydarzenia są już w kalendarzu. Połączenie z Google zostało zakończone.</Text>
            <View style={[styles.row, { justifyContent: 'flex-end', marginTop: 12 }]}>
              <Button title="Gotowe" primary onPress={() => void close()} />
            </View>
          </View>}
        </ScrollView>
      </View>
    </Modal>
  );
}
