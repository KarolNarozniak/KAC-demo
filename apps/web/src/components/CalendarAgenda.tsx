import React, { useRef, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import type { Occurrence } from '../domain/model';
import { localDateKey, addCalendarDays } from '../domain/calendar';
import { useTheme } from './ui';

export default function CalendarAgenda({ days, events, now, onSelect, onDaySelected }: { days: Date[]; events: Occurrence[]; now: Date; onSelect: (event: Occurrence) => void; onDaySelected?: (date: Date) => void }) {
  const { palette, styles } = useTheme();
  const scroll = useRef<React.ComponentRef<typeof ScrollView>>(null);
  const positions = useRef<Record<string, number>>({});
  const headerHeights = useRef<Record<string, number>>({});
  const [selectedDay, setSelectedDay] = useState(localDateKey(now));
  const colors = { Class: palette.class, Work: palette.work, Personal: palette.personal };
  const labels = { Class: 'Zajęcia', Work: 'Praca', Personal: 'Prywatne' };
  const time = (date: Date) => date.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit', hour12: false });
  return <View style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
    {days.length > 1 && <View style={[styles.row, { gap: 4, marginTop: 12, marginBottom: 0 }]}>{days.map(day => { const key = localDateKey(day); const count = events.filter(event => localDateKey(event.occurrenceStart) === key).length; return <Pressable key={key} accessibilityRole="button" accessibilityLabel={`${day.toLocaleDateString('pl-PL', { weekday: 'long', day: 'numeric' })}, ${count} wydarzeń`} accessibilityState={{ selected: selectedDay === key }} onPress={() => { setSelectedDay(key); onDaySelected?.(day); scroll.current?.scrollTo({ y: positions.current[key] ?? 0, animated: true }); }} style={{ flex: 1, alignItems: 'center', paddingVertical: 6, gap: 4, borderRadius: 12, backgroundColor: selectedDay === key ? palette.blueSoft : palette.surface, borderWidth: 1, borderColor: selectedDay === key ? palette.blue : palette.line }}><Text style={[styles.muted, { fontSize: 11 }]}>{day.toLocaleDateString('pl-PL', { weekday: 'short' })}</Text><Text style={[styles.heading, { fontSize: 16, color: localDateKey(day) === localDateKey(now) ? palette.blue : palette.ink }]}>{day.getDate()}</Text><View style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: count ? palette.blue : 'transparent' }} /></Pressable>; })}</View>}
    <View style={{ flex: 1, minHeight: 0, overflow: 'hidden', backgroundColor: palette.bg }}>
    <ScrollView ref={scroll} stickyHeaderIndices={days.length > 1 ? days.map((_, index) => index * 2) : []} style={{ flex: 1, minHeight: 0 }} contentContainerStyle={{ paddingBottom: 96 }}>
    {days.flatMap(day => {
      const dayStart = new Date(day.getFullYear(), day.getMonth(), day.getDate());
      const items = events.filter(event => event.occurrenceStart < addCalendarDays(dayStart, 1) && event.occurrenceEnd > dayStart)
        .sort((a, b) => a.occurrenceStart.getTime() - b.occurrenceStart.getTime());
      return [<View key={`${localDateKey(day)}-header`} onLayout={event => { headerHeights.current[localDateKey(day)] = event.nativeEvent.layout.height; }} style={[styles.row, { justifyContent: 'space-between', paddingVertical: 12, backgroundColor: palette.bg, borderBottomWidth: 1, borderColor: palette.bg }]}>
          <View><Text style={[styles.heading, { fontSize: 16, color: localDateKey(day) === localDateKey(now) ? palette.blue : palette.ink }]}>{days.length === 1 ? 'Twój plan na dziś' : day.toLocaleDateString('pl-PL', { weekday: 'long', day: 'numeric', month: 'short' })}</Text>
          </View>
        </View>,
        <View key={`${localDateKey(day)}-events`} onLayout={event => { positions.current[localDateKey(day)] = event.nativeEvent.layout.y - (headerHeights.current[localDateKey(day)] ?? 44); }} style={{ paddingTop: 4, paddingBottom: 12 }}>
                {items.length ? items.map(event => {
          // Tylko w widoku jednego dnia („Dziś”): co już minęło, a co trwa teraz.
          const ended = days.length === 1 && event.occurrenceEnd <= now;
          const ongoing = days.length === 1 && event.occurrenceStart <= now && !ended;
          const status = ended ? ' · zakończone' : ongoing ? ' · trwa teraz' : '';
          return <Pressable key={`${event.id}-${event.start}`} accessibilityRole="button" accessibilityLabel={`${event.title}, ${time(event.occurrenceStart)}–${time(event.occurrenceEnd)}${status}`} disabled={event.preview} onPress={() => onSelect(event)}
            style={{ backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.line, borderLeftWidth: 4, borderLeftColor: colors[event.category], borderRadius: 14, padding: 16, marginBottom: 10, gap: 6, opacity: ended ? 0.6 : 1 }}>
            <View style={[styles.row, { justifyContent: 'space-between', flexWrap: 'wrap' }]}><Text style={[styles.body, { fontWeight: '700' }]}>{time(event.occurrenceStart)} – {time(event.occurrenceEnd)}</Text><Text style={{ color: colors[event.category], fontSize: 12, fontWeight: '700' }}>{event.preview ? 'Propozycja pracy' : `${labels[event.category]}${status}`}</Text></View>
            <Text style={[styles.heading, { fontSize: 17, lineHeight: 24 }]}>{event.title}</Text>
            {!!event.location && <Text style={styles.muted}>{event.location}</Text>}
            {localDateKey(event.occurrenceStart) !== localDateKey(event.occurrenceEnd) && <Text style={styles.muted}>{event.occurrenceStart.toLocaleDateString('pl-PL')} – {event.occurrenceEnd.toLocaleDateString('pl-PL')}</Text>}
          </Pressable>;
        }) : <View style={{ padding: 12, backgroundColor: palette.surface, borderWidth: 1, borderStyle: 'dashed', borderColor: palette.line, borderRadius: 14 }}><Text style={styles.body}>Czas dla Ciebie</Text><Text style={styles.muted}>Brak wydarzeń · dodaj plan lub odpocznij.</Text></View>}
      </View>];
    })}
  </ScrollView>
    <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 12, backgroundColor: palette.bg, zIndex: 20 }} />
    </View></View>;
}
