import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { addCalendarDays, localDateKey, startOfWeek } from '../domain/calendar';
import { Button, Field, useTheme } from '../components/ui';
import { generateSchedule, loadSchedule, saveSchedule, type ScheduleShift, type WeeklySchedule, type WorkMode } from '../services/scheduleApi';

type Props = { week: Date; setWeek: (value: Date) => void; now: Date; active: boolean };
const modeLabel: Record<WorkMode, string> = { elastyczny: 'Elastyczny', zmianowy: 'Zmianowy' };
const statusLabel = { target_met: 'Cel osiągnięty', proven_infeasible: 'Cel niemożliwy przy tych ograniczeniach', not_found: 'Nie znaleziono pełnego grafiku' };
const minutesLabel = (minutes: number) => `${Math.floor(minutes / 60)} h${minutes % 60 ? ` ${minutes % 60} min` : ''}`;

export default function ScheduleScreen({ week, setWeek, now, active }: Props) {
  const { palette, styles } = useTheme();
  const monday = startOfWeek(week);
  const weekStart = localDateKey(monday);
  const [schedule, setSchedule] = useState<WeeklySchedule | null>(null);
  const [mode, setMode] = useState<WorkMode>('elastyczny');
  const [targetHours, setTargetHours] = useState('20');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!active) return;
    let current = true;
    setLoading(true); setError(''); setDirty(false);
    void loadSchedule(weekStart).then((value) => {
      if (!current) return;
      setSchedule(value);
      if (value) { setMode(value.mode); setTargetHours(String(value.targetMinutes / 60)); }
    }).catch((reason) => { if (current) setError(reason instanceof Error ? reason.message : 'Nie udało się wczytać grafiku.'); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [active, weekStart]);

  const selectedWeek = `${monday.toLocaleDateString('pl-PL', { day: 'numeric', month: 'short' })} – ${addCalendarDays(monday, 6).toLocaleDateString('pl-PL', { day: 'numeric', month: 'short', year: 'numeric' })}`;
  const changeShift = (id: string, field: 'startLocal' | 'endLocal', value: string) => {
    setDirty(true);
    setSchedule((current) => current ? { ...current, shifts: current.shifts.map((shift) => {
      if (shift.candidateId !== id) return shift;
      const updated = { ...shift, [field]: value };
      const dateTime = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/;
      const start = dateTime.exec(updated.startLocal), end = dateTime.exec(updated.endLocal);
      if (start && end) {
        const startMinute = Date.parse(`${start[1]}T${start[2]}Z`), endMinute = Date.parse(`${end[1]}T${end[2]}Z`);
        updated.durationMinutes = Math.max(0, Math.round((endMinute - startMinute) / 60_000));
        updated.workDate = start[1]!;
      }
      return updated;
    }) } : current);
  };
  const addShift = () => {
    if (!schedule) return;
    const date = localDateKey(monday);
    const shift: ScheduleShift = { candidateId: `manual-${Date.now()}`, title: 'Praca', start: '', end: '', startLocal: `${date}T12:00`, endLocal: `${date}T14:00`,
      durationMinutes: 120, workDate: date, mode: schedule.mode, optionalLectureIds: [], softPenalty: 0 };
    setSchedule({ ...schedule, shifts: [...schedule.shifts, shift] }); setDirty(true);
  };
  const removeShift = (id: string) => {
    if (!schedule) return;
    setSchedule({ ...schedule, shifts: schedule.shifts.filter((shift) => shift.candidateId !== id) }); setDirty(true);
  };
  const generate = async () => {
    const target = Number(targetHours);
    if (!Number.isFinite(target) || target < 0 || target > 80) { setError('Cel tygodniowy musi mieścić się w zakresie 0–80 godzin.'); return; }
    setLoading(true); setError('');
    try { setSchedule(await generateSchedule(weekStart, mode, target)); setDirty(false); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Nie udało się wygenerować grafiku.'); }
    finally { setLoading(false); }
  };
  const save = async () => {
    if (!schedule?.version) return;
    setSaving(true); setError('');
    try { setSchedule(await saveSchedule(weekStart, schedule.version, schedule.shifts)); setDirty(false); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Nie udało się zapisać zmian.'); }
    finally { setSaving(false); }
  };
  const shiftCount = schedule?.shifts.length ?? 0;

  return <ScrollView style={{ flex: 1 }} contentContainerStyle={{ width: '100%', maxWidth: 1120, alignSelf: 'center', padding: 16, paddingBottom: 40 }}>
    <View style={[styles.row, { flexWrap: 'wrap', justifyContent: 'space-between', marginBottom: 12 }]}>
      <Text style={[styles.title, { fontSize: 25 }]}>Plan pracy</Text>
      <View style={styles.row}><Button title="‹" accessibilityLabel="Poprzedni tydzień" onPress={() => setWeek(addCalendarDays(monday, -7))} /><Button title="Dzisiaj" onPress={() => setWeek(now)} /><Button title="›" accessibilityLabel="Następny tydzień" onPress={() => setWeek(addCalendarDays(monday, 7))} /></View>
    </View>
    <Text style={[styles.subtitle, { marginTop: 0, marginBottom: 14 }]}>{selectedWeek}</Text>

    <View style={styles.card}>
      <Text style={styles.heading}>Ustawienia planu</Text>
      <Text style={[styles.muted, { marginTop: 4, marginBottom: 12 }]}>Minimum jest dolną granicą, cel preferowanym wynikiem, a maksimum twardym limitem tygodnia.</Text>
      <Text style={styles.label}>TRYB PRACY</Text>
      <View accessibilityRole="radiogroup" style={[styles.row, { flexWrap: 'wrap', marginBottom: 12 }]}>
        {(['elastyczny', 'zmianowy'] as const).map((value) => <Pressable key={value} accessibilityRole="radio" accessibilityState={{ checked: mode === value }} onPress={() => setMode(value)} style={{ paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: mode === value ? palette.blue : palette.line, backgroundColor: mode === value ? palette.blueSoft : palette.surfaceAlt }}><Text style={[styles.body, { fontWeight: '700' }]}>{modeLabel[value]}</Text></Pressable>)}
      </View>
      <Field label="PREFEROWANY CEL (GODZ./TYDZ.)" value={targetHours} onChangeText={setTargetHours} keyboardType="decimal-pad" editable={!loading && !saving} placeholder="20" />
      <Button title={loading ? 'Przetwarzanie…' : 'Wygeneruj tydzień'} primary disabled={loading || saving} onPress={() => void generate()} />
    </View>

    {loading && <Text accessibilityLiveRegion="polite" style={styles.muted}>Wczytywanie propozycji…</Text>}
    {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
    {schedule && <>
      <View style={[styles.card, { borderColor: schedule.solutionStatus === 'target_met' ? palette.green : palette.amber }]}>
        <View style={[styles.row, { justifyContent: 'space-between', flexWrap: 'wrap' }]}><Text style={styles.heading}>{statusLabel[schedule.solutionStatus]}</Text><Text style={styles.muted}>Wersja {schedule.version ?? 1} · {modeLabel[schedule.mode]}</Text></View>
        <View style={[styles.row, { flexWrap: 'wrap', marginTop: 16 }]}>
          {[['Zaplanuj', minutesLabel(schedule.proposedMinutes)], ['Razem z pracą', minutesLabel(schedule.totalMinutes)], ['Cel', minutesLabel(schedule.targetMinutes)], ['Do celu', minutesLabel(schedule.shortfallMinutes)]].map(([label, value]) => <View key={label} style={{ flexGrow: 1, minWidth: 120, padding: 12, borderRadius: 12, backgroundColor: palette.surfaceAlt }}><Text style={styles.label}>{label.toUpperCase()}</Text><Text style={[styles.heading, { fontSize: 19 }]}>{value}</Text></View>)}
        </View>
        {!!schedule.optionalLecturesSkipped.length && <Text style={[styles.muted, { marginTop: 12 }]}>Pominięte zajęcia nieobowiązkowe: {schedule.optionalLecturesSkipped.join(', ')}</Text>}
        {schedule.violations.map((violation, index) => <Text key={`${violation.code}-${index}`} style={[styles.muted, { marginTop: 8, color: violation.severity === 'error' ? palette.red : palette.amber }]}>{violation.message}</Text>)}
      </View>

      <View style={styles.card}>
        <View style={[styles.row, { justifyContent: 'space-between', flexWrap: 'wrap', marginBottom: 12 }]}><View><Text style={styles.heading}>Proponowane zmiany</Text><Text style={styles.muted}>{shiftCount} zmian · możesz poprawić godziny przed zapisaniem</Text></View><Button title="Dodaj zmianę" disabled={saving || loading} onPress={addShift} /></View>
        {!schedule.shifts.length && <Text style={styles.muted}>Brak zmian. Dodaj zmianę albo zmień ograniczenia.</Text>}
        {schedule.shifts.map((shift, index) => <View key={shift.candidateId} style={{ paddingVertical: 12, borderTopWidth: index === 0 ? 0 : 1, borderColor: palette.line }}>
          <View style={[styles.row, { flexWrap: 'wrap', alignItems: 'flex-end' }]}>
            <View style={{ flex: 1, minWidth: 120 }}><Text style={styles.label}>DATA I POCZĄTEK</Text><TextInput accessibilityLabel={`Data i początek zmiany ${index + 1}`} value={shift.startLocal} onChangeText={(value) => changeShift(shift.candidateId, 'startLocal', value)} style={styles.input} /></View>
            <View style={{ flex: 1, minWidth: 120 }}><Text style={styles.label}>KONIEC</Text><TextInput accessibilityLabel={`Koniec zmiany ${index + 1}`} value={shift.endLocal} onChangeText={(value) => changeShift(shift.candidateId, 'endLocal', value)} style={styles.input} /></View>
            <Text style={[styles.muted, { paddingBottom: 10 }]}>{minutesLabel(shift.durationMinutes)}</Text>
            <Button title="Usuń" danger onPress={() => removeShift(shift.candidateId)} />
          </View>
        </View>)}
        {dirty && <Button title={saving ? 'Sprawdzanie i zapisywanie…' : 'Sprawdź i zapisz zmiany'} primary disabled={saving || loading || !schedule.version} onPress={() => void save()} />}
      </View>
    </>}
  </ScrollView>;
}
