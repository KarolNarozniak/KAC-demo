// Przykłady kalendarza i stanu API w Swagger UI. Dane syntetyczne, zgodne z odpowiedziami tras z tego modułu.
import type { NamedExamples } from '../../examples.js';

const eventId = 'a1b2c3d4-0000-4000-8000-000000000001';
const consultation = { title: 'Konsultacje z promotorem', start: '2026-11-19T15:00', end: '2026-11-19T16:00', category: 'Personal', location: 'Bud. 65, s. 120', mandatory: false, repeatWeekly: false };
const lecture = { title: 'Algorytmy – wykład', start: '2026-11-16T10:00', end: '2026-11-16T13:15', category: 'Class', location: 'Bud. 100, aula 2', mandatory: true, repeatWeekly: true };

export const overviewExamples: NamedExamples = {
  overview: {
    summary: 'Kalendarz z zajęciami i pracą',
    description: 'Wszystko, czego potrzebuje ekran kalendarza: użytkownik z jego strefą czasową, kalendarz, liczniki i lista wydarzeń. Czasy wydarzeń są w UTC (Z) – 09:00Z to 10:00 czasu polskiego zimą. mandatory: true oznacza zajęcia obowiązkowe, na które nie można zaplanować pracy.',
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
  oneOff: {
    summary: 'Jednorazowe spotkanie',
    description: 'Konsultacje w czwartek 15:00–16:00. start i end podajemy w czasie polskim, bez strefy (format RRRR-MM-DDTGG:MM). Jeśli termin nachodzi na inne wydarzenie, serwer zwróci 409 z listą kolizji.',
    value: consultation,
  },
  weekly: {
    summary: 'Wykład co tydzień',
    description: 'repeatWeekly: true tworzy serię – wykład powtarza się w każdy poniedziałek 10:00–13:15. mandatory: true oznacza zajęcia obowiązkowe: generator grafiku nigdy nie zaplanuje na nie pracy. Zmiana serii przez PUT zmienia wszystkie jej wystąpienia.',
    value: lecture,
  },
  override: {
    summary: 'Zapis mimo kolizji',
    description: 'Drugi krok po odpowiedzi 409: użytkownik zobaczył kolizję i mimo to chce zapisać. Wysyłamy te same dane plus collisionToken z odpowiedzi 409. Token potwierdza, że użytkownik widział dokładnie te konflikty – jeśli w międzyczasie doszły nowe, serwer znów zwróci 409.',
    value: { ...consultation, collisionToken: '5f2b9c0e7d4a1b3c6e8f0a2d4c6b8e0f1a3c5e7b9d1f3a5c7e9b1d3f5a7c9e1b' },
  },
};

export const savedEventExamples: NamedExamples = {
  saved: { summary: 'Zapisane wydarzenie', description: 'Serwer zwraca wysłane dane razem z nadanym id – jest ono potrzebne do późniejszej edycji (PUT) albo usunięcia (DELETE).', value: { id: eventId, ...consultation } },
};

export const collisionExamples: NamedExamples = {
  collision: {
    summary: 'Termin nachodzi na inne wydarzenie',
    description: 'Nic nie zostało zapisane. conflicts pokazuje, z czym jest kolizja i w jakich godzinach: konsultacje 15:00–16:00 nachodzą na laboratorium 15:30–16:30, więc wspólna część to 15:30–16:00 (w odpowiedzi w UTC: overlapStart 14:30Z – overlapEnd 15:00Z). Użytkownik może zmienić termin albo zapisać mimo to – wtedy wysyła żądanie ponownie z collisionToken (zobacz przykład żądania „Zapis mimo kolizji”).',
    value: {
      error: 'event_collision',
      conflicts: [{ id: 'E-LAB', title: 'Sieci komputerowe – laboratorium', category: 'Class', start: '2026-11-19T14:30:00.000Z', end: '2026-11-19T15:30:00.000Z', overlapStart: '2026-11-19T14:30:00.000Z', overlapEnd: '2026-11-19T15:00:00.000Z' }],
      collisionToken: '5f2b9c0e7d4a1b3c6e8f0a2d4c6b8e0f1a3c5e7b9d1f3a5c7e9b1d3f5a7c9e1b',
    },
  },
};

export const deletedEventExamples: NamedExamples = {
  single: { summary: 'Usunięte jedno wydarzenie', description: 'deletedIds zawiera id usuniętego wydarzenia – aplikacja może je od razu usunąć z ekranu.', value: { deletedIds: [eventId] } },
  series: { summary: 'Usunięta cała seria', description: 'Usunięcie wydarzenia cotygodniowego usuwa całą serię; deletedIds zawiera id wszystkich usuniętych wystąpień.', value: { deletedIds: ['E-ALG', 'E-ALG-2', 'E-ALG-3'] } },
};

export const readyExamples: NamedExamples = {
  connected: { summary: 'Wszystko działa', description: 'Serwer API odpowiada i ma połączenie z bazą PostgreSQL – aplikacja jest gotowa do pracy.', value: { api: 'ok', database: 'connected' } },
};

export const notReadyExamples: NamedExamples = {
  notConfigured: { summary: 'Serwer bez bazy danych', description: 'API działa, ale uruchomiono je bez adresu bazy (DATABASE_URL). Odpowiedzą tylko endpointy, które nie potrzebują bazy.', value: { api: 'ok', database: 'not-configured' } },
  unavailable: { summary: 'Baza nie odpowiada', description: 'API działa, ale nie może połączyć się z bazą – np. kontener PostgreSQL jest wyłączony. Uruchom bazę (npm run db:up).', value: { api: 'ok', database: 'unavailable' } },
};
