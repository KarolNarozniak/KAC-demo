import React, { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Button, useTheme } from './ui';
import TimeField from './TimeField';
import { loadCalendar } from '../services/calendarApi';
import { addCalendarDays, occurrencesForRange, startOfWeek } from '../domain/calendar';
import {
  loadWorkPreferences, saveWorkPreferences, WorkPreferencesConflictError, WorkPreferencesError,
  type AvailabilityInterval, type PreferenceInterval,
} from '../services/workProfileApi';

const DAY_LABELS = [
  { id: 1, label: 'Pon' }, { id: 2, label: 'Wt' }, { id: 3, label: 'Śr' }, { id: 4, label: 'Czw' },
  { id: 5, label: 'Pt' }, { id: 6, label: 'Sob' }, { id: 7, label: 'Nd' },
] as const;
const WEIGHT_OPTIONS = [{ label: 'Niska', value: 0.5 }, { label: 'Normalna', value: 1 }, { label: 'Wysoka', value: 2 }];

const hhmm = (date: Date) => `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;

/** Pierwszy wolny przedział preferowany; jeśli wszystkie kolidują z zajęciami (7a), pierwszy wolny z dostępności. */
function pickDailySlot(preferences: { startTime: string; endTime: string }[], availability: AvailabilityInterval[], busy: { start: Date; end: Date }[]) {
  const free = (slot: { startTime: string; endTime: string }) => !busy.some((b) => slot.startTime < hhmm(b.end) && hhmm(b.start) < slot.endTime);
  const preferred = preferences.find(free);
  if (preferred) return { time: `${preferred.startTime}–${preferred.endTime}`, preferred: true };
  const fallback = availability.find(free);
  if (fallback) return { time: `${fallback.startTime}–${fallback.endTime}`, preferred: false };
  return null;
}

export default function PreferencesEditor() {
  const { palette, styles } = useTheme();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [version, setVersion] = useState('');
  const [intervals, setIntervals] = useState<PreferenceInterval[]>([]);
  const [availability, setAvailability] = useState<AvailabilityInterval[]>([]);
  const [rowErrors, setRowErrors] = useState<Record<number, string>>({});
  const [saveError, setSaveError] = useState('');
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);

  const [days, setDays] = useState<Set<number>>(new Set());
  const [start, setStart] = useState('16:00');
  const [end, setEnd] = useState('20:00');
  const [weight, setWeight] = useState(1);
  const [formError, setFormError] = useState('');

  const load = async () => {
    setLoading(true); setLoadError('');
    try {
      const snapshot = await loadWorkPreferences();
      setVersion(snapshot.version); setIntervals(snapshot.intervals); setAvailability(snapshot.availability);
    } catch (error) { setLoadError(error instanceof Error ? error.message : 'Nie udało się wczytać preferencji.'); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);

  const toggleDay = (id: number) => setDays((current) => { const next = new Set(current); next.has(id) ? next.delete(id) : next.add(id); return next; });

  const addInterval = () => {
    setFormError('');
    if (!days.size) { setFormError('Wybierz co najmniej jeden dzień.'); return; }
    if (end <= start) { setFormError('Godzina zakończenia musi być późniejsza niż rozpoczęcia.'); return; } // 4b
    setIntervals((current) => [...current, ...[...days].map((dayOfWeek) => ({ dayOfWeek, startTime: start, endTime: end, weight }))]);
    setDays(new Set());
  };

  const removeInterval = (index: number) => {
    setIntervals((current) => current.filter((_, i) => i !== index));
    setRowErrors((current) => { const next = { ...current }; delete next[index]; return next; });
  };

  // 4a: Anuluj — porzuca niezapisane zmiany, wraca do ostatnio zapisanych preferencji.
  const cancel = () => { void load(); setDays(new Set()); setFormError(''); setSaveError(''); setNotice(''); setRowErrors({}); };

  const save = async () => {
    setSaving(true); setSaveError(''); setNotice(''); setRowErrors({});
    try {
      const snapshot = await saveWorkPreferences(version, intervals);
      setVersion(snapshot.version); setIntervals(snapshot.intervals); setAvailability(snapshot.availability);
      setNotice('Preferencje zapisane.');
    } catch (error) {
      if (error instanceof WorkPreferencesConflictError) { setSaveError(error.message); await load(); }
      else if (error instanceof WorkPreferencesError) { setSaveError(error.message); if (error.rowIndex !== undefined) setRowErrors({ [error.rowIndex]: error.message }); }
      else setSaveError(error instanceof Error ? error.message : 'Nie udało się zapisać preferencji.');
    } finally { setSaving(false); }
  };

  // --- Podgląd przykładowego grafiku (krok 6–8): prawdziwe obowiązkowe zajęcia + prosta symulacja w przeglądarce ---
  const [preview, setPreview] = useState<{ day: string; slot: { time: string; preferred: boolean } | null }[] | null>(null);
  const [previewError, setPreviewError] = useState('');
  const runPreview = async () => {
    setPreviewError(''); setPreview(null);
    try {
      const events = await loadCalendar();
      const monday = startOfWeek(new Date());
      const mandatoryClasses = occurrencesForRange(events.filter((e) => e.category === 'Class' && e.mandatory), { start: monday, end: addCalendarDays(monday, 7) });
      setPreview(DAY_LABELS.map(({ id, label }) => {
        const dayDate = addCalendarDays(monday, id - 1);
        const busy = mandatoryClasses.filter((m) => m.occurrenceStart.toDateString() === dayDate.toDateString()).map((m) => ({ start: m.occurrenceStart, end: m.occurrenceEnd }));
        return { day: label, slot: pickDailySlot(intervals.filter((p) => p.dayOfWeek === id), availability.filter((a) => a.dayOfWeek === id), busy) };
      }));
    } catch (error) { setPreviewError(error instanceof Error ? error.message : 'Nie udało się przygotować podglądu.'); }
  };

  if (loading) return <Text style={styles.muted}>Wczytywanie preferencji…</Text>;
  return <View style={{ marginTop: 24 }}>
    <Text style={[styles.heading, { marginBottom: 4 }]}>Preferowane godziny pracy</Text>
    <Text style={[styles.subtitle, { marginBottom: 12 }]}>Planer w pierwszej kolejności ułoży pracę w tych godzinach — to nie jest twardy limit.</Text>
    {!!loadError && <Text accessibilityRole="alert" style={styles.error}>{loadError}</Text>}

    {intervals.map((interval, index) => (
      <View key={`${interval.dayOfWeek}-${interval.startTime}-${index}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10, borderRadius: 8, borderWidth: 1, borderColor: rowErrors[index] ? palette.red : palette.line, marginBottom: 8 }}>
        <Text style={[styles.body, { flex: 1 }]}>{DAY_LABELS.find((d) => d.id === interval.dayOfWeek)?.label} {interval.startTime}–{interval.endTime} · waga {interval.weight}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Usuń przedział" onPress={() => removeInterval(index)}><Text style={{ color: palette.red, fontWeight: '700' }}>✕</Text></Pressable>
      </View>
    ))}
    {intervals.map((_, index) => rowErrors[index] ? <Text key={`err-${index}`} style={styles.error}>Wiersz {index + 1}: {rowErrors[index]}</Text> : null)}
    {!intervals.length && <Text style={[styles.muted, { marginBottom: 8 }]}>Brak zapisanych preferencji.</Text>}

    <Text style={[styles.label, { marginTop: 8, marginBottom: 4 }]}>DODAJ PRZEDZIAŁ</Text>
    <View accessibilityRole="group" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
      {DAY_LABELS.map((d) => <Pressable key={d.id} accessibilityRole="checkbox" accessibilityState={{ checked: days.has(d.id) }} onPress={() => toggleDay(d.id)}
        style={{ paddingVertical: 6, paddingHorizontal: 10, borderRadius: 6, borderWidth: 1, borderColor: days.has(d.id) ? palette.blue : palette.line, backgroundColor: days.has(d.id) ? palette.blueSoft : palette.surface }}>
        <Text style={styles.body}>{d.label}</Text>
      </Pressable>)}
    </View>
    <View style={{ flexDirection: 'row', gap: 12 }}>
      <TimeField label="OD" value={start} onChange={setStart} />
      <TimeField label="DO" value={end} onChange={setEnd} />
    </View>
    <Text style={[styles.label, { marginBottom: 4 }]}>WAŻNOŚĆ</Text>
    <View style={{ flexDirection: 'row', gap: 6, marginBottom: 8 }}>
      {WEIGHT_OPTIONS.map((option) => <Pressable key={option.label} accessibilityRole="radio" accessibilityState={{ checked: weight === option.value }} onPress={() => setWeight(option.value)}
        style={{ paddingVertical: 6, paddingHorizontal: 10, borderRadius: 6, borderWidth: 1, borderColor: weight === option.value ? palette.blue : palette.line, backgroundColor: weight === option.value ? palette.blueSoft : palette.surface }}>
        <Text style={styles.body}>{option.label}</Text>
      </Pressable>)}
    </View>
    {!!formError && <Text accessibilityRole="alert" style={styles.error}>{formError}</Text>}
    <Button title="Dodaj przedział" onPress={addInterval} />

    <View style={{ flexDirection: 'row', gap: 8, marginTop: 16 }}>
      <Button title={saving ? 'Zapisywanie…' : 'Zapisz'} primary disabled={saving} onPress={() => void save()} />
      <Button title="Anuluj" onPress={cancel} />
    </View>
    {!!saveError && <Text accessibilityRole="alert" style={styles.error}>{saveError}</Text>}
    {!!notice && <Text accessibilityLiveRegion="polite" style={styles.muted}>{notice}</Text>}

    <View style={{ marginTop: 20 }}>
      <Button title="Pokaż przykładowy grafik" onPress={() => void runPreview()} />
      {!!previewError && <Text accessibilityRole="alert" style={styles.error}>{previewError}</Text>}
      {!!preview && <View style={{ marginTop: 12, gap: 6 }}>
        {preview.map((row) => <Text key={row.day} style={styles.body}>
          {row.day}: {row.slot ? `${row.slot.time} ${row.slot.preferred ? '(preferowane)' : '(inne dostępne godziny)'}` : 'brak wolnych godzin'}
        </Text>)}
      </View>}
    </View>
  </View>;
}