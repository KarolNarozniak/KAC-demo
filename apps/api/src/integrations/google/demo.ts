// Konta demonstracyjne trwałej integracji Google (S23KC2S1P2-12, G01/G02).
// Działają, gdy serwer nie ma klienta Google OAuth – tak jak jednorazowy import (S23KC2S1P2-27). Nie ma tu żadnych tokenów.
// Dwa konta pozwalają pokazać wybór konta (5b) i „Zmień konto”.
import { localDateTime } from '../../collisions.js';
import { toInstant } from '../../import/rules.js';
import type { GoogleEventItem, IntegrationCalendar } from './oauth-client.js';

export const DEMO_INTEGRATION_ACCOUNTS = ['student.kac.demo@gmail.com', 'praca.kac.demo@gmail.com'] as const;
export type DemoIntegrationAccount = typeof DEMO_INTEGRATION_ACCOUNTS[number];

/** Zakresy, jakie „przyznaje” konto demonstracyjne – takie same, o jakie prosi prawdziwe połączenie. */
export const DEMO_GRANTED_SCOPES = ['openid', 'email', 'https://www.googleapis.com/auth/calendar.readonly', 'https://www.googleapis.com/auth/calendar.events'];

const CALENDARS: Record<DemoIntegrationAccount, IntegrationCalendar[]> = {
  'student.kac.demo@gmail.com': [
    { id: 'primary', name: 'Student KAC (prywatny)', primary: true, accessRole: 'owner', timeZone: 'Europe/Warsaw' },
    { id: 'grafik-pracy', name: 'Grafik pracy', primary: false, accessRole: 'writer', timeZone: 'Europe/Warsaw' },
    { id: 'kolo-naukowe', name: 'Koło naukowe Cyberbezpieczeństwa', primary: false, accessRole: 'reader', timeZone: 'Europe/Warsaw' },
    { id: 'urodziny', name: 'Urodziny', primary: false, accessRole: 'reader', timeZone: 'Europe/Warsaw' },
  ],
  // Konto bez kalendarzy pokazuje przebieg 7a: połączenie zostaje, lista jest pusta.
  'praca.kac.demo@gmail.com': [],
};

export const isDemoAccount = (value: unknown): value is DemoIntegrationAccount =>
  typeof value === 'string' && (DEMO_INTEGRATION_ACCOUNTS as readonly string[]).includes(value);

export function demoIntegrationCalendars(email: string): IntegrationCalendar[] {
  return isDemoAccount(email) ? CALENDARS[email].map((calendar) => ({ ...calendar })) : [];
}

/** Stabilny „identyfikator Google” konta demonstracyjnego – odpowiednik sub z id_token. */
export const demoSub = (email: string) => `demo:${email}`;

// --- Wydarzenia konta demonstracyjnego (S23KC2S1P2-23, G05) ---
//
// „Serwer Google” makiety: zbiór wydarzeń zależy od okna odczytu i rewizji kalendarza. Rewizja nieparzysta to stan „po zmianach
// w Google” (przesunięta wizyta, odwołana instancja serii, nowe wydarzenie, zmieniona godzina spotkania), parzysta – stan wyjściowy.
// Daty są liczone od początku okna, więc odczyt przyrostowy (kursor z oknem) porównuje te same wydarzenia.
// Są tu też przypadki brzegowe: seria cotygodniowa, wydarzenia całodniowe, odrzucone zaproszenie i własna publikacja KAC.

const DEMO_ZONE = 'Europe/Warsaw';
const DAY_MS = 86_400_000;
const addDays = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
const weekday = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay();
const at = (date: string, time: string) => toInstant(date, time, DEMO_ZONE)!.toISOString();
const nextWeekday = (date: string, day: number) => { let current = date; while (weekday(current) !== day) current = addDays(current, 1); return current; };

export type DemoWindow = { from: Date; to: Date };

