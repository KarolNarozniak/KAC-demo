import { mergeAvailability, subtractMandatory, mandatoryWeeklyIntervals } from '../domain/availability';
import { loadCalendar } from '../services/calendarApi';
import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, TextInput } from 'react-native';
import TimeField from './TimeField';
import { useTheme } from './ui';
import { getAvailability, saveAvailability, type Availability, type Interval } from '../services/workProfileApi';
const days = ['Poniedziałek', 'Wtorek', 'Środa', 'Czwartek', 'Piątek', 'Sobota', 'Niedziela'];
export default function AvailabilityEditor({ initial, targetHours, onSaved }: {
    initial: Availability;
    targetHours: number | null;
    onSaved: () => void;
}) {
    const { styles } = useTheme();
    const [saved, setSaved] = useState(initial);
    const [rows, setRows] = useState(initial.intervals);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [message, setMessage] = useState('');
    const [copyDays, setCopyDays] = useState<number[]>([]);
    const [blocked, setBlocked] = useState<Interval[]>([]);
    const [calendarLoaded, setCalendarLoaded] = useState(false);
    const [preview, setPreview] = useState<Interval[] | null>(null);
    useEffect(() => { void loadCalendar().then(events => { setBlocked(mandatoryWeeklyIntervals(events)); setCalendarLoaded(true); }).catch(e => setError('Nie udało się sprawdzić zajęć: ' + e.message)); }, []);
    useEffect(() => setSaved(old => ({ ...old, version: initial.version })), [initial.version]);
    const button = (label: string, fn: () => void) => <Pressable disabled={busy} onPress={fn} style={{ padding: 10 }}><Text style={styles.body}>{label}</Text></Pressable>;
    const update = (index: number, key: 'startTime' | 'endTime', value: string) => setRows(rows.map((r, i) => i === index ? { ...r, [key]: value } : r));
    const hours = saved.intervals.reduce((sum, r) => sum + (Number(r.endTime.slice(0, 2)) * 60 + Number(r.endTime.slice(3)) - Number(r.startTime.slice(0, 2)) * 60 - Number(r.startTime.slice(3))) / 60, 0);
    return <View style={{ gap: 8 }}><Text style={styles.heading}>Dostępność tygodniowa</Text><Text style={styles.body}>Zapisano: {hours.toFixed(2)} godz./tydzień</Text>{hours === 0 && <Text style={styles.error}>Brak dostępności — nie można wygenerować grafiku.</Text>}{targetHours !== null && hours < targetHours && <Text style={styles.error}>Dostępność mniejsza od celu. Cel może być nieosiągalny.</Text>}
    {days.map((day, d) => <View key={day}><Text style={styles.heading}>{day}</Text>{rows.map((r, i) => r.dayOfWeek === d + 1 ? <View key={i} style={{ gap: 4 }}><View pointerEvents={busy ? 'none' : 'auto'}><TimeField label="Od" value={r.startTime} onChange={v => update(i, 'startTime', v)}/></View>{/* Native time picker cannot represent 24:00. */}<Text style={styles.body}>Do (HH:mm, także 24:00)</Text><TextInput accessibilityLabel={`${day}: koniec`} editable={!busy} style={styles.body} value={r.endTime} onChangeText={v => update(i, 'endTime', v)}/>{button('Usuń', () => setRows(rows.filter((_, n) => n !== i)))}</View> : null)}{button('Dodaj przedział', () => setRows([...rows, { dayOfWeek: d + 1, startTime: '08:00', endTime: '16:00' }]))}{button(copyDays.includes(d + 1) ? '☑ Cel kopiowania' : '☐ Cel kopiowania', () => setCopyDays(copyDays.includes(d + 1) ? copyDays.filter(n => n !== d + 1) : [...copyDays, d + 1]))}{button('Kopiuj ten dzień na zaznaczone dni', () => setRows([...rows.filter(r => !copyDays.includes(r.dayOfWeek) || r.dayOfWeek === d + 1), ...copyDays.filter(n => n !== d + 1).flatMap(n => rows.filter(r => r.dayOfWeek === d + 1).map(r => ({ ...r, dayOfWeek: n })))]))}</View>)}
    <Text style={styles.body}>Dostępność powtarza się co tydzień. Obowiązkowe zajęcia cykliczne są wyłączane po Twojej akceptacji. Pozostałe wydarzenia ograniczą konkretny grafik.</Text>{preview && <View><Text style={styles.error}>Niedostępne: {blocked.map(b => `${days[b.dayOfWeek - 1]} ${b.startTime}–${b.endTime}`).join(', ')}</Text>{button('Akceptuj wyłączenie zajętych części', () => { setRows(preview); setPreview(null); setError(''); setMessage('Przejrzyj przedziały i wybierz Zapisz.'); })}</View>}{!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}{!!message && <Text style={styles.body}>{message}</Text>}
    {button(busy ? 'Zapisywanie…' : 'Zapisz dostępność', () => { if (busy)
        return; if (!calendarLoaded) {
        setError('Przed zapisem wymagane jest wczytanie zajęć. Odśwież profil.');
        return;
    } let normalized: Interval[]; try {
        normalized = mergeAvailability(rows);
    }
    catch (e) {
        setError((e as Error).message);
        return;
    } const clipped = subtractMandatory(normalized, blocked); if (JSON.stringify(normalized) !== JSON.stringify(clipped)) {
        setPreview(clipped);
        setError('Przedziały kolidują z obowiązkowymi zajęciami. Zaakceptuj wyłączenie zajętych części albo popraw godziny.');
        return;
    } setBusy(true); setPreview(null); setError(''); setMessage(''); void saveAvailability({ version: saved.version, intervals: normalized }).then(a => { setSaved(a); setRows(a.intervals); setMessage('Zapisano dostępność.'); onSaved(); }).catch(e => setError(e.message)).finally(() => setBusy(false)); })}
    {button('Anuluj', () => { setRows(saved.intervals); setPreview(null); setError(''); setMessage(''); })}{button('Wczytaj ponownie', () => { setBusy(true); void getAvailability().then(a => { setSaved(a); setRows(a.intervals); setError(''); }).catch(e => setError(e.message)).finally(() => setBusy(false)); })}
  </View>;
}
