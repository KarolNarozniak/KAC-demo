// Import grafiku pracy ze zdjęcia lub pliku (historyjka S23KC2S1P2-44).
//
// Przebieg: wybór pliku → API sprawdza plik i odczytuje zmiany → podgląd z poprawkami →
// wybór własnych zmian, potwierdzenie zmian nocnych i decyzje dla duplikatów → zapis → podsumowanie.
// Podgląd, sesja i zapis korzystają z mechanizmu z historyjki S23KC2S1P2-32.

import React, { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import type { CalendarEvent } from '../domain/model';
import { Button, Card, Field, Pill, useTheme } from './ui';
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
} from '../services/demoApi';

type Props = { setEvents: (value: CalendarEvent[] | ((current: CalendarEvent[]) => CalendarEvent[])) => void };

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const ACCEPTED_TYPES = 'image/jpeg,image/png,application/pdf,.jpg,.jpeg,.png,.pdf';

const fileErrorText: Record<string, string> = {
  'unsupported-format': 'Nieobsługiwany format pliku. Wybierz zdjęcie JPG/PNG albo plik PDF.',
  'corrupted-file': 'Plik jest uszkodzony lub niekompletny. Wybierz inny plik.',
  'empty-file': 'Wybrany plik jest pusty. Wybierz inny plik.',
  'file-too-large': 'Plik jest za duży (maks. 5 MB). Wybierz mniejszy plik albo zrób zdjęcie w niższej rozdzielczości.',
  nothing_recognized: 'Nie odczytano żadnej zmiany. Wybierz czytelniejsze zdjęcie lub inny plik.',
};

const issueText: Record<ImportIssue, string> = {
  'missing-title': 'brak tytułu',
  'invalid-date': 'brak lub błędna data (RRRR-MM-DD)',
  'invalid-time': 'brak lub błędna godzina (GG:MM)',
  'end-not-after-start': 'koniec musi następować po początku',
};

const decisionText: Record<DuplicateDecision, { label: string; effect: string }> = {
  skip: { label: 'Pomiń', effect: 'istniejące wydarzenie zostaje, kopia nie zostanie dodana' },
  replace: { label: 'Zastąp', effect: 'istniejące wydarzenie dostanie dane z grafiku' },
  keepBoth: { label: 'Zachowaj oba', effect: 'zmiana zostanie dodana jako osobne wydarzenie' },
};

const formatInstant = (iso: string) =>
  new Date(iso).toLocaleString('pl-PL', { timeZone: 'Europe/Warsaw', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

// Zapis lokalny używany przez kalendarz w aplikacji, np. 2026-11-02T16:00.
const toLocalInput = (iso: string) =>
  new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Warsaw', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    .format(new Date(iso))
    .replace(' ', 'T');

type PickedFile = { name: string; size: number; base64: string };
type Session = { id: string; readStatusLabel: string; readerIsDemo: boolean; userName: string };
type Phase = 'idle' | 'reading' | 'preview' | 'saving' | 'saveFailed';

/** Otwiera systemowy wybór pliku. Na telefonie pozwala też od razu zrobić zdjęcie aparatem. */
function pickFileFromDevice(): Promise<PickedFile | null> {
  return new Promise((resolve, reject) => {
    if (typeof document === 'undefined') {
      reject(new Error('Wybór pliku jest dostępny w przeglądarce.'));
      return;
    }
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = ACCEPTED_TYPES;
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = String(reader.result ?? '');
        resolve({ name: file.name, size: file.size, base64: dataUrl.slice(dataUrl.indexOf(',') + 1) });
      };
      reader.onerror = () => reject(new Error('Nie udało się wczytać pliku z urządzenia.'));
      reader.readAsDataURL(file);
    };
    input.click();
  });
}

