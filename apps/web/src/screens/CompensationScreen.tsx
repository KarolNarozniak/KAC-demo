import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView } from 'react-native';
import { useTheme } from '../components/ui';
import AvailabilityEditor from '../components/AvailabilityEditor';
import { getWorkProfile, saveWorkProfile, getAvailability, formatPln, type WorkProfile, type Availability } from '../services/compensationApi';

const labels: Record<string, string> = {
  hourlyRatePln: 'Stawka PLN (0 dozwolone)',
  commuteMinutes: 'Dojazd w pełnych minutach (puste = brak ustawienia)',
  minRestMinutes: 'Odpoczynek między zmianami (minuty)',
  minHours: 'Minimum godzin tygodniowo',
  targetHours: 'Cel godzin tygodniowo',
  maxHours: 'Maksimum godzin tygodniowo',
};

export default function WorkProfileScreen() {
  const { styles } = useTheme();
  const [profile, setProfile] = useState<WorkProfile | null>(null);
  const [saved, setSaved] = useState<WorkProfile | null>(null);
  const [availability, setAvailability] = useState<Availability | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [revision, setRevision] = useState(0);

  function apply(value: WorkProfile) {
    setProfile(value); setSaved(value);
    setFields(Object.fromEntries(Object.keys(labels).map(key => [key, String(value[key as keyof WorkProfile] ?? '')])));
  }
  useEffect(() => {
    let cancelled = false;
    setBusy(true);
    void Promise.all([getWorkProfile(), getAvailability()]).then(([value, available]) => {
      if (cancelled) return;
      apply(value); setAvailability(available); setError('');
    }).catch(e => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setBusy(false); });
    return () => { cancelled = true; };
  }, [revision]);

  // Availability changes advance the same profile version; retain the profile draft.
  function refreshVersion() {
    void getWorkProfile().then(value => {
      setProfile(old => old ? { ...old, version: value.version } : value);
      setSaved(value);
    }).catch(e => setError(e.message));
  }
  async function save() {
    if (busy || pending.current || !profile) return;
    setError(''); setMessage('');
    const values: Record<string, number | null> = {};
    for (const [key, text] of Object.entries(fields)) {
      if (text !== '' && !/^\d+(\.\d{1,2})?$/.test(text)) {
        setError(`${labels[key]}: niepoprawna liczba.`); return;
      }
      values[key] = text === '' ? null : Number(text);
      if (key.includes('Minutes') && values[key] !== null && !Number.isInteger(values[key])) {
        setError('Czas musi być liczbą całkowitą.'); return;
      }
    }
    if (values.minRestMinutes === null) { setError('Podaj odpoczynek (może wynosić 0).'); return; }
    pending.current = true; setBusy(true);
    try {
      const result = await saveWorkProfile({ ...profile, ...values } as WorkProfile);
      apply(result);
      setAvailability(old => old ? { ...old, version: result.version } : old);
      setMessage('Zapisano profil pracy.');
    } catch (e) { setError((e as Error).message); }
    finally { pending.current = false; setBusy(false); }
  }

  return <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
    <Text style={styles.heading}>Stawka i dostępność</Text>
    <Text style={styles.body}>Cel tutaj podajesz tygodniowo. Cel miesięczny ustawisz w zakładce Grafik. Zapis samej stawki zachowuje wybrany okres celu.</Text>
    <Pressable disabled={busy} onPress={() => { setMessage(''); setRevision(n => n + 1); }}>
      <Text style={styles.body}>{busy ? 'Wczytywanie lub zapisywanie…' : 'Wczytaj profil ponownie'}</Text>
    </Pressable>
    {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
    {!!message && <Text style={styles.body}>{message}</Text>}
    {profile && <>
      {Object.entries(labels).map(([key, label]) => <View key={key}>
        <Text style={styles.body}>{label}</Text>
        <TextInput accessibilityLabel={label} editable={!busy}
          keyboardType={key.includes('Minutes') ? 'number-pad' : 'decimal-pad'} value={fields[key]}
          onChangeText={value => setFields({ ...fields, [key]: value.replace(',', '.') })}
          style={[styles.body, { borderWidth: 1, padding: 10 }]} />
      </View>)}
      <View style={{ flexDirection: 'row' }}>
        {(['gross', 'net'] as const).map(kind => <Pressable key={kind} disabled={busy}
          onPress={() => setProfile({ ...profile, rateKind: kind })} style={{ padding: 12 }}>
          <Text style={styles.body}>{profile.rateKind === kind ? '◉' : '○'} {kind === 'gross' ? 'Brutto' : 'Netto'}</Text>
        </Pressable>)}
      </View>
      <Text style={styles.body}>Zapisana stawka: {saved?.hourlyRatePln == null ? 'brak' : formatPln(saved.hourlyRatePln)} {saved?.rateKind === 'gross' ? 'brutto' : saved?.rateKind === 'net' ? 'netto' : ''}</Text>
      <Pressable disabled={busy} onPress={() => void save()}><Text style={styles.body}>Zapisz profil</Text></Pressable>
      <Pressable disabled={busy} onPress={() => { if (saved) apply(saved); setError(''); setMessage(''); }}>
        <Text style={styles.body}>Anuluj</Text>
      </Pressable>
      {availability && <AvailabilityEditor key={revision} initial={availability}
        targetHours={saved?.targetHours ?? null} onSaved={refreshVersion} />}
    </>}
  </ScrollView>;
}
