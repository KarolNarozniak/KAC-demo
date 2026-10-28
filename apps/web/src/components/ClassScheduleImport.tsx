import React, { useEffect, useRef, useState } from 'react';
import { Modal, ScrollView, Text, View } from 'react-native';
import { Button, Field, useTheme } from './ui';
import DateField from './DateField';
import TimeField from './TimeField';
import { pickPdf } from '../services/pickPdf';
import { cancelImport, confirmImport, invalidFields, previewImport, readClassSchedule,
  type ClassReadResult, type ClassRow, type DuplicateDecision, type ImportIssue, type ImportPreviewRow, type ImportRowInput, type ImportSummary } from '../services/importApi';

// Import planu zajęć z pliku: PDF/zdjęcie (historyjka S23KC2S1P2-38) oraz ICS (S23KC2S1P2-8),
// z korektą błędnie odczytanych danych (S23KC2S1P2-20) w podglądzie z historyjki S23KC2S1P2-32.

const issueText: Record<ImportIssue, string> = {
  'missing-title': 'wpisz nazwę przedmiotu',
  'invalid-date': 'wybierz poprawną datę',
  'invalid-time': 'uzupełnij godziny',
  'end-not-after-start': 'koniec musi być później niż początek',
};
const skipText: Record<string, string> = {
  'all-day': 'całodniowe (bez godzin)', 'missing-time': 'bez godziny zakończenia',
  'invalid-date': 'z błędną datą', 'unsupported-repeat': 'z nieobsługiwanym powtarzaniem',
};
const shortStamp = (iso: string) => new Date(iso).toLocaleString('pl-PL', { timeZone: 'Europe/Warsaw', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

const PAGE_SIZE = 10;
const stamp = (iso: string) => new Date(iso).toLocaleString('pl-PL', { timeZone: 'Europe/Warsaw' });
const rowInput = (row: ClassRow): ImportRowInput => ({ id: row.id, title: row.title, date: row.date,
  startTime: row.startTime, endTime: row.endTime, ...(row.endDate ? { endDate: row.endDate } : {}), category: 'Class', location: row.location,
  duplicateDecision: row.duplicateDecision, replacementId: row.replacementId });

export default function ClassScheduleImport({ visible, onClose, onImported }: {
  visible: boolean; onClose: () => void; onImported: () => void;
}) {
  const { styles, palette } = useTheme();
  const [session, setSession] = useState<ClassReadResult | null>(null);
  const [rows, setRows] = useState<ClassRow[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [preview, setPreview] = useState<ImportPreviewRow[]>([]);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState('');
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  // Status importu (S23KC2S1P2-20): zakończony, nieudany albo anulowany.
  const [status, setStatus] = useState<'' | 'failed' | 'cancelled'>('');
  const [fileName, setFileName] = useState('');
  const [page, setPage] = useState(0);
  const [retry, setRetry] = useState(0);
  const chosen = rows.filter(row => selected.has(row.id));

  useEffect(() => {
    if (!session) return;
    const controller = new AbortController();
    setChecking(true);
    const timer = setTimeout(() => {
      previewImport(rows.filter(row => selected.has(row.id)).map(rowInput), session.importSessionId, controller.signal)
        .then(result => { if (!controller.signal.aborted) { setPreview(result); setChecking(false); } })
        .catch(() => { if (!controller.signal.aborted) { setPreview([]); setChecking(false); setError('Nie udało się sprawdzić danych. Ponów sprawdzenie przed zapisem.'); } });
    }, 350);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [rows, selected, session, retry]);

  const run = async (action: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setError('');
    try { await action(); }
    catch (err) { setError(err instanceof Error ? err.message : 'Operacja nie powiodła się. Spróbuj ponownie.'); }
    finally { busyRef.current = false; setBusy(false); }
  };
  const choose = () => run(async () => {
    const file = await pickPdf();
    if (!file) return;
    setStatus('');
    const result = await readClassSchedule(file.name, file.base64);
    setFileName(file.name); setSummary(null); setSession(result); setRows(result.rows);
    setSelected(new Set(result.rows.filter(row => !row.reviewRequired).map(row => row.id)));
    setPreview(result.preview); setPage(0);
  });
  const close = () => run(async () => {
    if (session) await cancelImport(session.importSessionId);
    setSession(null); setRows([]); setPreview([]); setSummary(null); setFileName(''); setStatus(''); onClose();
  });
  // „Anuluj import” kończy sesję bez zapisu, ale zostawia okno z informacją o wyniku (7a).
  const cancel = () => run(async () => {
    if (session) await cancelImport(session.importSessionId).catch(() => undefined);
    setSession(null); setRows([]); setPreview([]); setSummary(null); setStatus('cancelled');
  });
  const update = (id: string, change: Partial<ClassRow>) => {
    setChecking(true); setError('');
    setRows(current => current.map(row => row.id === id ? { ...row, duplicateDecision: undefined, replacementId: undefined, ...change } : row));
  };
  const toggle = (id: string) => {
    setChecking(true);
    setSelected(current => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  };
  const save = () => run(async () => {
    if (!session || checking) return;
    let result: Awaited<ReturnType<typeof confirmImport>>;
    try { result = await confirmImport(session.importSessionId, chosen.map(rowInput)); }
    catch { setStatus('failed'); throw new Error('Import nieudany – brak połączenia z serwerem. Nic nie zapisano, podgląd został zachowany. Spróbuj ponownie.'); }
    if (result.kind === 'saved') {
      setStatus('');
      setSummary(result.summary ?? { added: result.saved, replaced: 0, skipped: 0, rejected: result.rejected });
      setSession(null); setRows([]); onImported();
    } else {
      setRetry(value => value + 1);
      setStatus('failed');
      if (result.kind === 'expired' || result.kind === 'closed') {
        setSession(null); setRows([]);
        throw new Error('Sesja wygasła lub została już zakończona. Wczytaj plik ponownie i sprawdź kalendarz.');
      }
      throw new Error(result.error === 'duplicate_decision_required'
        ? 'Kalendarz się zmienił. Sprawdź aktualne duplikaty i ponownie wybierz decyzje. Jedną serię można zastąpić tylko raz w imporcie.'
        : 'Nie potwierdzono zapisu. Sprawdź dane i połączenie. Podgląd został zachowany.');
    }
  });
  const validPreview = chosen.length > 0 && preview.length === chosen.length && preview.every(item => item.status === 'ok');
  const undecided = preview.some(item => (item.duplicateOfEvents.length || item.duplicateOfRows.length) && !rows.find(row => row.id === item.id)?.duplicateDecision);

  return <Modal visible={visible} transparent animationType="fade" onRequestClose={() => { if (!busy) void close(); }}>
    <View style={{ flex: 1, backgroundColor: palette.scrim, alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <ScrollView style={{ backgroundColor: palette.surface, borderRadius: 18, width: '100%', maxWidth: 760, maxHeight: '92%' }} contentContainerStyle={{ padding: 20 }}>
        <Text style={styles.heading}>Importuj plan zajęć</Text>
        <Text style={styles.subtitle}>Plik ICS (np. eksport z USOS, Google Calendar, Outlooka), PDF planu WAT z tekstem (do 10 stron) lub zrzut ekranu Miniatura WAT w PNG/JPG. Maks. 5 MB. Odczyt zdjęcia (OCR) może potrwać do minuty.</Text>
        {!!fileName && <Text style={styles.body}>{fileName}</Text>}
        {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
        {busy && <Text accessibilityLiveRegion="polite" style={styles.body}>Przetwarzanie…</Text>}
        {summary && <Text accessibilityLiveRegion="polite" style={styles.body}>Import zakończony. Zaimportowano: {summary.added + summary.replaced} (dodano: {summary.added} · zastąpiono: {summary.replaced}) · Pominięto duplikaty: {summary.skipped} · Niewybrane: {summary.rejected}</Text>}
        {status === 'cancelled' && <Text accessibilityLiveRegion="polite" style={styles.body}>Import anulowany. Kalendarz pozostał bez zmian.</Text>}
        {status === 'failed' && !error && <Text accessibilityRole="alert" style={styles.error}>Import nieudany. Nic nie zapisano – popraw dane i zatwierdź ponownie.</Text>}
        {!session && <Button title="Wybierz plik (ICS, PDF lub zdjęcie)" primary disabled={busy} onPress={() => void choose()} />}
        {session && <>
          {session.warnings.map((warning, index) => <Text key={index} style={styles.muted}>{warning}</Text>)}
          {session.source === 'ics' ? <>
            <Text style={styles.body}>{session.calendarName ?? 'Plik ICS'} · {session.dateFrom} – {session.dateTo}</Text>
            <Text style={styles.muted}>Wydarzenia w pliku: {session.eventCount ?? rows.length} · wystąpienia do importu: {rows.length}{session.skipped?.count
              ? ` · pominięte: ${session.skipped.count} (${Object.entries(session.skipped.reasons).map(([reason, count]) => `${skipText[reason] ?? reason}: ${count}`).join(', ')})` : ''}</Text>
          </> : <Text style={styles.body}>Rok {session.academicYear} · {session.dateFrom} – {session.dateTo}</Text>}
          {Object.keys(session.collisions ?? {}).length > 0 && <Text style={styles.muted}>Część zajęć koliduje z wydarzeniami w kalendarzu – są oznaczone poniżej. Możesz je zaimportować mimo to albo odznaczyć.</Text>}
          <Text style={styles.muted}>Wybrano {chosen.length} z {rows.length} zajęć. Zapisujemy konkretne daty z planu. Sprawdź dane przed zatwierdzeniem. Niepewne wiersze wybierz dopiero po sprawdzeniu.</Text>
          <Text style={styles.muted}>Duplikat oznacza ten sam tytuł (bez różnic w wielkości liter i odstępach) oraz początek. Koniec może się różnić — „Zastąp” pozwala poprawić czas trwania.</Text>
          {checking && <Text accessibilityLiveRegion="polite" style={styles.muted}>Sprawdzanie danych…</Text>}
          {!!error && <Button title="Ponów sprawdzenie" disabled={busy} onPress={() => { setError(''); setChecking(true); setRetry(value => value + 1); }} />}
          <View pointerEvents={busy ? 'none' : 'auto'}>
            {rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map(row => {
              const item = preview.find(item => item.id === row.id);
              const bad = invalidFields(row, item?.status === 'error' ? item.issues : []);
              const collisions = session.collisions?.[row.id] ?? [];
              const targets = [...(item?.duplicateOfEvents ?? []).map(event => ({ id: event.id, label: `${event.title} · ${stamp(event.start)}${event.repeatWeekly ? " · seria cotygodniowa — zastąpienie zmieni całą serię" : ""}` })),
                ...(item?.duplicateOfRows ?? []).map(id => ({ id: `row:${id}`, label: `Wiersz ${rows.findIndex(other => other.id === id) + 1} tego importu` }))];
              return <View key={row.id} style={{ borderTopWidth: 1, borderColor: palette.line, paddingVertical: 12 }}>
                <Button title={`${selected.has(row.id) ? '☑' : '☐'} Zajęcia ${rows.indexOf(row) + 1}${session.source === 'ics' ? '' : ` · strona ${row.sourcePage}`}`} disabled={busy} onPress={() => toggle(row.id)} />
                {row.reviewRequired && <Text style={styles.error}>Odczyt niepewny — sprawdź i uzupełnij dane.</Text>}
                {item?.status === 'error' && <Text style={styles.error}>Popraw zaznaczone pola: {item.issues.map(issue => issueText[issue]).join(', ')}.</Text>}
                {!!row.repeat && <Text style={styles.muted}>Powtarzanie w pliku: {row.repeat}</Text>}
                {collisions.length > 0 && <Text style={[styles.muted, { color: palette.amber }]}>KOLIZJA z: {collisions.map(other => `${other.title}${other.mandatory ? ' (obowiązkowe)' : ''} ${shortStamp(other.start)}–${shortStamp(other.end).slice(-5)}`).join('; ')}</Text>}
                <Field label="PRZEDMIOT" value={row.title} maxLength={200} editable={!busy} invalid={bad.title} onChangeText={title => update(row.id, { title })} />
                <DateField label="DATA" value={row.date} invalid={bad.date} onChange={date => update(row.id, { date, endDate: undefined })} />
                <View style={styles.row}>
                  <TimeField label="POCZĄTEK" value={row.startTime} invalid={bad.start} onChange={startTime => update(row.id, { startTime })} />
                  <TimeField label="KONIEC" value={row.endTime} invalid={bad.end} onChange={endTime => update(row.id, { endTime })} />
                </View>
                <Field label="MIEJSCE" value={row.location ?? ''} maxLength={200} editable={!busy} onChangeText={location => update(row.id, { location })} />
                {targets.length > 0 && <>
                  <Text style={styles.body}>Wykryto duplikat:</Text>
                  {targets.map(target => <Text key={target.id} style={styles.muted}>{target.label}</Text>)}
                  <View style={[styles.row, { flexWrap: 'wrap' }]}>
                    {(['skip', 'replace', 'keepBoth'] as DuplicateDecision[]).map(decision => <Button key={decision}
                      title={{ skip: 'Pomiń', replace: 'Zastąp', keepBoth: 'Zachowaj oba' }[decision]}
                      primary={row.duplicateDecision === decision} disabled={busy}
                      onPress={() => update(row.id, { duplicateDecision: decision, replacementId: decision === 'replace' && targets.length === 1 ? targets[0]?.id : undefined })} />)}
                  </View>
                  {row.duplicateDecision === 'replace' && targets.length > 1 && targets.map(target => <Button key={target.id}
                    title={`Zastąp: ${target.label}`} primary={row.replacementId === target.id} disabled={busy}
                    onPress={() => update(row.id, { duplicateDecision: 'replace', replacementId: target.id })} />)}
                </>}
              </View>;
            })}
          </View>
          <View style={[styles.row, { flexWrap: 'wrap' }]}>
            <Button title="Poprzednie" disabled={busy || page === 0} onPress={() => setPage(page - 1)} />
            <Text style={styles.body}>{page + 1} / {Math.ceil(rows.length / PAGE_SIZE)}</Text>
            <Button title="Następne" disabled={busy || (page + 1) * PAGE_SIZE >= rows.length} onPress={() => setPage(page + 1)} />
          </View>
          <Button title={`Zatwierdź import (${chosen.length})`} primary disabled={busy || checking || !validPreview || undecided} onPress={() => void save()} />
        </>}
        {session ? <Button title="Anuluj import" disabled={busy} onPress={() => void cancel()} />
          : <Button title="Zamknij" disabled={busy} onPress={() => void close()} />}
      </ScrollView>
    </View>
  </Modal>;
}
