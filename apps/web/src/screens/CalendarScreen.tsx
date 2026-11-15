import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import type { CalendarEvent, Category, Occurrence } from '../domain/model';
import { addCalendarDays, localDateKey, occurrencesForRange, startOfWeek, validateEventInput } from '../domain/calendar';
import { loadCalendar, createEvent, updateEvent, EventCollisionError, type EventCollision, deleteEvent, checkEventCollisions } from '../services/calendarApi';
import { collisionSummary, describeCollision } from '../domain/collisions';
import { Button, Field, useTheme } from '../components/ui';
import DateField from '../components/DateField';
import TimeField from '../components/TimeField';
import WeekGrid, { type WeekLayout } from '../components/WeekGrid';
import type { WeeklySchedule } from '../services/scheduleApi';
import type { DueNotification } from '../services/notificationsApi';
import { PLAN_CHANGE_TYPE, planChangeLines, planChangeOutdated, resolveNotificationTarget } from '../domain/notifications';
import { getAssistantConfig, getDailySummary } from '../services/assistantApi';
import ClassScheduleImport from '../components/ClassScheduleImport';
import WorkScheduleImport from '../components/WorkScheduleImport';
import GoogleCalendarImport from '../components/GoogleCalendarImport';
const categories: Category[] = ['Class', 'Work', 'Personal'];
const labels: Record<Category, string> = { Class: 'Zajęcia', Work: 'Praca', Personal: 'Prywatne' };
type Props = { week: Date; setWeek: (value: Date) => void; todayOnly?: boolean; weekLayout: WeekLayout; now: Date; active: boolean; draftSchedule?: WeeklySchedule | null;
  notificationTarget?: DueNotification | null; onNotificationResolved?: () => void };
