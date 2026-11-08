// Konto demonstracyjne Google (S23KC2S1P2-27, warunek wstępny: „przykładowe konto Google, kalendarze i wydarzenia”).
// Używane, gdy serwer nie ma skonfigurowanego klienta Google OAuth – cały przebieg importu działa tak samo,
// łącznie z zapisem w bazie, tylko dane pochodzą z przykładowego konta.

import { localDateTime } from '../../collisions.js';
import { DEFAULT_TIME_ZONE, toInstant } from '../rules.js';
import type { GoogleCalendarInfo, GoogleCalendarSource, GoogleEvent } from './types.js';

export const DEMO_GOOGLE_ACCOUNT = 'student.kac.demo@gmail.com';

const CALENDARS: GoogleCalendarInfo[] = [
  { id: 'primary', name: 'Student KAC (prywatny)', primary: true },
  { id: 'kolo-naukowe', name: 'Koło naukowe Cyberbezpieczeństwa', primary: false },
  { id: 'urodziny', name: 'Urodziny', primary: false }, // same wydarzenia całodniowe – pokazuje scenariusz 6a
];

const DAY_MS = 86_400_000;
const addDays = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
const weekday = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay();

function at(date: string, time: string, zone: string): string {
  const instant = toInstant(date, time, zone)!;
  return instant.toISOString();
}

export class DemoGoogleCalendar implements GoogleCalendarSource {
  readonly mode = 'demo' as const;

  constructor(private readonly zone = DEFAULT_TIME_ZONE) {}

  async listCalendars(): Promise<GoogleCalendarInfo[]> {
    return CALENDARS;
  }

  async listEvents(_token: string, calendarId: string, from: Date, to: Date): Promise<GoogleEvent[]> {
    const first = localDateTime(from, this.zone).slice(0, 10);
    const last = localDateTime(new Date(to.getTime() - 1), this.zone).slice(0, 10);
    const events: GoogleEvent[] = [];
    const add = (id: string, summary: string, date: string, start: string, end: string, location?: string) =>
      events.push({ id, summary, location, start: { dateTime: at(date, start, this.zone), timeZone: this.zone }, end: { dateTime: at(date, end, this.zone), timeZone: this.zone } });
    for (let date = first, i = 0; date <= last && events.length < 500; date = addDays(date, 1), i++) {
      const day = weekday(date);
      if (calendarId === 'primary') {
        if (day === 6) add(`gym-${date}`, 'Siłownia', date, '10:00', '11:30', 'CityFit Bemowo');
        if (day === 2) add(`eng-${date}`, 'Korepetycje z angielskiego', date, '19:00', '20:00');
        if (i === 2) add(`dent-${date}`, 'Dentysta', date, '15:00', '15:45', 'ul. Górczewska 200');
      } else if (calendarId === 'kolo-naukowe') {
        if (day === 3) add(`kolo-${date}`, 'Spotkanie koła naukowego', date, '18:00', '19:30', 'WAT, bud. 65, s. 120');
        if (i === 4) add(`ctf-${date}`, 'Warsztaty CTF', date, '16:00', '20:00', 'WAT, bud. 100');
      } else if (calendarId === 'urodziny') {
        if (i % 9 === 0) events.push({ id: `bday-${date}`, summary: 'Urodziny znajomego', start: { date }, end: { date: addDays(date, 1) } });
      } else {
        return [];
      }
    }
    return events.sort((a, b) => (a.start?.dateTime ?? a.start?.date ?? '').localeCompare(b.start?.dateTime ?? b.start?.date ?? ''));
  }
}
