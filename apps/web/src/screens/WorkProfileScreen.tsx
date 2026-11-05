import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView } from 'react-native';
import { useTheme } from '../components/ui';
import AvailabilityEditor from '../components/AvailabilityEditor';
import { getWorkProfile, saveWorkProfile, getAvailability, formatPln, type WorkProfile, type Availability } from '../services/workProfileApi';
export default function WorkProfileScreen() {
    const { styles } = useTheme();
    const [profile, setProfile] = useState<WorkProfile | null>(null);
    const [saved, setSaved] = useState<WorkProfile | null>(null);
    const [availability, setAvailability] = useState<Availability | null>(null);
    const [fields, setFields] = useState<Record<string, string>>({});
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const [revision, setRevision] = useState(0);
    const apply = (p: WorkProfile) => { setProfile(p); setSaved(p); setFields(Object.fromEntries(['hourlyRatePln', 'commuteMinutes', 'minRestMinutes', 'minHours', 'targetHours', 'maxHours'].map(k => [k, String(p[k as keyof WorkProfile] ?? '')]))); };
    useEffect(() => { void Promise.all([getWorkProfile(), getAvailability()]).then(([p, a]) => { apply(p); setAvailability(a); setError(''); }).catch(e => setError(e.message)); }, [revision]);
    const refresh = () => { void getWorkProfile().then(p => { setProfile(old => old ? { ...old, version: p.version } : p); setSaved(p); }).catch(e => setError(e.message)); };
    const labels: Record<string, string> = { hourlyRatePln: 'Stawka PLN (0 dozwolone)', commuteMinutes: 'Dojazd w pełnych minutach (puste = brak ustawienia)', minRestMinutes: 'Odpoczynek między zmianami (minuty)', minHours: 'Minimum godzin tygodniowo', targetHours: 'Cel godzin tygodniowo', maxHours: 'Maksimum godzin tygodniowo' };
    return <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}><Text style={styles.heading}>Profil pracy</Text><Pressable disabled={busy} onPress={() => setRevision(n => n + 1)}><Text style={styles.body}>Wczytaj profil ponownie</Text></Pressable>{!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}{!profile ? <Pressable onPress={() => setRevision(n => n + 1)}><Text style={styles.body}>Wczytaj ponownie</Text></Pressable> : <>
 {Object.entries(labels).map(([key, label]) => <View key={key}><Text style={styles.body}>{label}</Text><TextInput accessibilityLabel={label} editable={!busy} keyboardType={key.includes('Minutes') ? 'number-pad' : 'decimal-pad'} value={fields[key]} onChangeText={v => setFields({ ...fields, [key]: v.replace(',', '.') })} style={[styles.body, { borderWidth: 1, padding: 10 }]}/></View>)}
 <View style={{ flexDirection: 'row' }}>{(['gross', 'net'] as const).map(kind => <Pressable disabled={busy} key={kind} onPress={() => setProfile({ ...profile, rateKind: kind })} style={{ padding: 12 }}><Text style={styles.body}>{profile.rateKind === kind ? '◉' : '○'} {kind === 'gross' ? 'Brutto' : 'Netto'}</Text></Pressable>)}</View>
 <Text style={styles.body}>Zapisana stawka: {saved?.hourlyRatePln == null ? 'brak' : formatPln(saved.hourlyRatePln)} {saved?.rateKind === 'gross' ? 'brutto' : saved?.rateKind === 'net' ? 'netto' : ''}</Text>
 <Pressable disabled={busy} onPress={() => { if (busy)
            return; setError(''); const values: Record<string, number | null> = {}; for (const [key, text] of Object.entries(fields)) {
            if (text !== '' && !/^\d+(\.\d{1,2})?$/.test(text)) {
                setError(`${labels[key]}: niepoprawna liczba.`);
                return;
            }
            values[key] = text === '' ? null : Number(text);
            if (key.includes('Minutes') && values[key] !== null && !Number.isInteger(values[key])) {
                setError('Czas musi być liczbą całkowitą.');
                return;
            }
        } if (values.minRestMinutes === null) {
            setError('Podaj odpoczynek (może wynosić 0).');
            return;
        } setBusy(true); void saveWorkProfile({ ...profile, ...values } as WorkProfile).then(p => { apply(p); setAvailability(a => a ? { ...a, version: p.version } : a); }).catch(e => setError(e.message)).finally(() => setBusy(false)); }}><Text style={styles.body}>{busy ? 'Zapisywanie…' : 'Zapisz profil'}</Text></Pressable>
 <Pressable disabled={busy} onPress={() => { if (saved)
            apply(saved); setError(''); }}><Text style={styles.body}>Anuluj</Text></Pressable>
 {availability && <AvailabilityEditor key={revision} initial={availability} targetHours={saved?.targetHours ?? null} onSaved={refresh}/>}
 </>}</ScrollView>;
}
