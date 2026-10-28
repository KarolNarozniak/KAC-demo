import React, { useEffect, useRef, useState } from 'react';
import { Modal, ScrollView, Text, View } from 'react-native';
import { Button, Field, useTheme } from './ui';
import DateField from './DateField';
import TimeField from './TimeField';
import { pickPdf } from '../services/pickPdf';
import { cancelImport, confirmImport, previewImport, readClassSchedule,
  type ClassReadResult, type ClassRow, type DuplicateDecision, type ImportPreviewRow, type ImportRowInput, type ImportSummary } from '../services/importApi';

const PAGE_SIZE = 10;
const stamp = (iso: string) => new Date(iso).toLocaleString('pl-PL', { timeZone: 'Europe/Warsaw' });
const rowInput = (row: ClassRow): ImportRowInput => ({ id: row.id, title: row.title, date: row.date,
  startTime: row.startTime, endTime: row.endTime, category: 'Class', location: row.location,
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
    const result = await readClassSchedule(file.name, file.base64);
    setFileName(file.name); setSummary(null); setSession(result); setRows(result.rows);
    setSelected(new Set(result.rows.filter(row => !row.reviewRequired).map(row => row.id)));
    setPreview(result.preview); setPage(0);
  });
  const close = () => run(async () => {
    if (session) await cancelImport(session.importSessionId);
    setSession(null); setRows([]); setPreview([]); setSummary(null); setFileName(''); onClose();
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
    const result = await confirmImport(session.importSessionId, chosen.map(rowInput));
    if (result.kind === 'saved') {
      setSummary(result.summary ?? { added: result.saved, replaced: 0, skipped: 0, rejected: result.rejected });
      setSession(null); setRows([]); onImported();
    } else {
      setRetry(value => value + 1);
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
        <Text style={styles.heading}>Importuj plan zajęć WAT</Text>
        <Text style={styles.subtitle}>PDF z tekstem (do 10 stron) lub zrzut ekranu Miniatura WAT w PNG/JPG (do 20 megapikseli). Maks. 5 MB. OCR działa lokalnie na serwerze i może potrwać do minuty.</Text>
        {!!fileName && <Text style={styles.body}>{fileName}</Text>}
        {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
        {busy && <Text accessibilityLiveRegion="polite" style={styles.body}>Przetwarzanie…</Text>}
        {summary && <Text accessibilityLiveRegion="polite" style={styles.body}>Import zakończony. Dodano: {summary.added} · Zastąpiono: {summary.replaced} · Pominięto: {summary.skipped} · Niewybrane: {summary.rejected}</Text>}
        {!session && <Button title="Wybierz PDF lub obraz" primary disabled={busy} onPress={() => void choose()} />}
        {session && <>
          {session.warnings.map((warning, index) => <Text key={index} style={styles.muted}>{warning}</Text>)}
          <Text style={styles.body}>Rok {session.academicYear} · {session.dateFrom} – {session.dateTo}</Text>
          <Text style={styles.muted}>Wybrano {chosen.length} z {rows.length} zajęć. Zapisujemy konkretne daty z planu. Sprawdź dane przed zatwierdzeniem. Niepewne wiersze wybierz dopiero po sprawdzeniu.</Text>
          <Text style={styles.muted}>Duplikat oznacza ten sam tytuł (bez różnic w wielkości liter i odstępach) oraz początek. Koniec może się różnić — „Zastąp” pozwala poprawić czas trwania.</Text>
          {checking && <Text accessibilityLiveRegion="polite" style={styles.muted}>Sprawdzanie danych…</Text>}
          {!!error && <Button title="Ponów sprawdzenie" disabled={busy} onPress={() => { setError(''); setChecking(true); setRetry(value => value + 1); }} />}
          <View pointerEvents={busy ? 'none' : 'auto'}>
            {rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map(row => {
              const item = preview.find(item => item.id === row.id);
              const targets = [...(item?.duplicateOfEvents ?? []).map(event => ({ id: event.id, label: `${event.title} · ${stamp(event.start)}${event.repeatWeekly ? " · seria cotygodniowa — zastąpienie zmieni całą serię" : ""}` })),
                ...(item?.duplicateOfRows ?? []).map(id => ({ id: `row:${id}`, label: `Wiersz ${rows.findIndex(other => other.id === id) + 1} tego importu` }))];
              return <View key={row.id} style={{ borderTopWidth: 1, borderColor: palette.line, paddingVertical: 12 }}>
                <Button title={`${selected.has(row.id) ? '☑' : '☐'} Zajęcia ${rows.indexOf(row) + 1} · strona ${row.sourcePage}`} disabled={busy} onPress={() => toggle(row.id)} />
                {row.reviewRequired && <Text style={styles.error}>Odczyt niepewny — sprawdź i uzupełnij dane.</Text>}
                {item?.status === 'error' && <Text style={styles.error}>Sprawdź tytuł, datę i godziny. Koniec musi być późniejszy od początku.</Text>}
                <Field label="PRZEDMIOT" value={row.title} maxLength={200} editable={!busy} onChangeText={title => update(row.id, { title })} />
                <DateField label="DATA" value={row.date} onChange={date => update(row.id, { date })} />
                <View style={styles.row}>
                  <TimeField label="POCZĄTEK" value={row.startTime} onChange={startTime => update(row.id, { startTime })} />
                  <TimeField label="KONIEC" value={row.endTime} onChange={endTime => update(row.id, { endTime })} />
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
        <Button title={session ? 'Anuluj import' : 'Zamknij'} disabled={busy} onPress={() => void close()} />
      </ScrollView>
    </View>
  </Modal>;
}