export default function CalendarScreen({ week, setWeek, todayOnly = false, weekLayout, now, active, draftSchedule, notificationTarget, onNotificationResolved }: Props) {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [dailySummary, setDailySummary] = useState<{ date: string; text: string } | null>(null);
  const [dailySummaryLoading, setDailySummaryLoading] = useState(false);
  const [dailySummaryError, setDailySummaryError] = useState('');
  const summaryAttemptedDate = useRef('');
  const summaryRequesting = useRef(false);
  const [loadError, setLoadError] = useState('');
  const [saving, setSaving] = useState(false);
  const [classImportOpen, setClassImportOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [googleImportOpen, setGoogleImportOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const reload = async () => {
    setLoading(true); setLoadError('');
    try { setEvents(await loadCalendar()); }
    catch (error) { setLoadError(error instanceof Error ? error.message : 'Nie udało się wczytać wydarzeń.'); }
    finally { setLoading(false); }
  };
  useEffect(() => { if (active) void reload(); }, [active]);
  const { palette, styles } = useTheme();
  const colors: Record<Category, string> = { Class: palette.class, Work: palette.work, Personal: palette.personal };
  const { width: viewportWidth } = useWindowDimensions();
  const compact = viewportWidth < 760;
  const [dialog, setDialog] = useState<'form' | 'details' | 'collision' | 'delete' | null>(null);
  const [selected, setSelected] = useState<Occurrence | null>(null); const [draft, setDraft] = useState<CalendarEvent | null>(null);
  const [error, setError] = useState(''); const [conflicts, setConflicts] = useState<EventCollision[]>([]); const [pending, setPending] = useState<CalendarEvent | null>(null);
  const monday = startOfWeek(todayOnly ? now : week); const weekDays = useMemo(() => Array.from({ length: 7 }, (_, i) => addCalendarDays(monday, i)), [monday.getTime()]);
  const todayKey = localDateKey(now);
  const requestDailySummary = useCallback(async (refresh = false) => {
    if (summaryRequesting.current || (!refresh && summaryAttemptedDate.current === todayKey)) return;
    summaryRequesting.current = true;
    summaryAttemptedDate.current = todayKey;
    setDailySummaryLoading(true); setDailySummaryError('');
    try {
      const config = await getAssistantConfig();
      if (!config.enabled) throw new Error('Asystent AI jest niedostępny. Sprawdź konfigurację Azure AI i spróbuj ponownie.');
      const result = await getDailySummary(todayKey, refresh);
      setDailySummary({ date: todayKey, text: result.text });
    } catch (error) {
      setDailySummaryError(error instanceof Error ? error.message : 'Nie udało się przygotować podsumowania dnia.');
    } finally {
      summaryRequesting.current = false;
      setDailySummaryLoading(false);
    }
  }, [todayKey]);
  useEffect(() => {
    if (!active || !todayOnly || loading || loadError || summaryAttemptedDate.current === todayKey) return;
    void requestDailySummary();
  }, [active, todayOnly, loading, loadError, todayKey, requestDailySummary]);
  const list = useMemo(() => occurrencesForRange(events, { start: monday, end: addCalendarDays(monday, 7) }), [events, monday.getTime()]);
  // S23KC2S1P2-299: po kliknięciu „Zmiana planu” najpierw ładujemy aktualny stan kalendarza, potem otwieramy wydarzenie z różnicą.
  const [refreshedFor, setRefreshedFor] = useState('');
  const [planChange, setPlanChange] = useState<{ lines: string[]; outdated: boolean } | null>(null);
  useEffect(() => {
    if (!active || !notificationTarget || notificationTarget.type !== PLAN_CHANGE_TYPE || refreshedFor === notificationTarget.id) return;
    const id = notificationTarget.id;
    void reload().finally(() => setRefreshedFor(id));
  }, [active, notificationTarget, refreshedFor]);
  useEffect(() => {
    if (!active || loading || !notificationTarget) return;
    const isPlanChange = notificationTarget.type === PLAN_CHANGE_TYPE;
    if (isPlanChange && refreshedFor !== notificationTarget.id) return;
    const resolution = resolveNotificationTarget(events, notificationTarget, { start: monday, end: addCalendarDays(monday, 7) });
    if (resolution.kind === 'open') {
      const current = events.find((event) => event.id === notificationTarget.eventId);
      setPlanChange(isPlanChange ? { lines: planChangeLines(notificationTarget.change), outdated: planChangeOutdated(notificationTarget.change, current ?? null) } : null);
      setSelected(resolution.occurrence); setDialog('details');
    } else if (resolution.kind === 'navigate') {
      const [year, month, day] = resolution.date.split('-').map(Number);
      const targetWeek = startOfWeek(new Date(year, month - 1, day, 12));
      if (targetWeek.getTime() !== monday.getTime()) {
        setWeek(new Date(year, month - 1, day, 12));
        return;
      }
      setNotice('To wystąpienie zmiany już się nie odbywa. Kalendarz został otwarty.');
    } else {
      setNotice(resolution.eventExists
        ? 'To wystąpienie zmiany już się nie odbywa. Kalendarz został otwarty.'
        : 'Ta zmiana została usunięta. Kalendarz został otwarty.');
    }
    onNotificationResolved?.();
  }, [active, loading, notificationTarget, list, events, onNotificationResolved, refreshedFor]);
  const previewEvents = useMemo(() => {
    if (!draftSchedule || draftSchedule.isApproved || draftSchedule.weekStart !== localDateKey(monday)) return [];
    return draftSchedule.shifts.map((shift) => ({ id: `preview-${shift.candidateId}`, title: 'Propozycja pracy', location: 'Nieopublikowana propozycja',
      start: shift.start, end: shift.end, category: 'Work' as const, mandatory: false, repeatWeekly: false,
      occurrenceStart: new Date(shift.start), occurrenceEnd: new Date(shift.end), preview: true }));
  }, [draftSchedule, monday.getTime()]);
  const gridEvents = useMemo(() => [...list, ...previewEvents], [list, previewEvents]);
  const [collisionToken, setCollisionToken] = useState<string | undefined>();
  const [notice, setNotice] = useState('');
  // S23KC2S1P2-302: wynik ponownego sprawdzenia dotyczy dokładnie tego szkicu – każda zmiana pola go unieważnia.
  const [recheck, setRecheck] = useState<{ draft: CalendarEvent; conflicts: EventCollision[] } | null>(null);
  const [checking, setChecking] = useState(false);
  const close = () => { setDialog(null); setDraft(null); setSelected(null); setPending(null); setEditId(null); setError(''); setCollisionToken(undefined); setRecheck(null); setPlanChange(null); };
  const normalizedDraft = (value: CalendarEvent) => ({ ...value, title: value.title.trim(), mandatory: value.category === 'Class' && value.mandatory });
  const recheckDraft = async () => {
    if (!draft || checking) return;
    const validation = validateEventInput(draft); if (validation) { setError(validation); return; }
    const candidate = normalizedDraft(draft);
    setChecking(true); setError('');
    try { setRecheck({ draft: candidate, conflicts: (await checkEventCollisions(candidate, editId ?? undefined)).conflicts }); }
    catch (reason) { setRecheck(null); setError(reason instanceof Error ? reason.message : 'Nie udało się sprawdzić kolizji.'); }
    finally { setChecking(false); }
  };
  const recheckCurrent = recheck && draft && JSON.stringify(normalizedDraft(draft)) === JSON.stringify(recheck.draft) ? recheck : null;
  const newEvent = (date: Date) => { const key = localDateKey(date); setDraft({ id: `evt-${Date.now()}`, title: '', location: '', start: `${key}T09:00`, end: `${key}T10:00`, category: 'Class', mandatory: false, repeatWeekly: false }); setDialog('form'); };
  const details = (item: Occurrence) => { setSelected(item); setDialog('details'); };
  const edit = () => {
    if (!selected) return;
    const { title, location, start, end, category, mandatory, repeatWeekly } = selected;
    setDraft({ id: `evt-${Date.now()}`, title, location: location ?? '', start, end, category, mandatory, repeatWeekly });
    setEditId(selected.id); setError(''); setDialog('form');
  };
  const commit = async (event: CalendarEvent, force = false) => {
    if (saving) return;
    setSaving(true); setError(''); setNotice('');
    try {
      const token = force ? collisionToken : undefined;
      const saved = editId ? await updateEvent(editId, event, token) : await createEvent(event, token);
      setEvents((current) => editId ? current.map(item => item.id === editId ? saved : item) : [...current, saved]);
      close();
      setNotice(force ? 'Zapisano mimo kolizji.' : 'Zapisano bez kolizji.');
    } catch (error) {
      if (error instanceof EventCollisionError) {
        setConflicts(error.conflicts); setCollisionToken(error.token); setPending(event); setDialog('collision');
      } else { setError(error instanceof Error ? error.message : 'Nie udało się zapisać wydarzenia.'); setDialog('form'); }
    }
    finally { setSaving(false); }
  };
  const remove = async () => {
    if (!selected || saving) return;
    setSaving(true); setError('');
    try {
      const deletedIds = new Set(await deleteEvent(selected.id));
      setEvents((current) => current.filter((event) => !deletedIds.has(event.id)));
      close();
    } catch {
      setError('Nie udało się usunąć wydarzenia. Spróbuj ponownie.');
    } finally { setSaving(false); }
  };
  const save = () => {
    if (!draft) return; const validation = validateEventInput(draft); if (validation) { setError(validation); return; }
    commit({ ...draft, title: draft.title.trim(), mandatory: draft.category === 'Class' && draft.mandatory });
  };
  const upcoming = list.filter((item) => localDateKey(item.occurrenceStart) === localDateKey(now) && item.occurrenceStart >= now);
  const selectedWeek = `${monday.toLocaleDateString('pl-PL', { day: 'numeric', month: 'short' })} – ${addCalendarDays(monday, 6).toLocaleDateString('pl-PL', { day: 'numeric', month: 'short', year: 'numeric' })}`;
  const changeDraft = (field: 'title' | 'location', value: string) => setDraft((current) => current ? { ...current, [field]: value } : current);
  const changeDate = (value: string) => setDraft((current) => current ? { ...current, start: `${value}T${current.start.split('T')[1]}`, end: `${value}T${current.end.split('T')[1]}` } : current);
  const changeTime = (field: 'start' | 'end', value: string) => setDraft((current) => current ? { ...current, [field]: `${current[field].split('T')[0]}T${value}` } : current);
  return <View style={{ flex: 1, minHeight: 0, width: '100%', maxWidth: 1440, alignSelf: 'center', paddingHorizontal: compact ? 8 : 16 }}>
    {!!notice && <Text accessibilityLiveRegion="polite" style={styles.muted}>{notice}</Text>}
    {loading && <Text accessibilityLiveRegion="polite" style={styles.muted}>Wczytywanie…</Text>}
    {!!loadError && <View><Text accessibilityRole="alert" style={styles.error}>{loadError}</Text><Button title="Spróbuj ponownie" onPress={() => void reload()} /></View>}
    {!todayOnly && <View style={[styles.row, { justifyContent: 'space-between', paddingVertical: 6, flexWrap: 'wrap' }]}>
      <Text numberOfLines={1} style={[styles.heading, { flex: 1, minWidth: compact ? '100%' : 160, fontSize: compact ? 14 : 17 }]}>{selectedWeek}</Text>
      <Button title="Importuj plan" onPress={() => setClassImportOpen(true)} />
      <Button title="Grafik pracy" accessibilityLabel="Importuj grafik pracy" onPress={() => setImportOpen(true)} />
      <Button title="Google" accessibilityLabel="Importuj z Google Calendar" onPress={() => setGoogleImportOpen(true)} />
      <Button title="+" accessibilityLabel="Dodaj wydarzenie" primary onPress={() => newEvent(todayOnly ? new Date() : weekDays.some((date) => localDateKey(date) === localDateKey(new Date())) ? new Date() : monday)} />
    </View>}
    {!todayOnly && <View style={[styles.row, { justifyContent: 'space-between', paddingBottom: 6 }]}>
      <Button title="‹" accessibilityLabel="Poprzedni tydzień" onPress={() => setWeek(addCalendarDays(monday, -7))} />
      <Button title="Dzisiaj" onPress={() => setWeek(new Date())} />
      <Button title="›" accessibilityLabel="Następny tydzień" onPress={() => setWeek(addCalendarDays(monday, 7))} />
    </View>}
    {!!previewEvents.length && !todayOnly && <Text accessibilityLiveRegion="polite" style={[styles.muted, { paddingVertical: 5 }]}>Podgląd propozycji pracy: linie przerywane oznaczają zmiany niezatwierdzone.</Text>}
    {todayOnly ? <View style={{ flex: 1, minHeight: 0 }}>
      <View style={[styles.row, { justifyContent: 'space-between', paddingVertical: 8 }]}><Text style={styles.heading}>Dzień dobry!</Text><Button title="+" accessibilityLabel="Dodaj wydarzenie" primary onPress={() => newEvent(now)} /></View>
       <View accessibilityLabel="Podsumowanie dnia od asystenta" style={{ backgroundColor: palette.blueSoft, borderRadius: 8, padding: 12, marginBottom: 14, minHeight: 88 }}>
         <View style={[styles.row, { justifyContent: 'space-between', alignItems: 'center' }]}>
           <Text style={[styles.body, { fontWeight: '700' }]}>Twój dzień w skrócie</Text>
           <Button title={dailySummaryLoading ? '...' : 'Odśwież'} disabled={dailySummaryLoading || !active} onPress={() => void requestDailySummary(true)} />
         </View>
         {dailySummaryLoading ? <Text accessibilityLiveRegion="polite" style={styles.muted}>Asystent analizuje dzisiejsze wydarzenia…</Text>
           : dailySummaryError ? <Text accessibilityRole="alert" style={styles.error}>{dailySummaryError}</Text>
           : dailySummary?.date === todayKey ? <Text accessibilityLiveRegion="polite" style={styles.body}>{dailySummary.text}</Text>
           : <Text style={styles.muted}>Asystent przygotuje podsumowanie dzisiejszego kalendarza.</Text>}
       </View>
      <WeekGrid active={active} days={[addCalendarDays(now, 0)]} events={upcoming} layout="days-top" now={now} startAtNow hideDayHeader onAdd={newEvent} onSelect={details} />
    </View> : <WeekGrid active={active} days={weekDays} events={gridEvents} layout={weekLayout} now={now} onAdd={newEvent} onSelect={details} />}
    <Modal visible={dialog !== null} transparent animationType="fade" onRequestClose={() => { if (!saving) close(); }}><View style={{ flex: 1, backgroundColor: palette.scrim, alignItems: 'center', justifyContent: 'center', padding: 16 }}><ScrollView style={{ backgroundColor: palette.surface, borderRadius: 18, width: '100%', maxWidth: 480, maxHeight: '92%' }} contentContainerStyle={{ padding: 21 }}>
      {dialog === 'form' && draft && <><Text style={styles.heading}>{editId ? 'Edytuj wydarzenie' : 'Dodaj wydarzenie'}</Text><View style={{ marginTop: 16 }}>
        <Field label="TYTUŁ WYDARZENIA" maxLength={200} editable={!saving} value={draft.title} onChangeText={(v) => changeDraft('title', v)} placeholder="Spotkanie projektowe" /><Field label="MIEJSCE" maxLength={500} editable={!saving} value={draft.location ?? ''} onChangeText={(v) => changeDraft('location', v)} placeholder="np. Gmach Północny 204" />
        <DateField label="DATA" value={draft.start.split('T')[0]} onChange={changeDate} />
        <View style={styles.row}><TimeField label="POCZĄTEK" value={draft.start.split('T')[1]} onChange={(v) => changeTime('start', v)} /><TimeField label="KONIEC" value={draft.end.split('T')[1]} onChange={(v) => changeTime('end', v)} /></View>
        <Text style={styles.label}>KATEGORIA</Text><View style={[styles.row, { flexWrap: 'wrap', marginBottom: 8 }]}>{categories.map((category) => <Pressable key={category} onPress={() => setDraft({ ...draft, category, mandatory: category === 'Class' && draft.mandatory })} style={{ padding: 9, borderRadius: 8, borderWidth: 1, borderColor: draft.category === category ? colors[category] : palette.line, backgroundColor: draft.category === category ? `${colors[category]}18` : palette.surfaceAlt }}><Text style={{ color: colors[category], fontWeight: '700', fontSize: 12 }}>{labels[category]}</Text></Pressable>)}</View>
        <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: draft.repeatWeekly }} onPress={() => setDraft({ ...draft, repeatWeekly: !draft.repeatWeekly })} style={{ paddingVertical: 8 }}><Text style={styles.body}>{draft.repeatWeekly ? '☑' : '☐'} Powtarzaj co tydzień</Text></Pressable>
        {draft.category === 'Class' && <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: draft.mandatory }} onPress={() => setDraft({ ...draft, mandatory: !draft.mandatory })} style={{ paddingVertical: 8 }}><Text style={styles.body}>{draft.mandatory ? '☑' : '☐'} Zajęcia obowiązkowe</Text></Pressable>}
        {recheckCurrent && <View accessibilityLiveRegion="polite" style={{ marginTop: 8 }}>
          <Text style={[styles.body, { color: recheckCurrent.conflicts.length ? palette.amber : palette.green }]}>{collisionSummary(recheckCurrent.conflicts)}</Text>
          {recheckCurrent.conflicts.map((conflict) => describeCollision(conflict)).map(item => <Text key={item.key} style={styles.muted}>• {item.title} ({item.kind}) {item.range}{item.notes.length ? ` – ${item.notes.join(', ')}` : ''}</Text>)}
        </View>}
        {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}<View style={[styles.row, { justifyContent: 'flex-end', flexWrap: 'wrap', marginTop: 12 }]}><Button title="Anuluj" disabled={saving} onPress={close} /><Button title={checking ? 'Sprawdzanie…' : 'Sprawdź kolizje'} disabled={saving || checking || loading || !!loadError} onPress={() => void recheckDraft()} /><Button title={saving ? 'Zapisywanie…' : editId ? 'Zapisz zmiany' : 'Zapisz wydarzenie'} disabled={saving || loading || !!loadError} primary onPress={save} /></View>
      </View></>}
      {dialog === 'details' && selected && <>{planChange && <View accessibilityRole="alert" style={{ marginTop: 8, padding: 10, borderRadius: 10, borderWidth: 1, borderColor: palette.amber, backgroundColor: palette.surfaceAlt }}>
        <Text style={[styles.body, { fontWeight: '700' }]}>Zmiana planu</Text>
        {planChange.lines.map((line) => <Text key={line} style={styles.body}>{line}</Text>)}
        {planChange.outdated && <Text style={[styles.muted, { color: palette.amber }]}>Wydarzenie zmieniło się ponownie po wysłaniu powiadomienia – poniżej aktualny termin.</Text>}
      </View>}<Text style={[styles.heading, { marginTop: 12 }]}>{selected.title}</Text><Text style={styles.subtitle}>{selected.occurrenceStart.toLocaleDateString('pl-PL', { weekday: 'long', day: 'numeric', month: 'long' })} · {selected.occurrenceStart.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' })}–{selected.occurrenceEnd.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' })}</Text><Text style={[styles.subtitle, { marginTop: 8 }]}>{selected.location ? `Miejsce: ${selected.location}` : 'Nie podano miejsca.'}</Text><Text style={[styles.body, { marginTop: 12 }]}>{selected.repeatWeekly ? 'Seria cotygodniowa. Edycja zmienia całą serię.' : 'Wydarzenie jednorazowe.'} {selected.mandatory ? 'Zajęcia obowiązkowe.' : ''}</Text><View style={[styles.row, { justifyContent: 'flex-end', flexWrap: 'wrap', marginTop: 18 }]}><Button title="Edytuj" primary onPress={edit} /><Button title={selected.repeatWeekly ? 'Usuń serię' : 'Usuń wydarzenie'} danger onPress={() => { setError(''); setDialog('delete'); }} /><Button title="Zamknij" onPress={close} /></View></>}
      {dialog === 'delete' && selected && <>
        <Text style={styles.heading}>{selected.repeatWeekly ? 'Usunąć całą serię?' : 'Usunąć wydarzenie?'}</Text>
        <Text style={styles.subtitle}>{selected.title}</Text>
        <Text style={styles.body}>{selected.repeatWeekly ? 'Wszystkie cotygodniowe wystąpienia zostaną usunięte.' : 'Wydarzenie zostanie usunięte z kalendarza.'}</Text>
        {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
        <View style={[styles.row, { justifyContent: 'flex-end', flexWrap: 'wrap', marginTop: 16 }]}>
          <Button title="Anuluj" disabled={saving} onPress={() => { setError(''); setDialog('details'); }} />
          <Button title={saving ? 'Usuwanie…' : selected.repeatWeekly ? 'Usuń całą serię' : 'Usuń wydarzenie'} danger disabled={saving} onPress={() => void remove()} />
        </View>
      </>}
      {dialog === 'collision' && <>
        <Text style={[styles.heading, { marginTop: 12 }]}>Wydarzenia nakładają się.</Text>
        <Text style={styles.subtitle}>Nic nie zapisano. Popraw termin, świadomie zaakceptuj kolizje albo anuluj.</Text>
        <Text style={[styles.body, { marginTop: 8 }]}>{collisionSummary(conflicts)}</Text>
        {conflicts.map((conflict) => describeCollision(conflict)).map(item => <View key={item.key} style={{ marginTop: 12, paddingTop: 8, borderTopWidth: 1, borderColor: palette.line }}>
          <Text style={[styles.body, { fontWeight: '700' }]}>{item.title} · {item.kind}</Text>
          <Text style={styles.muted}>Termin: {item.range}</Text>
          <Text style={styles.muted}>Nakładanie: {item.overlap}</Text>
          {!!item.notes.length && <Text style={[styles.muted, { color: palette.amber }]}>{item.notes.join(' · ')}</Text>}
        </View>)}
        <View style={[styles.row, { flexWrap: 'wrap', marginTop: 18 }]}>
          <Button title="Popraw termin" disabled={saving} onPress={() => { setDialog('form'); setPending(null); setCollisionToken(undefined); }} />
          <Button title={saving ? 'Zapisywanie…' : 'Zapisz mimo kolizji'} disabled={saving} primary onPress={() => pending && void commit(pending, true)} />
          <Button title="Anuluj" disabled={saving} onPress={() => { close(); setNotice('Anulowano. Kalendarz pozostał bez zmian.'); }} />
        </View>
      </>}

    </ScrollView></View></Modal>
    <ClassScheduleImport visible={classImportOpen} onClose={() => setClassImportOpen(false)} onImported={() => void reload()} />
    <WorkScheduleImport visible={importOpen} onClose={() => setImportOpen(false)} onImported={() => void reload()} />
    <GoogleCalendarImport visible={googleImportOpen} onClose={() => setGoogleImportOpen(false)} onImported={() => void reload()} />
  </View>;
}
