import React, { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import type { CalendarEvent, Category, Occurrence } from '../domain/model';
import { addCalendarDays, findCollisions, localDateKey, occurrencesForRange, startOfWeek, validateEventInput } from '../domain/calendar';
import { loadCalendar, createEvent, updateEvent, updateSeriesEvent, deleteEvent } from '../services/calendarApi';
import { Button, Field, useTheme } from '../components/ui';
import DateField from '../components/DateField';
import TimeField from '../components/TimeField';
import WeekGrid, { type WeekLayout } from '../components/WeekGrid';
import WorkScheduleImport from '../components/WorkScheduleImport';
const categories: Category[] = ['Class', 'Work', 'Personal'];
const labels: Record<Category, string> = { Class: 'Zajęcia', Work: 'Praca', Personal: 'Prywatne' };
type Props = { week: Date; setWeek: (value: Date) => void; todayOnly?: boolean; weekLayout: WeekLayout; now: Date; active: boolean };
export default function CalendarScreen({ week, setWeek, todayOnly = false, weekLayout, now, active }: Props) {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [saving, setSaving] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
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
  const [dialog, setDialog] = useState<'form' | 'details' | 'collision' | 'delete' | 'series_choice' | null>(null);
  const [selected, setSelected] = useState<Occurrence | null>(null); const [draft, setDraft] = useState<CalendarEvent | null>(null);
  const [error, setError] = useState(''); const [conflicts, setConflicts] = useState<string[]>([]); const [pending, setPending] = useState<CalendarEvent | null>(null);
  const monday = startOfWeek(todayOnly ? now : week); const weekDays = useMemo(() => Array.from({ length: 7 }, (_, i) => addCalendarDays(monday, i)), [monday.getTime()]);
  const list = useMemo(() => occurrencesForRange(events, { start: monday, end: addCalendarDays(monday, 7) }), [events, monday.getTime()]);
  const close = () => { setDialog(null); setDraft(null); setSelected(null); setPending(null); setEditId(null); setError(''); };
  const newEvent = (date: Date) => { const key = localDateKey(date); setDraft({ id: `evt-${Date.now()}`, title: '', location: '', start: `${key}T09:00`, end: `${key}T10:00`, category: 'Class', mandatory: false, repeatWeekly: false }); setDialog('form'); };
  const details = (item: Occurrence) => { setSelected(item); setDialog('details'); };
  const edit = () => {
    if (!selected) return;
    const { title, location, start, end, category, mandatory, repeatWeekly } = selected;
    setDraft({ id: `evt-${Date.now()}`, title, location: location ?? '', start, end, category, mandatory, repeatWeekly });
    setEditId(selected.id); setError(''); setDialog('form');
  };
  const commit = async (event: CalendarEvent, force = false, updateSeries = false) => {
    if (saving) return;
    if (!force) { const found = findCollisions(event, events, editId ?? undefined); if (found.length) { setConflicts(found.map((item) => item.title)); setPending(event); setDialog('collision'); return; } }
    setSaving(true); setError('');
    try {
      if (editId) {
        if (updateSeries) {
          await updateSeriesEvent(editId, event);
          await reload();
        } else {
          const updated = await updateEvent(editId, event);
          setEvents((current) => current.map((item) => (item.id === editId ? updated : item)));
        }
      } else {
        const saved = await createEvent(event);
        setEvents((current) => [...current, saved]);
      }
      close();
    }
    catch (error) { setError(error instanceof Error ? error.message : 'Nie udało się zapisać wydarzenia.'); setDialog('form'); }
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
    const eventToSave = { ...draft, title: draft.title.trim(), mandatory: draft.category === 'Class' && draft.mandatory };
    if (editId && selected?.repeatWeekly) {
      setPending(eventToSave);
      setDialog('series_choice');
      return;
    }
    commit(eventToSave);
  };
  const upcoming = list.filter((item) => localDateKey(item.occurrenceStart) === localDateKey(now) && item.occurrenceStart >= now);
  const selectedWeek = `${monday.toLocaleDateString('pl-PL', { day: 'numeric', month: 'short' })} – ${addCalendarDays(monday, 6).toLocaleDateString('pl-PL', { day: 'numeric', month: 'short', year: 'numeric' })}`;
  const changeDraft = (field: 'title' | 'location', value: string) => setDraft((current) => current ? { ...current, [field]: value } : current);
  const changeDate = (value: string) => setDraft((current) => current ? { ...current, start: `${value}T${current.start.split('T')[1]}`, end: `${value}T${current.end.split('T')[1]}` } : current);
  const changeTime = (field: 'start' | 'end', value: string) => setDraft((current) => current ? { ...current, [field]: `${current[field].split('T')[0]}T${value}` } : current);
  return <View style={{ flex: 1, minHeight: 0, width: '100%', maxWidth: 1440, alignSelf: 'center', paddingHorizontal: compact ? 8 : 16 }}>
    {loading && <Text accessibilityLiveRegion="polite" style={styles.muted}>Wczytywanie…</Text>}
    {!!loadError && <View><Text accessibilityRole="alert" style={styles.error}>{loadError}</Text><Button title="Spróbuj ponownie" onPress={() => void reload()} /></View>}
    {!todayOnly && <View style={[styles.row, { justifyContent: 'space-between', paddingVertical: 6 }]}>
      <Text numberOfLines={1} style={[styles.heading, { flex: 1, fontSize: compact ? 14 : 17 }]}>{selectedWeek}</Text>
      <Button title="Importuj" accessibilityLabel="Importuj grafik pracy" onPress={() => setImportOpen(true)} />
      <Button title="+" accessibilityLabel="Dodaj wydarzenie" primary onPress={() => newEvent(todayOnly ? new Date() : weekDays.some((date) => localDateKey(date) === localDateKey(new Date())) ? new Date() : monday)} />
    </View>}
    {!todayOnly && <View style={[styles.row, { justifyContent: 'space-between', paddingBottom: 6 }]}>
      <Button title="‹" accessibilityLabel="Poprzedni tydzień" onPress={() => setWeek(addCalendarDays(monday, -7))} />
      <Button title="Dzisiaj" onPress={() => setWeek(new Date())} />
      <Button title="›" accessibilityLabel="Następny tydzień" onPress={() => setWeek(addCalendarDays(monday, 7))} />
    </View>}
    {todayOnly ? <View style={{ flex: 1, minHeight: 0 }}>
      <View style={[styles.row, { justifyContent: 'space-between', paddingVertical: 8 }]}><Text style={styles.heading}>Dzień dobry!</Text><Button title="+" accessibilityLabel="Dodaj wydarzenie" primary onPress={() => newEvent(now)} /></View>
      <View accessibilityLabel="Podsumowanie dnia od asystenta" style={{ backgroundColor: palette.blueSoft, borderRadius: 8, padding: 12, marginBottom: 14, minHeight: 88 }}>
        <Text style={[styles.body, { fontWeight: '700' }]}>Twój dzień w skrócie</Text>
        <Text style={styles.muted}>Tutaj pojawi się podsumowanie wydarzeń od asystenta.</Text>
      </View>
      <WeekGrid active={active} days={[addCalendarDays(now, 0)]} events={upcoming} layout="days-top" now={now} startAtNow hideDayHeader onAdd={newEvent} onSelect={details} />
    </View> : <WeekGrid active={active} days={weekDays} events={list} layout={weekLayout} now={now} onAdd={newEvent} onSelect={details} />}
    <Modal visible={dialog !== null} transparent animationType="fade" onRequestClose={() => { if (!saving) close(); }}><View style={{ flex: 1, backgroundColor: palette.scrim, alignItems: 'center', justifyContent: 'center', padding: 16 }}><ScrollView style={{ backgroundColor: palette.surface, borderRadius: 18, width: '100%', maxWidth: 480, maxHeight: '92%' }} contentContainerStyle={{ padding: 21 }}>
      {dialog === 'form' && draft && <><Text style={styles.heading}>{editId ? 'Edytuj wydarzenie' : 'Dodaj wydarzenie'}</Text><View style={{ marginTop: 16 }}>
        <Field label="TYTUŁ WYDARZENIA" value={draft.title} onChangeText={(v) => changeDraft('title', v)} placeholder="Spotkanie projektowe" /><Field label="MIEJSCE" value={draft.location ?? ''} onChangeText={(v) => changeDraft('location', v)} placeholder="np. Gmach Północny 204" />
        <DateField label="DATA" value={draft.start.split('T')[0]} onChange={changeDate} />
        <View style={styles.row}><TimeField label="POCZĄTEK" value={draft.start.split('T')[1]} onChange={(v) => changeTime('start', v)} /><TimeField label="KONIEC" value={draft.end.split('T')[1]} onChange={(v) => changeTime('end', v)} /></View>
        <Text style={styles.label}>KATEGORIA</Text><View style={[styles.row, { flexWrap: 'wrap', marginBottom: 8 }]}>{categories.map((category) => <Pressable key={category} onPress={() => setDraft({ ...draft, category, mandatory: category === 'Class' && draft.mandatory })} style={{ padding: 9, borderRadius: 8, borderWidth: 1, borderColor: draft.category === category ? colors[category] : palette.line, backgroundColor: draft.category === category ? `${colors[category]}18` : palette.surfaceAlt }}><Text style={{ color: colors[category], fontWeight: '700', fontSize: 12 }}>{labels[category]}</Text></Pressable>)}</View>
        <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: draft.repeatWeekly }} onPress={() => setDraft({ ...draft, repeatWeekly: !draft.repeatWeekly })} style={{ paddingVertical: 8 }}><Text style={styles.body}>{draft.repeatWeekly ? '☑' : '☐'} Powtarzaj co tydzień</Text></Pressable>
        {draft.category === 'Class' && <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: draft.mandatory }} onPress={() => setDraft({ ...draft, mandatory: !draft.mandatory })} style={{ paddingVertical: 8 }}><Text style={styles.body}>{draft.mandatory ? '☑' : '☐'} Zajęcia obowiązkowe</Text></Pressable>}
        {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}<View style={[styles.row, { justifyContent: 'flex-end', marginTop: 12 }]}><Button title="Anuluj" disabled={saving} onPress={close} /><Button title={saving ? 'Zapisywanie…' : editId ? 'Zapisz zmiany' : 'Zapisz wydarzenie'} disabled={saving || loading || !!loadError} primary onPress={save} /></View>
      </View></>}
      {dialog === 'details' && selected && <><Text style={[styles.heading, { marginTop: 12 }]}>{selected.title}</Text><Text style={styles.subtitle}>{selected.occurrenceStart.toLocaleDateString('pl-PL', { weekday: 'long', day: 'numeric', month: 'long' })} · {selected.occurrenceStart.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' })}–{selected.occurrenceEnd.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' })}</Text><Text style={[styles.subtitle, { marginTop: 8 }]}>{selected.location ? `Miejsce: ${selected.location}` : 'Nie podano miejsca.'}</Text><Text style={[styles.body, { marginTop: 12 }]}>{selected.repeatWeekly ? 'Seria cotygodniowa.' : 'Wydarzenie jednorazowe.'} {selected.mandatory ? 'Zajęcia obowiązkowe.' : ''}</Text><View style={[styles.row, { justifyContent: 'flex-end', flexWrap: 'wrap', marginTop: 18 }]}><Button title="Edytuj" primary onPress={edit} /><Button title={selected.repeatWeekly ? 'Usuń serię' : 'Usuń wydarzenie'} danger onPress={() => { setError(''); setDialog('delete'); }} /><Button title="Zamknij" onPress={close} /></View></>}
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
      {dialog === 'collision' && <><Text style={[styles.heading, { marginTop: 12 }]}>Wydarzenia nakładają się.</Text><Text style={styles.subtitle}>Nic jeszcze nie zapisano. Możesz zapisać wydarzenie mimo kolizji. Konflikty: {conflicts.join(', ')}.</Text><View style={[styles.row, { justifyContent: 'flex-end', marginTop: 18 }]}><Button title="Wróć do edycji" disabled={saving} onPress={() => { setDialog('form'); setPending(null); }} /><Button title={saving ? 'Zapisywanie…' : editId ? 'Zapisz mimo to' : 'Dodaj mimo to'} disabled={saving} primary onPress={() => pending && commit(pending, true)} /></View></>}
	  {dialog === 'series_choice' && pending && <><Text style={[styles.heading, { marginTop: 12 }]}>Edycja serii wydarzeń</Text><Text style={styles.subtitle}>Wydarzenie jest częścią serii cotygodniowej. Jak chcesz zapisać zmiany?</Text><View style={{ marginTop: 18, gap: 8 }}><Button title={saving ? 'Zapisywanie…' : 'Tylko to wydarzenie'} disabled={saving} onPress={() => void commit(pending, false, false)} /><Button title={saving ? 'Zapisywanie…' : 'To i przyszłe wydarzenia'} disabled={saving} primary onPress={() => void commit(pending, false, true)} /><Button title="Anuluj" disabled={saving} onPress={() => { setDialog('form'); }} /></View></>}
	</ScrollView></View></Modal>
    <WorkScheduleImport visible={importOpen} onClose={() => setImportOpen(false)} onImported={() => void reload()} />
  </View>;
}
