import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { addCalendarDays, localDateKey, startOfWeek } from '../domain/calendar';
import { Button, Field, useTheme } from '../components/ui';
import { approveSchedule, generateSchedule, loadSchedule, loadScheduleSettings, NoClassesConfirmationRequired, rejectSchedule, saveSchedule, saveScheduleSettings, type ScheduleSettings, type ScheduleShift, type ShiftTemplate, type WeeklySchedule, type WorkMode } from '../services/scheduleApi';

type Props = { week: Date; setWeek: (value: Date) => void; now: Date; active: boolean; onApproved: () => void; onPreview: (schedule: WeeklySchedule | null) => void };
const modeLabel: Record<WorkMode, string> = { elastyczny: 'Elastyczny', zmianowy: 'Zmianowy' };
const statusLabel = { target_met: 'Cel osiągnięty', proven_infeasible: 'Cel niemożliwy przy tych ograniczeniach', not_found: 'Nie znaleziono pełnego grafiku' };
const minutesLabel = (minutes: number) => `${Math.floor(minutes / 60)} h${minutes % 60 ? ` ${minutes % 60} min` : ''}`;
const weekdays = ['Pn', 'Wt', 'Śr', 'Cz', 'Pt', 'Sb', 'Nd'];
const initialSettings: ScheduleSettings = { profileVersion: '', mode: 'elastyczny', minimumHours: 10, targetHours: 20, maximumHours: 40,
  commuteBufferMinutes: 15, minimumRestMinutes: 30, minimumShiftMinutes: 120, maximumSlotMinutes: 360, maxHoursPerDay: 8,
  availability: [], preferredWorkWindows: [], blockedPeriods: [], shiftTemplates: [] };

