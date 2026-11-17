// Korekta opublikowanej zmiany (S23KC2S1P2-47, G09): komunikaty po zapisie i usunięciu, ponowienie i opis rozbieżności.
// Stany, rodzaje operacji i przyczyny błędów muszą mieć dopuszczalne wartości z historyjki 47.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canRetryCorrection, correctionNotice, errorCause, nextStep, operationKind, operationLine, operationStatus, snapshotLabel,
  type CorrectionItem, type CorrectionSyncResult,
} from '../src/domain/googleCorrection.ts';

const item = (state: CorrectionItem['state'], extra: Partial<CorrectionItem> = {}): CorrectionItem => ({
  eventId: 'e1', calendar: { id: 'praca', name: 'Grafik pracy' }, state, simulated: true, errorCode: null, errorClass: null, message: null,
  tries: 1, lastTryAt: null, publishedAt: null, snapshot: { title: 'Zmiana pracy', start: new Date(2035, 2, 5, 9).toISOString(), end: new Date(2035, 2, 5, 14).toISOString() },
  lastOperation: 'Aktualizacja', ...extra,
});
const result = (value: CorrectionSyncResult['result'], items: CorrectionItem[]): CorrectionSyncResult => ({ eventId: 'e1', result: value, errorCode: items[0]?.errorCode ?? null, items });

test('wartości z historyjki 47: rodzaj operacji, stan synchronizacji i przyczyna błędu', () => {
  assert.deepEqual([operationKind(item('synced', { lastOperation: 'Utworzenie' })), operationKind(item('synced')), operationKind(item('pending')), operationKind(item('pending_delete')), operationKind(item('deleted'))],
    [null, 'Aktualizacja', 'Aktualizacja', 'Usunięcie', 'Usunięcie']);
  assert.deepEqual([operationStatus(item('pending')), operationStatus(item('pending'), true), operationStatus(item('synced')), operationStatus(item('deleted')),
    operationStatus(item('error', { errorCode: 'network_error' })), operationStatus(item('missing')), operationStatus(item('pending_delete', { errorCode: 'google_unavailable' }))],
  ['Oczekuje', 'W trakcie', 'Zakończona', 'Zakończona', 'Błąd', 'Błąd', 'Błąd']);
  const cause = (errorCode: string, errorClass: CorrectionItem['errorClass']) => errorCause(item('error', { errorCode, errorClass }));
  assert.deepEqual([cause('network_error', 'network'), cause('reconnect_required', 'reconnect'), cause('calendar_not_writable', 'permissions'),
    cause('google_unavailable', 'server'), cause('rate_limited', 'rate_limit'), cause('google_error', 'other'), errorCause(item('missing', { errorCode: 'event_not_found' }))],
  ['Brak połączenia', 'Wymagane ponowne logowanie', 'Brak uprawnień', 'Usługa niedostępna', 'Usługa niedostępna', 'Inny błąd', 'Brak powiązanego wydarzenia']);
  assert.equal(errorCause(item('synced')), null);
  assert.match(nextStep('Wymagane ponowne logowanie') ?? '', /Połącz ponownie konto Google/);
  assert.equal(nextStep('Brak powiązanego wydarzenia'), null);
  assert.equal(operationLine(item('pending_delete', { errorCode: 'network_error', errorClass: 'network' })), 'Usunięcie – stan synchronizacji: Błąd (Brak połączenia)');
  assert.equal(operationLine(item('synced', { lastOperation: 'Utworzenie' })), 'stan synchronizacji: Zakończona');
});

test('po udanej synchronizacji potwierdzenie, że oba kalendarze odzwierciedlają zmianę (krok 6 i 3a)', () => {
  assert.deepEqual(correctionNotice(result('success', [item('synced')]), 'update'),
    { tone: 'success', text: 'Aktualizacja – stan synchronizacji: Zakończona. Symulacja: zaktualizowano powiązane wydarzenie w kalendarzu „Grafik pracy” w Google.' });
  assert.deepEqual(correctionNotice(result('success', [item('deleted')]), 'delete'),
    { tone: 'success', text: 'Usunięcie – stan synchronizacji: Zakończona. Symulacja: zmianę usunięto z kalendarza aplikacji i z kalendarza „Grafik pracy” w Google.' });
  assert.equal(correctionNotice(result('nothing', [item('synced')]), 'update'), null);
  assert.equal(correctionNotice(result('success', []), 'update'), null);
});

test('błąd synchronizacji: w którym kalendarzu się udało, przyczyna i dalsze działanie (6b, 3a.1)', () => {
  const failed = correctionNotice(result('error', [item('error', { errorCode: 'network_error', errorClass: 'network' })]), 'update')!;
  assert.equal(failed.tone, 'error');
  assert.equal(failed.text, 'Aktualizacja – stan synchronizacji: Błąd (Brak połączenia). Zmiana jest zapisana w kalendarzu aplikacji, ale wydarzenie w Google Calendar może być nieaktualne. Sprawdź połączenie z internetem i ponów synchronizację.');
  const deleteFailed = correctionNotice(result('error', [item('pending_delete', { errorCode: 'google_unavailable', errorClass: 'server' })]), 'delete')!;
  assert.match(deleteFailed.text, /^Usunięcie – stan synchronizacji: Błąd \(Usługa niedostępna\)\. Zmianę usunięto z kalendarza aplikacji, ale wydarzenie może nadal być widoczne w Google Calendar\./);
});

test('brak wydarzenia w Google: informacja bez tworzenia nowego i bez ponowienia (6c)', () => {
  const missing = item('missing', { errorCode: 'event_not_found', errorClass: 'other' });
  const notice = correctionNotice(result('error', [missing]), 'update')!;
  assert.equal(notice.tone, 'info');
  assert.match(notice.text, /^Aktualizacja – stan synchronizacji: Błąd \(Brak powiązanego wydarzenia\)\..*nowe wydarzenie nie zostało utworzone\.$/);
  assert.equal(canRetryCorrection(missing), false);
  assert.equal(canRetryCorrection(item('error')), true);
  assert.equal(canRetryCorrection(item('pending_delete')), true);
  assert.equal(canRetryCorrection(item('synced')), false);
});

test('opis rozbieżności, także po usunięciu w KAC (migawka)', () => {
  assert.equal(snapshotLabel(item('pending_delete')), 'Zmiana pracy · 05.03, 09:00–14:00');
  assert.equal(snapshotLabel(item('pending', { snapshot: null })), 'Zmiana pracy');
});

test('korekta przy prawdziwym zapisie: komunikat bez „Symulacja”, zdanie od wielkiej litery', () => {
  const real = correctionNotice(result('success', [item('synced', { simulated: false, lastOperation: 'Aktualizacja' })]), 'update');
  assert.equal(real?.text, 'Aktualizacja – stan synchronizacji: Zakończona. Zaktualizowano powiązane wydarzenie w kalendarzu „Grafik pracy” w Google.');
  const removed = correctionNotice(result('success', [item('deleted', { simulated: false })]), 'delete');
  assert.match(removed?.text ?? '', /: Zakończona\. Zmianę usunięto z kalendarza aplikacji/);
});
