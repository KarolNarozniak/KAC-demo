// Kolizje importowanych wydarzeń z wydarzeniami już zapisanymi w kalendarzu (historyjka S23KC2S1P2-8, przebieg 7a;
// ta sama informacja przydaje się w imporcie PDF/zdjęć i z Google Calendar).
// Kolizja to nakładanie się przedziałów czasu (samo zetknięcie granic nie jest kolizją) – ta sama reguła co przy
// ręcznym dodawaniu wydarzeń (collisions.ts, historyjka 43). Kolizja nie blokuje importu – użytkownik jest informowany.

import { findEventCollisions, type TimedEvent } from '../collisions.js';
import type { CalendarOverview } from '../database.js';
import type { ImportRow } from './rules.js';

export type ImportCollision = { id: string; title: string; category: string; mandatory: boolean; start: string; end: string };

export function importCollisions(rows: ImportRow[], events: CalendarOverview['events'], zone: string): Record<string, ImportCollision[]> {
  const existing: TimedEvent[] = events.map((event) => ({
    id: event.id, title: event.title, start: event.start.slice(0, 16), end: event.end.slice(0, 16),
    category: event.category, repeatWeekly: Boolean(event.repeatWeekly),
  }));
  const mandatory = new Map(events.map((event) => [event.id, event.mandatory]));
  const result: Record<string, ImportCollision[]> = {};
  for (const row of rows) {
    const candidate: TimedEvent = {
      title: row.title.trim() || '-', start: `${row.date}T${row.startTime}`, end: `${row.endDate ?? row.date}T${row.endTime}`,
      category: row.category ?? 'Class', repeatWeekly: false,
    };
    try {
      const found = findEventCollisions(candidate, existing, zone);
      if (found.length) result[row.id] = found.map((item) => ({ id: item.id, title: item.title, category: item.category,
        mandatory: Boolean(mandatory.get(item.id)), start: item.start, end: item.end }));
    } catch {
      // Niepoprawny wiersz (np. brak godziny) – kolizje sprawdzimy, gdy użytkownik go poprawi.
    }
  }
  return result;
}
