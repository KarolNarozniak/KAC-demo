import type { CalendarEvent } from '../domain/model';
export type EventCollision = { id: string; title: string; category: string; start: string; end: string; overlapStart: string; overlapEnd: string };
export class EventCollisionError extends Error {
  constructor(public conflicts: EventCollision[], public token: string) { super('Wydarzenia nakładają się.'); }
}
const baseUrl = () => {
  const configured = process.env.EXPO_PUBLIC_API_URL?.trim();
  if (configured) return configured.replace(/\/$/, '');
  const host = globalThis.location?.hostname;
  if (host === 'localhost' || host === '127.0.0.1') return 'http://localhost:4000';
  throw new Error('Brak konfiguracji adresu API.');
};
async function request(path: string, options?: RequestInit) {
  const response = await fetch(`${baseUrl()}${path}`, { ...options, headers: { Accept: 'application/json', ...(options?.body ? { 'Content-Type': 'application/json' } : {}) }, signal: AbortSignal.timeout(15000) });
  if (response.status === 409) {
    const data = await response.json();
    if (data.error === 'event_collision') throw new EventCollisionError(data.conflicts, data.collisionToken);
  }
  if (response.status === 400) throw new Error('Sprawdź datę i godziny. Czas musi istnieć w strefie kalendarza; wydarzenie może trwać do 366 dni, a cotygodniowe do 7 dni.');
  if (response.status === 404) throw new Error('Wydarzenie już nie istnieje. Odśwież kalendarz.');
  if (!response.ok) throw new Error('Nie udało się połączyć z kalendarzem. Sprawdź połączenie i spróbuj ponownie.');
  return response.json();
}
export async function loadCalendar(): Promise<CalendarEvent[]> {
  const data = await request('/api/calendar');
  const categories: Record<string, CalendarEvent['category']> = { 'Zajęcia': 'Class', 'Praca': 'Work', 'Prywatne': 'Personal' };
  return data.events.map((event: CalendarEvent) => ({ ...event, category: categories[event.category] ?? 'Personal' }));
}
export async function createEvent(event: CalendarEvent, collisionToken?: string): Promise<CalendarEvent> {
  const { title, start, end, category, mandatory, repeatWeekly } = event;
  return request('/api/events', { method: 'POST', body: JSON.stringify({ title, start, end, category, mandatory, repeatWeekly, location: event.location ?? '', collisionToken }) });
}

export async function deleteEvent(id: string): Promise<string[]> {
  const result = await request(`/api/events/${encodeURIComponent(id)}`, { method: 'DELETE' });
  return result.deletedIds;
}

export async function updateEvent(id: string, event: CalendarEvent, collisionToken?: string): Promise<CalendarEvent> {
  const { title, start, end, category, mandatory, repeatWeekly } = event;
  return request(`/api/events/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify({ title, start, end, category, mandatory, repeatWeekly, location: event.location ?? '', collisionToken }) });
}
