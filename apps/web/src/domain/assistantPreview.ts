// Karta podglądu wydarzenia w czacie (S23KC2S1P2-252, S23KC2S1P2-263).
import type { PendingAssistantAction, PreviewCollision } from '../services/assistantApi';

const LOCAL = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const CATEGORY: Record<string, string> = { Class: 'Zajęcia', Work: 'Praca', Personal: 'Prywatne' };
const SHORT_DAY = ['nd', 'pn', 'wt', 'śr', 'cz', 'pt', 'sb'];

// Daty z API to czas lokalny kalendarza ("YYYY-MM-DDTHH:MM"). Formatujemy je jako UTC, żeby strefa przeglądarki niczego nie przesunęła.
const asUtc = (value: string) => new Date(`${value.slice(0, 10)}T00:00:00Z`);
export const longDate = (value: string) => asUtc(value).toLocaleDateString('pl-PL', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const shortDate = (value: string) => { const date = asUtc(value); return `${SHORT_DAY[date.getUTCDay()]} ${date.getUTCDate()}.${String(date.getUTCMonth() + 1).padStart(2, '0')}`; };

export type EventPreview = {
  title: string; date: string; time: string; category: string; location: string; recurrence: string; mandatory: string;
  collisions: string[]; blocked: boolean; blockReason: string; dateKey: string;
};

export function collisionLabel(item: PreviewCollision): string {
  const sameDay = item.startLocal.slice(0, 10) === item.endLocal.slice(0, 10);
  return `${item.title} (${shortDate(item.startLocal)}, ${item.startLocal.slice(11)}–${sameDay ? item.endLocal.slice(11) : `${shortDate(item.endLocal)} ${item.endLocal.slice(11)}`})`;
}

/** Pełny podgląd propozycji dodania – pokazujemy konkretną datę zamiast „jutro”. Zwraca null dla innych akcji albo uszkodzonych danych. */
export function eventPreview(action: PendingAssistantAction): EventPreview | null {
  if (action.kind !== 'calendar_event_create') return null;
  const event = action.payload.event as Record<string, unknown> | undefined;
  const start = String(event?.start ?? ''), end = String(event?.end ?? '');
  if (!event || !LOCAL.test(start) || !LOCAL.test(end)) return null;
  const sameDay = start.slice(0, 10) === end.slice(0, 10);
  const collisions = (action.collisions ?? []).map(collisionLabel);
  const blockReason = action.validationError
    ? 'Ten termin nie istnieje w kalendarzu (np. przez zmianę czasu). Poproś asystenta o inną godzinę.'
    : collisions.length ? 'Termin koliduje z wydarzeniami w kalendarzu. Popraw go w rozmowie albo anuluj propozycję.' : '';
  return {
    title: String(event.title ?? ''),
    date: longDate(start),
    time: sameDay ? `${start.slice(11)}–${end.slice(11)}` : `${start.slice(11)} – ${shortDate(end)} ${end.slice(11)}`,
    category: CATEGORY[String(event.category)] ?? 'Prywatne',
    location: String(event.location ?? '').trim() || 'nie podano',
    recurrence: event.repeatWeekly ? `Co tydzień (${asUtc(start).toLocaleDateString('pl-PL', { timeZone: 'UTC', weekday: 'long' })}), od tej daty` : 'Jednorazowo',
    mandatory: event.category === 'Class' ? (event.mandatory ? 'obowiązkowe' : 'nieobowiązkowe') : '',
    collisions, blocked: Boolean(blockReason), blockReason, dateKey: start.slice(0, 10),
  };
}

/** Potwierdzenie po zapisie – z datą, żeby można było przejść do niej w kalendarzu. */
export function createdMessage(preview: EventPreview): string {
  return `Dodano „${preview.title}” do kalendarza: ${preview.date}, ${preview.time}.`;
}
