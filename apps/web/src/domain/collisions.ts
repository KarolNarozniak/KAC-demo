// Pełna informacja o kolizjach w kalendarzu (S23KC2S1P2-302, N10).
// Opis każdej kolidującej pozycji: nazwa, rodzaj, termin i część wspólna w strefie kalendarza.
import type { EventCollision } from '../services/calendarApi';

const CATEGORY_LABELS: Record<string, string> = {
  Class: 'Zajęcia', Work: 'Praca', Personal: 'Prywatne', 'Zajęcia': 'Zajęcia', 'Praca': 'Praca', 'Prywatne': 'Prywatne',
};

function parts(value: string, timeZone: string) {
  const formatted = new Intl.DateTimeFormat('pl-PL', { timeZone, weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date(value));
  const get = (type: string) => formatted.find((part) => part.type === type)?.value ?? '';
  return { day: `${get('weekday')} ${get('day')}.${get('month')}`, time: `${get('hour')}:${get('minute')}` };
}

/** „czw. 19.11 15:30–16:30”; gdy koniec wypada innego dnia, podaje obie daty. */
export function collisionRange(start: string, end: string, timeZone = 'Europe/Warsaw'): string {
  const a = parts(start, timeZone), b = parts(end, timeZone);
  return a.day === b.day ? `${a.day} ${a.time}–${b.time}` : `${a.day} ${a.time} – ${b.day} ${b.time}`;
}

export type CollisionView = { key: string; title: string; kind: string; range: string; overlap: string; notes: string[] };

export function describeCollision(item: EventCollision, timeZone = 'Europe/Warsaw'): CollisionView {
  const notes: string[] = [];
  if (item.mandatory) notes.push('zajęcia obowiązkowe');
  if (item.recurring) notes.push('kolizja powtarza się co tydzień');
  else if (item.repeatWeekly) notes.push('wystąpienie serii cotygodniowej');
  return { key: `${item.id}-${item.start}`, title: item.title, kind: CATEGORY_LABELS[item.category] ?? item.category,
    range: collisionRange(item.start, item.end, timeZone), overlap: collisionRange(item.overlapStart, item.overlapEnd, timeZone), notes };
}

/** Krótkie podsumowanie listy, np. „Koliduje z 3 pozycjami, w tym z zajęciami obowiązkowymi (1).” */
export function collisionSummary(items: EventCollision[]): string {
  if (!items.length) return 'Termin jest wolny – brak kolizji.';
  const count = items.length, mandatory = items.filter((item) => item.mandatory).length;
  const noun = count === 1 ? 'pozycją' : 'pozycjami';
  return `Koliduje z ${count} ${noun}${mandatory ? `, w tym z zajęciami obowiązkowymi (${mandatory})` : ''}.`;
}
