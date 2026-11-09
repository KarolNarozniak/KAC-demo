// Profil pracy (S23KC2S1P2-15, S23KC2S1P2-181) z celem godzin (S23KC2S1P2-39, S23KC2S1P2-156).
// Ekran jest osadzony w zakładce „Grafik”, nad generowaniem tygodnia. Stan formularza trzyma hook useWorkProfile.
import React from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { Button, Field, useTheme } from '../components/ui';
import { errorMessage, formatNumber, parseNumber, weeklyHours, type ProfileDraft } from '../domain/workProfile';
import type { WorkProfileState } from '../hooks/useWorkProfile';
import type { NumberField, ShiftTemplate, WorkMode } from '../services/workProfileApi';

const modeLabel: Record<WorkMode, string> = { elastyczny: 'Elastyczny', zmianowy: 'Zmianowy' };
const weekdays = ['Pn', 'Wt', 'Śr', 'Cz', 'Pt', 'Sb', 'Nd'];

export default function WorkProfileScreen({ state, disabled = false }: { state: WorkProfileState; disabled?: boolean }) {
  const { palette, styles } = useTheme();
  const { draft, errors, dirty, valid, saving } = state;

  if (state.loadError) return <View style={styles.card}>
    <Text style={styles.heading}>Profil pracy</Text>
    <Text accessibilityRole="alert" style={styles.error}>{state.loadError}</Text>
    <View style={{ alignSelf: 'flex-start' }}><Button title="Spróbuj ponownie" onPress={() => void state.reload()} /></View>
  </View>;
  if (!draft) return <View style={styles.card}><Text style={styles.heading}>Profil pracy</Text><Text style={styles.muted}>Wczytywanie…</Text></View>;

  const locked = disabled || saving;
  const message = (field: string) => dirty && errors[field] ? errorMessage(field, errors[field]!, draft) : '';
  const set = (update: Partial<ProfileDraft>) => state.change((current) => ({ ...current, ...update }));
  const setNumber = (field: NumberField, text: string) => state.change((current) => ({ ...current, numbers: { ...current.numbers, [field]: text } }));
  const changeTemplate = (id: string, update: Partial<ShiftTemplate>) => set({ shiftTemplates: draft.shiftTemplates.map((template) => template.id === id ? { ...template, ...update } : template) });
  const changeAvailability = (id: string, update: Partial<ProfileDraft['availability'][number]>) =>
    set({ availability: draft.availability.map((window) => window.id === id ? { ...window, ...update } : window) });

  const numberField = (field: NumberField, label: string, placeholder?: string) => {
    const text = message(field);
    return <View key={field} style={{ flex: 1, minWidth: 150 }}>
      <Field label={label} value={draft.numbers[field]} onChangeText={(value) => setNumber(field, value)} keyboardType="decimal-pad" placeholder={placeholder} editable={!locked} invalid={!!text} maxLength={7} />
      {!!text && <Text accessibilityRole="alert" style={[styles.error, { marginTop: -8 }]}>{text}</Text>}
    </View>;
  };
  const radio = <T extends string>(options: readonly T[], selected: T, label: (value: T) => string, onSelect: (value: T) => void) =>
    <View accessibilityRole="radiogroup" style={[styles.row, { flexWrap: 'wrap', marginBottom: 12 }]}>
      {options.map((value) => <Pressable key={value} accessibilityRole="radio" accessibilityState={{ checked: selected === value, disabled: locked }} disabled={locked} onPress={() => onSelect(value)}
        style={{ paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: selected === value ? palette.blue : palette.line, backgroundColor: selected === value ? palette.blueSoft : palette.surfaceAlt }}>
        <Text style={[styles.body, { fontWeight: '700' }]}>{label(value)}</Text>
      </Pressable>)}
    </View>;

  const target = parseNumber(draft.numbers.targetHours);
  const targetValid = target !== null && !Number.isNaN(target) && !errors.targetHours;

  return <View style={styles.card}>
    <Text style={styles.heading}>Profil pracy</Text>
    <Text style={[styles.muted, { marginTop: 4, marginBottom: 12 }]}>Limity godzin, cel, dojazd i dostępność. Zmiany obejmą kolejne generowane grafiki – zatwierdzone grafiki się nie zmienią.</Text>

    <Text style={styles.label}>TRYB PRACY</Text>
    {radio(['elastyczny', 'zmianowy'] as const, draft.mode, (value) => modeLabel[value], (mode) => set({ mode }))}

    <Text style={styles.label}>LIMITY GODZIN W TYGODNIU</Text>
    <View style={[styles.row, { flexWrap: 'wrap', alignItems: 'flex-start' }]}>
      {numberField('minimumHours', 'MINIMUM (GODZ./TYDZ.)')}
      {numberField('maximumHours', 'MAKSIMUM (GODZ./TYDZ.)')}
    </View>

    <Text style={styles.label}>CEL GODZIN PRACY</Text>
    {radio(['week', 'month'] as const, draft.targetPeriod, (value) => value === 'week' ? 'Na tydzień' : 'Na miesiąc', (targetPeriod) => set({ targetPeriod }))}
    <View style={{ maxWidth: 340 }}>
      {numberField('targetHours', `CEL (GODZ./${draft.targetPeriod === 'week' ? 'TYDZ.' : 'MIES.'})`, draft.targetPeriod === 'week' ? 'np. 20' : 'np. 80')}
    </View>
    {draft.targetPeriod === 'month' && targetValid && <Text style={[styles.muted, { marginTop: -6, marginBottom: 10 }]}>To ok. {formatNumber(weeklyHours(target!, 'month'))} h tygodniowo – według tej wartości układany jest grafik.</Text>}

    <View style={[styles.row, { flexWrap: 'wrap', alignItems: 'flex-start' }]}>
      {numberField('commuteBufferMinutes', 'CZAS DOJAZDU (MIN)')}
      {numberField('minimumRestMinutes', 'MIN. ODPOCZYNEK (MIN)')}
    </View>
    <View style={[styles.row, { flexWrap: 'wrap', alignItems: 'flex-start' }]}>
      {numberField('minimumShiftMinutes', 'MIN. DŁUGOŚĆ ZMIANY (MIN)')}
      {numberField('maximumSlotMinutes', 'MAKS. DŁUGOŚĆ ZMIANY (MIN)')}
      {numberField('maxHoursPerDay', 'MAKS. GODZIN PRACY NA DZIEŃ')}
    </View>

    <View style={[styles.card, { borderColor: draft.availability.length ? palette.line : palette.amber }]}>
      <View style={[styles.row, { justifyContent: 'space-between', flexWrap: 'wrap' }]}>
        <View><Text style={styles.heading}>Dostępne dni i godziny</Text><Text style={styles.muted}>Grafik będzie układany wyłącznie w tych oknach.</Text></View>
        <Button title="Dodaj okno" disabled={locked} onPress={() => set({ availability: [...draft.availability, { id: `availability-${Date.now()}`, dayOfWeek: 1, startTime: '08:00', endTime: '16:00' }] })} />
      </View>
      {!draft.availability.length && <Text style={[styles.error, { marginTop: 8 }]}>Ustaw co najmniej jedno okno dostępności przed generowaniem grafiku.</Text>}
      {draft.availability.map((window, index) => <View key={window.id} style={{ paddingVertical: 10, borderTopWidth: 1, borderColor: palette.line }}>
        <View style={[styles.row, { flexWrap: 'wrap', alignItems: 'flex-end' }]}>
          <View style={[styles.row, { flexWrap: 'wrap' }]}>{weekdays.map((day, dayIndex) => <Pressable key={day} accessibilityRole="radio" accessibilityState={{ checked: window.dayOfWeek === dayIndex + 1 }} disabled={locked} onPress={() => changeAvailability(window.id, { dayOfWeek: dayIndex + 1 })} style={[styles.button, window.dayOfWeek === dayIndex + 1 && { backgroundColor: palette.blueSoft, borderColor: palette.blue }]}><Text style={styles.buttonText}>{day}</Text></Pressable>)}</View>
          <View style={{ minWidth: 88 }}><Text style={styles.label}>OD</Text><TextInput accessibilityLabel={`Początek dostępności ${index + 1}`} editable={!locked} value={window.startTime} onChangeText={(startTime) => changeAvailability(window.id, { startTime })} style={[styles.input, !!message(`availability.${index}`) && { borderColor: palette.red }]} /></View>
          <View style={{ minWidth: 88 }}><Text style={styles.label}>DO</Text><TextInput accessibilityLabel={`Koniec dostępności ${index + 1}`} editable={!locked} value={window.endTime} onChangeText={(endTime) => changeAvailability(window.id, { endTime })} style={[styles.input, !!message(`availability.${index}`) && { borderColor: palette.red }]} /></View>
          <Button title="Usuń" danger disabled={locked} onPress={() => set({ availability: draft.availability.filter((item) => item.id !== window.id) })} />
        </View>
        {!!message(`availability.${index}`) && <Text accessibilityRole="alert" style={styles.error}>{message(`availability.${index}`)}</Text>}
      </View>)}
    </View>

    {draft.mode === 'zmianowy' && <View style={styles.card}>
      <View style={[styles.row, { justifyContent: 'space-between', flexWrap: 'wrap', marginBottom: 8 }]}>
        <View><Text style={styles.heading}>Szablony zmian</Text><Text style={styles.muted}>Domyślne zmiany możesz zmienić lub dodać własne.</Text></View>
        <Button title="Dodaj zmianę" disabled={locked} onPress={() => set({ shiftTemplates: [...draft.shiftTemplates, { id: `custom-${Date.now()}`, name: 'Nowa zmiana', startTime: '08:00', endTime: '16:00', endsNextDay: false, daysOfWeek: [1, 2, 3, 4, 5], active: true }] })} />
      </View>
      {draft.shiftTemplates.map((template, index) => <View key={template.id} style={{ paddingVertical: 10, borderTopWidth: 1, borderColor: palette.line }}>
        <View style={[styles.row, { flexWrap: 'wrap' }]}>
          <Field label="NAZWA" value={template.name} editable={!locked} onChangeText={(name) => changeTemplate(template.id, { name })} />
          <Field label="OD (GG:MM)" value={template.startTime} editable={!locked} invalid={!!message(`shiftTemplates.${index}`)} onChangeText={(startTime) => changeTemplate(template.id, { startTime })} />
          <Field label="DO (GG:MM)" value={template.endTime} editable={!locked} invalid={!!message(`shiftTemplates.${index}`)} onChangeText={(endTime) => changeTemplate(template.id, { endTime })} />
          <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: template.endsNextDay }} disabled={locked} onPress={() => changeTemplate(template.id, { endsNextDay: !template.endsNextDay })} style={[styles.button, { marginBottom: 12 }]}><Text style={styles.buttonText}>{template.endsNextDay ? 'Kończy następnego dnia' : 'Kończy tego samego dnia'}</Text></Pressable>
          <Button title="Usuń" danger disabled={locked} onPress={() => set({ shiftTemplates: draft.shiftTemplates.filter((item) => item.id !== template.id) })} />
        </View>
        <View style={[styles.row, { flexWrap: 'wrap' }]}>{weekdays.map((day, dayIndex) => {
          const dayOfWeek = dayIndex + 1, selected = template.daysOfWeek.includes(dayOfWeek);
          return <Pressable key={day} accessibilityRole="checkbox" accessibilityState={{ checked: selected }} disabled={locked || (selected && template.daysOfWeek.length === 1)} onPress={() => changeTemplate(template.id, { daysOfWeek: selected ? template.daysOfWeek.filter((value) => value !== dayOfWeek) : [...template.daysOfWeek, dayOfWeek].sort() })} style={[styles.button, selected && { backgroundColor: palette.blueSoft, borderColor: palette.blue }]}><Text style={styles.buttonText}>{day}</Text></Pressable>;
        })}</View>
        {!!message(`shiftTemplates.${index}`) && <Text accessibilityRole="alert" style={styles.error}>{message(`shiftTemplates.${index}`)}</Text>}
      </View>)}
    </View>}

    {state.conflict && <View accessibilityRole="alert" style={[styles.card, { borderColor: palette.amber }]}>
      <Text style={styles.heading}>Profil zmieniono w innym miejscu</Text>
      <Text style={styles.body}>Ktoś (np. Ty w innym oknie) zapisał profil po jego wczytaniu tutaj.</Text>
      <View style={[styles.row, { flexWrap: 'wrap', marginTop: 10 }]}>
        <Button title="Wczytaj aktualny profil" onPress={state.loadCurrent} disabled={saving} />
        <Button title="Zapisz moje zmiany" primary onPress={() => void state.overwrite()} disabled={saving || !valid} />
      </View>
    </View>}

    {dirty && valid && !state.conflict && <Text accessibilityLiveRegion="polite" style={[styles.muted, { color: palette.green, marginBottom: 8 }]}>✓ Dane są poprawne. Zapisz profil, żeby użyć ich przy planowaniu.</Text>}
    {dirty && !state.conflict && <View style={[styles.row, { flexWrap: 'wrap', marginBottom: 8 }]}>
      <Button title="Anuluj zmiany" onPress={state.cancel} disabled={locked} />
      <Button title={saving ? 'Zapisywanie…' : 'Zapisz profil'} primary onPress={() => void state.save()} disabled={locked || !valid} />
    </View>}
    {!!state.saveError && <Text accessibilityRole="alert" style={styles.error}>{state.saveError}</Text>}
    {!!state.notice && !dirty && <Text accessibilityLiveRegion="polite" style={[styles.muted, { color: palette.green, marginBottom: 8 }]}>{state.notice}</Text>}
  </View>;
}
