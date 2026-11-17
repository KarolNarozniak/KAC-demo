// Korekta opublikowanej zmiany (S23KC2S1P2-47, G09): komunikaty po zapisie i usunięciu, ponowienie i opis rozbieżności.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canRetryCorrection, correctionNotice, correctionStateLabel, snapshotLabel, type CorrectionItem, type CorrectionSyncResult,
} from '../src/domain/googleCorrection.ts';

const item = (state: CorrectionItem['state'], extra: Partial<CorrectionItem> = {}): CorrectionItem => ({
  eventId: 'e1', calendar: { id: 'praca', name: 'Grafik pracy' }, state, simulated: true, errorCode: null, errorClass: null, message: null,
  tries: 1, lastTryAt: null, publishedAt: null, snapshot: { title: 'Zmiana pracy', start: new Date(2035, 2, 5, 9).toISOString(), end: new Date(2035, 2, 5, 14).toISOString() }, ...extra,
});
const result = (value: CorrectionSyncResult['result'], items: CorrectionItem[]): CorrectionSyncResult => ({ eventId: 'e1', result: value, errorCode: items[0]?.errorCode ?? null, items });

test('po udanej synchronizacji potwierdzenie oznaczone jako symulacja (krok 6 i 3a)', () => {
  assert.deepEqual(correctionNotice(result('success', [item('synced')]), 'update'),
    { tone: 'success', text: 'Symulacja: zaktualizowano powiązane wydarzenie w kalendarzu „Grafik pracy” w Google.' });
  assert.deepEqual(correctionNotice(result('success', [item('deleted')]), 'delete'),
    { tone: 'success', text: 'Symulacja: zmianę usunięto także z kalendarza „Grafik pracy” w Google.' });
  assert.equal(correctionNotice(result('nothing', [item('synced')]), 'update'), null);
  assert.equal(correctionNotice(result('success', []), 'update'), null);
});

test('błąd synchronizacji: zmiana lokalna zachowana, usunięcie może być nadal widoczne w Google (6b, 3a.1)', () => {
  const failed = correctionNotice(result('error', [item('error', { errorCode: 'network_error', message: 'Brak połączenia z Google.' })]), 'update')!;
  assert.equal(failed.tone, 'error');
  assert.match(failed.text, /zapisana w KAC.*Przyczyna: Brak połączenia z Google\./);
  const deleteFailed = correctionNotice(result('error', [item('pending_delete', { errorCode: 'google_unavailable' })]), 'delete')!;
  assert.match(deleteFailed.text, /może nadal być widoczne w Google Calendar/);
});

test('brak wydarzenia w Google: informacja bez tworzenia nowego i bez ponowienia (6c)', () => {
  const missing = item('missing', { errorCode: 'event_not_found', message: 'Powiązane wydarzenie nie istnieje już w Google Calendar.' });
  assert.deepEqual(correctionNotice(result('error', [missing]), 'update'), { tone: 'info', text: 'Powiązane wydarzenie nie istnieje już w Google Calendar.' });
  assert.equal(canRetryCorrection(missing), false);
  assert.equal(canRetryCorrection(item('error')), true);
  assert.equal(canRetryCorrection(item('pending_delete')), true);
  assert.equal(canRetryCorrection(item('synced')), false);
});

test('opis rozbieżności, także po usunięciu w KAC (migawka)', () => {
  assert.equal(snapshotLabel(item('pending_delete')), 'Zmiana pracy · 05.03, 09:00–14:00');
  assert.equal(snapshotLabel(item('pending', { snapshot: null })), 'Zmiana pracy');
  assert.equal(correctionStateLabel('pending_delete'), 'usunięte w KAC, czeka na usunięcie w Google');
});
