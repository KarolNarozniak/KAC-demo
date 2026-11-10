// Przykłady kalendarza i stanu API w Swagger UI. Dane syntetyczne, zgodne z odpowiedziami tras z tego modułu.
import type { NamedExamples } from '../../examples.js';

const eventId = 'a1b2c3d4-0000-4000-8000-000000000001';
const consultation = { title: 'Konsultacje z promotorem', start: '2026-11-19T15:00', end: '2026-11-19T16:00', category: 'Personal', location: 'Bud. 65, s. 120', mandatory: false, repeatWeekly: false };
const lecture = { title: 'Algorytmy – wykład', start: '2026-11-16T10:00', end: '2026-11-16T13:15', category: 'Class', location: 'Bud. 100, aula 2', mandatory: true, repeatWeekly: true };

export const overviewExamples: NamedExamples = {
  overview: {
    summary: 'Kalendarz z wydarzeniami',
    description: 'Wydarzenia mają instanty UTC; serie cotygodniowe są rozwinięte na wystąpienia.',
    value: {
      source: 'postgresql',
      user: { id: 'U001', name: 'Student Demo', timezone: 'Europe/Warsaw' },
      calendar: { id: 'K001', name: 'Kalendarz studenta' },
      counts: { events: 2, categories: 3 },
      events: [
        { id: 'E-ALG', title: 'Algorytmy – wykład', start: '2026-11-16T09:00:00.000Z', end: '2026-11-16T12:15:00.000Z', category: 'Zajęcia', color: '#2563EB', mandatory: true },
        { id: 'E-WORK', title: 'Praca', start: '2026-11-17T11:30:00.000Z', end: '2026-11-17T18:30:00.000Z', category: 'Praca', color: '#16A34A', mandatory: false },
      ],
    },
  },
};

export const eventInputExamples: NamedExamples = {
  oneOff: { summary: 'Jednorazowe wydarzenie', description: 'start i end to lokalny czas użytkownika (YYYY-MM-DDTHH:MM).', value: consultation },
  weekly: { summary: 'Zajęcia co tydzień', description: 'repeatWeekly tworzy serię; edycja PUT zmienia całą serię.', value: lecture },
  override: {
    summary: 'Zapis mimo kolizji',
    description: 'collisionToken z odpowiedzi 409 potwierdza, że użytkownik widział te same konflikty.',
    value: { ...consultation, collisionToken: '5f2b9c0e7d4a1b3c6e8f0a2d4c6b8e0f1a3c5e7b9d1f3a5c7e9b1d3f5a7c9e1b' },
  },
};

export const savedEventExamples: NamedExamples = {
  saved: { summary: 'Zapisane wydarzenie', value: { id: eventId, ...consultation } },
};

export const collisionExamples: NamedExamples = {
  collision: {
    summary: 'Kolizja z innym wydarzeniem',
    description: 'Popraw termin albo wyślij ponownie z collisionToken, żeby zapisać mimo kolizji.',
    value: {
      error: 'event_collision',
      conflicts: [{ id: 'E-ALG', title: 'Algorytmy – wykład', category: 'Class', start: '2026-11-19T14:30:00.000Z', end: '2026-11-19T15:30:00.000Z', overlapStart: '2026-11-19T14:30:00.000Z', overlapEnd: '2026-11-19T15:00:00.000Z' }],
      collisionToken: '5f2b9c0e7d4a1b3c6e8f0a2d4c6b8e0f1a3c5e7b9d1f3a5c7e9b1d3f5a7c9e1b',
    },
  },
};

export const deletedEventExamples: NamedExamples = {
  single: { summary: 'Usunięte wydarzenie', value: { deletedIds: [eventId] } },
  series: { summary: 'Usunięta seria', description: 'Dla serii zwracane są identyfikatory wszystkich usuniętych wystąpień.', value: { deletedIds: ['E-ALG', 'E-ALG-2', 'E-ALG-3'] } },
};

export const readyExamples: NamedExamples = {
  connected: { summary: 'API i baza działają', value: { api: 'ok', database: 'connected' } },
};

export const notReadyExamples: NamedExamples = {
  notConfigured: { summary: 'Brak DATABASE_URL', value: { api: 'ok', database: 'not-configured' } },
  unavailable: { summary: 'Baza nie odpowiada', value: { api: 'ok', database: 'unavailable' } },
};