export default function ScheduleScreen({ week, setWeek, now, active, onApproved, onPreview }: Props) {
  const { palette, styles } = useTheme();
  const monday = startOfWeek(week);
  const weekStart = localDateKey(monday);
  const [schedule, setSchedule] = useState<WeeklySchedule | null>(null);
  const [settings, setSettings] = useState<ScheduleSettings>(initialSettings);
  const [settingsDirty, setSettingsDirty] = useState(false);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [workaholic, setWorkaholic] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState('');
  const [confirmNoClasses, setConfirmNoClasses] = useState(false);
  const [confirmReject, setConfirmReject] = useState(false);

  useEffect(() => {
    if (!active) return;
    let current = true;
    setLoading(true); setError(''); setDirty(false); setSchedule(null); onPreview(null);
    void loadSchedule(weekStart).then((value) => {
      if (!current) return;
      setSchedule(value);
      onPreview(value && !value.isApproved ? value : null);
      if (value) setWorkaholic(value.parameters.workaholic === true);
    }).catch((reason) => { if (current) setError(reason instanceof Error ? reason.message : 'Nie udało się wczytać grafiku.'); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [active, weekStart, onPreview]);

  useEffect(() => {
    if (!active || settingsLoaded) return;
    let current = true;
    void loadScheduleSettings().then((value) => {
      if (current) { setSettings(value); setSettingsDirty(false); setSettingsLoaded(true); }
    }).catch((reason) => { if (current) setError(reason instanceof Error ? reason.message : 'Nie udało się wczytać ustawień planu.'); });
    return () => { current = false; };
  }, [active, settingsLoaded]);

  useEffect(() => {
    onPreview(schedule && !schedule.isApproved ? schedule : null);
  }, [schedule, onPreview]);

  const changeSetting = <K extends keyof ScheduleSettings>(key: K, value: ScheduleSettings[K]) => {
    setSettings((current) => ({ ...current, [key]: value })); setSettingsDirty(true);
  };
  const changeTemplate = (id: string, update: Partial<ShiftTemplate>) => {
    setSettings((current) => ({ ...current, shiftTemplates: current.shiftTemplates.map((template) => template.id === id ? { ...template, ...update } : template) }));
    setSettingsDirty(true);
  };
  const changeAvailability = (id: string, update: Partial<ScheduleSettings['availability'][number]>) => {
    setSettings((current) => ({ ...current, availability: current.availability.map((window) => window.id === id ? { ...window, ...update } : window) }));
    setSettingsDirty(true);
  };
  const numericField = (key: 'minimumHours' | 'targetHours' | 'maximumHours' | 'commuteBufferMinutes' | 'minimumRestMinutes' | 'minimumShiftMinutes' | 'maximumSlotMinutes' | 'maxHoursPerDay', label: string) =>
    <Field label={label} value={String(settings[key])} onChangeText={(value) => changeSetting(key, Number(value.replace(',', '.')) || 0)} keyboardType="decimal-pad" editable={!loading && !saving} />;
  const saveSettings = async () => {
    setSaving(true); setError('');
    try { setSettings(await saveScheduleSettings(settings)); setSettingsDirty(false); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Nie udało się zapisać ustawień.'); }
    finally { setSaving(false); }
  };

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
    const template = schedule.mode === 'zmianowy' ? settings.shiftTemplates.find((item) => item.active) : undefined;
    if (schedule.mode === 'zmianowy' && !template) { setError('Dodaj i zapisz co najmniej jeden aktywny szablon zmiany.'); return; }
    const dayOffset = template ? Array.from({ length: 7 }, (_, index) => index).find((index) => template.daysOfWeek.includes(((monday.getDay() + 6 + index) % 7) + 1)) ?? 0 : 0;
    const shiftDate = addCalendarDays(monday, dayOffset), date = localDateKey(shiftDate);
    const startLocal = `${date}T${template?.startTime ?? '12:00'}`;
    const endDate = template?.endsNextDay ? localDateKey(addCalendarDays(shiftDate, 1)) : date;
    const endLocal = `${endDate}T${template?.endTime ?? '14:00'}`;
    const shift: ScheduleShift = { candidateId: `manual-${Date.now()}`, title: 'Praca', start: '', end: '', startLocal, endLocal,
      durationMinutes: 120, workDate: date, mode: schedule.mode, templateId: template?.id, optionalLectureIds: [], softPenalty: 0 };
    setSchedule({ ...schedule, shifts: [...schedule.shifts, shift] }); setDirty(true);
  };
  const applyTemplate = (shiftId: string, template: ShiftTemplate) => {
    if (!schedule) return;
    const updated = { ...schedule, shifts: schedule.shifts.map((shift) => {
      if (shift.candidateId !== shiftId) return shift;
      const date = shift.workDate, endDate = template.endsNextDay ? localDateKey(addCalendarDays(new Date(`${date}T00:00:00`), 1)) : date;
      return { ...shift, templateId: template.id, startLocal: `${date}T${template.startTime}`, endLocal: `${endDate}T${template.endTime}`,
        durationMinutes: template.endsNextDay ? 1440 - Number(template.startTime.slice(0, 2)) * 60 - Number(template.startTime.slice(3)) + Number(template.endTime.slice(0, 2)) * 60 + Number(template.endTime.slice(3)) :
          Number(template.endTime.slice(0, 2)) * 60 + Number(template.endTime.slice(3)) - Number(template.startTime.slice(0, 2)) * 60 - Number(template.startTime.slice(3)) };
    }) };
    setSchedule(updated); setDirty(true);
  };
  const removeShift = (id: string) => {
    if (!schedule) return;
    setSchedule({ ...schedule, shifts: schedule.shifts.filter((shift) => shift.candidateId !== id) }); setDirty(true);
  };
  const generate = async (confirmedNoClasses = false) => {
    if (!settingsLoaded) return;
    if (settings.minimumHours < 0 || settings.minimumHours > settings.targetHours || settings.targetHours > settings.maximumHours || settings.maximumHours > 80 || settings.maximumSlotMinutes < settings.minimumShiftMinutes) {
      setError('Sprawdź ustawienia: minimum ≤ cel ≤ maksimum, limit tygodniowy do 80 h oraz maksimum zmiany ≥ minimum.'); return;
    }
    setLoading(true); setError('');
    try {
      const savedSettings = settingsDirty ? await saveScheduleSettings(settings) : settings;
      setSettings(savedSettings); setSettingsDirty(false);
      setConfirmNoClasses(false);
      const generated = await generateSchedule(weekStart, savedSettings, workaholic, confirmedNoClasses);
      setSchedule(generated); onPreview(generated); setDirty(false);
    }
    catch (reason) {
      if (reason instanceof NoClassesConfirmationRequired) { setConfirmNoClasses(true); return; }
      setError(reason instanceof Error ? reason.message : 'Nie udało się wygenerować grafiku.');
    }
    finally { setLoading(false); }
  };
  const save = async () => {
    if (!schedule?.version) return;
    setSaving(true); setError('');
    try { const updated = await saveSchedule(weekStart, schedule.version, schedule.shifts); setSchedule(updated); onPreview(updated); setDirty(false); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Nie udało się zapisać zmian.'); }
    finally { setSaving(false); }
  };
  const approve = async () => {
    if (!schedule?.version || dirty || settingsDirty) return;
    setSaving(true); setError('');
    try { setSchedule(await approveSchedule(weekStart, schedule.version)); onPreview(null); onApproved(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Nie udało się zatwierdzić grafiku.'); }
    finally { setSaving(false); }
  };
  const reject = async () => {
    if (!schedule?.version) return;
    setSaving(true); setError('');
    try {
      const remaining = await rejectSchedule(weekStart, schedule.version);
      setSchedule(remaining); onPreview(remaining && !remaining.isApproved ? remaining : null); setDirty(false); setConfirmReject(false);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Nie udało się odrzucić propozycji.'); }
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
      <Text style={[styles.muted, { marginTop: 4, marginBottom: 12 }]}>Ustaw limity tygodnia, długość zmian i przerwy. Zatwierdzony plan pojawi się jako wydarzenia „Praca” w kalendarzu.</Text>
      <Text style={styles.label}>TRYB PRACY</Text>
      <View accessibilityRole="radiogroup" style={[styles.row, { flexWrap: 'wrap', marginBottom: 12 }]}>
        {(['elastyczny', 'zmianowy'] as const).map((value) => <Pressable key={value} accessibilityRole="radio" accessibilityState={{ checked: settings.mode === value }} onPress={() => changeSetting('mode', value)} style={{ paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: settings.mode === value ? palette.blue : palette.line, backgroundColor: settings.mode === value ? palette.blueSoft : palette.surfaceAlt }}><Text style={[styles.body, { fontWeight: '700' }]}>{modeLabel[value]}</Text></Pressable>)}
      </View>
      <View style={[styles.row, { flexWrap: 'wrap' }]}>{numericField('minimumHours', 'MINIMUM (GODZ./TYDZ.)')}{numericField('targetHours', 'PREFEROWANY CEL (GODZ./TYDZ.)')}{numericField('maximumHours', 'MAKSIMUM (GODZ./TYDZ.)')}</View>
      <View style={[styles.row, { flexWrap: 'wrap' }]}>{numericField('commuteBufferMinutes', 'BUFOR DOJAZDU (MIN)')}{numericField('minimumRestMinutes', 'MIN. ODPOCZYNEK (MIN)')}</View>
      <View style={[styles.row, { flexWrap: 'wrap' }]}>{numericField('minimumShiftMinutes', 'MIN. DŁUGOŚĆ ZMIANY (MIN)')}{numericField('maximumSlotMinutes', 'MAKS. DŁUGOŚĆ ZMIANY (MIN)')}{numericField('maxHoursPerDay', 'MAKS. GODZIN PRACY NA DZIEŃ')}</View>
      <View style={[styles.card, { borderColor: settings.availability.length ? palette.line : palette.amber }]}>
        <View style={[styles.row, { justifyContent: 'space-between', flexWrap: 'wrap' }]}><View><Text style={styles.heading}>Dostępność do pracy</Text><Text style={styles.muted}>Grafik będzie układany wyłącznie w tych oknach.</Text></View>
          <Button title="Dodaj okno" onPress={() => changeSetting('availability', [...settings.availability, { id: `availability-${Date.now()}`, dayOfWeek: 1, startTime: '08:00', endTime: '16:00' }])} /></View>
        {!settings.availability.length && <Text style={[styles.error, { marginTop: 8 }]}>Ustaw co najmniej jedno okno dostępności przed generowaniem grafiku.</Text>}
        {settings.availability.map((window) => <View key={window.id} style={{ paddingVertical: 10, borderTopWidth: 1, borderColor: palette.line }}>
          <View style={[styles.row, { flexWrap: 'wrap', alignItems: 'flex-end' }]}>
            <View style={[styles.row, { flexWrap: 'wrap' }]}>{weekdays.map((day, index) => <Pressable key={day} accessibilityRole="radio" accessibilityState={{ checked: window.dayOfWeek === index + 1 }} onPress={() => changeAvailability(window.id, { dayOfWeek: index + 1 })} style={[styles.button, window.dayOfWeek === index + 1 && { backgroundColor: palette.blueSoft, borderColor: palette.blue }]}><Text style={styles.buttonText}>{day}</Text></Pressable>)}</View>
            <View style={{ minWidth: 88 }}><Text style={styles.label}>OD</Text><TextInput accessibilityLabel="Początek dostępności" value={window.startTime} onChangeText={(startTime) => changeAvailability(window.id, { startTime })} style={styles.input} /></View>
            <View style={{ minWidth: 88 }}><Text style={styles.label}>DO</Text><TextInput accessibilityLabel="Koniec dostępności" value={window.endTime} onChangeText={(endTime) => changeAvailability(window.id, { endTime })} style={styles.input} /></View>
            <Button title="Usuń" danger onPress={() => changeSetting('availability', settings.availability.filter((item) => item.id !== window.id))} />
          </View>
        </View>)}
      </View>
      {settings.mode === 'zmianowy' && <View style={styles.card}>
        <View style={[styles.row, { justifyContent: 'space-between', flexWrap: 'wrap', marginBottom: 8 }]}><View><Text style={styles.heading}>Szablony zmian</Text><Text style={styles.muted}>Domyślne zmiany możesz zmienić lub dodać własne.</Text></View><Button title="Dodaj zmianę" onPress={() => { const id = `custom-${Date.now()}`; changeSetting('shiftTemplates', [...settings.shiftTemplates, { id, name: 'Nowa zmiana', startTime: '08:00', endTime: '16:00', endsNextDay: false, daysOfWeek: [1, 2, 3, 4, 5], active: true }]); }} /></View>
        {settings.shiftTemplates.map((template) => <View key={template.id} style={{ paddingVertical: 10, borderTopWidth: 1, borderColor: palette.line }}>
          <View style={[styles.row, { flexWrap: 'wrap' }]}>
            <Field label="NAZWA" value={template.name} onChangeText={(name) => changeTemplate(template.id, { name })} />
            <Field label="OD (HH:MM)" value={template.startTime} onChangeText={(startTime) => changeTemplate(template.id, { startTime })} />
            <Field label="DO (HH:MM)" value={template.endTime} onChangeText={(endTime) => changeTemplate(template.id, { endTime })} />
            <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: template.endsNextDay }} onPress={() => changeTemplate(template.id, { endsNextDay: !template.endsNextDay })} style={[styles.button, { marginBottom: 12 }]}><Text style={styles.buttonText}>{template.endsNextDay ? 'Kończy następnego dnia' : 'Kończy tego samego dnia'}</Text></Pressable>
            <Button title="Usuń" danger onPress={() => changeSetting('shiftTemplates', settings.shiftTemplates.filter((item) => item.id !== template.id))} />
          </View>
          <View style={[styles.row, { flexWrap: 'wrap' }]}>{weekdays.map((day, index) => {
            const dayOfWeek = index + 1, selected = template.daysOfWeek.includes(dayOfWeek);
            return <Pressable key={day} accessibilityRole="checkbox" accessibilityState={{ checked: selected }} onPress={() => changeTemplate(template.id, { daysOfWeek: selected ? template.daysOfWeek.filter((value) => value !== dayOfWeek) : [...template.daysOfWeek, dayOfWeek].sort() })} style={[styles.button, selected && { backgroundColor: palette.blueSoft, borderColor: palette.blue }]}><Text style={styles.buttonText}>{day}</Text></Pressable>;
          })}</View>
        </View>)}
      </View>}
      <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: workaholic }} onPress={() => setWorkaholic((value) => !value)} style={[styles.row, { alignSelf: 'flex-start', paddingVertical: 10, marginBottom: 8 }]}><Text style={{ color: palette.blue, fontSize: 18 }}>{workaholic ? '☑' : '□'}</Text><View><Text style={styles.body}>Pracoholik</Text><Text style={styles.muted}>Wyznacz maksymalną liczbę godzin możliwą do zaplanowania w tym tygodniu.</Text></View></Pressable>
      {settingsDirty && <Button title={saving ? 'Zapisywanie…' : 'Zapisz ustawienia planu'} disabled={saving || loading} onPress={() => void saveSettings()} />}
      <Button title={loading ? 'Przetwarzanie…' : 'Wygeneruj tydzień'} primary disabled={loading || saving || !settingsLoaded} onPress={() => void generate()} />
      {confirmNoClasses && <View accessibilityRole="alert" style={[styles.card, { borderColor: palette.amber }]}>
        <Text style={styles.heading}>Brak zajęć w wybranym tygodniu</Text><Text style={styles.body}>Czy mimo to wygenerować plan na podstawie dostępności i pozostałych wydarzeń?</Text>
        <View style={[styles.row, { flexWrap: 'wrap', marginTop: 10 }]}><Button title="Kontynuuj bez zajęć" primary disabled={loading || saving} onPress={() => void generate(true)} /><Button title="Anuluj" disabled={loading || saving} onPress={() => setConfirmNoClasses(false)} /></View>
      </View>}
    </View>

    {loading && <Text accessibilityLiveRegion="polite" style={styles.muted}>Wczytywanie propozycji…</Text>}
    {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
    {schedule && <>
      <View style={[styles.card, { borderColor: schedule.solutionStatus === 'target_met' ? palette.green : palette.amber }]}>
        <View style={[styles.row, { justifyContent: 'space-between', flexWrap: 'wrap' }]}><Text style={styles.heading}>{statusLabel[schedule.solutionStatus]}</Text><Text style={styles.muted}>Wersja {schedule.version ?? 1} · {modeLabel[schedule.mode]}{schedule.isApproved ? ' · zatwierdzony' : ' · propozycja'}</Text></View>
        <View style={[styles.row, { flexWrap: 'wrap', marginTop: 16 }]}>
          {[['Zaplanuj', minutesLabel(schedule.proposedMinutes)], ['Razem z pracą', minutesLabel(schedule.totalMinutes)], [workaholic ? 'Maks. nowe zmiany' : 'Cel', minutesLabel(workaholic ? schedule.proposedMinutes : schedule.targetMinutes)], ['Do celu', minutesLabel(schedule.shortfallMinutes)]].map(([label, value]) => <View key={label} style={{ flexGrow: 1, minWidth: 120, padding: 12, borderRadius: 12, backgroundColor: palette.surfaceAlt }}><Text style={styles.label}>{label.toUpperCase()}</Text><Text style={[styles.heading, { fontSize: 19 }]}>{value}</Text></View>)}
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
          {schedule.mode === 'zmianowy' && <View style={[styles.row, { flexWrap: 'wrap', marginTop: 8 }]} accessibilityLabel={`Szablon zmiany ${index + 1}`}>
            {settings.shiftTemplates.filter((template) => template.active).map((template) => <Pressable key={template.id} accessibilityRole="radio" accessibilityState={{ checked: shift.templateId === template.id }} onPress={() => applyTemplate(shift.candidateId, template)} style={[styles.button, shift.templateId === template.id && { backgroundColor: palette.blueSoft, borderColor: palette.blue }]}><Text style={styles.buttonText}>{template.name}</Text></Pressable>)}
          </View>}
        </View>)}
        {dirty && <Button title={saving ? 'Sprawdzanie i zapisywanie…' : 'Sprawdź i zapisz zmiany'} disabled={saving || loading || !schedule.version} onPress={() => void save()} />}
        {!schedule.isApproved && <Button title={saving ? 'Zatwierdzanie…' : 'Zatwierdź grafik i dodaj do kalendarza'} primary disabled={saving || loading || dirty || settingsDirty || !schedule.version} onPress={() => void approve()} />}
        {!schedule.isApproved && <Button title="Odrzuć propozycję" danger disabled={saving || loading || !schedule.version} onPress={() => setConfirmReject(true)} />}
        {confirmReject && !schedule.isApproved && <View accessibilityRole="alert" style={[styles.card, { borderColor: palette.red }]}>
          <Text style={styles.body}>{dirty ? 'Odrzucić propozycję i utracić niezapisane poprawki?' : 'Odrzucić tę propozycję? Zatwierdzone wcześniej wydarzenia pozostaną w kalendarzu.'}</Text>
          <View style={[styles.row, { flexWrap: 'wrap', marginTop: 8 }]}><Button title={saving ? 'Odrzucanie…' : 'Tak, odrzuć'} danger disabled={saving || loading} onPress={() => void reject()} /><Button title="Anuluj" disabled={saving || loading} onPress={() => setConfirmReject(false)} /></View>
        </View>}
        {schedule.isApproved && <Text style={[styles.muted, { color: palette.green, marginTop: 10 }]}>Zatwierdzone zmiany są widoczne jako wydarzenia „Praca” w widoku Tydzień.</Text>}
      </View>
    </>}
  </ScrollView>;
}
