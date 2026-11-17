// Panel „Google Calendar” w Ustawieniach (S23KC2S1P2-12, G02): stan panelu, zakres dostępu, wyniki logowania i lista kalendarzy.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  apiErrorMessage, attemptNotice, attemptOverdue, calendarsSummary, changeAccountWarning, connectedAtLabel, grantedAccessLines, grantedAccessWarning,
  panelState, requestedAccessLines, sortCalendars, unavailableMessage, type GoogleIntegrationStatus, type IntegrationAttempt, type IntegrationCalendar,
} from '../src/domain/googleIntegration.ts';

const status = (overrides: Partial<GoogleIntegrationStatus> = {}): GoogleIntegrationStatus => ({
  mode: 'demo', ready: true, problem: null, status: 'not_connected', account: null, requestedAccess: { calendarsRead: true, eventsWrite: true },
  demoAccounts: ['student.kac.demo@gmail.com', 'praca.kac.demo@gmail.com'], ...overrides,
});
const attempt = (overrides: Partial<IntegrationAttempt> = {}): IntegrationAttempt => ({
  attemptId: 'a1', status: 'pending', errorCode: null, purpose: 'connect', mode: 'google', expiresAt: '2026-11-16T18:10:00.000Z', ...overrides,
});

test('stan panelu: wczytywanie, brak internetu (2a), problem serwera, trwające logowanie i stan z serwera', () => {
  assert.equal(panelState({ status: null, loadError: null, attempt: null }), 'loading');
  assert.equal(panelState({ status: null, loadError: 'network', attempt: null }), 'offline');
  assert.equal(panelState({ status: null, loadError: 'integration_not_configured', attempt: null }), 'unavailable');
  assert.equal(panelState({ status: status({ mode: 'google', ready: false, problem: 'token_key_missing' }), loadError: null, attempt: null }), 'unavailable');
  assert.equal(panelState({ status: status(), loadError: null, attempt: null }), 'not_connected');
  assert.equal(panelState({ status: status({ status: 'connected' }), loadError: null, attempt: attempt() }), 'connecting');
  assert.equal(panelState({ status: status({ status: 'connected' }), loadError: null, attempt: attempt({ status: 'processing' }) }), 'connecting');
  // Zakończona próba nie blokuje panelu – pokazujemy stan z serwera.
  assert.equal(panelState({ status: status({ status: 'connected' }), loadError: null, attempt: attempt({ status: 'denied' }) }), 'connected');
  assert.equal(panelState({ status: status({ status: 'reconnect_required' }), loadError: null, attempt: null }), 'reconnect_required');
});

test('krok 2: zakres dostępu przed logowaniem i realnie przyznany dostęp po nim', () => {
  assert.deepEqual(requestedAccessLines({ calendarsRead: true, eventsWrite: true }).length, 2);
  assert.match(requestedAccessLines({ calendarsRead: true, eventsWrite: true })[1]!, /publikacja zaakceptowanego grafiku/);
  assert.deepEqual(grantedAccessLines({ calendarsRead: true, eventsWrite: false }).map((line) => line.granted), [true, false]);
  assert.equal(grantedAccessWarning({ calendarsRead: true, eventsWrite: true }), null);
  assert.match(grantedAccessWarning({ calendarsRead: true, eventsWrite: false })!, /publikacja grafiku w Google nie będzie możliwa/);
  assert.match(grantedAccessWarning({ calendarsRead: false, eventsWrite: true })!, /lista kalendarzy nie jest dostępna/);
});

