// Odczyt planu zajęć z pliku ICS (iCalendar, RFC 5545) – historyjka S23KC2S1P2-8.
//
// Plik ICS eksportują m.in. USOS, Google Calendar, Outlook i Apple Calendar. Czytamy z niego wydarzenia (VEVENT)
// i zamieniamy je na wiersze importu (ImportRow), które przechodzą przez ten sam podgląd, walidację,
// wykrywanie duplikatów i zapis co import PDF/zdjęć (historyjki 32, 14).
//
// Obsługiwane: zawijanie linii, znaki ucieczki, DTSTART/DTEND/DURATION, strefy czasowe (TZID, UTC „Z”,
// czas „pływający”), powtarzanie RRULE (DAILY/WEEKLY/MONTHLY, INTERVAL, COUNT, UNTIL, BYDAY), wyjątki EXDATE,
// przeniesione lub odwołane wystąpienia (RECURRENCE-ID) i odwołane wydarzenia (STATUS:CANCELLED).
// Wydarzenia całodniowe i bez godzin są pomijane i liczone (scenariusz 4a).
// Wydarzenia powtarzające się są rozwijane na wszystkie wystąpienia (krok 6) – w kalendarzu są osobnymi wpisami.

import { localDateTime } from '../../collisions.js';
import { DEFAULT_TIME_ZONE, toInstant, type ImportRow } from '../rules.js';

export type IcsRow = ImportRow & {
  category: 'Class';
  /** Opis powtarzania do podglądu, np. „co tydzień (pn), do 31.01.2027” albo null dla wydarzenia jednorazowego. */
  repeat: string | null;
  /** UID wydarzenia z pliku – wiersze jednej serii mają ten sam UID. */
  uid: string;
};

export type SkipReason = 'all-day' | 'missing-time' | 'invalid-date' | 'unsupported-repeat';

export type IcsResult = {
  calendarName: string | null;
  /** Strefa czasowa zapisana w pliku (X-WR-TIMEZONE albo najczęstszy TZID). */
  fileTimeZone: string | null;
  /** Strefa użytkownika, do której przeliczono godziny. */
  userTimeZone: string;
  rows: IcsRow[];
  /** Liczba wydarzeń z pliku (bez rozwinięcia powtórzeń). */
  eventCount: number;
  skipped: { count: number; reasons: Partial<Record<SkipReason, number>> };
  warnings: string[];
  dateFrom: string | null;
  dateTo: string | null;
};

export class IcsError extends Error {}

/** Limit wierszy jednego importu (taki sam jak limit API podglądu). */
export const MAX_ICS_ROWS = 1000;
/** Serie bez daty końca rozwijamy na najwyżej rok od pierwszego wystąpienia. */
const OPEN_SERIES_DAYS = 366;

type Property = { name: string; params: Record<string, string>; value: string };
type DateValue = { date: string; time: string | null; zone: string | 'UTC' | null };

const DAY_MS = 86_400_000;
const WEEKDAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
const WEEKDAY_LABELS: Record<string, string> = { MO: 'pn', TU: 'wt', WE: 'śr', TH: 'czw', FR: 'pt', SA: 'sob', SU: 'nd' };

// Strefy Windows (Outlook, Teams) najczęstsze w Polsce i Europie.
const WINDOWS_ZONES: Record<string, string> = {
  'central european standard time': 'Europe/Warsaw',
  'central europe standard time': 'Europe/Budapest',
  'w. europe standard time': 'Europe/Berlin',
  'romance standard time': 'Europe/Paris',
  'gmt standard time': 'Europe/London',
  'greenwich standard time': 'Atlantic/Reykjavik',
  'utc': 'UTC',
  'coordinated universal time': 'UTC',
  'e. europe standard time': 'Europe/Chisinau',
  'fle standard time': 'Europe/Kiev',
  'eastern standard time': 'America/New_York',
  'pacific standard time': 'America/Los_Angeles',
};

function validZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** Zamienia TZID z pliku na strefę IANA. Zwraca null, gdy strefy nie da się rozpoznać. */
export function resolveZone(tzid: string | undefined): string | null {
  if (!tzid) return null;
  const cleaned = tzid.replace(/^"|"$/g, '').trim();
  if (validZone(cleaned)) return cleaned;
  const windows = WINDOWS_ZONES[cleaned.toLowerCase()];
  if (windows) return windows;
  // Np. „/mozilla.org/20050126_1/Europe/Warsaw” albo „(UTC+01:00) Europe/Warsaw”.
  const iana = cleaned.match(/([A-Z][A-Za-z_]+\/[A-Z][A-Za-z_]+(?:\/[A-Z][A-Za-z_]+)?)\s*$/)?.[1];
  return iana && validZone(iana) ? iana : null;
}

/** Rozwija zawinięte linie (linia zaczynająca się od spacji lub tabulatora jest kontynuacją poprzedniej). */
function unfold(text: string): string[] {
  return text.replace(/^﻿/, '').replace(/\r\n?/g, '\n').replace(/\n[ \t]/g, '').split('\n').filter((line) => line.trim());
}

function parseProperty(line: string): Property | null {
  // Dwukropek w cudzysłowie (np. w parametrze) nie kończy nazwy właściwości.
  let quoted = false;
  let colon = -1;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"') quoted = !quoted;
    else if (line[i] === ':' && !quoted) { colon = i; break; }
  }
  if (colon <= 0) return null;
  const [name, ...paramParts] = line.slice(0, colon).split(';');
  const params: Record<string, string> = {};
  for (const part of paramParts) {
    const eq = part.indexOf('=');
    if (eq > 0) params[part.slice(0, eq).toUpperCase()] = part.slice(eq + 1).replace(/^"|"$/g, '');
  }
  return { name: name!.toUpperCase(), params, value: line.slice(colon + 1) };
}

function unescapeText(value: string): string {
  return value.replace(/\\([\\;,nN])/g, (_, char: string) => (char === 'n' || char === 'N' ? '\n' : char)).trim();
}

function parseDateValue(property: Property | undefined, defaultZone: string | null): DateValue | null {
  if (!property) return null;
  const value = property.value.trim();
  const dateOnly = value.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (dateOnly || property.params.VALUE === 'DATE') {
    if (!dateOnly) return null;
    return { date: `${dateOnly[1]}-${dateOnly[2]}-${dateOnly[3]}`, time: null, zone: null };
  }
  const match = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/);
  if (!match) return null;
  const zone = match[7] ? 'UTC' : resolveZone(property.params.TZID) ?? (property.params.TZID ? null : defaultZone);
  return { date: `${match[1]}-${match[2]}-${match[3]}`, time: `${match[4]}:${match[5]}`, zone };
}

/** Czas trwania ISO 8601 z ICS (np. PT1H30M, P1D, P1W) w milisekundach. */
function parseDuration(value: string | undefined): number | null {
  const match = value?.trim().match(/^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/);
  if (!match || match[1] === '-') return null;
  const [, , w, d, h, m, s] = match;
  const ms = (+(w ?? 0) * 7 + +(d ?? 0)) * DAY_MS + (+(h ?? 0) * 3600 + +(m ?? 0) * 60 + +(s ?? 0)) * 1000;
  return ms > 0 ? ms : null;
}

const addDays = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
const weekdayOf = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay();
const plDate = (date: string) => `${date.slice(8, 10)}.${date.slice(5, 7)}.${date.slice(0, 4)}`;

function instantOf(value: DateValue, fallbackZone: string): Date | null {
  if (!value.time) return null;
  if (value.zone === 'UTC') return new Date(`${value.date}T${value.time}:00Z`);
  return toInstant(value.date, value.time, value.zone ?? fallbackZone);
}

type Rule = { freq: 'DAILY' | 'WEEKLY' | 'MONTHLY'; interval: number; count?: number; until?: Date; byDay: number[] };

