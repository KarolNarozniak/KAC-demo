import Disclosure from '../components/Disclosure';
import DateField from '../components/DateField';
import TimeField from '../components/TimeField';
import SelectionMark from '../components/SelectionMark';
import {formatPln} from '../domain/pay';
import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { addCalendarDays, localDateKey, startOfWeek } from '../domain/calendar';
import { Button, useTheme } from '../components/ui';
import { classTimeLabel, conflictMessage, shiftClassConflicts, weekClasses } from '../domain/scheduleClasses';
import { useWorkProfile } from '../hooks/useWorkProfile';
import { hoursLimitLines, hoursLimitStatus } from '../domain/hoursLimit';
import WorkProfileScreen from './WorkProfileScreen';
import GooglePublication from '../components/GooglePublication';
import { approveSchedule, generateSchedule, loadSchedule, listSchedules, loadScheduleById, type ScheduleListItem, NoClassesConfirmationRequired, rejectSchedule, saveSchedule, type ScheduleShift, type ShiftTemplate, type WeeklySchedule, type WorkMode } from '../services/scheduleApi';

type Props = { week: Date; setWeek: (value: Date) => void; now: Date; active: boolean; onApproved: () => void; onPreview: (schedule: WeeklySchedule | null) => void;
  /** Informuje aplikację o niezapisanych zmianach profilu (pytanie przy wyjściu z zakładki – S23KC2S1P2-15, 3a). */
  onUnsavedChange?: (unsaved: boolean) => void;
  /** Zmiana wartości odrzuca niezapisane zmiany profilu (użytkownik wybrał „Odrzuć zmiany”). */
  discardSignal?: number;
  /** Publikacja bez połączonego konta albo bez zgody na zapis (historyjka 30, kroki 3–4a) prowadzi do Ustawień → Google Calendar. */
  onOpenSettings?: () => void };
