import {localDateKey,startOfWeek} from '../domain/calendar';
import TimeField from '../components/TimeField';
import DateField from '../components/DateField';
import { localFields, editedInstant } from '../domain/scheduleTime';
import React, { useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView } from 'react-native';
import { useTheme } from '../components/ui';
import { workRequest, formatPln } from '../services/compensationApi';
type Shift = {
    id: string;
    start: string;
    end: string;
    hourlyRatePln: number;
    estimatedPayPln: number;
    rateKind: 'gross' | 'net';
};
type Schedule = {
    id: string;
    status: string;
    shifts: Shift[];
    plannedHours: number;
    estimatedPayPln: number;
    achievable: boolean;
    commuteMinutes: number;
};
function ShiftEditor({ shift, busy, save }: {
    shift: Shift;
    busy: boolean;
    save: (start: string, end: string) => void;
}) {
    const { styles } = useTheme();
    const [start, setStart] = useState(localFields(shift.start));
    const [end, setEnd] = useState(localFields(shift.end));
    const [error, setError] = useState('');
    return <View pointerEvents={busy ? 'none' : 'auto'}><DateField label="Data rozpoczęcia" value={start.date} onChange={date => setStart({ ...start, date })}/><TimeField label="Początek" value={start.time} onChange={time => setStart({ ...start, time })}/><DateField label="Data zakończenia" value={end.date} onChange={date => setEnd({ ...end, date })}/><TimeField label="Koniec" value={end.time} onChange={time => setEnd({ ...end, time })}/>{!!error && <Text style={styles.error}>{error}</Text>}<Pressable disabled={busy} onPress={() => { try {
        save(editedInstant(shift.start, start.date, start.time), editedInstant(shift.end, end.date, end.time));
    }
    catch (e) {
        setError((e as Error).message);
    } }}><Text style={styles.body}>Zapisz korektę</Text></Pressable></View>;
}
export default function ScheduleScreen() {
    const { styles } = useTheme();
    const [week, setWeek] = useState(() => localDateKey(startOfWeek(new Date())));
    const [schedule, setSchedule] = useState<Schedule | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [history, setHistory] = useState<Schedule[]>([]);
    const run = (fn: () => Promise<Schedule>) => { if (busy)
        return; setBusy(true); setError(''); void fn().then(setSchedule).catch(e => setError(e.message)).finally(() => setBusy(false)); };
    return <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}><Text style={styles.heading}>Planowanie pracy</Text><Text style={styles.body}>Poniedziałek tygodnia (RRRR-MM-DD)</Text><DateField label="Początek tygodnia" value={week} onChange={setWeek}/><Text style={styles.body}>Godziny zmian w strefie urządzenia: {Intl.DateTimeFormat().resolvedOptions().timeZone}</Text><Pressable disabled={busy} onPress={() => { if (busy)
        return; setBusy(true); setError(''); void workRequest(`schedules?week=${encodeURIComponent(week)}`).then(setHistory).catch(e => setError(e.message)).finally(() => setBusy(false)); }}><Text style={styles.body}>Wczytaj zapisane grafiki z tygodnia</Text></Pressable>{history.map(h => <Pressable key={h.id} disabled={busy} onPress={() => setSchedule(h)}><Text style={styles.body}>{h.status} · {h.plannedHours.toFixed(2)} godz. · {formatPln(h.estimatedPayPln)}</Text></Pressable>)}<Pressable disabled={busy} onPress={() => run(() => workRequest('schedules/generate', { week }, 'POST'))}><Text style={styles.body}>{busy ? 'Przetwarzanie…' : 'Generuj propozycję'}</Text></Pressable>{!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}{schedule && <><Text style={styles.body}>{schedule.status} · {schedule.plannedHours.toFixed(2)} godz. · {formatPln(schedule.estimatedPayPln)}</Text>{!schedule.achievable && <Text style={styles.error}>Nie udało się osiągnąć celu godzinowego.</Text>}{!schedule.shifts.length && <Text style={styles.body}>Brak zaplanowanych godzin: {formatPln(0)}. Brak odpowiednich okien do pracy.</Text>}{schedule.shifts.map(s => <View key={`${s.id}-${s.start}`} style={{ gap: 6, padding: 12, borderWidth: 1 }}><Text style={styles.body}>{new Date(s.start).toLocaleString('pl-PL')} – {new Date(s.end).toLocaleString('pl-PL')}</Text><Text style={styles.body}>{formatPln(s.hourlyRatePln)}/h · {formatPln(s.estimatedPayPln)} {s.rateKind === 'gross' ? 'brutto' : s.rateKind === 'net' ? 'netto' : 'rodzaj nieustalony'}</Text><View style={{ padding: 8, opacity: 0.65 }}><Text style={styles.body}>Dojazd: {schedule.commuteMinutes} min przed i po zmianie. Czas niepłatny.</Text></View>{schedule.status === 'Proposed' && <ShiftEditor shift={s} busy={busy} save={(start, end) => run(() => workRequest(`schedules/${schedule.id}/shifts/${s.id}`, { start, end }))}/>}</View>)}{schedule.status === 'Proposed' && (['accept', 'reject'] as const).map(action => <Pressable key={action} disabled={busy} onPress={() => run(() => workRequest(`schedules/${schedule.id}/${action}`, {}, 'POST'))}><Text style={styles.body}>{action === 'accept' ? 'Akceptuj i dodaj do kalendarza' : 'Odrzuć propozycję'}</Text></Pressable>)}</>}</ScrollView>;
}
