// Symulowana publikacja grafiku (S23KC2S1P2-30, G07): warunki wejścia, podgląd, wynik oznaczony jako symulacja i ponowienie.
import assert from 'node:assert/strict';
import test from 'node:test';
import type { SyncAttempt } from '../src/domain/googleIntegration.ts';
import {
  actionLabel, canRetry, itemResultLabel, itemTimeLabel, pendingCount, previewSummary, publicationEntry, publicationErrorMessage, publicationNotice,
  type PublicationItem, type PublicationPreview, type PublicationResult,
} from '../src/domain/googlePublication.ts';

const item = (shiftId: string, action: PublicationItem['action']): PublicationItem => ({
  shiftId, eventId: `e-${shiftId}`, eventVersion: 1, title: 'Zmiana pracy', start: new Date(2035, 2, 5, 9).toISOString(), end: new Date(2035, 2, 5, 14).toISOString(),
  action, publishedAt: action === 'create' ? null : '2035-03-01T10:00:00.000Z',
});
const preview = (items: PublicationItem[]): PublicationPreview => ({
  simulated: true, weekStart: '2035-03-05', scheduleId: 'g1', scheduleVersion: 2, target: { id: 'praca', name: 'Grafik pracy' },
  targets: [{ id: 'praca', name: 'Grafik pracy', primary: false }], items,
  summary: { create: items.filter((i) => i.action === 'create').length, update: items.filter((i) => i.action === 'update').length, unchanged: items.filter((i) => i.action === 'unchanged').length },
});
const attempt = (status: SyncAttempt['status'], extra: Partial<SyncAttempt> = {}): SyncAttempt => ({
  id: 'a1', direction: 'publish', scope: 'schedule:2035-03-05', operation: 'Publikacja grafiku (symulacja)', status, startedAt: '2035-03-01T10:00:00.000Z',
  finishedAt: '2035-03-01T10:00:01.000Z', tries: 1, changes: 0, errorCode: null, message: null, errorClass: null, retryable: false, ...extra,
});
const result = (status: SyncAttempt['status'], results: PublicationResult['items'][number]['result'][], extra: Partial<SyncAttempt> = {}): PublicationResult => {
  const items = results.map((value, index) => ({ ...item(`z${index}`, 'create'), result: value }));
  return { simulated: true, attempt: attempt(status, extra), items, preview: preview(items) };
};

test('wejście: brak akceptacji i pusty grafik blokują publikację; podgląd historii jej nie pokazuje', () => {
  assert.deepEqual(publicationEntry({ isApproved: true, shifts: [1] }, false), { enabled: true, reason: null });
  assert.match(publicationEntry({ isApproved: false, shifts: [1] }, false).reason ?? '', /zaakceptowany/);
  assert.match(publicationEntry({ isApproved: true, shifts: [] }, false).reason ?? '', /żadnej zmiany/);
  assert.deepEqual(publicationEntry({ isApproved: true, shifts: [1] }, true), { enabled: false, reason: null });
  assert.deepEqual(publicationEntry(null, false), { enabled: false, reason: null });
});

test('podgląd: konkretne zmiany, opis akcji i nic do publikacji', () => {
  const mixed = preview([item('a', 'create'), item('b', 'update'), item('c', 'unchanged')]);
  assert.equal(pendingCount(mixed), 2);
  assert.equal(previewSummary(mixed), 'Kalendarz „Grafik pracy” – do dodania: 1, do aktualizacji: 1, bez zmian: 1.');
  assert.equal(actionLabel('unchanged'), 'bez zmian – pominięta');
  assert.equal(itemTimeLabel(item('a', 'create')), 'pn 05.03, 09:00–14:00');
  const done = preview([item('a', 'unchanged')]);
  assert.equal(pendingCount(done), 0);
  assert.match(previewSummary(done), /już opublikowane/);
});

test('wynik: sukces oznaczony jako symulacja, błąd i wynik częściowy nigdy jako sukces', () => {
  const ok = publicationNotice(result('success', ['published', 'published']));
  assert.equal(ok.tone, 'success');
  assert.match(ok.text, /^Symulacja: opublikowano 2 zmian .*Nic nie trafiło do Google\./);
  assert.match(publicationNotice(result('success', ['unchanged'])).text, /nic nie zmieniono/);
  const error = publicationNotice(result('error', ['failed', 'skipped'], { message: 'Symulacja nieudana: brak sieci.', retryable: true, errorClass: 'network' }));
  assert.equal(error.tone, 'error');
  assert.doesNotMatch(error.text, /opublikowano \d/);
  const partial = publicationNotice(result('partial', ['published', 'failed'], { message: 'Symulacja częściowa: opublikowano 1 z 2 zmian.', retryable: true }));
  assert.equal(partial.tone, 'info');
  assert.match(partial.text, /tylko brakujące zmiany – bez duplikatów/);
  assert.equal(itemResultLabel('published'), 'opublikowano (symulacja)');
});

test('ponowienie: po błędzie przejściowym i wyniku częściowym tak, po sukcesie i przy wygasłym logowaniu nie', () => {
  assert.equal(canRetry(result('error', ['failed'], { retryable: true, errorClass: 'network' })), true);
  assert.equal(canRetry(result('partial', ['published', 'failed'], { retryable: true, errorClass: 'server' })), true);
  assert.equal(canRetry(result('success', ['published'])), false);
  assert.equal(canRetry(result('error', ['failed'], { retryable: false, errorClass: 'reconnect' })), false);
  assert.equal(canRetry(null), false);
});

test('komunikaty błędów wejścia', () => {
  assert.match(publicationErrorMessage('not_connected'), /Ustawieniach/);
  assert.match(publicationErrorMessage('schedule_version_conflict'), /Nic nie opublikowano/);
  assert.match(publicationErrorMessage('target_not_writable'), /prawem zapisu/);
});
