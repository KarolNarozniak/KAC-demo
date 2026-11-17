// Synchronizacja z Google w panelu (S23KC2S1P2-17, G06): stany, przyczyny błędów, przyciski i komunikaty.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  apiErrorMessage, attemptNotice, lastSuccessLabel, syncActions, syncErrorLabel, syncResultNotice, syncStateLabel, type SyncAttempt, type SyncStatus,
} from '../src/domain/googleIntegration.ts';

const attempt = (overrides: Partial<SyncAttempt> = {}): SyncAttempt => ({
  id: 's1', direction: 'read', scope: 'calendar_list', operation: 'Lista kalendarzy', status: 'success', startedAt: '2026-11-17T08:30:00.000Z',
  finishedAt: '2026-11-17T08:30:01.000Z', tries: 1, changes: 4, errorCode: null, message: 'Odczytane kalendarze: 4.', errorClass: null, retryable: false, ...overrides,
});
const status = (overrides: Partial<SyncStatus> = {}): SyncStatus => ({
  connection: 'connected', enabled: true, sourcesSelected: 1, state: 'never', lastAttempt: null, lastSuccess: { read: null, publish: null }, history: [], ...overrides,
});
const networkError = attempt({ status: 'error', tries: 3, errorCode: 'network_error', errorClass: 'network', retryable: true, message: null });
const authError = attempt({ status: 'error', errorCode: 'reconnect_required', errorClass: 'reconnect', retryable: false, message: null });

test('stany synchronizacji: nigdy, w trakcie, sukces, częściowo, błąd', () => {
  assert.deepEqual((['never', 'running', 'success', 'partial', 'error'] as const).map(syncStateLabel),
    ['Nigdy nie synchronizowano', 'W trakcie', 'Zsynchronizowano', 'Częściowo', 'Błąd']);
  assert.equal(lastSuccessLabel(status()), 'Ostatnia udana synchronizacja: jeszcze nie było');
  assert.match(lastSuccessLabel(status({ lastSuccess: { read: new Date(2026, 10, 17, 9, 5).toISOString(), publish: null } })), /17\.11\.2026, 09:05$/);
});

test('przyczyny błędu: brak internetu, wygasłe logowanie, brak uprawnień, limit, serwer i wyłączone Calendar API', () => {
  assert.match(syncErrorLabel(networkError), /Brak połączenia/);
  assert.match(syncErrorLabel(authError), /Wygasłe logowanie/);
  assert.match(syncErrorLabel({ errorClass: 'permissions', errorCode: 'insufficient_permissions' }), /Brak uprawnień/);
  assert.match(syncErrorLabel({ errorClass: 'rate_limit', errorCode: 'rate_limited' }), /Limit/);
  assert.match(syncErrorLabel({ errorClass: 'server', errorCode: 'google_unavailable' }), /po stronie Google/);
  assert.match(syncErrorLabel({ errorClass: 'server', errorCode: 'api_not_enabled' }), /Calendar API/);
  assert.match(apiErrorMessage('sync_disabled'), /nie udzielono zgody/);
});

test('przyciski po próbie: „Spróbuj ponownie” przy błędzie przejściowym, „Połącz ponownie” przy wygasłym logowaniu albo wyłączonej synchronizacji', () => {
  assert.deepEqual(syncActions(status()), { sync: true, retry: false, reconnect: false });
  assert.deepEqual(syncActions(status({ state: 'error', lastAttempt: networkError })), { sync: false, retry: true, reconnect: false });
  // Wygasłe logowanie: zwykłe ponowienie nic nie da.
  assert.deepEqual(syncActions(status({ state: 'error', lastAttempt: authError, connection: 'reconnect_required' })), { sync: false, retry: false, reconnect: true });
  // 5a: odmowa przy ponownym logowaniu – synchronizacja wyłączona, zostaje tylko „Połącz ponownie”.
  assert.deepEqual(syncActions(status({ enabled: false, state: 'error', lastAttempt: networkError })), { sync: false, retry: false, reconnect: true });
  assert.deepEqual(syncActions(status({ state: 'running' })), { sync: false, retry: false, reconnect: false });
});

test('komunikat po próbie: sukces (2a), wynik częściowy i błąd z liczbą prób; dane lokalne bez zmian', () => {
  assert.deepEqual(syncResultNotice(attempt()), { tone: 'success', text: 'Synchronizacja zakończona. Odczytane kalendarze: 4.' });
  assert.match(syncResultNotice(attempt({ status: 'partial', errorCode: 'incomplete_list', retryable: true })).text, /częściowa.*bez zmian/);
  const failed = syncResultNotice(networkError);
  assert.equal(failed.tone, 'error');
  assert.match(failed.text, /\(próby: 3\): Brak połączenia.*Lokalne wydarzenia pozostały bez zmian/);
});

test('5a: odmowa przy ponownym logowaniu mówi o wyłączonej synchronizacji', () => {
  assert.match(attemptNotice({ status: 'denied', errorCode: 'access_denied', purpose: 'reconnect' })!.text, /synchronizacja z Google jest wyłączona/);
  assert.match(attemptNotice({ status: 'denied', errorCode: 'access_denied', purpose: 'connect' })!.text, /Nie udzielono zgody – konto Google nie zostało połączone/);
});
