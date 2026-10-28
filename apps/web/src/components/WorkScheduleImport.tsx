// Import grafiku pracy ze zdjęcia lub pliku (historyjka S23KC2S1P2-44)
// z kontrolą rozpoznanych danych przed zapisem (historyjka S23KC2S1P2-32).
//
// Przebieg: wybór pliku → API sprawdza plik i odczytuje zmiany → podgląd z poprawkami →
// wybór własnych zmian, potwierdzenie zmian nocnych i decyzje dla duplikatów → zapis → podsumowanie.
// Okno otwiera przycisk „Importuj” w zakładce Tydzień.

import React, { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { Button, Field, useTheme } from './ui';
import DateField from './DateField';
import TimeField from './TimeField';
import {
  cancelImport,
  confirmImport,
  previewImport,
  readWorkSchedule,
  type DuplicateDecision,
  type ImportIssue,
  type ImportPreviewRow,
  type ImportRowInput,
  type ImportSummary,
  type ScheduleRow,
} from '../services/importApi';
import { pickPdf } from '../services/pickPdf';
import { takePhoto } from '../services/takePhoto';

type Props = { visible: boolean; onClose: () => void; onImported: () => void };

/** Poniżej tej pewności odczytu wiersz jest dodatkowo oznaczony do sprawdzenia (historyjka 32). */
const LOW_CONFIDENCE = 0.7;

const fileErrorText: Record<string, string> = {
  'unsupported-format': 'Nieobsługiwany format pliku. Wybierz zdjęcie JPG/PNG albo plik PDF.',
  'corrupted-file': 'Plik jest uszkodzony lub niekompletny. Wybierz inny plik.',
  'empty-file': 'Wybrany plik jest pusty. Wybierz inny plik.',
  'file-too-large': 'Plik jest za duży (maks. 5 MB). Wybierz mniejszy plik albo zrób zdjęcie w niższej rozdzielczości.',
  nothing_recognized: 'Nie odczytano żadnej zmiany. Wybierz czytelniejsze zdjęcie lub inny plik.',
  'unreadable-image': 'Nie udało się odczytać zdjęcia. Zrób wyraźniejsze zdjęcie (prosto, bez cienia) albo wybierz plik PNG/JPG.',
  'unreadable-pdf': 'Nie udało się odczytać pliku PDF. Plik może być uszkodzony – wybierz inny plik.',
  'encrypted-pdf': 'PDF zabezpieczony hasłem nie jest obsługiwany. Wybierz plik bez hasła albo zrób zdjęcie grafiku.',
  'scanned-pdf': 'Ten PDF to skan bez tekstu. Zrób zdjęcie lub zrzut ekranu grafiku i wybierz plik JPG/PNG.',
  'read-timeout': 'Odczyt trwał zbyt długo. Spróbuj z mniejszym lub wyraźniejszym zdjęciem.',
  'reader-busy': 'Serwer odczytuje teraz inny plik. Spróbuj ponownie za chwilę.',
};

const issueText: Record<ImportIssue, string> = {
  'missing-title': 'brak tytułu',
  'invalid-date': 'brak lub błędna data',
  'invalid-time': 'brak lub błędna godzina',
  'end-not-after-start': 'koniec musi następować po początku',
};

const decisionText: Record<DuplicateDecision, { label: string; effect: string }> = {
  skip: { label: 'Pomiń', effect: 'istniejące wydarzenie zostaje, kopia nie zostanie dodana' },
  replace: { label: 'Zastąp', effect: 'istniejące wydarzenie dostanie dane z grafiku' },
  keepBoth: { label: 'Zachowaj oba', effect: 'zmiana zostanie dodana jako osobne wydarzenie' },
};

const formatInstant = (iso: string) =>
  new Date(iso).toLocaleString('pl-PL', { timeZone: 'Europe/Warsaw', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

type PickedFile = { name: string; size: number; base64: string };
type Session = { id: string; readStatusLabel: string; readerIsDemo: boolean; userName: string };
type Phase = 'idle' | 'reading' | 'preview' | 'saving' | 'saveFailed';

export default function WorkScheduleImport({ visible, onClose, onImported }: Props) {
  const { palette, styles } = useTheme();
  const [file, setFile] = useState<PickedFile | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [session, setSession] = useState<Session | null>(null);
  const [rows, setRows] = useState<ScheduleRow[]>([]);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [overnightOk, setOvernightOk] = useState<Record<string, boolean>>({});
  const [decisions, setDecisions] = useState<Record<string, DuplicateDecision>>({});
  const [replacementIds, setReplacementIds] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<Record<string, ImportPreviewRow>>({});
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [summary, setSummary] = useState<ImportSummary | null>(null);

  const reset = () => {
    setPhase('idle'); setSession(null); setRows([]); setSelected({}); setOvernightOk({}); setDecisions({}); setReplacementIds({}); setPreview({});
  };

  const toInput = (row: ScheduleRow): ImportRowInput => ({
    id: row.id, title: row.title, date: row.date, startTime: row.startTime, endTime: row.endTime,
    category: 'Work', location: row.location, confidence: row.confidence, employee: row.employee,
  });

  // Po każdej poprawce ponownie sprawdzamy wiersze w API (z opóźnieniem, żeby nie wysyłać przy każdej zmianie).
  useEffect(() => {
    if (!session || rows.length === 0) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      previewImport(rows.map(toInput), session.id, controller.signal)
        .then((result) => setPreview(Object.fromEntries(result.map((item) => [item.id, item]))))
        .catch(() => undefined);
    }, 400);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [rows, session]);

  // Plik z galerii/dysku albo zdjęcie prosto z aparatu. Oba sposoby sprawdzają rozmiar (maks. 5 MB) i zgłaszają błąd z gotowym komunikatem.
  const chooseFile = async (source: 'file' | 'camera' = 'file') => {
    setError(''); setNotice(''); setSummary(null);
    try {
      // Wybór pliku jest wspólny z importem planu zajęć: przeglądarka (także na telefonie) oraz aplikacja na Androidzie/iOS.
      const picked: PickedFile | null = source === 'camera' ? await takePhoto() : await pickPdf();
      if (!picked) return;
      setFile(picked);
    } catch (pickError) {
      setError(pickError instanceof Error ? pickError.message : 'Nie udało się wybrać pliku.');
    }
  };

  const startImport = async () => {
    if (!file) return;
    setError(''); setNotice(''); setSummary(null); setPhase('reading');
    try {
      const result = await readWorkSchedule(file.name, file.base64);
      if (result.kind === 'rejected') { reset(); setError(fileErrorText[result.error] ?? `Nie udało się odczytać pliku (${result.error}).`); return; }
      if (result.kind === 'unavailable') { reset(); setError('Nie udało się połączyć z kalendarzem. Sprawdź połączenie i spróbuj ponownie.'); return; }
      setSession({ id: result.importSessionId, readStatusLabel: result.readStatusLabel, readerIsDemo: result.readerIsDemo, userName: result.userName });
      setRows(result.rows);
      // Domyślnie zaznaczamy tylko zmiany użytkownika – zmiany innych pracowników trzeba wybrać świadomie.
      setSelected(Object.fromEntries(result.rows.map((row) => [row.id, row.isOwn])));
      setPreview(Object.fromEntries(result.preview.map((item) => [item.id, item])));
      setPhase('preview');
    } catch {
      reset(); setError('Nie udało się połączyć z kalendarzem. Plik nie został odczytany, spróbuj ponownie.');
    }
  };

  const update = (id: string, key: 'title' | 'date' | 'startTime' | 'endTime' | 'location', value: string) =>
    setRows((current) => current.map((row) => (row.id === id ? { ...row, [key]: value } : row)));

  const label = (id: string) => `zmiana ${rows.findIndex((row) => row.id === id) + 1}`;
  const chosen = rows.filter((row) => selected[row.id]);

  // Te same warunki sprawdza serwer – tutaj tylko po to, żeby od razu powiedzieć użytkownikowi, co poprawić (6a).
  const blockers = () => {
    const problems: string[] = [];
    const invalid = chosen.filter((row) => preview[row.id]?.status === 'error');
    if (invalid.length) problems.push(`popraw albo odznacz: ${invalid.map((row) => label(row.id)).join(', ')}`);
    const night = chosen.filter((row) => preview[row.id]?.overnight && !overnightOk[row.id]);
    if (night.length) problems.push(`potwierdź zmiany nocne: ${night.map((row) => label(row.id)).join(', ')}`);
    const undecided = chosen.filter((row) => {
      const item = preview[row.id];
      return item && (item.duplicateOfEvents.length > 0 || item.duplicateOfRows.length > 0) && !decisions[row.id];
    });
    if (undecided.length) problems.push(`wybierz, co zrobić z duplikatami: ${undecided.map((row) => label(row.id)).join(', ')}`);
    return problems;
  };

  const save = async () => {
    if (!session) return;
    const problems = blockers();
    if (problems.length) { setError(`Nie zapisano importu – ${problems.join('; ')}.`); return; }
    setError(''); setPhase('saving');
    try {
      const result = await confirmImport(
        session.id,
        chosen.map((row) => ({ ...toInput(row), overnightConfirmed: overnightOk[row.id] || undefined, duplicateDecision: decisions[row.id], replacementId: replacementIds[row.id] })),
      );
      if (result.kind === 'saved') {
        setSummary(result.summary ?? { added: result.saved, replaced: 0, skipped: 0, rejected: result.rejected });
        setNotice('Zakończono. Kalendarz został zaktualizowany.');
        reset(); setFile(null);
        onImported();
        return;
      }
      if (result.kind === 'failed') { setPhase('saveFailed'); return; }
      setPhase('preview');
      if (result.kind === 'expired') { reset(); setError('Sesja importu wygasła po 15 minutach bez akcji. Nic nie zostało zapisane – wczytaj grafik ponownie.'); }
      else if (result.kind === 'closed') { reset(); setError('Ten import został już zakończony.'); }
      else setError('Serwer odrzucił import, bo część zmian wymaga poprawy lub decyzji. Nic nie zostało zapisane.');
    } catch {
      setPhase('saveFailed');
    }
  };

  const cancel = async () => {
    if (session) await cancelImport(session.id).catch(() => undefined);
    reset(); setError(''); setSummary(null);
    setNotice('Anulowano. Kalendarz pozostał bez zmian.');
  };

  const close = async () => {
    if (phase === 'saving') return;
    if (session) await cancelImport(session.id).catch(() => undefined);
    reset(); setFile(null); setError(''); setNotice(''); setSummary(null);
    onClose();
  };

  const pill = (text: string, color: string) => (
    <View style={{ alignSelf: 'flex-start', paddingHorizontal: 9, paddingVertical: 5, borderRadius: 99, backgroundColor: `${color}22` }}>
      <Text style={{ fontSize: 10, color, fontWeight: '800', letterSpacing: 0.5 }}>{text}</Text>
    </View>
  );

  const choice = (text: string, active: boolean, onPress: () => void, key?: string) => (
    <Pressable key={key ?? text} accessibilityRole="button" accessibilityState={{ selected: active }} onPress={onPress}
      style={{ paddingHorizontal: 10, paddingVertical: 7, borderRadius: 8, borderWidth: 1, borderColor: active ? palette.blue : palette.line, backgroundColor: active ? palette.blueSoft : 'transparent' }}>
      <Text style={{ fontSize: 12, fontWeight: '700', color: active ? palette.blue : palette.ink }}>{text}</Text>
    </Pressable>
  );

  const renderRow = (row: ScheduleRow) => {
    const item = preview[row.id];
    const isSelected = Boolean(selected[row.id]);
    const duplicateEvents = item?.duplicateOfEvents ?? [];
    const duplicateRows = item?.duplicateOfRows ?? [];
    const hasDuplicate = duplicateEvents.length > 0 || duplicateRows.length > 0;
    const allowed: DuplicateDecision[] = ['skip', 'replace', 'keepBoth'];
    const targets = [...duplicateEvents.map(event => ({ id: event.id, label: `${event.title}, ${formatInstant(event.start)}${event.repeatWeekly ? ' — cała seria cotygodniowa' : ''}` })),
      ...duplicateRows.map(id => ({ id: `row:${id}`, label: label(id) }))];
    const decision = decisions[row.id];
    return (
      <View key={row.id} style={{ marginTop: 14, borderTopWidth: 1, borderColor: palette.line, paddingTop: 13, opacity: isSelected ? 1 : 0.6 }}>
        <View style={[styles.row, { flexWrap: 'wrap' }]}>
          {choice(isSelected ? '☑ Importuj' : '☐ Pomiń', isSelected, () => setSelected((current) => ({ ...current, [row.id]: !current[row.id] })), 'select')}
          <Text style={{ fontWeight: '800', color: palette.ink }}>{label(row.id)} · {row.employee ?? 'bez nazwiska'}{row.isOwn ? ' (Ty)' : ''}</Text>
          {!row.isOwn && pill('INNY PRACOWNIK', palette.muted)}
          {row.confidence !== undefined && <Text style={styles.muted}>Pewność odczytu: {Math.round(row.confidence * 100)}%</Text>}
          {row.confidence !== undefined && row.confidence < LOW_CONFIDENCE && pill('SPRAWDŹ ODCZYT', palette.amber)}
        </View>

        {item?.status === 'error' && (
          <View style={[styles.row, { flexWrap: 'wrap', marginTop: 6 }]}>
            {pill(row.incomplete ? 'DANE NIEPEŁNE' : 'DANE WYMAGAJĄ POPRAWY', palette.red)}
            <Text style={styles.muted}>{item.issues.map((issue) => issueText[issue]).join(', ')} – uzupełnij albo pomiń tę zmianę</Text>
          </View>
        )}
        {item?.status === 'ok' && !item.overnight && !hasDuplicate && <View style={{ marginTop: 6 }}>{pill('DANE POPRAWNE', palette.green)}</View>}

        {item?.overnight && item.end && (
          <View style={[styles.row, { flexWrap: 'wrap', marginTop: 6 }]}>
            {pill('ZMIANA NOCNA', palette.blue)}
            {choice(`${overnightOk[row.id] ? '☑' : '☐'} Potwierdzam koniec: ${formatInstant(item.end)}`, Boolean(overnightOk[row.id]), () =>
              setOvernightOk((current) => ({ ...current, [row.id]: !current[row.id] })), 'night')}
          </View>
        )}

        {hasDuplicate && (
          <View style={{ marginTop: 6 }}>
            <View style={[styles.row, { flexWrap: 'wrap' }]}>
              {pill(duplicateEvents.length > 0 ? 'WYKRYTO DUPLIKAT' : 'POWTÓRZONE W IMPORCIE', palette.amber)}
              <Text style={styles.muted}>
                {duplicateEvents[0] ? `W kalendarzu jest już: ${duplicateEvents[0].title}, ${formatInstant(duplicateEvents[0].start)}` : `Taka sama zmiana jak ${duplicateRows.map(label).join(', ')}`}
              </Text>
            </View>
            <View style={[styles.row, { flexWrap: 'wrap', marginTop: 6 }]}>
              {allowed.map((option) => choice(decisionText[option].label, decision === option, () => setDecisions((current) => ({ ...current, [row.id]: option })), option))}
            </View>
            {decision === 'replace' && targets.length > 1 && targets.map(target => choice(`Zastąp: ${target.label}`, replacementIds[row.id] === target.id, () => setReplacementIds(current => ({ ...current, [row.id]: target.id })), target.id))}
            {duplicateEvents.some(event => event.repeatWeekly) && <Text style={styles.muted}>Zastąpienie zmienia całą serię cotygodniową. Jedną serię można zastąpić tylko raz w imporcie.</Text>}
            {decision && <Text style={[styles.muted, { marginTop: 4 }]}>{decisionText[decision].label}: {decisionText[decision].effect}.</Text>}
          </View>
        )}

        <View style={{ marginTop: 8 }}>
          <DateField label="DATA" value={row.date} onChange={(value) => update(row.id, 'date', value)} />
          <View style={styles.row}>
            <TimeField label="POCZĄTEK" value={row.startTime} onChange={(value) => update(row.id, 'startTime', value)} />
            <TimeField label="KONIEC" value={row.endTime} onChange={(value) => update(row.id, 'endTime', value)} />
          </View>
          <Field label="TYTUŁ" value={row.title} onChangeText={(value) => update(row.id, 'title', value)} />
          <Field label="MIEJSCE" value={row.location ?? ''} onChangeText={(value) => update(row.id, 'location', value)} />
        </View>
      </View>
    );
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={() => void close()}>
      <View style={{ flex: 1, backgroundColor: palette.scrim, alignItems: 'center', justifyContent: 'center', padding: 16 }}>
        <ScrollView style={{ backgroundColor: palette.surface, borderRadius: 18, width: '100%', maxWidth: 640, maxHeight: '92%' }} contentContainerStyle={{ padding: 21 }}>
          <View style={[styles.row, { justifyContent: 'space-between' }]}>
            <Text style={[styles.heading, { flex: 1 }]}>Importuj grafik pracy</Text>
            <Button title="Zamknij" accessibilityLabel="Zamknij import" disabled={phase === 'saving'} onPress={() => void close()} />
          </View>
          <Text style={styles.subtitle}>Zdjęcie JPG/PNG albo plik PDF, maks. 5 MB. Na telefonie możesz od razu zrobić zdjęcie grafiku.</Text>
          <Text style={[styles.muted, { marginTop: 6 }]}>Najlepiej odczytywany jest grafik w formie listy lub tabeli: data, imię i nazwisko, godziny (np. 16:00-20:00). Zdjęcie rób prosto i bez cieni. Każdą odczytaną zmianę sprawdzisz przed zapisem.</Text>

          {phase === 'idle' && (
            <View style={[styles.row, { flexWrap: 'wrap', marginTop: 14 }]}>
              <Button title="Zrób zdjęcie" onPress={() => void chooseFile('camera')} />
              <Button title={file ? 'Zmień plik' : 'Wybierz zdjęcie lub plik'} onPress={() => void chooseFile('file')} />
              {file && <Text style={styles.body}>{file.name} · {(file.size / 1024).toFixed(0)} KB</Text>}
              {file && <Button title="Wczytaj grafik" primary onPress={() => void startImport()} />}
            </View>
          )}
          {phase === 'reading' && <Text accessibilityLiveRegion="polite" style={[styles.body, { marginTop: 14 }]}>Sprawdzanie pliku i odczyt grafiku…</Text>}

          {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
          {!!notice && <Text style={[styles.body, { marginTop: 11 }]}>{notice}</Text>}

          {summary && (
            <View style={[styles.row, { flexWrap: 'wrap', marginTop: 10 }]}>
              {pill('ZAKOŃCZONO', palette.green)}
              <Text style={styles.body}>Dodano: {summary.added} · Zastąpiono: {summary.replaced} · Pominięto (duplikaty): {summary.skipped} · Nie wybrano: {summary.rejected}</Text>
            </View>
          )}

          {session && phase !== 'idle' && phase !== 'reading' && (
            <View style={{ marginTop: 14 }}>
              <View style={[styles.row, { flexWrap: 'wrap' }]}>
                {pill(session.readStatusLabel.toUpperCase(), session.readStatusLabel === 'Odczytano wszystkie zmiany' ? palette.green : palette.amber)}
                <Text style={styles.muted}>Zaznaczono {chosen.length} z {rows.length} zmian · Twoje zmiany ({session.userName || 'użytkownik'}) są zaznaczone domyślnie.</Text>
              </View>
              {session.readerIsDemo && (
                <View style={[styles.row, { flexWrap: 'wrap', marginTop: 8 }]}>
                  {pill('ODCZYT DEMONSTRACYJNY', palette.muted)}
                  <Text style={styles.muted}>Serwer działa w trybie demonstracyjnym (WORK_SCHEDULE_READER=demo): plik został sprawdzony, ale poniżej jest przykładowy grafik zamiast treści pliku.</Text>
                </View>
              )}

              {rows.map(renderRow)}

              {phase === 'saveFailed' ? (
                <View style={{ marginTop: 14 }}>
                  <Text accessibilityRole="alert" style={styles.error}>Nie zapisano z powodu błędu. Kalendarz pozostał bez zmian, podgląd jest zachowany.</Text>
                  <View style={[styles.row, { justifyContent: 'flex-end', flexWrap: 'wrap', marginTop: 8 }]}>
                    <Button title="Anuluj" onPress={() => void cancel()} />
                    <Button title="Ponów zapis" primary onPress={() => void save()} />
                  </View>
                </View>
              ) : (
                <View style={[styles.row, { justifyContent: 'flex-end', flexWrap: 'wrap', marginTop: 14 }]}>
                  <Button title="Anuluj import" disabled={phase === 'saving'} onPress={() => void cancel()} />
                  <Button title={phase === 'saving' ? 'Zapisywanie…' : `Zatwierdź import (${chosen.length})`} primary onPress={() => void save()} disabled={chosen.length === 0 || phase === 'saving'} />
                </View>
              )}
            </View>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}
