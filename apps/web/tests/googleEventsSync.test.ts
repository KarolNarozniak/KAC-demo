// Pobieranie zmian z Google (S23KC2S1P2-23, G05): wynik per kalendarz po synchronizacji i szczegóły pobranego wydarzenia (D05).
import assert from 'node:assert/strict';
import test from 'node:test';
import { calendarResultLine, importedEventLines, SIMULATIONS, syncResultNotice, type CalendarSyncResult, type ImportedEvent, type SyncAttempt } from '../src/domain/googleIntegration.ts';

const result = (extra: Partial<CalendarSyncResult> = {}): CalendarSyncResult => ({ calendarId: 'primary', name: 'Student', mode: 'incremental', reason: null,
  created: 0, updated: 0, deleted: 0, unchanged: 0, conflicts: 0, skippedAllDay: 0, skippedDeclined: 0, skippedOwn: 0, errorCode: null, ...extra });
const imported = (extra: Partial<ImportedEvent> = {}): ImportedEvent => ({ eventId: 'e1', calendar: { id: 'primary', name: 'Student' }, account: 'student@example.com',
  state: 'synced', googleVersion: { title: 'Dentysta', start: new Date(2035, 2, 7, 16, 0).toISOString(), end: new Date(2035, 2, 7, 16, 45).toISOString(), location: 'ul. Górczewska 212' },
  lastSyncAt: new Date(2035, 2, 1, 12, 5).toISOString(), connected: true, ...extra });

test('wynik per kalendarz: zmiany, pominięte, powód pełnego odczytu, konflikt i błąd bez zmian', () => {
  assert.deepEqual(calendarResultLine(result({ created: 3, updated: 1, skippedAllDay: 2, mode: 'full', reason: 'first' })),
    { tone: 'success', text: 'Student: nowe 3, zmienione 1 (całodniowe pominięte: 2; pierwszy pełny odczyt).' });
  assert.deepEqual(calendarResultLine(result()), { tone: 'success', text: 'Student: bez zmian.' });
  assert.deepEqual(calendarResultLine(result({ conflicts: 1, skippedOwn: 1 })),
    { tone: 'info', text: 'Student: bez zmian (edytowane w KAC – nienadpisane: 1; opublikowane przez KAC: 1).' });
  assert.match(calendarResultLine(result({ mode: 'full', reason: 'token_expired', deleted: 2 })).text, /usunięte 2 \(pełny odczyt – Google unieważnił znacznik zmian\)/);
  const failed = calendarResultLine(result({ errorCode: 'google_unavailable', created: 5 }));
  assert.equal(failed.tone, 'error');
  assert.match(failed.text, /^Student: nie udało się pobrać – nic nie zmieniono/);
});

test('szczegóły pobranego wydarzenia: zgodne, edytowane w KAC z wersją z Google, usunięte w Google, konto odłączone', () => {
  const synced = importedEventLines(imported());
  assert.equal(synced.origin, 'Z Google Calendar: „Student” (student@example.com)');
  assert.equal(synced.state, 'Zgodne z Google (ostatnia synchronizacja: 01.03, 12:05).');
  assert.deepEqual([synced.google, synced.canRestore], [null, false]);
  const conflict = importedEventLines(imported({ state: 'conflict' }));
  assert.match(conflict.state, /nie nadpisują/);
  assert.equal(conflict.google, 'W Google: Dentysta, 07.03, 16:00–16:45, ul. Górczewska 212');
  assert.equal(conflict.canRestore, true);
  const detached = importedEventLines(imported({ state: 'detached', googleVersion: null }));
  assert.deepEqual([detached.canRestore, detached.google], [false, null]);
  assert.match(importedEventLines(imported({ connected: false })).origin, /konto odłączone/);
});

test('makieta: symulacje zmian wydarzeń i komunikat częściowy bez obietnicy „nic nie zmieniono”', () => {
  assert.deepEqual(SIMULATIONS.slice(-3).map((option) => option.id), ['remote_changes', 'page_error', 'token_expired']);
  const partial: SyncAttempt = { id: 'a', direction: 'read', scope: 'events', operation: 'Pobieranie zmian z Google', status: 'partial', startedAt: '2035-03-01T12:00:00.000Z',
    finishedAt: null, tries: 3, changes: 3, errorCode: 'google_unavailable', message: 'Kalendarze: 1. Pobrano zmiany z Google: nowe 3. Nie udało się pobrać: „Koło”.',
    errorClass: 'server', retryable: true };
  assert.match(syncResultNotice(partial).text, /Kalendarze z błędem zostały bez zmian – „Spróbuj ponownie” dokończy pobieranie\./);
});