function parseRule(value: string, fallbackZone: string): Rule | 'unsupported' {
  const parts = Object.fromEntries(value.split(';').map((part) => part.split('=') as [string, string]).map(([k, v]) => [k.toUpperCase(), v]));
  const freq = parts.FREQ?.toUpperCase();
  if (freq !== 'DAILY' && freq !== 'WEEKLY' && freq !== 'MONTHLY') return 'unsupported';
  // Złożone reguły (np. „drugi wtorek miesiąca”, BYSETPOS) pomijamy, żeby nie zapisać błędnych terminów.
  if (parts.BYSETPOS || parts.BYMONTH || parts.BYYEARDAY || parts.BYWEEKNO || (freq === 'MONTHLY' && parts.BYDAY)) return 'unsupported';
  const interval = Math.max(1, Number(parts.INTERVAL ?? 1) || 1);
  const count = parts.COUNT ? Math.max(1, Number(parts.COUNT) || 1) : undefined;
  let until: Date | undefined;
  if (parts.UNTIL) {
    const parsed = parseDateValue({ name: 'UNTIL', params: {}, value: parts.UNTIL }, fallbackZone);
    if (parsed) until = parsed.time ? instantOf(parsed, fallbackZone) ?? undefined : new Date(Date.parse(`${addDays(parsed.date, 1)}T00:00:00Z`) - 1);
  }
  const byDay = (parts.BYDAY ?? '').split(',').map((day) => WEEKDAYS.indexOf(day.replace(/^[+-]?\d+/, '').toUpperCase())).filter((day) => day >= 0);
  return { freq, interval, count, until, byDay };
}

function describeRule(rule: Rule, startDate: string, lastDate: string | null): string {
  const days = rule.byDay.length ? rule.byDay : [weekdayOf(startDate)];
  const every = rule.freq === 'DAILY'
    ? rule.interval === 1 ? 'codziennie' : `co ${rule.interval} dni`
    : rule.freq === 'WEEKLY'
      ? `${rule.interval === 1 ? 'co tydzień' : rule.interval === 2 ? 'co dwa tygodnie' : `co ${rule.interval} tygodnie`} (${days.map((day) => WEEKDAY_LABELS[WEEKDAYS[day]!]).join(', ')})`
      : rule.interval === 1 ? 'co miesiąc' : `co ${rule.interval} miesiące`;
  return lastDate ? `${every}, do ${plDate(lastDate)}` : every;
}

/**
 * Daty kolejnych wystąpień (w czasie lokalnym strefy wydarzenia). Iterujemy po dniach kalendarza, a nie po
 * milisekundach, żeby zmiana czasu letni/zimowy nie przesuwała godzin zajęć.
 */
function occurrenceDates(startDate: string, rule: Rule, startTime: string, zone: string, horizonEnd: string): string[] {
  const dates: string[] = [];
  const limit = rule.count ?? Infinity;
  const passedUntil = (date: string) => {
    if (!rule.until) return false;
    const instant = toInstant(date, startTime, zone);
    return instant ? instant.getTime() > rule.until.getTime() : false;
  };
  if (rule.freq === 'MONTHLY') {
    const [y, m, d] = startDate.split('-').map(Number) as [number, number, number];
    for (let i = 0; dates.length < limit; i++) {
      const month = m - 1 + i * rule.interval;
      const candidate = new Date(Date.UTC(y, month, d));
      if (candidate.getUTCDate() !== d) continue; // np. 31. dzień w miesiącu, który go nie ma
      const date = candidate.toISOString().slice(0, 10);
      if (date > horizonEnd || passedUntil(date)) break;
      dates.push(date);
    }
    return dates;
  }
  const stepDays = rule.freq === 'DAILY' ? rule.interval : 7 * rule.interval;
  const weekdays = rule.freq === 'WEEKLY' && rule.byDay.length ? [...rule.byDay].sort((a, b) => a - b) : null;
  // Tydzień liczymy od poniedziałku (WKST=MO – domyślnie w Polsce i w eksportach USOS).
  const weekStart = addDays(startDate, -((weekdayOf(startDate) + 6) % 7));
  for (let period = 0; dates.length < limit; period++) {
    const base = weekdays ? addDays(weekStart, period * stepDays) : addDays(startDate, period * stepDays);
    if (base > horizonEnd) break;
    const candidates = weekdays ? weekdays.map((day) => addDays(base, (day + 6) % 7)) : [base];
    let stop = false;
    for (const date of candidates) {
      if (date < startDate) continue;
      if (date > horizonEnd || passedUntil(date)) { stop = true; break; }
      dates.push(date);
      if (dates.length >= limit) break;
    }
    if (stop) break;
  }
  return dates;
}