const modeLabel: Record<WorkMode, string> = { elastyczny: 'Elastyczny', zmianowy: 'Zmianowy' };
const statusLabel = { target_met: 'Cel osiągnięty', proven_infeasible: 'Cel niemożliwy przy tych ograniczeniach', not_found: 'Nie znaleziono pełnego grafiku' };
const minutesLabel = (minutes: number) => `${Math.floor(minutes / 60)} h${minutes % 60 ? ` ${minutes % 60} min` : ''}`;
export default function ScheduleScreen({ week, setWeek, now, active, onApproved, onPreview, onUnsavedChange, discardSignal = 0, onOpenSettings }: Props) {
  const { palette, styles } = useTheme();
  const monday = startOfWeek(week);
  const weekStart = localDateKey(monday);
  const [profileOpen, setProfileOpen] = useState(false);
  const [schedule, setSchedule] = useState<WeeklySchedule | null>(null);
  const [history,setHistory]=useState<ScheduleListItem[]>([]);
  const [historyTotal,setHistoryTotal]=useState(0);
  const [historyReadOnly,setHistoryReadOnly]=useState(false);
  // Profil pracy (limity, cel, dojazd, dostępność, szablony) – S23KC2S1P2-15 i S23KC2S1P2-39.
  const profile = useWorkProfile(active);
  const templates = profile.saved?.shiftTemplates ?? [];
  const classes = weekClasses(schedule?.blockingEvents, schedule?.weekStart);
  const classCollision = !!schedule?.shifts.some((shift) => shiftClassConflicts(shift, schedule.blockingEvents).some((conflict) => conflict.blocking));
  const [workaholic, setWorkaholic] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState('');
  const [confirmNoClasses, setConfirmNoClasses] = useState(false);
  const [confirmReject, setConfirmReject] = useState(false);
  // S23KC2S1P2-301: „Rozumiem” tylko zwija ostrzeżenie – nie omija limitu; zmiana sum unieważnia potwierdzenie.
  const [limitAcknowledged, setLimitAcknowledged] = useState('');

  useEffect(() => {
    if (!active) return;
    let current = true;
    setLoading(true); setError(''); setDirty(false);setHistory([]);setHistoryTotal(0);setHistoryReadOnly(false); setSchedule(null); onPreview(null);
    void loadSchedule(weekStart).then((value) => {
      if (!current) return;
      setSchedule(value);
      onPreview(value && !value.isApproved ? value : null);
      if (value) setWorkaholic(value.parameters.workaholic === true);
    }).catch((reason) => { if (current) setError(reason instanceof Error ? reason.message : 'Nie udało się wczytać grafiku.'); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [active, weekStart, onPreview]);

  useEffect(() => { onUnsavedChange?.(profile.dirty); }, [profile.dirty, onUnsavedChange]);
  useEffect(() => { if (discardSignal) profile.cancel(); }, [discardSignal]);

  useEffect(() => {
    onPreview(schedule && !schedule.isApproved && !historyReadOnly ? schedule : null);
  }, [schedule, onPreview,historyReadOnly]);

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
    const template = schedule.mode === 'zmianowy' ? templates.find((item) => item.active) : undefined;
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
    if (!profile.saved) return;
    if (profile.dirty && !profile.valid) { setError('Popraw zaznaczone pola profilu pracy przed generowaniem grafiku.'); return; }
    setLoading(true); setError('');
    try {
      // Niezapisane zmiany profilu zapisujemy przed generowaniem, żeby grafik powstał z tych samych danych, które widać na ekranie.
      const savedProfile = profile.dirty ? await profile.save() : profile.saved;
      if (!savedProfile) return;
      setConfirmNoClasses(false);
      const generated = await generateSchedule(weekStart, savedProfile, workaholic, confirmedNoClasses);
      setSchedule(generated);setHistoryReadOnly(false); onPreview(generated); setDirty(false);
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
    if (!schedule?.version || dirty || profile.dirty) return;
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
  async function loadHistory(append=false){
    setLoading(true);setError('');
    try{const page=await listSchedules(weekStart,weekStart,20,append?history.length:0);setHistory(old=>append?[...old,...page.items]:page.items);setHistoryTotal(page.total);}catch(e){setError((e as Error).message);}finally{setLoading(false);}
  }
  async function selectHistory(id:string){
    setLoading(true);setError('');
    try{setSchedule(await loadScheduleById(id));setHistoryReadOnly(true);setConfirmReject(false);setDirty(false);onPreview(null);}catch(e){setError((e as Error).message);}finally{setLoading(false);}
  }
  const shiftCount = schedule?.shifts.length ?? 0;
  const limit = schedule && !historyReadOnly && !schedule.isApproved ? hoursLimitStatus(schedule, dirty) : null;
  const limitLines = limit ? hoursLimitLines(limit) : [];
  const limitCollapsed = !!limit && limitAcknowledged === limit.acknowledgementKey;

  const setup = <>
    <View style={[styles.card, { gap: 12 }]}>
      <View style={[styles.row, { justifyContent: 'space-between', flexWrap: 'wrap' }]}><View style={{ flex: 1 }}><Text style={styles.heading}>Twój profil pracy</Text><Text style={styles.subtitle}>{profile.saved ? `${profile.saved.weeklyTargetHours} h tygodniowo · ${profile.saved.hourlyRatePln ?? '—'} PLN / h · ${modeLabel[profile.saved.mode]}` : 'Ustaw dostępność i cel godzinowy'}</Text></View><Button title={profileOpen ? 'Zwiń profil' : 'Edytuj profil'} onPress={() => setProfileOpen(value => !value)} /></View>
      <Text style={styles.muted}>Grafik uwzględnia Twoje zajęcia, dojazdy i czas na odpoczynek.</Text>
    </View>
    {(profileOpen || !profile.saved) && <WorkProfileScreen blockingEvents={schedule?.blockingEvents} state={profile} disabled={loading} />}

    <View style={styles.card}>
      <Text style={styles.heading}>Generowanie tygodnia</Text>
      <Text style={[styles.muted, { marginTop: 4, marginBottom: 8 }]}>Zatwierdzony plan pojawi się jako wydarzenia „Praca” w kalendarzu.</Text>
      <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: workaholic }} onPress={() => setWorkaholic((value) => !value)} style={[styles.row, { alignSelf: 'flex-start', alignItems: 'flex-start', paddingVertical: 10, marginBottom: 8 }]}><SelectionMark checked={workaholic} /><View style={{ flex: 1 }}><Text style={styles.body}>Pracoholik</Text><Text style={styles.muted}>Wyznacz maksymalną liczbę godzin możliwą do zaplanowania w tym tygodniu.</Text></View></Pressable>
      <Button title={loading ? 'Przetwarzanie…' : profile.dirty ? 'Zapisz profil i wygeneruj tydzień' : 'Wygeneruj tydzień'} primary disabled={loading || saving || profile.saving || !profile.saved} onPress={() => void generate()} />
      {confirmNoClasses && <View accessibilityRole="alert" style={[styles.card, { borderColor: palette.amber }]}>
        <Text style={styles.heading}>Brak zajęć w wybranym tygodniu</Text><Text style={styles.body}>Czy mimo to wygenerować plan na podstawie dostępności i pozostałych wydarzeń?</Text>
        <View style={[styles.row, { flexWrap: 'wrap', marginTop: 10 }]}><Button title="Kontynuuj bez zajęć" primary disabled={loading || saving} onPress={() => void generate(true)} /><Button title="Anuluj" disabled={loading || saving} onPress={() => setConfirmNoClasses(false)} /></View>
      </View>}
    </View>

  </>;

  if (profileOpen) return <View style={{ flex: 1 }}>
    <ScrollView style={{ flex: 1, minWidth: 0 }} contentContainerStyle={{ width: '100%', maxWidth: 880, alignSelf: 'center', padding: 16, paddingBottom: 32 }}>
      <View style={[styles.row, { justifyContent: 'space-between', flexWrap: 'wrap', marginBottom: 20 }]}><Text style={styles.title}>Profil pracy</Text><Button title="Wróć do planu" onPress={() => setProfileOpen(false)} /></View>
      <WorkProfileScreen blockingEvents={schedule?.blockingEvents} state={profile} disabled={loading} showSaveActions={false} />
    </ScrollView>
    <View style={{ borderTopWidth: 1, borderColor: palette.line, backgroundColor: palette.surface, padding: 16 }}><View style={[styles.row, { width: '100%', maxWidth: 848, alignSelf: 'center', flexWrap: 'wrap', justifyContent: 'space-between' }]}><Text accessibilityLiveRegion="polite" style={styles.muted}>{profile.conflict ? 'Rozwiąż konflikt wersji w formularzu.' : profile.dirty ? 'Masz niezapisane zmiany' : 'Wszystkie zmiany zapisane'}</Text>{profile.dirty && <Button title="Anuluj zmiany" disabled={profile.saving} onPress={profile.cancel} />}<Button title={profile.saving ? 'Zapisywanie…' : 'Zapisz profil'} primary disabled={!profile.dirty || !profile.valid || profile.saving || !!profile.conflict} onPress={() => void profile.save()} /></View></View>
  </View>;

  return <ScrollView style={{ flex: 1, minWidth: 0 }} horizontal={false} contentContainerStyle={{ width: '100%', maxWidth: 1120, alignSelf: 'center', padding: 16, paddingBottom: 40 }}>
    <View style={[styles.row, { flexWrap: 'wrap', justifyContent: 'space-between', marginBottom: 12 }]}>
      <Text style={[styles.title, { fontSize: 25 }]}>Plan pracy</Text>
      <View style={styles.row}><Button title="‹" accessibilityLabel="Poprzedni tydzień" onPress={() => setWeek(addCalendarDays(monday, -7))} /><Button title="Dzisiaj" onPress={() => setWeek(now)} /><Button title="›" accessibilityLabel="Następny tydzień" onPress={() => setWeek(addCalendarDays(monday, 7))} /></View>
    </View>
    <Text style={[styles.subtitle, { marginTop: 0, marginBottom: 14 }]}>{selectedWeek}</Text>

    {!schedule && setup}
    {historyReadOnly&&<Text style={styles.muted}>Oglądasz zapisany grafik w trybie odczytu. Stawki i kwoty pochodzą z historii. Nową propozycję utworzysz przyciskiem „Wygeneruj tydzień”.</Text>}
    {loading && <Text accessibilityLiveRegion="polite" style={styles.muted}>Wczytywanie propozycji…</Text>}
    {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
    {schedule && <>
      <View style={[styles.card, { borderColor: schedule.solutionStatus === 'target_met' ? palette.green : palette.amber }]}>
        <View style={[styles.row, { justifyContent: 'space-between', flexWrap: 'wrap' }]}><Text style={styles.heading}>{!schedule.isApproved && schedule.solutionStatus === 'target_met' ? 'Proponowany grafik' : statusLabel[schedule.solutionStatus]}</Text><Text style={styles.muted}>Wersja {schedule.version ?? 1} · {modeLabel[schedule.mode]}{schedule.isApproved ? ' · zatwierdzony' : ' · propozycja'}</Text></View>
        <View style={[styles.row, { flexWrap: 'wrap', justifyContent: 'space-between', marginTop: 14 }]}><Text style={[styles.heading, { fontSize: 22 }]}>{minutesLabel(schedule.totalMinutes)} / cel {minutesLabel(schedule.targetMinutes)}</Text>{schedule.estimatedPayPln !== undefined && <Text style={[styles.heading, { color: palette.green }]}>{formatPln(schedule.estimatedPayPln)}{dirty ? ' · do przeliczenia' : ' · nowe zmiany'}</Text>}</View>
        <Text style={[styles.muted, { marginTop: 8 }]}>Nowe zmiany: {minutesLabel(schedule.proposedMinutes)} · W kalendarzu: {minutesLabel(schedule.existingWorkMinutes)}</Text>
        <Text style={[styles.muted, { marginTop: 6 }]}>{classes.length ? `Zajęcia uwzględnione w planowaniu: ${classes.length}` : 'Brak zajęć w kalendarzu dla tego tygodnia'}</Text>
        {!!schedule.optionalLecturesSkipped.length && <Text style={[styles.muted, { marginTop: 12 }]}>Pominięte zajęcia nieobowiązkowe: {schedule.optionalLecturesSkipped.join(', ')}</Text>}
        {schedule.violations.filter((violation) => !limit?.exceeded || !['maximum_hours', 'daily_maximum_hours', 'existing_work_exceeds_maximum'].includes(violation.code)).map((violation, index) => <Text key={`${violation.code}-${index}`} style={[styles.muted, { marginTop: 8, color: violation.severity === 'error' ? palette.red : palette.amber }]}>{violation.message}</Text>)}
      </View>

      {limit?.exceeded && <View accessibilityRole="alert" style={[styles.card, { borderColor: palette.red }]}>
        <View style={[styles.row, { justifyContent: 'space-between', flexWrap: 'wrap' }]}>
          <Text style={[styles.heading, { color: palette.red }]}>Przekroczony limit godzin pracy</Text>
          {limitCollapsed ? <Button title="Pokaż szczegóły" onPress={() => setLimitAcknowledged('')} /> : <Button title="Rozumiem" onPress={() => setLimitAcknowledged(limit.acknowledgementKey)} />}
        </View>
        {!limitCollapsed && limitLines.map((line) => <Text key={line} style={[styles.body, { marginTop: 6 }]}>{line}</Text>)}
        <Text style={[styles.muted, { marginTop: 8 }]}>{limitCollapsed ? 'Ostrzeżenie przeczytane. ' : ''}Grafiku ponad limit nie można zatwierdzić – usuń albo skróć zmiany, a potem kliknij „Sprawdź i zapisz zmiany”. Limit zmienisz w profilu pracy.</Text>
      </View>}

      <View style={styles.card}>
        <View style={[styles.row, { justifyContent: 'space-between', flexWrap: 'wrap', marginBottom: 12 }]}><View><Text style={styles.heading}>Proponowane zmiany</Text><Text style={styles.muted}>{shiftCount} zmian · możesz poprawić godziny przed zapisaniem</Text></View><Button title="Dodaj zmianę" disabled={saving || loading || historyReadOnly} onPress={addShift} /></View>
        {!schedule.shifts.length && <Text style={styles.muted}>Brak zmian. Dodaj zmianę albo zmień ograniczenia.</Text>}
        {schedule.shifts.map((shift, index) => <Disclosure key={shift.candidateId} title={`${new Date(shift.startLocal).toLocaleDateString('pl-PL', { weekday: 'short', day: 'numeric', month: 'short' })} · ${shift.startLocal.slice(11,16)}–${shift.endLocal.slice(11,16)}`} summary={`${minutesLabel(shift.durationMinutes)}${shift.estimatedPayPln !== undefined ? ` · ${formatPln(shift.estimatedPayPln)}` : ''} · rozwiń, aby edytować`}>
          <View style={[styles.row, { flexWrap: 'wrap', alignItems: 'flex-end' }]}>
            <DateField disabled={historyReadOnly} label="Dzień rozpoczęcia" value={shift.startLocal.split('T')[0]} onChange={value => changeShift(shift.candidateId, 'startLocal', `${value}T${shift.startLocal.split('T')[1]}`)} />
            <TimeField label="Początek" disabled={historyReadOnly} value={shift.startLocal.split('T')[1]} onChange={value => changeShift(shift.candidateId, 'startLocal', `${shift.startLocal.split('T')[0]}T${value}`)} />
            <DateField disabled={historyReadOnly} label="Dzień zakończenia" value={shift.endLocal.split('T')[0]} onChange={value => changeShift(shift.candidateId, 'endLocal', `${value}T${shift.endLocal.split('T')[1]}`)} />
            <TimeField label="Koniec" disabled={historyReadOnly} value={shift.endLocal.split('T')[1]} onChange={value => changeShift(shift.candidateId, 'endLocal', `${shift.endLocal.split('T')[0]}T${value}`)} />
            <Text style={[styles.muted, { paddingBottom: 10 }]}>{minutesLabel(shift.durationMinutes)}</Text>
            <Button title="Usuń" danger disabled={historyReadOnly} onPress={() => removeShift(shift.candidateId)} />
          </View>
          {shift.hourlyRatePln !== undefined && <Text style={styles.body}>{formatPln(shift.hourlyRatePln)}/h · {formatPln(shift.estimatedPayPln ?? 0)} {shift.rateKind === 'gross' ? 'brutto' : shift.rateKind === 'net' ? 'netto' : ''}</Text>}
          <Text style={styles.muted}>Dojazd: {profile.saved?.commuteBufferMinutes ?? 0} min przed i po zmianie — czas niepłatny.</Text>
          {(() => {
            // S23KC2S1P2-195: wskazanie zajęć kolidujących ze zmianą – od razu przy ręcznej edycji, przed zapisem.
            const message = conflictMessage(shiftClassConflicts(shift, schedule.blockingEvents));
            return <>
              {!!message.blocking && <Text accessibilityRole="alert" style={[styles.error, { marginTop: 6 }]}>{message.blocking}</Text>}
              {!!message.optional && <Text style={[styles.muted, { marginTop: 6, color: palette.amber }]}>{message.optional}</Text>}
            </>;
          })()}
          {!historyReadOnly && schedule.mode === 'zmianowy' && <View style={[styles.row, { flexWrap: 'wrap', marginTop: 8 }]} accessibilityLabel={`Szablon zmiany ${index + 1}`}>
            {templates.filter((template) => template.active).map((template) => <Pressable key={template.id} accessibilityRole="radio" accessibilityState={{ checked: shift.templateId === template.id }} onPress={() => applyTemplate(shift.candidateId, template)} style={[styles.button, shift.templateId === template.id && { backgroundColor: palette.blueSoft, borderColor: palette.blue }]}><Text style={styles.buttonText}>{template.name}</Text></Pressable>)}
          </View>}
        </Disclosure>)}
        {dirty && <Button title={saving ? 'Sprawdzanie i zapisywanie…' : 'Sprawdź i zapisz zmiany'} disabled={saving || loading || !schedule.version} onPress={() => void save()} />}
        {!historyReadOnly && !schedule.isApproved && classCollision && <Text accessibilityRole="alert" style={styles.error}>Zmień albo usuń zmiany kolidujące z zajęciami obowiązkowymi – takiego grafiku nie można zatwierdzić.</Text>}
        {!historyReadOnly && !schedule.isApproved && <Button title={saving ? 'Zatwierdzanie…' : 'Zatwierdź grafik i dodaj do kalendarza'} primary disabled={saving || loading || dirty || profile.dirty || classCollision || !!limit?.exceeded || !schedule.version} onPress={() => void approve()} />}
        {!historyReadOnly && !schedule.isApproved && <View style={{ marginTop: 16, alignSelf: 'flex-start' }}><Button title="Odrzuć propozycję" danger disabled={saving || loading || !schedule.version} onPress={() => setConfirmReject(true)} /></View>}
        {!historyReadOnly && confirmReject && !schedule.isApproved && <View accessibilityRole="alert" style={[styles.card, { borderColor: palette.red }]}>
          <Text style={styles.body}>{dirty ? 'Odrzucić propozycję i utracić niezapisane poprawki?' : 'Odrzucić tę propozycję? Zatwierdzone wcześniej wydarzenia pozostaną w kalendarzu.'}</Text>
          <View style={[styles.row, { flexWrap: 'wrap', marginTop: 8 }]}><Button title={saving ? 'Odrzucanie…' : 'Tak, odrzuć'} danger disabled={saving || loading} onPress={() => void reject()} /><Button title="Anuluj" disabled={saving || loading} onPress={() => setConfirmReject(false)} /></View>
        </View>}
        {schedule.isApproved && <Text style={[styles.muted, { color: palette.green, marginTop: 10 }]}>Zatwierdzone zmiany są widoczne jako wydarzenia „Praca” w widoku Tydzień.</Text>}
        {/* Symulowana publikacja zaakceptowanego grafiku w Google Calendar (S23KC2S1P2-30, G07). */}
        <GooglePublication weekStart={weekStart} schedule={schedule} readOnly={historyReadOnly} onOpenSettings={onOpenSettings} />
      </View>
      {/* S23KC2S1P2-40: zajęcia uwzględnione przy planowaniu tego tygodnia (serie rozwinięte na konkretne daty). */}
      <Disclosure title="Zajęcia i wolne okna" summary={`${classes.length} zajęć uwzględnionych w planowaniu`}>
        <Text style={[styles.muted, { marginTop: 4, marginBottom: 8 }]}>Praca nie jest planowana w czasie zajęć obowiązkowych ani dojazdu przed i po nich. Zajęcia nieobowiązkowe są pomijane tylko wtedy, gdy inaczej nie da się zbliżyć do celu.</Text>
        {!classes.length && <Text style={styles.muted}>Brak zajęć w kalendarzu na ten tydzień.</Text>}
        {classes.map((event) => <View key={`${event.eventId}-${event.start}`} style={[styles.row, { flexWrap: 'wrap', paddingVertical: 6, borderTopWidth: 1, borderColor: palette.line }]}>
          <Text style={[styles.body, { minWidth: 150 }]}>{classTimeLabel(event)}</Text>
          <Text style={[styles.body, { flex: 1, fontWeight: '700' }]}>{event.title}{event.repeatWeekly ? ' · co tydzień' : ''}</Text>
          <Text style={[styles.muted, { color: event.mandatory ? palette.red : palette.muted }]}>{event.mandatory ? 'obowiązkowe' : 'nieobowiązkowe'}</Text>
        </View>)}
        {typeof schedule.freeMinutes === 'number' && <Text style={[styles.muted, { marginTop: 10 }]}>Wolny czas na pracę w dostępności po odjęciu zajęć i dojazdów: {minutesLabel(schedule.freeMinutes)}.</Text>}
      </Disclosure>

    </>}
    {schedule && <Disclosure title="Profil i generowanie nowego planu" summary="Zmień dostępność lub przygotuj inną propozycję">{setup}</Disclosure>}
    <View style={{ gap: 10, marginVertical: 16 }}>
      <Button title="Historia wybranego tygodnia" disabled={loading||saving||dirty} onPress={()=>void loadHistory()}/>
      {history.map(item=><Button key={item.scheduleId} title={`${item.status} · ${minutesLabel(item.totalMinutes)} · wersja ${item.version}`} disabled={loading||saving||dirty} onPress={()=>void selectHistory(item.scheduleId)}/>)}
      {history.length<historyTotal&&<Button title="Pokaż więcej" disabled={loading} onPress={()=>void loadHistory(true)}/>}
    </View>
  </ScrollView>;
}
