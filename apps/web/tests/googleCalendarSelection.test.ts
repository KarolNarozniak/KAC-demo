// Wybór kalendarzy Google (S23KC2S1P2-41, G04): szkic wyboru, kandydaci na kalendarz publikacji, podsumowanie zmian i teksty.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  apiErrorMessage, draftFrom, draftProblem, NO_SOURCES_TEXT, selectionChanges, selectionSummary, syncActions, targetOptions, targetProblemText, toggleSource,
  type CalendarSelection, type SelectionCalendar,
} from '../src/domain/googleIntegration.ts';

const calendar = (id: string, overrides: Partial<SelectionCalendar> = {}): SelectionCalendar => ({
  id, name: id, primary: false, accessRole: 'writer', timeZone: null, available: true, writable: true, source: false, publicationTarget: false, ...overrides,
});
const selection = (overrides: Partial<CalendarSelection> = {}): CalendarSelection => ({
  version: 2, canPublish: true, targetProblem: null, publicationTargetCalendarId: 'Praca', sourceCalendarIds: ['Student'],
  calendars: [
    calendar('Student', { primary: true, accessRole: 'owner', source: true }),
    calendar('Praca', { publicationTarget: true }),
    calendar('Koło', { accessRole: 'reader', writable: false }),
    calendar('Stary', { accessRole: null, available: false, writable: false }),
  ],
  ...overrides,
});

test('zaznaczanie źródeł: dodanie, odznaczenie i brak możliwości dodania niedostępnego kalendarza', () => {
  const current = selection();
  let draft = draftFrom(current);
  draft = toggleSource(current, draft, 'Koło');
  assert.deepEqual(draft.sources, ['Student', 'Koło']);
  draft = toggleSource(current, draft, 'Student');
  assert.deepEqual(draft.sources, ['Koło']);
  assert.deepEqual(toggleSource(current, draft, 'Stary').sources, ['Koło']);
  // Niedostępny, ale już wybrany – można go odznaczyć.
  const withStale = selection({ sourceCalendarIds: ['Stary'] });
  assert.deepEqual(toggleSource(withStale, draftFrom(withStale), 'Stary').sources, []);
});

test('kalendarz publikacji: tylko dostępne z prawem zapisu; brak zgody na zapis blokuje cel', () => {
  assert.deepEqual(targetOptions(selection()).map((item) => item.id), ['Student', 'Praca']);
  assert.equal(draftProblem(selection(), { sources: ['Student'], target: 'Praca' }), null);
  assert.equal(draftProblem(selection(), { sources: ['Student'], target: null }), null);
  assert.match(draftProblem(selection(), { sources: ['Student'], target: 'Koło' }) ?? '', /nie pozwala/);
  assert.match(draftProblem(selection({ canPublish: false }), { sources: ['Student'], target: 'Praca' }) ?? '', /Zgoda Google/);
});

test('podsumowanie zmian przed zatwierdzeniem: dodane, wyłączone (bez usuwania z KAC), nowy cel i brak zmian', () => {
  const current = selection();
  assert.deepEqual(selectionChanges(current, draftFrom(current)), []);
  const lines = selectionChanges(current, { sources: ['Koło'], target: 'Student' });
  assert.deepEqual(lines, [
    'Dodane do planowania i synchronizacji: Koło.',
    'Wyłączone z przyszłych synchronizacji: Student. Wydarzenia już zapisane w KAC zostają.',
    'Kalendarz publikacji: Student.',
  ]);
  assert.match(selectionChanges(current, { sources: ['Student'], target: null })[0], /Bez kalendarza publikacji/);
  assert.equal(selectionChanges(current, { sources: [], target: 'Praca' }).at(-1), NO_SOURCES_TEXT);
});

test('opis zapisanego wyboru i problemy po utracie uprawnień', () => {
  assert.equal(selectionSummary(selection()), '1 kalendarz do planowania · publikacja: Praca');
  assert.equal(selectionSummary(selection({ sourceCalendarIds: [], publicationTargetCalendarId: null })), 'Brak kalendarzy do planowania · bez kalendarza publikacji');
  assert.match(targetProblemText('unavailable') ?? '', /straciło dostęp/);
  assert.match(targetProblemText('not_writable') ?? '', /prawem zapisu/);
  assert.match(targetProblemText('write_access_missing') ?? '', /Połącz konto ponownie/);
  assert.equal(targetProblemText(null), null);
});

test('komunikaty błędów zapisu i synchronizacja bez wybranych kalendarzy', () => {
  for (const code of ['selection_conflict', 'unknown_calendar', 'calendar_unavailable', 'target_not_writable', 'write_access_missing'])
    assert.match(apiErrorMessage(code), /Nic nie zapisano/);
  assert.equal(apiErrorMessage('no_calendars_selected'), NO_SOURCES_TEXT);
  const base = { connection: 'connected' as const, enabled: true, state: 'never' as const, lastAttempt: null };
  assert.deepEqual(syncActions({ ...base, sourcesSelected: 0 }), { sync: false, retry: false, reconnect: false });
  assert.equal(syncActions({ ...base, sourcesSelected: 2 }).sync, true);
});