type RawEvent = { props: Property[] };
const prop = (event: RawEvent, name: string) => event.props.find((p) => p.name === name);
const props = (event: RawEvent, name: string) => event.props.filter((p) => p.name === name);

/** Najczęstszy TZID w pliku – informacja dla użytkownika, w jakiej strefie zapisano plan. */
function dominantZone(events: RawEvent[], calendarZone: string | null): string | null {
  if (calendarZone) return calendarZone;
  const counts = new Map<string, number>();
  for (const event of events) {
    const tzid = prop(event, 'DTSTART')?.params.TZID;
    const zone = resolveZone(tzid) ?? (prop(event, 'DTSTART')?.value.endsWith('Z') ? 'UTC' : null);
    if (zone) counts.set(zone, (counts.get(zone) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

export function parseIcs(text: string, options: { timeZone?: string } = {}): IcsResult {
  const userZone = options.timeZone ?? DEFAULT_TIME_ZONE;
  const lines = unfold(text);
  if (!lines.some((line) => /^BEGIN:VCALENDAR\s*$/i.test(line)) || !lines.some((line) => /^END:VCALENDAR\s*$/i.test(line))) {
    throw new IcsError('corrupted-file');
  }

  const calendarProps: Property[] = [];
  const events: RawEvent[] = [];
  const stack: string[] = [];
  let current: RawEvent | null = null;
  for (const line of lines) {
    const property = parseProperty(line);
    if (!property) continue;
    if (property.name === 'BEGIN') {
      stack.push(property.value.toUpperCase());
      if (property.value.toUpperCase() === 'VEVENT' && stack.length === 2) current = { props: [] };
      continue;
    }
    if (property.name === 'END') {
      const ended = stack.pop();
      if (ended === 'VEVENT' && current) { events.push(current); current = null; }
      continue;
    }
    // Właściwości z VALARM i VTIMEZONE (zagnieżdżone) nie należą do wydarzenia.
    if (current && stack.length === 2) current.props.push(property);
    else if (stack.length === 1) calendarProps.push(property);
  }
  if (stack.length !== 0) throw new IcsError('corrupted-file');

  const calendarZone = resolveZone(calendarProps.find((p) => p.name === 'X-WR-TIMEZONE')?.value);
  const calendarName = calendarProps.find((p) => p.name === 'X-WR-CALNAME')?.value;
  const fileZone = dominantZone(events, calendarZone);
  const floatingZone = calendarZone ?? userZone;
  const warnings: string[] = [];
  const skipped: IcsResult['skipped'] = { count: 0, reasons: {} };
  const skip = (reason: SkipReason) => { skipped.count += 1; skipped.reasons[reason] = (skipped.reasons[reason] ?? 0) + 1; };
  let unknownZone = false;

  // Przeniesione/odwołane pojedyncze wystąpienia serii: UID + pierwotny termin (RECURRENCE-ID).
  const overrides = new Map<string, Map<number, RawEvent>>();
  const masters: RawEvent[] = [];
  for (const event of events) {
    const recurrenceId = prop(event, 'RECURRENCE-ID');
    const uid = prop(event, 'UID')?.value ?? '';
    if (recurrenceId && uid) {
      const original = parseDateValue(recurrenceId, floatingZone);
      const instant = original ? instantOf(original, floatingZone) : null;
      if (instant) {
        const forUid = overrides.get(uid) ?? new Map<number, RawEvent>();
        forUid.set(instant.getTime(), event);
        overrides.set(uid, forUid);
        continue;
      }
    }
    masters.push(event);
  }

  const rows: IcsRow[] = [];
  let truncated = false;

  /** Dodaje jedno wystąpienie jako wiersz (godziny przeliczone na strefę użytkownika). */
  const addRow = (event: RawEvent, start: Date, end: Date, repeat: string | null, uid: string) => {
    if (rows.length >= MAX_ICS_ROWS) { truncated = true; return; }
    const localStart = localDateTime(start, userZone);
    const localEnd = localDateTime(end, userZone);
    rows.push({
      id: `ics${rows.length + 1}`,
      title: unescapeText(prop(event, 'SUMMARY')?.value ?? ''),
      date: localStart.slice(0, 10),
      startTime: localStart.slice(11, 16),
      endTime: localEnd.slice(11, 16),
      ...(localEnd.slice(0, 10) !== localStart.slice(0, 10) ? { endDate: localEnd.slice(0, 10) } : {}),
      category: 'Class',
      location: unescapeText(prop(event, 'LOCATION')?.value ?? '') || undefined,
      // Dane z ICS są odczytane dokładnie – nie ma niepewności rozpoznawania jak przy OCR.
      confidence: 1,
      repeat,
      uid,
    });
  };

  /** Termin pojedynczego wydarzenia (także przeniesionego wystąpienia). */
  const timing = (event: RawEvent): { start: Date; end: Date; zone: string; startValue: DateValue } | SkipReason => {
    const startValue = parseDateValue(prop(event, 'DTSTART'), floatingZone);
    if (!startValue) return 'invalid-date';
    if (!startValue.time) return 'all-day';
    if (startValue.zone === null) unknownZone = true;
    const zone = startValue.zone === 'UTC' ? 'UTC' : startValue.zone ?? userZone;
    const start = instantOf(startValue, userZone);
    if (!start) return 'invalid-date';
    const endValue = parseDateValue(prop(event, 'DTEND'), floatingZone);
    let end: Date | null = null;
    if (endValue) {
      if (!endValue.time) return 'all-day';
      end = instantOf(endValue, userZone);
    } else {
      const duration = parseDuration(prop(event, 'DURATION')?.value);
      if (duration) end = new Date(start.getTime() + duration);
    }
    if (!end || end.getTime() <= start.getTime()) return 'missing-time';
    return { start, end, zone, startValue };
  };

  const cancelled = (event: RawEvent) => prop(event, 'STATUS')?.value.trim().toUpperCase() === 'CANCELLED';

  for (const event of masters) {
    if (cancelled(event)) continue; // odwołane wydarzenie – nie ma czego importować
    const uid = prop(event, 'UID')?.value ?? `bez-uid-${rows.length}`;
    const result = timing(event);
    if (typeof result === 'string') { skip(result); continue; }
    const { start, end, zone, startValue } = result;
    const ruleProperty = prop(event, 'RRULE');
    if (!ruleProperty) { addRow(event, start, end, null, uid); continue; }

    const rule = parseRule(ruleProperty.value, zone);
    if (rule === 'unsupported') { skip('unsupported-repeat'); continue; }
    const duration = end.getTime() - start.getTime();
    const localStart = startValue.zone === 'UTC' ? localDateTime(start, zone) : `${startValue.date}T${startValue.time}`;
    const horizon = addDays(localStart.slice(0, 10), OPEN_SERIES_DAYS);
    if (!rule.count && !rule.until) warnings.push(`Seria „${unescapeText(prop(event, 'SUMMARY')?.value ?? '')}” nie ma daty końca – zaimportowano wystąpienia do ${plDate(horizon)}.`);
    const excluded = new Set(props(event, 'EXDATE').flatMap((ex) => ex.value.split(',').map((value) => {
      const parsed = parseDateValue({ ...ex, value }, zone);
      if (!parsed) return NaN;
      // EXDATE z samą datą wyklucza wystąpienie tego dnia.
      return parsed.time ? instantOf(parsed, zone)?.getTime() ?? NaN : toInstant(parsed.date, localStart.slice(11, 16), zone)?.getTime() ?? NaN;
    })));
    const dates = occurrenceDates(localStart.slice(0, 10), rule, localStart.slice(11, 16), zone, horizon);
    const repeat = describeRule(rule, localStart.slice(0, 10), dates.at(-1) ?? null);
    const moved = overrides.get(uid);
    for (const date of dates) {
      const occurrenceStart = toInstant(date, localStart.slice(11, 16), zone);
      if (!occurrenceStart || excluded.has(occurrenceStart.getTime())) continue; // nieistniejąca godzina (zmiana czasu) albo wyjątek
      const override = moved?.get(occurrenceStart.getTime());
      if (override) {
        moved!.delete(occurrenceStart.getTime());
        if (cancelled(override)) continue;
        const changed = timing(override);
        if (typeof changed === 'string') { skip(changed); continue; }
        addRow(override, changed.start, changed.end, repeat, uid);
        continue;
      }
      addRow(event, occurrenceStart, new Date(occurrenceStart.getTime() + duration), repeat, uid);
    }
  }
  // Wystąpienia przeniesione z terminu, którego nie ma w serii (np. seria pominięta) – importujemy jak pojedyncze wydarzenia.
  for (const [uid, moved] of overrides) {
    for (const override of moved.values()) {
      if (cancelled(override) || masters.some((event) => prop(event, 'UID')?.value === uid && prop(event, 'RRULE'))) continue;
      const changed = timing(override);
      if (typeof changed === 'string') { skip(changed); continue; }
      addRow(override, changed.start, changed.end, null, uid);
    }
  }

  rows.sort((a, b) => `${a.date}T${a.startTime}`.localeCompare(`${b.date}T${b.startTime}`));
  rows.forEach((row, index) => { row.id = `ics${index + 1}`; });

  if (truncated) warnings.push(`Plik zawiera ponad ${MAX_ICS_ROWS} wystąpień – zaimportowano pierwsze ${MAX_ICS_ROWS}. Podziel plik na krótsze okresy.`);
  if (unknownZone) warnings.push(`Nie rozpoznano strefy czasowej części wydarzeń – przyjęto strefę ${userZone}. Sprawdź godziny.`);
  if (fileZone && fileZone !== userZone) {
    warnings.push(`Plik zapisano w strefie ${fileZone}, a Twój kalendarz używa strefy ${userZone}. Godziny przeliczono na Twoją strefę.`);
  }

  return {
    calendarName: calendarName ? unescapeText(calendarName) : null,
    fileTimeZone: fileZone,
    userTimeZone: userZone,
    rows,
    eventCount: masters.length,
    skipped,
    warnings,
    dateFrom: rows[0]?.date ?? null,
    dateTo: rows.at(-1)?.endDate ?? rows.at(-1)?.date ?? null,
  };
}

/** Sprawdza plik ICS przesłany jako base64 (format, rozmiar, kodowanie). */
export function decodeIcsFile(dataBase64: string, maxBytes: number):
  | { ok: true; text: string; bytes: number }
  | { ok: false; reason: 'empty-file' | 'file-too-large' | 'unsupported-format' | 'corrupted-file' } {
  const bytes = Buffer.from(dataBase64, 'base64');
  if (!bytes.length) return { ok: false, reason: 'empty-file' };
  if (bytes.length > maxBytes) return { ok: false, reason: 'file-too-large' };
  const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes).replace(/^﻿/, '');
  if (!/^\s*BEGIN:VCALENDAR/i.test(text)) return { ok: false, reason: 'unsupported-format' };
  if (!/END:VCALENDAR\s*$/i.test(text.trimEnd())) return { ok: false, reason: 'corrupted-file' };
  return { ok: true, text, bytes: bytes.length };
}

/** Czy przesłany plik to ICS (po treści, a nie po rozszerzeniu). */
export const looksLikeIcs = (dataBase64: string) =>
  /^\s*BEGIN:VCALENDAR/i.test(Buffer.from(dataBase64.slice(0, 200), 'base64').toString('utf8').replace(/^﻿/, ''));
