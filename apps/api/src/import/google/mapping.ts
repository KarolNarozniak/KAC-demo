// Zamiana wydarzeń z Google Calendar na wiersze importu (S23KC2S1P2-27).
// Godziny są przeliczane na strefę kalendarza użytkownika. Wydarzenia całodniowe i odwołane są pomijane
// (aplikacja planuje zajęcia i pracę w godzinach), a ich liczba jest podawana w podglądzie.

import { localDateTime } from '../../collisions.js';
import type { ImportCategory, ImportRow } from '../rules.js';
import type { GoogleEvent } from './types.js';

export type GoogleRow = ImportRow & { category: ImportCategory; externalId: string };

export function googleEventsToRows(events: GoogleEvent[], zone: string, category: ImportCategory): { rows: GoogleRow[]; skippedAllDay: number } {
  const rows: GoogleRow[] = [];
  let skippedAllDay = 0;
  for (const event of events) {
    if (event.status === 'cancelled') continue;
    if (!event.start?.dateTime || !event.end?.dateTime) { skippedAllDay += 1; continue; }
    const start = new Date(event.start.dateTime), end = new Date(event.end.dateTime);
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) { skippedAllDay += 1; continue; }
    const localStart = localDateTime(start, zone), localEnd = localDateTime(end, zone);
    rows.push({
      id: `g${rows.length + 1}`,
      title: (event.summary ?? '').trim().slice(0, 200),
      date: localStart.slice(0, 10),
      startTime: localStart.slice(11, 16),
      endTime: localEnd.slice(11, 16),
      ...(localEnd.slice(0, 10) !== localStart.slice(0, 10) ? { endDate: localEnd.slice(0, 10) } : {}),
      category,
      location: event.location?.trim().slice(0, 200) || undefined,
      confidence: 1,
      externalId: event.id,
    });
    if (rows.length >= 1000) break;
  }
  return { rows, skippedAllDay };
}
