import React, { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { Button, Field, useTheme } from './ui';
import { loadWorkProfile, saveWorkProfile, WorkProfileConflictError, WorkProfileError } from '../services/workProfileApi';

export default function RestSettings() {
  const { styles } = useTheme();
  const [version, setVersion] = useState('');
  const [hoursInput, setHoursInput] = useState('0');
  const [minutesInput, setMinutesInput] = useState('0');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [formError, setFormError] = useState('');
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true); setLoadError('');
    try {
      const profile = await loadWorkProfile();
      setVersion(profile.version);
      setHoursInput(String(Math.floor(profile.minRestMinutes / 60)));
      setMinutesInput(String(profile.minRestMinutes % 60));
    } catch (error) { setLoadError(error instanceof Error ? error.message : 'Nie udało się wczytać ustawień odpoczynku.'); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);

  const save = async () => {
    setFormError(''); setNotice('');
    const hours = Number(hoursInput); const minutes = Number(minutesInput);
    if (!Number.isInteger(hours) || hours < 0 || !Number.isInteger(minutes) || minutes < 0 || minutes > 59) {
      setFormError('Wpisz poprawną liczbę godzin (≥ 0) i minut (0–59).'); return; // 4a
    }
    setSaving(true);
    try {
      const profile = await saveWorkProfile(version, hours * 60 + minutes);
      setVersion(profile.version);
      setNotice('Ustawienia odpoczynku zapisane.');
    } catch (error) {
      if (error instanceof WorkProfileConflictError) { setFormError(error.message); await load(); }
      else if (error instanceof WorkProfileError) setFormError(error.message);
      else setFormError(error instanceof Error ? error.message : 'Nie udało się zapisać ustawień.');
    } finally { setSaving(false); }
  };

  if (loading) return <Text style={styles.muted}>Wczytywanie ustawień odpoczynku…</Text>;
  return <View style={{ marginTop: 24 }}>
    <Text style={[styles.heading, { marginBottom: 4 }]}>Odpoczynek między zmianami</Text>
    <Text style={[styles.subtitle, { marginBottom: 12 }]}>Minimalna przerwa, jaką planer musi zostawić między kolejnymi zmianami pracy.</Text>
    {!!loadError && <Text accessibilityRole="alert" style={styles.error}>{loadError}</Text>}
    <View style={{ flexDirection: 'row', gap: 12 }}>
      <Field label="GODZINY" keyboardType="number-pad" value={hoursInput} onChangeText={setHoursInput} invalid={!!formError} />
      <Field label="MINUTY" keyboardType="number-pad" value={minutesInput} onChangeText={setMinutesInput} invalid={!!formError} />
    </View>
    {!!formError && <Text accessibilityRole="alert" style={styles.error}>{formError}</Text>}
    {!!notice && <Text accessibilityLiveRegion="polite" style={styles.muted}>{notice}</Text>}
    <Button title={saving ? 'Zapisywanie…' : 'Zapisz'} primary disabled={saving} onPress={() => void save()} />
  </View>;
}