import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { mergeAvailability, subtractMandatory, mandatoryWeeklyIntervals } from '../domain/availability';
import { loadCalendar } from '../services/calendarApi';
import { getAvailability, saveAvailability, type Availability, type Interval } from '../services/compensationApi';
import TimeField from './TimeField';
import { useTheme } from './ui';

const days = ['Poniedziałek', 'Wtorek', 'Środa', 'Czwartek', 'Piątek', 'Sobota', 'Niedziela'];

export default function AvailabilityEditor({ initial, targetHours, onSaved }: {
  initial: Availability; targetHours: number | null; onSaved: () => void;
}) {
  const { styles } = useTheme();
  const [saved, setSaved] = useState(initial);
  const [rows, setRows] = useState(initial.intervals);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [copyDays, setCopyDays] = useState<number[]>([]);
  const [blocked, setBlocked] = useState<Interval[]>([]);
  const [calendarLoaded, setCalendarLoaded] = useState(false);
  const [preview, setPreview] = useState<Interval[] | null>(null);

  useEffect(() => {
    void loadCalendar().then(events => {
      setBlocked(mandatoryWeeklyIntervals(events));
      setCalendarLoaded(true);
    }).catch(e => setError('Nie udało się sprawdzić zajęć: ' + e.message));
  }, []);
  // A profile save advances the shared version without discarding this editor's draft.
  useEffect(() => setSaved(old => ({ ...old, version: initial.version })), [initial.version]);

  const changeRows = (next: Interval[]) => { setRows(next); setPreview(null); setMessage(''); };
  const update = (index: number, key: 'startTime' | 'endTime', value: string) =>
    changeRows(rows.map((row, i) => i === index ? { ...row, [key]: value } : row));
  const hours = saved.intervals.reduce((sum, row) => {
    const minutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
    return sum + (minutes(row.endTime) - minutes(row.startTime)) / 60;
  }, 0);

  async function save() {
    if (pending.current) return;
    if (!calendarLoaded) {
      setError('Przed zapisem wymagane jest wczytanie zajęć. Odśwież profil.');
      return;
    }
    let normalized: Interval[];
    try { normalized = mergeAvailability(rows); }
    catch (e) { setError((e as Error).message); return; }
    const clipped = subtractMandatory(normalized, blocked);
    if (JSON.stringify(normalized) !== JSON.stringify(clipped)) {
      setPreview(clipped);
      setError('Przedziały kolidują z obowiązkowymi zajęciami. Zaakceptuj wyłączenie zajętych części albo popraw godziny.');
      return;
    }
    pending.current = true;
    setBusy(true); setPreview(null); setError(''); setMessage('');
    try {
      const result = await saveAvailability({ version: saved.version, intervals: normalized });
      setSaved(result); setRows(result.intervals); setMessage('Zapisano dostępność.'); onSaved();
    } catch (e) { setError((e as Error).message); }
    finally { pending.current = false; setBusy(false); }
  }
  async function reload() {
    if (pending.current) return;
    pending.current = true; setBusy(true);
    try {
      const [result, events] = await Promise.all([getAvailability(), loadCalendar()]);
      setSaved(result); changeRows(result.intervals);
      setBlocked(mandatoryWeeklyIntervals(events)); setCalendarLoaded(true); setError('');
      onSaved();
    } catch (e) { setError((e as Error).message); }
    finally { pending.current = false; setBusy(false); }
  }
  function copyDay(day: number) {
    const unchanged = rows.filter(row => !copyDays.includes(row.dayOfWeek) || row.dayOfWeek === day);
    const copies = copyDays.filter(target => target !== day).flatMap(target =>
      rows.filter(row => row.dayOfWeek === day).map(row => ({ ...row, dayOfWeek: target })));
    changeRows([...unchanged, ...copies]);
  }
  const button = (label: string, action: () => void) => (
    <Pressable disabled={busy} onPress={action} style={{ padding: 10 }}>
      <Text style={styles.body}>{label}</Text>
    </Pressable>
  );

  return <View style={{ gap: 8 }}>
    <Text style={styles.heading}>Dostępność tygodniowa</Text>
    <Text style={styles.body}>Zapisano: {hours.toFixed(2)} godz./tydzień</Text>
    {hours === 0 && <Text style={styles.error}>Brak dostępności — nie można wygenerować grafiku.</Text>}
    {targetHours !== null && hours < targetHours && <Text style={styles.error}>Dostępność mniejsza od celu. Cel może być nieosiągalny.</Text>}
    {days.map((day, d) => <View key={day}>
      <Text style={styles.heading}>{day}</Text>
      {rows.map((row, i) => row.dayOfWeek === d + 1 ? <View key={i} style={{ gap: 4 }}>
        <View pointerEvents={busy ? 'none' : 'auto'}>
          <TimeField disabled={busy} label={`${day}: od`} value={row.startTime} onChange={value => update(i, 'startTime', value)} />
          <TimeField disabled={busy} label={`${day}: do${row.endTime === '24:00' ? ' — koniec dnia 24:00' : ''}`}
            value={row.endTime === '24:00' ? '00:00' : row.endTime} onChange={value => update(i, 'endTime', value)} />
        </View>
        {button('Ustaw koniec dnia (24:00)', () => update(i, 'endTime', '24:00'))}
        {button('Usuń', () => changeRows(rows.filter((_, index) => index !== i)))}
      </View> : null)}
      {button('Dodaj przedział', () => changeRows([...rows, { dayOfWeek: d + 1, startTime: '08:00', endTime: '16:00' }]))}
      {button(copyDays.includes(d + 1) ? '☑ Cel kopiowania' : '☐ Cel kopiowania', () =>
        setCopyDays(copyDays.includes(d + 1) ? copyDays.filter(n => n !== d + 1) : [...copyDays, d + 1]))}
      {button('Kopiuj ten dzień na zaznaczone dni', () => copyDay(d + 1))}
    </View>)}
    <Text style={styles.body}>Dostępność powtarza się co tydzień. Obowiązkowe zajęcia cykliczne są wyłączane po Twojej akceptacji. Pozostałe wydarzenia ograniczą konkretny grafik.</Text>
    {preview && <View>
      <Text style={styles.error}>Niedostępne: {blocked.map(row => `${days[row.dayOfWeek - 1]} ${row.startTime}–${row.endTime}`).join(', ')}</Text>
      {button('Akceptuj wyłączenie zajętych części', () => {
        changeRows(preview); setError(''); setMessage('Przejrzyj przedziały i wybierz Zapisz.');
      })}
    </View>}
    {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
    {!!message && <Text style={styles.body}>{message}</Text>}
    {button(busy ? 'Zapisywanie…' : 'Zapisz dostępność', () => void save())}
    {button('Anuluj', () => { changeRows(saved.intervals); setError(''); })}
    {button('Wczytaj ponownie', () => void reload())}
  </View>;
}
