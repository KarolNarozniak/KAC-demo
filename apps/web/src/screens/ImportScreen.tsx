import React, { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import type { CalendarEvent, Category } from '../domain/model';
import { validateEventInput } from '../domain/calendar';
import { Button, Card, Field, MockNotice, Pill, useTheme } from '../components/ui';
import WorkScheduleImport from '../components/WorkScheduleImport';
import { confirmImport, createImportSession, previewImport, type ImportIssue, type ImportPreviewRow, type ImportRowInput } from '../services/demoApi';
type Props = { events: CalendarEvent[]; setEvents: (value: CalendarEvent[] | ((current: CalendarEvent[]) => CalendarEvent[])) => void };
type ScanRow = { id: string; title: string; location: string; date: string; start: string; end: string; category: Category };
const googleEvents: ScanRow[] = [
  { id: 'g1', title: 'Wykład z projektowania', location: 'Gmach Północny 204', date: '2026-10-19', start: '09:00', end: '10:30', category: 'Class' },
  { id: 'g2', title: 'Spotkanie projektowe', location: 'Zdalnie', date: '2026-10-19', start: '11:00', end: '12:00', category: 'Personal' },
];
const classSample: ScanRow[] = [
  { id: 'p1', title: 'Seminarium z algorytmów i struktur danych', location: 'Sala B12', date: '2026-10-20', start: '10:00', end: '12:00', category: 'Class' },
  { id: 'p2', title: 'Warsztaty baz danych', location: 'Pracownia 3', date: '2026-10-22', start: '13:00', end: '15:00', category: 'Class' },
  { id: 'p3', title: 'Laboratorium bezpieczeństwa sieci', location: 'Wydział Inżynierii 118', date: '2026-10-13', start: '10:00', end: '12:00', category: 'Class' },
];
const workSample: ScanRow[] = [{ id: 'w1', title: 'Praca', location: 'Kawiarnia Zachodnia', date: '2026-10-21', start: '16:00', end: '20:00', category: 'Work' }, { id: 'w2', title: 'Praca', location: 'Kawiarnia Zachodnia', date: '2026-10-23', start: '15:00', end: '19:00', category: 'Work' }];
// --- Kontrola rozpoznanych danych przed zapisem (S23KC2S1P2-32) ---
type SampleFormat = 'PDF' | 'Zdjęcie' | 'ICS/CSV';
// Przykładowa pewność odczytu: plik ICS/CSV ma dane wprost, PDF i zdjęcie są rozpoznawane, więc pewność jest niższa.
const SAMPLE_CONFIDENCE: Record<SampleFormat, number> = { 'ICS/CSV': 1, PDF: 0.9, 'Zdjęcie': 0.75 };
const issueText: Record<ImportIssue, string> = {
  'missing-title': 'brak tytułu',
  'invalid-date': 'błędna data (wymagany format RRRR-MM-DD)',
  'invalid-time': 'błędna godzina (wymagany format GG:MM)',
  'end-not-after-start': 'koniec musi następować po początku',
};
// Zamienia czas z API (UTC) na zapis lokalny używany przez kalendarz w aplikacji, np. 2026-10-21T16:00.
const toLocalInput = (iso: string) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Warsaw', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(iso)).replace(' ', 'T');
type ImportSessionState = { id: string; confidence: number } | null;
type ApiCheck = { state: 'idle' | 'loading' | 'done' | 'unavailable'; rows: Record<string, ImportPreviewRow> };
export default function ImportScreen({ events, setEvents }: Props) {
  const { palette, styles } = useTheme();
  const [tab, setTab] = useState<'google' | 'classes' | 'work'>('google'); const [connected, setConnected] = useState(false); const [calendar, setCalendar] = useState('Uczelniany');
  const [rows, setRows] = useState<ScanRow[] | null>(null); const [notice, setNotice] = useState(''); const [error, setError] = useState(''); const [failSync, setFailSync] = useState(false); const [emptyRange, setEmptyRange] = useState(false);
  const [skipDuplicates, setSkipDuplicates] = useState(true);
  // Sesja importu w API (gdy działa baza), wiersze odrzucone przez użytkownika i wynik sprawdzenia w API.
  const [session, setSession] = useState<ImportSessionState>(null);
  const [rejectedIds, setRejectedIds] = useState<Record<string, boolean>>({});
  const [apiCheck, setApiCheck] = useState<ApiCheck>({ state: 'idle', rows: {} });
  const [saving, setSaving] = useState(false);
  const toRowInput = (row: ScanRow, confidence?: number): ImportRowInput => ({ id: row.id, title: row.title, date: row.date, startTime: row.start, endTime: row.end, category: row.category, location: row.location, confidence });
  const rowLabel = (id: string) => { const index = rows?.findIndex((row) => row.id === id) ?? -1; return index >= 0 ? `wiersz ${index + 1}` : id; };
  const startImport = (kind: 'classes' | 'work', format: SampleFormat) => {
    const sample = (kind === 'classes' ? classSample : workSample).map((row) => ({ ...row }));
    setSample(kind); setRejectedIds({}); setSession(null);
    // Gdy API i baza działają, zakładamy sesję importu. Bez nich ekran działa jak dotąd, lokalnie.
    const confidence = SAMPLE_CONFIDENCE[format];
    createImportSession(kind, format, sample.map((row) => toRowInput(row, confidence)))
      .then((created) => setSession({ id: created.importSessionId, confidence }))
      .catch(() => setSession(null));
  };
  // Po każdej poprawce w podglądzie wysyłamy wiersze do API (z krótkim opóźnieniem, żeby nie wysyłać przy każdym klawiszu).
  useEffect(() => {
    if (!session || !rows || rows.length === 0 || tab === 'google') { setApiCheck({ state: 'idle', rows: {} }); return; }
    const controller = new AbortController();
    setApiCheck((current) => ({ ...current, state: 'loading' }));
    const timer = setTimeout(() => {
      previewImport(rows.map((row) => toRowInput(row, session.confidence)), session.id, controller.signal)
        .then((result) => setApiCheck({ state: 'done', rows: Object.fromEntries(result.map((item) => [item.id, item])) }))
        .catch(() => { if (!controller.signal.aborted) setApiCheck({ state: 'unavailable', rows: {} }); });
    }, 400);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [rows, tab, session]);
  const renderApiCheck = (row: ScanRow) => {
    const result = apiCheck.rows[row.id];
    if (apiCheck.state !== 'done' || !result) return null;
    const confidence = result.confidence === null ? '' : `Pewność odczytu: ${Math.round(result.confidence * 100)}%`;
    return <View style={[styles.row, { flexWrap: 'wrap', marginTop: 8 }]}>{result.status === 'error' ? <Pill color={palette.red}>BŁĄD</Pill> : <Pill color={palette.green}>DANE POPRAWNE</Pill>}<Text style={styles.muted}>{[result.status === 'error' ? result.issues.map((issue) => issueText[issue]).join(', ') : '', confidence].filter(Boolean).join(' · ')}</Text></View>;
  };
  const selectedRows = rows?.filter((row) => !rejectedIds[row.id]) ?? [];
  const confirmWithApi = async () => {
    if (!session || !rows) return;
    const blocked = selectedRows.filter((row) => apiCheck.rows[row.id]?.status === 'error');
    if (blocked.length) { setError(`Popraw albo odrzuć wiersze z błędem: ${blocked.map((row) => rowLabel(row.id)).join(', ')}.`); return; }
    setSaving(true); setError('');
    try {
      const result = await confirmImport(session.id, selectedRows.map((row) => toRowInput(row, session.confidence)));
      if (result.kind === 'saved') {
        const additions: CalendarEvent[] = result.events.map((event) => ({ id: event.id, title: event.title, start: toLocalInput(event.start), end: toLocalInput(event.end), category: event.category, location: event.location ?? undefined, mandatory: false, repeatWeekly: false, source: 'import' }));
        setEvents((current) => [...current, ...additions]);
        setNotice(`Zapisano w kalendarzu (baza danych): ${result.saved}. Odrzucono przed zapisem: ${result.rejected}.`);
        setRows(null); setSession(null); setRejectedIds({});
      } else if (result.kind === 'invalid-rows') setError('Serwer odrzucił import, bo część zaznaczonych wierszy ma błędy. Nic nie zostało zapisane.');
      else if (result.kind === 'expired') { setError('Sesja importu wygasła po 15 minutach bez akcji. Nic nie zostało zapisane. Wczytaj plik ponownie.'); setSession(null); }
      else if (result.kind === 'closed') setError('Ten import został już zakończony.');
      else setError(`Nie udało się zapisać importu (status ${result.status}). Kalendarz pozostał bez zmian.`);
    } catch {
      setError('Brak połączenia z API. Kalendarz pozostał bez zmian, spróbuj ponownie.');
    } finally {
      setSaving(false);
    }
  };
  const tabs = [{ id: 'google', name: 'Kalendarz Google' }, { id: 'classes', name: 'Plan zajęć' }, { id: 'work', name: 'Zmiany w pracy' }] as const;
  const setSample = (kind: 'google' | 'classes' | 'work') => { setTab(kind); setRows(kind === 'google' ? googleEvents.map((row) => ({ ...row })) : kind === 'classes' ? classSample.map((row) => ({ ...row })) : workSample.map((row) => ({ ...row }))); setNotice('Przejrzyj przykładowe wpisy i popraw je przed importem.'); setError(''); };
  const isDuplicate = (row: ScanRow) => events.some((event) => event.title.toLowerCase() === row.title.toLowerCase() && event.start === `${row.date}T${row.start}` && event.end === `${row.date}T${row.end}`);
  const importRows = () => {
    if (session && tab !== 'google') { void confirmWithApi(); return; }
    if (!rows) return; const issue = selectedRows.map((row) => validateEventInput({ title: row.title, start: `${row.date}T${row.start}`, end: `${row.date}T${row.end}` })).find(Boolean); if (issue) { setError(issue); return; } const accepted = selectedRows.filter((row) => !skipDuplicates || !isDuplicate(row));
    const additions: CalendarEvent[] = accepted.map((row) => ({ id: `import-${row.id}-${Date.now()}`, title: row.title, start: `${row.date}T${row.start}`, end: `${row.date}T${row.end}`, category: row.category, location: row.location.trim() || undefined, mandatory: false, repeatWeekly: false, source: 'import' }));
    const eventNoun = additions.length === 1 ? 'wydarzenie' : additions.length > 1 && additions.length < 5 ? 'wydarzenia' : 'wydarzeń';
    setEvents((current) => [...current, ...additions]); const skipped = selectedRows.length - additions.length; const rejected = rows.length - selectedRows.length; setNotice(`Dodano ${additions.length} ${eventNoun}${skipped ? `; pominięto duplikaty: ${skipped}` : ''}${rejected ? `; odrzucono: ${rejected}` : ''}.`); setRows(null); setError('');
  };
  const sync = () => { if (!connected) { setError('Najpierw połącz konto demonstracyjne i wybierz kalendarz.'); return; } if (failSync) { setError('Symulacja synchronizacji nie powiodła się: przykładowe połączenie jest niedostępne. Spróbuj ponownie lub połącz się ponownie.'); return; } setSample('google'); setNotice('Odświeżono przykładowy kalendarz. Przejrzyj zmiany przed importem.'); };
  const update = (id: string, key: keyof ScanRow, value: string) => setRows((current) => current?.map((row) => row.id === id ? { ...row, [key]: value } : row) ?? null);
  const duplicateCount = rows?.filter(isDuplicate).length ?? 0;
  return <View style={styles.content}>
    <MockNotice>Logowanie Google OAuth, odczyt Kalendarza Google, rozpoznawanie PDF i zdjęć oraz synchronizacja nie są podłączone. Przykładowy plan zajęć i zmiany w pracy można sprawdzić i zapisać w bazie danych, gdy działa API; bez API wpisy trafiają tylko do pamięci przeglądarki.</MockNotice>
    <Pill>IMPORTOWANIE</Pill><Text style={[styles.title, { marginTop: 9 }]}>Zbierz swój tydzień w jednym miejscu.</Text><Text style={styles.subtitle}>Przejrzyj wpisy, popraw je, wykryj duplikaty i wybierz, co zachować.</Text>
    <View style={[styles.row, { flexWrap: 'wrap', marginTop: 19, marginBottom: 8 }]}>{tabs.map((item) => <Pressable key={item.id} accessibilityRole="tab" accessibilityState={{ selected: tab === item.id }} onPress={() => setTab(item.id)} style={{ padding: 10, borderRadius: 9, backgroundColor: tab === item.id ? palette.blue : palette.surfaceAlt }}><Text style={{ color: tab === item.id ? '#FFFFFF' : palette.ink, fontWeight: '700', fontSize: 12 }}>{item.name}</Text></Pressable>)}</View>
    <Card><View style={[styles.row, { justifyContent: 'space-between', flexWrap: 'wrap' }]}><View><Text style={styles.heading}>{tab === 'google' ? 'Jednorazowy import kalendarza' : tab === 'classes' ? 'Import planu zajęć' : 'Import zmian w pracy'}</Text><Text style={styles.muted}>{tab === 'google' ? 'Wybierz przykładowy kalendarz, zakres dat i wydarzenia.' : 'Przejrzyj i edytuj przykładowe wpisy z pliku lub skanu.'}</Text></View><Pill color={connected ? palette.green : palette.muted}>{connected ? 'POŁĄCZENIE SYMULOWANE' : 'NIEPOŁĄCZONO'}</Pill></View>
      {tab === 'google' && <><View style={[styles.row, { flexWrap: 'wrap', marginTop: 15 }]}><Button title={connected ? 'Konto testowe: u123456@student.wat.edu.pl' : 'Połącz przykładowe konto Google'} primary onPress={() => { setConnected(true); setError(''); setNotice('Połączono wyłącznie konto przykładowe. Nie użyto OAuth ani nie uzyskano dostępu do Google.'); }} /><Button title="Symuluj odmowę dostępu" onPress={() => { setConnected(false); setError('Odmowa dostępu w tej symulacji. Nie odczytano żadnych wydarzeń.'); setRows(null); }} /></View>
        <View style={[styles.row, { flexWrap: 'wrap', marginTop: 11 }]}>{['Uczelniany', 'Prywatny', 'Pusty kalendarz'].map((name) => <Pressable key={name} onPress={() => { setCalendar(name); setEmptyRange(name === 'Pusty kalendarz'); }} style={{ padding: 8, borderRadius: 8, backgroundColor: calendar === name ? palette.blueSoft : palette.surfaceAlt }}><Text style={{ color: calendar === name ? palette.blue : palette.muted, fontSize: 12, fontWeight: '700' }}>{name}</Text></Pressable>)}</View>
        <Text style={[styles.muted, { marginTop: 9 }]}>Wybrany kalendarz: {calendar} · zakres dat: 12–25 października 2026</Text>
        <View style={[styles.row, { flexWrap: 'wrap', marginTop: 11 }]}><Button title="Podgląd przykładowych wydarzeń" onPress={() => { if (!connected) { setError('Najpierw połącz konto demonstracyjne.'); return; } if (emptyRange) { setRows([]); setNotice('W tym przykładowym zakresie nie ma wydarzeń. Wybierz kalendarz uczelniany lub prywatny.'); } else setSample('google'); }} /><Button title="Symuluj synchronizację" onPress={sync} /><Pressable accessibilityRole="checkbox" accessibilityState={{ checked: failSync }} onPress={() => setFailSync(!failSync)} style={{ padding: 9 }}><Text style={styles.muted}>{failSync ? '☑' : '☐'} Wymuś błąd synchronizacji</Text></Pressable><Button title="Odłącz / cofnij przykładowy dostęp" onPress={() => { setConnected(false); setRows(null); setNotice('Odłączono symulowane konto.'); }} /></View></>}
      {tab !== 'google' && <><Text style={[styles.muted, { marginTop: 14 }]}>Wybierz przykładowy plik. Żaden plik nie zostanie przesłany ani odczytany.</Text><View style={[styles.row, { flexWrap: 'wrap', marginTop: 10 }]}><Button title="Podgląd przykładowego PDF" onPress={() => startImport(tab, 'PDF')} /><Button title="Podgląd przykładowego zdjęcia" onPress={() => startImport(tab, 'Zdjęcie')} /><Button title="Podgląd przykładowego ICS / CSV" onPress={() => startImport(tab, 'ICS/CSV')} /><Button title="Sprawdź nieobsługiwany plik" onPress={() => { setRows(null); setError('Nieobsługiwany lub nieczytelny format. Wybierz przykładowy plik PDF, zdjęcie, ICS albo CSV.'); }} /></View></>}
      {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}{!!notice && <Text style={[styles.body, { marginTop: 11 }]}>{notice}</Text>}
    </Card>
    {tab === 'work' && <WorkScheduleImport setEvents={setEvents} />}
    {rows && <Card><View style={[styles.row, { justifyContent: 'space-between', flexWrap: 'wrap' }]}><View><Text style={styles.heading}>Podgląd importu · przykładowe wpisy: {rows.length}</Text><Text style={styles.muted}>Popraw dane przed dodaniem ich do kalendarza w tej sesji.</Text>{session && tab !== 'google' && <Text style={styles.muted}>{apiCheck.state === 'loading' ? 'Sprawdzanie w API…' : apiCheck.state === 'unavailable' ? 'API niedostępne · zapis nie jest teraz możliwy' : `Sesja importu aktywna (wygasa po 15 min bez akcji) · do zapisu: ${selectedRows.length} z ${rows.length}`}</Text>}</View>{!(session && tab !== 'google') && <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: skipDuplicates }} onPress={() => setSkipDuplicates(!skipDuplicates)}><Text style={styles.body}>{skipDuplicates ? '☑' : '☐'} Pomijaj dokładne duplikaty ({duplicateCount})</Text></Pressable>}</View>
      {!rows.length && <Text style={[styles.body, { marginTop: 16 }]}>W tym przykładowym zakresie nie znaleziono wydarzeń. Kalendarz pozostał bez zmian.</Text>}
      {rows.map((row) => <View key={row.id} style={{ marginTop: 14, borderTopWidth: 1, borderColor: palette.line, paddingTop: 13 }}><View style={styles.row}><Pressable accessibilityRole="checkbox" accessibilityLabel={`Importuj ${rowLabel(row.id)}`} accessibilityState={{ checked: !rejectedIds[row.id] }} onPress={() => setRejectedIds((current) => ({ ...current, [row.id]: !current[row.id] }))} style={{ paddingRight: 8 }}><Text style={[styles.body, { color: rejectedIds[row.id] ? palette.muted : palette.ink }]}>{rejectedIds[row.id] ? '☐ Odrzucony' : '☑ Importuj'}</Text></Pressable><Text style={{ fontWeight: '800', color: rejectedIds[row.id] ? palette.muted : palette.ink, flex: 1, textDecorationLine: rejectedIds[row.id] ? 'line-through' : 'none' }}>{row.title}{isDuplicate(row) ? ' · duplikat' : ''}</Text>{!(session && tab !== 'google') && <Pill color={isDuplicate(row) ? palette.amber : palette.green}>{isDuplicate(row) ? 'DUPLIKAT' : 'NOWE'}</Pill>}</View>{renderApiCheck(row)}<View style={[styles.row, { flexWrap: 'wrap', marginTop: 8 }]}><Field label="TYTUŁ" value={row.title} onChangeText={(v) => update(row.id, 'title', v)} /><Field label="DATA" value={row.date} onChangeText={(v) => update(row.id, 'date', v)} /></View><View style={styles.row}><Field label="MIEJSCE" value={row.location} onChangeText={(v) => update(row.id, 'location', v)} /></View><View style={styles.row}><Field label="POCZĄTEK" value={row.start} onChangeText={(v) => update(row.id, 'start', v)} /><Field label="KONIEC" value={row.end} onChangeText={(v) => update(row.id, 'end', v)} /></View></View>)}
      {!!rows.length && <View style={[styles.row, { justifyContent: 'flex-end', flexWrap: 'wrap', marginTop: 10 }]}><Button title="Anuluj import" onPress={() => { setRows(null); setSession(null); setRejectedIds({}); setNotice('Anulowano import. Kalendarz pozostał bez zmian.'); }} /><Button title={saving ? 'Zapisywanie…' : `Importuj zaznaczone (${selectedRows.length})`} primary onPress={importRows} disabled={selectedRows.length === 0 || saving} /></View>}
    </Card>}
    <Card><Text style={styles.heading}>Opcje synchronizacji</Text><Text style={[styles.body, { marginTop: 7 }]}>Import jednorazowy nie uruchamia stałej synchronizacji. Możesz zasymulować błąd odświeżania, ponowić próbę, zmienić kalendarz lub odłączyć przykładowe konto. Dane nie pochodzą z Google.</Text><Text style={[styles.muted, { marginTop: 9 }]}>Duplikat: ten sam tytuł oraz ta sama data i godzina rozpoczęcia. Import można anulować przed zapisaniem.</Text></Card>
  </View>;
}
