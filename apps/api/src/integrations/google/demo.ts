// Konta demonstracyjne trwałej integracji Google (S23KC2S1P2-12, G01/G02).
// Działają, gdy serwer nie ma klienta Google OAuth – tak jak jednorazowy import (S23KC2S1P2-27). Nie ma tu żadnych tokenów.
// Dwa konta pozwalają pokazać wybór konta (5b) i „Zmień konto”.
import type { IntegrationCalendar } from './oauth-client.js';

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
