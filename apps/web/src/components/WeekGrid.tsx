import React, { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import type { Occurrence } from '../domain/model';
import { addCalendarDays, localDateKey } from '../domain/calendar';
import { useTheme } from './ui';

export type WeekLayout = 'days-left' | 'days-top';
const daysLabel = ['Pon', 'Wt', 'Śr', 'Czw', 'Pt', 'Sob', 'Niedz'];
const hourLabel = (hour: number) => `${String(hour).padStart(2, '0')}:00`;

type Props = {
  days: Date[];
  events: Occurrence[];
  layout: WeekLayout;
  now: Date;
  active: boolean;
  startAtNow?: boolean;
  hideDayHeader?: boolean;
  onAdd: (date: Date) => void;
  onSelect: (event: Occurrence) => void;
};

export default function WeekGrid({ days, events, layout, now, active, startAtNow = false, hideDayHeader = false, onAdd, onSelect }: Props) {
  const { palette } = useTheme();
  const [size, setSize] = useState({ width: 0, height: 0 });
  const scrollRef = useRef<React.ComponentRef<typeof ScrollView>>(null);
  const initialScrollKey = useRef('');
  const latestHour = useRef(0);
  const horizontal = layout === 'days-left';
  const gutter = horizontal ? 44 : 36;
  const headerHeight = hideDayHeader ? 0 : 30;
  const viewportWidth = Math.max(0, size.width - gutter);
  const viewportHeight = Math.max(0, size.height - headerHeight);
  const isWeek = days.length > 1;
  const crossesMidnight = events.some((event) => localDateKey(event.occurrenceStart) !== localDateKey(event.occurrenceEnd));
  const currentHour = now.getHours() + now.getMinutes() / 60 + now.getSeconds() / 3600;
  const includesToday = days.some((date) => localDateKey(date) === localDateKey(now));
  const firstHour = startAtNow ? currentHour : crossesMidnight ? 0 : Math.min(6, ...(includesToday ? [Math.floor(currentHour)] : []), ...events.map((event) => event.occurrenceStart.getHours()));
  const lastHour = startAtNow || crossesMidnight ? 24 : Math.min(24, Math.max(22, ...(includesToday ? [Math.ceil(currentHour)] : []), ...events.map((event) => event.occurrenceEnd.getHours() + (event.occurrenceEnd.getMinutes() > 0 ? 1 : 0) || 24)));
  const hours = lastHour - firstHour;
  // Keep time slots readable, scrolling along the time axis when needed.
  const bodyWidth = horizontal && isWeek ? Math.max(viewportWidth, hours * 80) : viewportWidth;
  const bodyHeight = !horizontal ? Math.max(viewportHeight, hours * 48) : Math.max(0, viewportHeight - (horizontal && isWeek ? 12 : 0));
  const hourSize = (horizontal ? bodyWidth : bodyHeight) / hours;
  const daySize = (horizontal ? bodyHeight : bodyWidth) / Math.max(1, days.length);
  latestHour.current = currentHour;
  const weekKey = days[0] ? localDateKey(days[0]) : '';
  useEffect(() => {
    if (!active) { initialScrollKey.current = ''; return; }
    if (!isWeek || !includesToday || size.width === 0 || size.height === 0) return;
    const key = `${weekKey}:${layout}:${size.width}:${size.height}:${firstHour}:${hourSize}`;
    if (initialScrollKey.current === key) return;
    const frame = requestAnimationFrame(() => {
      const viewport = horizontal ? viewportWidth : viewportHeight;
      const content = horizontal ? bodyWidth : bodyHeight;
      const offset = Math.min(Math.max(0, content - viewport), Math.max(0, (latestHour.current - firstHour) * hourSize - viewport * 0.3));
      scrollRef.current?.scrollTo(horizontal ? { x: offset, y: 0, animated: false } : { x: 0, y: offset, animated: false });
      initialScrollKey.current = key;
    });
    return () => cancelAnimationFrame(frame);
  }, [active, isWeek, includesToday, weekKey, layout, size.width, size.height, horizontal, viewportWidth, viewportHeight, bodyWidth, bodyHeight, firstHour, hourSize]);
  const tickStep = Math.max(1, Math.ceil((horizontal ? 30 : 16) / Math.max(1, hourSize)));
  const colors = { Class: palette.class, Work: palette.work, Personal: palette.personal };
  const dayLabel = (date: Date, index: number, style: object) => <Pressable key={localDateKey(date)} accessibilityRole="button" accessibilityLabel={`Dodaj wydarzenie: ${date.toLocaleDateString('pl-PL')}`} onPress={() => onAdd(date)} style={[{ justifyContent: 'center', alignItems: 'center', borderBottomWidth: 1, borderColor: palette.line, backgroundColor: localDateKey(date) === localDateKey(now) ? palette.blueSoft : palette.surface }, style]}>
    <Text style={{ fontSize: 11, fontWeight: '700', color: palette.ink }}>{daysLabel[(date.getDay() + 6) % 7]}</Text><Text style={{ fontSize: 11, color: palette.muted }}>{date.getDate()}</Text>
  </Pressable>;
  const ticks = [firstHour, ...Array.from({ length: Math.max(0, Math.ceil(lastHour) - Math.floor(firstHour) - 1) }, (_, index) => Math.floor(firstHour) + index + 1)];
  const eventRows = <View style={{ width: bodyWidth, height: bodyHeight }}>
        {days.map((date, dayIndex) => {
          const dayEnd = addCalendarDays(date, 1);
          const items = events.filter((event) => event.occurrenceStart < dayEnd && event.occurrenceEnd > date);
          const lanes: Date[] = [];
          const positions = items.map((event) => {
            let lane = lanes.findIndex((end) => end <= event.occurrenceStart);
            if (lane < 0) lane = lanes.length;
            lanes[lane] = event.occurrenceEnd;
            return lane;
          });
          return <View key={localDateKey(date)} style={[{ position: 'absolute', borderColor: palette.line, overflow: 'hidden' }, horizontal ? { top: dayIndex * daySize, left: 0, height: daySize, width: bodyWidth, borderBottomWidth: 1 } : { left: dayIndex * daySize, top: 0, width: daySize, height: bodyHeight, borderRightWidth: 1 }]}>
            {ticks.map((index) => <View key={index} style={[{ position: 'absolute', borderColor: palette.grid }, horizontal ? { left: (index - firstHour) * hourSize, top: 0, bottom: 0, borderLeftWidth: 1 } : { top: (index - firstHour) * hourSize, left: 0, right: 0, borderTopWidth: 1 }]} />)}
            {items.map((event, index) => {
              const from = event.occurrenceStart < date ? 0 : event.occurrenceStart.getHours() + event.occurrenceStart.getMinutes() / 60;
              const to = event.occurrenceEnd >= dayEnd ? 24 : event.occurrenceEnd.getHours() + event.occurrenceEnd.getMinutes() / 60;
              const offset = Math.max(0, (from - firstHour) * hourSize);
              const length = Math.max(1, (to - from) * hourSize);
              const laneSize = daySize / Math.max(1, lanes.length);
              return <Pressable key={event.id} accessibilityRole="button" accessibilityLabel={`${event.title}, ${event.occurrenceStart.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' })}`} onPress={() => onSelect(event)} style={[{ position: 'absolute', padding: 2, overflow: 'hidden', borderRadius: 3, backgroundColor: `${colors[event.category]}25`, borderColor: colors[event.category] }, horizontal ? { left: offset, width: length, top: positions[index] * laneSize, height: laneSize - 1, borderTopWidth: 2 } : { top: offset, height: length, left: positions[index] * laneSize, width: laneSize - 1, borderLeftWidth: 2 }]}>
                <Text numberOfLines={horizontal ? 3 : 2} style={{ fontSize: 10, fontWeight: '700', color: palette.ink }}>{event.title}</Text>
              </Pressable>;
            })}
            {isWeek && includesToday && currentHour >= firstHour && currentHour < lastHour && <View pointerEvents="none" accessibilityLabel={`Aktualna godzina ${now.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' })}`} style={[{ position: 'absolute', zIndex: 2, backgroundColor: localDateKey(date) === localDateKey(now) ? palette.red : palette.muted, opacity: localDateKey(date) === localDateKey(now) ? 1 : 0.35 }, horizontal ? { left: (currentHour - firstHour) * hourSize, top: 0, bottom: 0, width: localDateKey(date) === localDateKey(now) ? 3 : 1 } : { top: (currentHour - firstHour) * hourSize, left: 0, right: 0, height: localDateKey(date) === localDateKey(now) ? 3 : 1 }]} />}
          </View>;
        })}
  </View>;
  const timeLabels = (top: boolean) => ticks.filter((hour, index) => index === 0 || (hour % tickStep === 0 && (hour - firstHour) * hourSize >= (top ? 30 : 16))).map((hour) => <Text key={hour} style={[{ position: 'absolute', fontSize: 9, color: palette.muted }, top ? { left: (hour - firstHour) * hourSize, top: 8 } : { top: (hour - firstHour) * hourSize }]}>{hour === firstHour && startAtNow ? now.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' }) : hourLabel(hour)}</Text>);
  return <View onLayout={({ nativeEvent: { layout: measured } }) => setSize({ width: measured.width, height: measured.height })} style={{ flex: 1, minHeight: 0, overflow: 'hidden', backgroundColor: palette.surface }}>
    {horizontal ? <View style={{ flex: 1, flexDirection: 'row' }}>
      <View style={{ width: gutter }}>
        <View style={{ height: headerHeight }} />
        {days.map((date, index) => dayLabel(date, index, { height: daySize }))}
      </View>
      <ScrollView ref={scrollRef} key={layout} horizontal scrollEnabled={isWeek} showsHorizontalScrollIndicator={isWeek} style={{ flex: 1 }} contentContainerStyle={{ width: bodyWidth }}>
        <View style={{ width: bodyWidth }}>
          <View style={{ height: headerHeight }}>{timeLabels(true)}</View>
          {eventRows}
        </View>
      </ScrollView>
    </View> : <>
      {!hideDayHeader && <View style={{ height: headerHeight, flexDirection: 'row' }}>
        <View style={{ width: gutter }} />
        {days.map((date, index) => dayLabel(date, index, { width: daySize, height: headerHeight }))}
      </View>}
      <ScrollView ref={scrollRef} key={layout} scrollEnabled showsVerticalScrollIndicator style={{ flex: 1 }} contentContainerStyle={{ height: bodyHeight }}>
        <View style={{ flexDirection: 'row', height: bodyHeight }}>
          <View style={{ width: gutter }}>{timeLabels(false)}</View>
          {eventRows}
        </View>
      </ScrollView>
    </>}
  </View>;
}