export function demoIntegrationEvents(email: string, calendarId: string, revision: number, window: DemoWindow): GoogleEventItem[] {
  if (email !== 'student.kac.demo@gmail.com') return [];
  const changed = revision % 2 === 1;
  const first = localDateTime(window.from, DEMO_ZONE).slice(0, 10);
  const last = localDateTime(new Date(window.to.getTime() - 1), DEMO_ZONE).slice(0, 10);
  // Okno pełnego odczytu zaczyna się 28 dni wstecz, więc kotwica wypada mniej więcej pojutrze.
  const anchor = addDays(first, 30);
  const updated = new Date(Date.UTC(2026, 0, 1) + revision * 60_000).toISOString();
  const events: GoogleEventItem[] = [];
  const timed = (id: string, summary: string, date: string, start: string, end: string, extra: Partial<GoogleEventItem> = {}) => events.push({
    id, status: 'confirmed', summary, updated, start: { dateTime: at(date, start), timeZone: DEMO_ZONE }, end: { dateTime: at(date, end), timeZone: DEMO_ZONE }, ...extra,
  });
  const instance = (series: string, summary: string, date: string, start: string, end: string, extra: Partial<GoogleEventItem> = {}) =>
    timed(`${series}_${date.replaceAll('-', '')}`, summary, date, start, end,
      { recurringEventId: series, originalStartTime: { dateTime: at(date, start), timeZone: DEMO_ZONE }, ...extra });

  const cancelledLesson = nextWeekday(anchor, 2);
  const movedMeeting = nextWeekday(anchor, 3);
  for (let date = first, index = 0; date <= last; date = addDays(date, 1), index++) {
    const day = weekday(date);
    if (calendarId === 'primary') {
      if (day === 6) instance('demo-silownia', 'Siłownia', date, '10:00', '11:30', { location: 'CityFit Bemowo' });
      if (day === 2 && !(changed && date === cancelledLesson)) instance('demo-angielski', 'Korepetycje z angielskiego', date, '19:00', '20:00');
    } else if (calendarId === 'kolo-naukowe') {
      if (day === 3) {
        const moved = changed && date === movedMeeting;
        instance('demo-kolo', 'Spotkanie koła naukowego', date, moved ? '18:30' : '18:00', moved ? '20:00' : '19:30', { location: 'WAT, bud. 65, s. 120' });
      }
    } else if (calendarId === 'urodziny') {
      // Wydarzenia całodniowe – nie blokują planowania pracy, synchronizacja je pomija (D05).
      if (index % 9 === 0) events.push({ id: `demo-urodziny-${date}`, status: 'confirmed', summary: 'Urodziny znajomego', updated, start: { date }, end: { date: addDays(date, 1) } });
    }
  }
  if (calendarId === 'primary') {
    timed('demo-dentysta', 'Dentysta', anchor, changed ? '16:00' : '15:00', changed ? '16:45' : '15:45', { location: changed ? 'ul. Górczewska 212' : 'ul. Górczewska 200' });
    if (changed) timed('demo-promotor', 'Konsultacje z promotorem', addDays(anchor, 1), '12:00', '13:00', { location: 'WAT, bud. 65' });
    // Odrzucone zaproszenie – użytkownik nie bierze udziału, więc nie trafia do planu (D05).
    timed('demo-webinar', 'Webinar (odrzucone zaproszenie)', addDays(anchor, 2), '17:00', '18:00', { attendees: [{ self: true, responseStatus: 'declined' }] });
  } else if (calendarId === 'kolo-naukowe') {
    timed('demo-ctf', 'Warsztaty CTF', addDays(anchor, 2), '16:00', '20:00', { location: 'WAT, bud. 100' });
  } else if (calendarId === 'grafik-pracy') {
    // Wydarzenie opublikowane przez KAC (przyszła prawdziwa publikacja oznacza je tak samo) – nie wraca jako nowy wpis.
    timed('demo-kac-zmiana', 'Zmiana pracy', anchor, '08:00', '12:00', { extendedProperties: { private: { kacEventId: 'demo-publikacja' } } });
  }
  const from = window.from.getTime(); const to = window.to.getTime();
  return events
    .filter((event) => {
      const start = Date.parse(event.start?.dateTime ?? `${event.start?.date}T00:00:00Z`);
      const end = Date.parse(event.end?.dateTime ?? `${event.end?.date}T00:00:00Z`);
      return end > from && start < to;
    })
    .sort((a, b) => (a.start?.dateTime ?? a.start?.date ?? '').localeCompare(b.start?.dateTime ?? b.start?.date ?? ''));
}

/** Zmiany między dwoma stanami makiety, tak jak zwraca je odczyt przyrostowy Google: nowe i zmienione wydarzenia oraz usunięte jako „cancelled”. */
export function demoEventDelta(before: GoogleEventItem[], after: GoogleEventItem[]): GoogleEventItem[] {
  const strip = ({ updated: _updated, ...rest }: GoogleEventItem) => JSON.stringify(rest);
  const previous = new Map(before.map((event) => [event.id, strip(event)]));
  const current = new Set(after.map((event) => event.id));
  return [
    ...after.filter((event) => previous.get(event.id) !== strip(event)),
    ...before.filter((event) => !current.has(event.id)).map((event) => ({ id: event.id, status: 'cancelled', updated: event.updated,
      ...(event.recurringEventId ? { recurringEventId: event.recurringEventId } : {}) })),
  ];
}