export default function WorkScheduleImport({ setEvents }: Props) {
  const { palette, styles } = useTheme();
  const [file, setFile] = useState<PickedFile | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [session, setSession] = useState<Session | null>(null);
  const [rows, setRows] = useState<ScheduleRow[]>([]);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [overnightOk, setOvernightOk] = useState<Record<string, boolean>>({});
  const [decisions, setDecisions] = useState<Record<string, DuplicateDecision>>({});
  const [preview, setPreview] = useState<Record<string, ImportPreviewRow>>({});
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [summary, setSummary] = useState<ImportSummary | null>(null);

  const reset = () => {
    setPhase('idle'); setSession(null); setRows([]); setSelected({}); setOvernightOk({}); setDecisions({}); setPreview({});
  };

  const toInput = (row: ScheduleRow): ImportRowInput => ({
    id: row.id, title: row.title, date: row.date, startTime: row.startTime, endTime: row.endTime,
    category: 'Work', location: row.location, confidence: row.confidence, employee: row.employee,
  });

  // Po każdej poprawce ponownie sprawdzamy wiersze w API (z opóźnieniem, żeby nie wysyłać przy każdym klawiszu).
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

  const chooseFile = async () => {
    setError(''); setNotice(''); setSummary(null);
    try {
      const picked = await pickFileFromDevice();
      if (!picked) return;
      if (picked.size > MAX_FILE_BYTES) { setFile(null); setError(fileErrorText['file-too-large'] ?? ''); return; }
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
      if (result.kind === 'unavailable') { reset(); setError('Import grafiku wymaga działającego API i bazy danych. Uruchom API i spróbuj ponownie.'); return; }
      setSession({ id: result.importSessionId, readStatusLabel: result.readStatusLabel, readerIsDemo: result.readerIsDemo, userName: result.userName });
      setRows(result.rows);
      // Domyślnie zaznaczamy tylko zmiany użytkownika – zmiany innych pracowników trzeba wybrać świadomie.
      setSelected(Object.fromEntries(result.rows.map((row) => [row.id, row.isOwn])));
      setPreview(Object.fromEntries(result.preview.map((item) => [item.id, item])));
      setPhase('preview');
    } catch {
      reset(); setError('Brak połączenia z API. Plik nie został odczytany, spróbuj ponownie.');
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
      return item && ((item.duplicateOfEvents?.length ?? 0) > 0 || (item.duplicateOfRows?.length ?? 0) > 0) && !decisions[row.id];
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
        chosen.map((row) => ({ ...toInput(row), overnightConfirmed: overnightOk[row.id] || undefined, duplicateDecision: decisions[row.id] })),
      );
      if (result.kind === 'saved') {
        setEvents((current) => {
          const next = [...current];
          for (const event of result.events) {
            const item: CalendarEvent = {
              id: event.id, title: event.title, start: toLocalInput(event.start), end: toLocalInput(event.end), category: 'Work',
              location: event.location ?? undefined, mandatory: false, repeatWeekly: false, source: 'import',
            };
            const index = next.findIndex((existing) => existing.id === event.id);
            if (index >= 0) next[index] = item; else next.push(item);
          }
          return next;
        });
        setSummary(result.summary ?? { added: result.saved, replaced: 0, skipped: 0, rejected: result.rejected });
        setNotice('Zakończono. Zaktualizowany kalendarz znajdziesz w zakładce Kalendarz.');
        reset(); setFile(null);
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

  const choice = (text: string, active: boolean, onPress: () => void, key?: string) => (
    <Pressable key={key ?? text} accessibilityRole="button" accessibilityState={{ selected: active }} onPress={onPress}
      style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: active ? palette.blue : palette.line, backgroundColor: active ? palette.blueSoft : 'transparent' }}>
      <Text style={{ fontSize: 12, fontWeight: '700', color: active ? palette.blue : palette.ink }}>{text}</Text>
    </Pressable>
  );

  const renderRow = (row: ScheduleRow) => {
    const item = preview[row.id];
    const isSelected = Boolean(selected[row.id]);
    const duplicateEvents = item?.duplicateOfEvents ?? [];
    const duplicateRows = item?.duplicateOfRows ?? [];
    const hasDuplicate = duplicateEvents.length > 0 || duplicateRows.length > 0;
    const allowed: DuplicateDecision[] = duplicateEvents.length > 0 ? ['skip', 'replace', 'keepBoth'] : ['skip', 'keepBoth'];
    const decision = decisions[row.id];
    return (
      <View key={row.id} style={{ marginTop: 14, borderTopWidth: 1, borderColor: palette.line, paddingTop: 13, opacity: isSelected ? 1 : 0.6 }}>
        <View style={[styles.row, { flexWrap: 'wrap' }]}>
          {choice(isSelected ? '☑ Importuj' : '☐ Pomiń', isSelected, () => setSelected((current) => ({ ...current, [row.id]: !current[row.id] })), 'select')}
          <Text style={{ fontWeight: '800', color: palette.ink }}>{label(row.id)} · {row.employee ?? 'bez nazwiska'}{row.isOwn ? ' (Ty)' : ''}</Text>
          {!row.isOwn && <Pill color={palette.muted}>INNY PRACOWNIK</Pill>}
          {row.confidence !== undefined && <Text style={styles.muted}>Pewność odczytu: {Math.round(row.confidence * 100)}%</Text>}
        </View>

        {item?.status === 'error' && (
          <View style={[styles.row, { flexWrap: 'wrap', marginTop: 6 }]}>
            <Pill color={palette.red}>{row.incomplete ? 'DANE NIEPEŁNE' : 'DANE WYMAGAJĄ POPRAWY'}</Pill>
            <Text style={styles.muted}>{item.issues.map((issue) => issueText[issue]).join(', ')} – uzupełnij albo pomiń tę zmianę</Text>
          </View>
        )}
        {item?.status === 'ok' && !item.overnight && !hasDuplicate && <View style={{ marginTop: 6 }}><Pill color={palette.green}>DANE POPRAWNE</Pill></View>}

        {item?.overnight && item.end && (
          <View style={[styles.row, { flexWrap: 'wrap', marginTop: 6 }]}>
            <Pill color={palette.blue}>ZMIANA NOCNA</Pill>
            {choice(`${overnightOk[row.id] ? '☑' : '☐'} Potwierdzam koniec: ${formatInstant(item.end)}`, Boolean(overnightOk[row.id]), () =>
              setOvernightOk((current) => ({ ...current, [row.id]: !current[row.id] })), 'night')}
          </View>
        )}

        {hasDuplicate && (
          <View style={{ marginTop: 6 }}>
            <View style={[styles.row, { flexWrap: 'wrap' }]}>
              <Pill color={palette.amber}>{duplicateEvents.length > 0 ? 'WYKRYTO DUPLIKAT' : 'POWTÓRZONE W IMPORCIE'}</Pill>
              <Text style={styles.muted}>
                {duplicateEvents[0] ? `W kalendarzu jest już: ${duplicateEvents[0].title}, ${formatInstant(duplicateEvents[0].start)}` : `Taka sama zmiana jak ${duplicateRows.map(label).join(', ')}`}
              </Text>
            </View>
            <View style={[styles.row, { flexWrap: 'wrap', marginTop: 6 }]}>
              {allowed.map((option) => choice(decisionText[option].label, decision === option, () => setDecisions((current) => ({ ...current, [row.id]: option })), option))}
            </View>
            {decision && <Text style={[styles.muted, { marginTop: 4 }]}>{decisionText[decision].label}: {decisionText[decision].effect}.</Text>}
          </View>
        )}

        <View style={[styles.row, { flexWrap: 'wrap', marginTop: 8 }]}>
          <Field label="DATA" value={row.date} placeholder="RRRR-MM-DD" onChangeText={(value) => update(row.id, 'date', value)} />
          <Field label="POCZĄTEK" value={row.startTime} placeholder="GG:MM" onChangeText={(value) => update(row.id, 'startTime', value)} />
          <Field label="KONIEC" value={row.endTime} placeholder="GG:MM" onChangeText={(value) => update(row.id, 'endTime', value)} />
        </View>
        <View style={[styles.row, { flexWrap: 'wrap' }]}>
          <Field label="TYTUŁ" value={row.title} onChangeText={(value) => update(row.id, 'title', value)} />
          <Field label="MIEJSCE" value={row.location ?? ''} onChangeText={(value) => update(row.id, 'location', value)} />
        </View>
      </View>
    );
  };

  return (
    <Card>
      <Text style={styles.heading}>Importuj grafik pracy ze zdjęcia lub pliku</Text>
      <Text style={styles.muted}>Obsługiwane: JPG/JPEG, PNG lub PDF, maks. 5 MB. Na telefonie możesz od razu zrobić zdjęcie grafiku.</Text>

      {phase === 'idle' && (
        <View style={[styles.row, { flexWrap: 'wrap', marginTop: 12 }]}>
          <Button title={file ? 'Zmień plik' : 'Wybierz zdjęcie lub plik'} onPress={chooseFile} />
          {file && <Text style={styles.body}>{file.name} · {(file.size / 1024).toFixed(0)} KB</Text>}
          {file && <Button title="Wczytaj grafik" primary onPress={startImport} />}
        </View>
      )}
      {phase === 'reading' && <Text style={[styles.body, { marginTop: 12 }]}>Sprawdzanie pliku i odczyt grafiku…</Text>}

      {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
      {!!notice && <Text style={[styles.body, { marginTop: 11 }]}>{notice}</Text>}

      {summary && (
        <View style={[styles.row, { flexWrap: 'wrap', marginTop: 10 }]}>
          <Pill color={palette.green}>ZAKOŃCZONO</Pill>
          <Text style={styles.body}>Dodano: {summary.added} · Zastąpiono: {summary.replaced} · Pominięto (duplikaty): {summary.skipped} · Nie wybrano: {summary.rejected}</Text>
        </View>
      )}

      {session && phase !== 'idle' && phase !== 'reading' && (
        <View style={{ marginTop: 14 }}>
          <View style={[styles.row, { flexWrap: 'wrap' }]}>
            <Pill color={session.readStatusLabel === 'Odczytano wszystkie zmiany' ? palette.green : palette.amber}>{session.readStatusLabel.toUpperCase()}</Pill>
            <Text style={styles.muted}>Zaznaczono {chosen.length} z {rows.length} zmian · Twoje zmiany ({session.userName || 'użytkownik'}) są zaznaczone domyślnie.</Text>
          </View>
          {session.readerIsDemo && (
            <View style={[styles.row, { flexWrap: 'wrap', marginTop: 8 }]}>
              <Pill color={palette.muted}>ODCZYT DEMONSTRACYJNY</Pill>
              <Text style={styles.muted}>Plik został sprawdzony, ale treść grafiku nie jest jeszcze odczytywana (sposób odczytu zdjęć i PDF czeka na decyzję zespołu). Poniżej przykładowy grafik.</Text>
            </View>
          )}

          {rows.map(renderRow)}

          {phase === 'saveFailed' ? (
            <View style={{ marginTop: 14 }}>
              <Text accessibilityRole="alert" style={styles.error}>Nie zapisano z powodu błędu. Kalendarz pozostał bez zmian, podgląd jest zachowany.</Text>
              <View style={[styles.row, { justifyContent: 'flex-end', flexWrap: 'wrap', marginTop: 8 }]}>
                <Button title="Anuluj" onPress={cancel} />
                <Button title="Ponów zapis" primary onPress={save} />
              </View>
            </View>
          ) : (
            <View style={[styles.row, { justifyContent: 'flex-end', flexWrap: 'wrap', marginTop: 14 }]}>
              <Button title="Anuluj import" onPress={cancel} />
              <Button title={phase === 'saving' ? 'Zapisywanie…' : `Zatwierdź import (${chosen.length})`} primary onPress={save} disabled={chosen.length === 0 || phase === 'saving'} />
            </View>
          )}
        </View>
      )}
    </Card>
  );
}
