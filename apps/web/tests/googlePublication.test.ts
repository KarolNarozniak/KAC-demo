// Symulowana publikacja grafiku (S23KC2S1P2-30, G07): warunki wejścia, podgląd, wynik oznaczony jako symulacja i ponowienie.
import assert from 'node:assert/strict';
import test from 'node:test';
import type { SyncAttempt } from '../src/domain/googleIntegration.ts';
import {
  actionLabel, calendarViewLines, calendarViewTitle, canRetry, itemResultLabel, itemTimeLabel, pendingCount, previewSummary, publicationAccount, publicationEntry,
  publicationErrorMessage, publicationNotice,
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
  assert.match(ok.text, /^Symulacja: opublikowano 2 zmiany .*Nic nie trafiło do Google\./);
  assert.match(publicationNotice(result('success', ['published', 'published', 'published', 'published', 'published'])).text, /opublikowano 5 zmian /);
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

test('historyjka 30, kroki 3–4a: konto Google i zgoda na dodawanie wydarzeń', () => {
  const status = (extra: Record<string, unknown> = {}, access = { calendarsRead: true, eventsWrite: true }) => ({
    mode: 'demo' as const, ready: true, problem: null, status: 'connected' as const, requestedAccess: access, demoAccounts: [],
    account: { email: 'student@example.com', connectedAt: null, grantedScopes: [], access }, ...extra });
  assert.deepEqual(publicationAccount(status()), { state: 'ok', text: 'Konto Google: student@example.com · dodawanie wydarzeń: zgoda udzielona' });
  assert.equal(publicationAccount(status({}, { calendarsRead: true, eventsWrite: false })).state, 'no_write');
  assert.match(publicationAccount(status({}, { calendarsRead: true, eventsWrite: false })).text, /bez tej zgody publikacja nie jest możliwa/);
  assert.equal(publicationAccount(status({ status: 'not_connected', account: null })).state, 'not_connected');
  assert.equal(publicationAccount(null).state, 'not_connected');
  assert.equal(publicationAccount(status({ status: 'reconnect_required' })).state, 'not_connected');
});

test('historyjka 30, krok 10: zmiany robocze razem z pozostałymi wydarzeniami w widoku kalendarza Google', () => {
  const view = { simulated: true, calendar: { id: 'praca', name: 'Grafik pracy' }, weekStart: '2035-03-05', othersError: null, events: [
    { id: 'zespol', title: 'Spotkanie zespołu', start: new Date(2035, 2, 5, 9).toISOString(), end: new Date(2035, 2, 5, 9, 30).toISOString(), published: false },
    { id: 'kac-1', title: 'Zmiana pracy', start: new Date(2035, 2, 5, 14).toISOString(), end: new Date(2035, 2, 5, 19).toISOString(), published: true },
  ] };
  assert.equal(calendarViewTitle(view), 'Kalendarz Google „Grafik pracy” – tydzień od 05.03: opublikowane zmiany: 1, pozostałe wydarzenia: 1.');
  assert.deepEqual(calendarViewLines(view), [
    { key: 'zespol', when: 'pn 05.03, 09:00–09:30', title: 'Spotkanie zespołu', published: false },
    { key: 'kac-1', when: 'pn 05.03, 14:00–19:00', title: 'Zmiana pracy', published: true },
  ]);
});

test('prawdziwa publikacja (konto Google): bez oznaczeń symulacji, komunikat mówi, że zmiany są w Google Calendar', () => {
  const real = { ...result('success', ['published', 'published']), simulated: false };
  const notice = publicationNotice(real);
  assert.equal(notice.text, 'Opublikowano 2 zmiany w kalendarzu „Grafik pracy”. Zmiany są widoczne w Google Calendar.');
  assert.doesNotMatch(notice.text, /Symulacja|Nic nie trafiło/);
  assert.equal(itemResultLabel('published', false), 'opublikowano');
  assert.equal(itemResultLabel('published'), 'opublikowano (symulacja)');
});