test('wynik logowania: zgoda, odmowa (5a), brak dostępu do kalendarza, anulowanie, wygaśnięcie i błąd (6a)', () => {
  assert.deepEqual(attemptNotice(attempt({ status: 'connected' })), { tone: 'success', text: 'Połączono z Google Calendar.' });
  assert.equal(attemptNotice(attempt({ status: 'connected', purpose: 'change_account' }))!.text, 'Zmieniono konto Google.');
  const denied = attemptNotice(attempt({ status: 'denied', errorCode: 'access_denied' }))!;
  assert.equal(denied.tone, 'info');
  assert.match(denied.text, /Nie udzielono zgody.*pozostały bez zmian/);
  assert.match(attemptNotice(attempt({ status: 'denied', errorCode: 'calendar_scope_missing' }))!.text, /zaznacz dostęp do kalendarza/);
  // Przy zmianie konta odmowa i anulowanie zostawiają dotychczasowe połączenie.
  assert.match(attemptNotice(attempt({ status: 'cancelled', purpose: 'change_account' }))!.text, /Dotychczasowe połączenie zostało bez zmian/);
  assert.match(attemptNotice(attempt({ status: 'expired' }))!.text, /Czas na zalogowanie/);
  assert.match(attemptNotice(attempt({ status: 'error', errorCode: 'authorization_code_invalid' }))!.text, /Kod logowania wygasł/);
  assert.match(attemptNotice(attempt({ status: 'error', errorCode: 'reconnect_account_mismatch', purpose: 'reconnect' }))!.text, /użyj „Zmień konto”/);
  assert.match(attemptNotice(attempt({ status: 'error', errorCode: 'no_refresh_token' }))!.text, /Aplikacje innych firm/);
  assert.match(attemptNotice(attempt({ status: 'error', errorCode: 'nieznany' }))!.text, /błąd autoryzacji/);
  assert.equal(attemptNotice(attempt({ status: 'pending' })), null);
});

test('odpytywanie kończy się po terminie próby z zapasem 15 s', () => {
  const expiresAt = Date.parse('2026-11-16T18:10:00.000Z');
  assert.equal(attemptOverdue(attempt(), expiresAt + 14_000), false);
  assert.equal(attemptOverdue(attempt(), expiresAt + 16_000), true);
});

test('krok 7: kalendarz główny pierwszy, potem z prawem zapisu; pusta lista (7a) nie rozłącza konta', () => {
  const list: IntegrationCalendar[] = [
    { id: 'u', name: 'Urodziny', primary: false, accessRole: 'reader', timeZone: null },
    { id: 'z', name: 'Zajętość', primary: false, accessRole: 'freeBusyReader', timeZone: null },
    { id: 'g', name: 'Grafik pracy', primary: false, accessRole: 'writer', timeZone: 'Europe/Warsaw' },
    { id: 'p', name: 'Student', primary: true, accessRole: 'owner', timeZone: 'Europe/Warsaw' },
    { id: 'k', name: 'Koło naukowe', primary: false, accessRole: 'reader', timeZone: null },
  ];
  assert.deepEqual(sortCalendars(list).map((calendar) => calendar.id), ['p', 'g', 'k', 'u', 'z']);
  assert.equal(list[0]!.id, 'u', 'sortowanie nie zmienia listy wejściowej');
  assert.equal(calendarsSummary(list, true), '5 kalendarzy (z prawem zapisu: 2).');
  assert.equal(calendarsSummary(list.slice(0, 2), true), '2 kalendarze – żaden nie pozwala na zapis wydarzeń.');
  assert.equal(calendarsSummary(list.slice(3, 4), true), '1 kalendarz (z prawem zapisu: 1).');
  assert.match(calendarsSummary(list, false), /^Pierwsze 5 kalendarzy.*więcej kalendarzy/);
  assert.match(calendarsSummary([], true), /nie ma żadnych kalendarzy\. Połączenie zostaje/);
});

test('komunikaty: brak internetu (2a), problemy serwera, zmiana konta i data połączenia', () => {
  assert.match(apiErrorMessage('network'), /Brak połączenia z internetem/);
  assert.match(apiErrorMessage('rate_limited'), /ogranicza liczbę zapytań/);
  assert.match(apiErrorMessage('http-500'), /\(http-500\)/);
  assert.match(unavailableMessage(status({ mode: 'google', ready: false, problem: 'token_key_missing' }), null), /GOOGLE_TOKEN_ENCRYPTION_KEY/);
  assert.match(unavailableMessage(null, 'integration_not_configured'), /bez bazy danych/);
  assert.match(changeAccountWarning('student@example.test'), /student@example\.test zostanie zastąpione dopiero po udanym zalogowaniu/);
  const local = new Date(2026, 10, 16, 9, 5);
  assert.equal(connectedAtLabel(local.toISOString()), 'połączono 16.11.2026, 09:05');
  assert.equal(connectedAtLabel(null), '');
  assert.equal(connectedAtLabel('zła data'), '');
});
