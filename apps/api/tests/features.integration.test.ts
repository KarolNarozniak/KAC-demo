import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import { config } from '../src/config.js';
import { buildApi } from '../src/app.js';
import { pool, PostgresCalendarRepository, type EventInput } from '../src/database.js';
import { buildImportPreview } from '../src/import/preview.js';
import { parseWatTimetable } from '../src/import/classes/wat.js';

// Uses a dedicated calendar to avoid touching demo or user events.
test('atomic editing, collision decisions, concurrent writes, import rechecks and cancellation', { skip: !config.databaseUrl }, async () => {
  assert.ok(pool);
  const calendarId = `test-${Date.now()}`;
  await pool.query(`insert into t_kalendarze(id_kalendarza,id_uzytkownika,nazwa,typ) values ($1,$2,'Integration test','Osobisty')`, [calendarId, config.demoUserId]);
  const repository = new PostgresCalendarRepository(pool);
  const scoped = {
    checkConnection: () => repository.checkConnection(), getOverview: () => repository.getOverview(config.demoUserId, calendarId),
    createEvent: (event: EventInput) => repository.createEvent(event, config.demoUserId, calendarId),
    updateEvent: (id: string, event: EventInput) => repository.updateEvent(id, event, config.demoUserId, calendarId),
    deleteEvent: (id: string) => repository.deleteEvent(id, config.demoUserId, calendarId),
    createImportSession: repository.createImportSession.bind(repository),
    listEventsForImport: () => repository.listEventsForImport(calendarId),
    confirmImportSession: (id: string, rows: Parameters<typeof repository.confirmImportSession>[1]) => repository.confirmImportSession(id, rows, config.demoUserId, calendarId),
    cancelImportSession: repository.cancelImportSession.bind(repository),
  };
  const app = buildApi(scoped);
  const sessions: string[] = [];
  const event: EventInput = { title: 'Test class', start: '2026-11-02T10:00', end: '2026-11-02T12:00', category: 'Class', mandatory: false, repeatWeekly: false, location: 'A' };
  const post = (payload: EventInput) => app.inject({ method: 'POST', url: '/api/events', payload });
  try {
    const first = await post(event); assert.equal(first.statusCode, 201);
    const id = first.json().id;
    const conflict = await post({ ...event, title: 'Work', category: 'Work' });
    assert.equal(conflict.statusCode, 409);
    assert.equal((await scoped.getOverview())?.events.length, 1);
    const saved = await post({ ...event, title: 'Work', category: 'Work', collisionToken: conflict.json().collisionToken });
    assert.equal(saved.statusCode, 201);
    // PUT warns without changing either event; then updates the same ID atomically.
    const update = { ...event, end: '2026-11-02T13:00' };
    const warned = await app.inject({ method: 'PUT', url: `/api/events/${id}`, payload: update });
    assert.equal(warned.statusCode, 409);
    assert.equal((await scoped.getOverview())?.events.find(item => item.id === id)?.end, event.end);
    const edited = await app.inject({ method: 'PUT', url: `/api/events/${id}`, payload: { ...update, collisionToken: warned.json().collisionToken } });
    assert.equal(edited.statusCode, 200); assert.equal(edited.json().id, id);
    assert.equal((await scoped.getOverview())?.events.length, 2);
    await assert.rejects(repository.updateEvent(id, event, 'other-owner', calendarId));
    // Both requests start before either has committed; exactly one may save without a warning.
    const concurrent = await Promise.all([post({ ...event, start: '2026-11-04T08:00', end: '2026-11-04T09:00' }), post({ ...event, title: 'Concurrent', start: '2026-11-04T08:00', end: '2026-11-04T09:00' })]);
    assert.deepEqual(concurrent.map(response => response.statusCode).sort(), [201, 409]);
    // Weekly update preserves identity and excludes its own derived occurrences.
    const weekly = await post({ ...event, start: '2026-11-05T16:00', end: '2026-11-05T17:00', repeatWeekly: true });
    assert.equal(weekly.statusCode, 201);
    const weeklyId = weekly.json().id;
    const weeklyUpdate = await app.inject({ method: 'PUT', url: `/api/events/${weeklyId}`, payload: { ...event, start: '2026-11-05T16:00', end: '2026-11-05T18:00', repeatWeekly: true } });
    assert.equal(weeklyUpdate.statusCode, 200);
    const future = await post({ ...event, start: '2027-04-01T17:00', end: '2027-04-01T18:30' });
    assert.equal(future.statusCode, 409);
    // Confirmation rechecks duplicates created since the preview; end time is not part of identity.
    const row = { id: 'r1', title: ' test   CLASS ', category: 'Class' as const, date: '2026-11-02', startTime: '10:00', endTime: '14:00' };
    const session = await scoped.createImportSession({ source: 'classes', format: 'PDF', rows: [row], preview: buildImportPreview([row]) });
    sessions.push(session.id);
    const undecided = await app.inject({ method: 'POST', url: `/api/import/sessions/${session.id}/confirm`, payload: { rows: [row] } });
    assert.equal(undecided.statusCode, 422);
    const imported = await app.inject({ method: 'POST', url: `/api/import/sessions/${session.id}/confirm`, payload: { rows: [{ ...row, duplicateDecision: 'replace', replacementId: id }] } });
    assert.equal(imported.statusCode, 201); assert.equal(imported.json().summary.replaced, 1);
    assert.equal((await scoped.getOverview())?.events.find(item => item.id === id)?.end, '2026-11-02T14:00');
    const cancelled = await scoped.createImportSession({ source: 'classes', format: 'PDF', rows: [row], preview: buildImportPreview([row]) });
    sessions.push(cancelled.id);
    const before = (await scoped.getOverview())?.events.length;
    assert.equal(await scoped.cancelImportSession(cancelled.id), true);
    assert.equal((await app.inject({ method: 'POST', url: `/api/import/sessions/${cancelled.id}/confirm`, payload: { rows: [{ ...row, duplicateDecision: 'keepBoth' }] } })).statusCode, 409);
    assert.equal((await scoped.getOverview())?.events.length, before);
    // A later weekly occurrence is a duplicate. Replacing it edits the series duration,
    // retaining the original anchor rather than moving the series to the imported date.
    const recurringRow = { id: 'weekly-row', title: event.title, date: '2027-04-01', startTime: '16:00', endTime: '19:00', category: 'Class' as const };
    const recurringPreview = buildImportPreview([recurringRow], await scoped.listEventsForImport());
    assert.equal(recurringPreview[0]?.duplicateOfEvents[0]?.id, weeklyId);
    assert.equal(recurringPreview[0]?.duplicateOfEvents[0]?.repeatWeekly, true);
    const recurringSession = await scoped.createImportSession({ source: 'classes', format: 'PDF', rows: [recurringRow], preview: recurringPreview });
    sessions.push(recurringSession.id);
    const replacedSeries = await app.inject({ method: 'POST', url: `/api/import/sessions/${recurringSession.id}/confirm`, payload: { rows: [{ ...recurringRow, duplicateDecision: 'replace', replacementId: weeklyId }] } });
    assert.equal(replacedSeries.statusCode, 201);
    const seriesAfter = (await scoped.getOverview())?.events.find(item => item.id === weeklyId);
    assert.equal(seriesAfter?.start, '2026-11-05T16:00');
    assert.equal(seriesAfter?.end, '2026-11-05T19:00');
    assert.equal(seriesAfter?.repeatWeekly, true);
    // Force a repository-level failure after the first row insert: the transaction
    // must roll back both events and leave the session available for correction.
    const rollbackRows = [{ ...row, id: 'rollback-1', title: 'Rollback first' }, { ...row, id: 'rollback-2', title: 'Rollback second' }];
    const rollbackSession = await scoped.createImportSession({ source: 'classes', format: 'PDF', rows: rollbackRows, preview: buildImportPreview(rollbackRows) });
    sessions.push(rollbackSession.id);
    const countBeforeFailure = (await scoped.getOverview())?.events.length;
    await assert.rejects(scoped.confirmImportSession(rollbackSession.id, [
      { id: 'rollback-1', title: 'Rollback first', start: new Date('2026-12-01T10:00Z'), end: new Date('2026-12-01T11:00Z'), category: 'Class', location: null },
      { id: 'rollback-2', title: 'Rollback second', start: new Date('2026-12-01T10:00Z'), end: new Date('2026-12-01T11:00Z'), category: 'Invalid' as 'Class', location: null },
    ]));
    assert.equal((await scoped.getOverview())?.events.length, countBeforeFailure);
    assert.equal((await pool.query('select status from t_importy where id_importu = $1', [rollbackSession.id])).rows[0].status, 'Podgląd');
    // Complete semester import and repeat import: no duplicate calendar copies.
    const fixture = JSON.parse(readFileSync(new URL('./fixtures/wat-grid.json', import.meta.url), 'utf8'));
    const semester = parseWatTimetable(fixture);
    const fullRows = semester.rows.map(({ id, title, date, startTime, endTime, category, location }) => ({ id, title, date, startTime, endTime, category, location }));
    const sample = new URL('../../../Wojskowa Akademia Techniczna, e-Dziekanat.pdf', import.meta.url);
    let fullSessionId: string;
    if (existsSync(sample)) {
      const upload = await app.inject({ method: 'POST', url: '/api/import/classes/read', payload: { fileName: 'semester.pdf', dataBase64: readFileSync(sample).toString('base64') } });
      assert.equal(upload.statusCode, 201); assert.equal(upload.json().rows.length, 166);
      fullSessionId = upload.json().importSessionId;
    } else {
      fullSessionId = (await scoped.createImportSession({ source: 'classes', format: 'PDF', rows: fullRows, preview: buildImportPreview(fullRows) })).id;
    }
    sessions.push(fullSessionId);
    const importedAll = await app.inject({ method: 'POST', url: `/api/import/sessions/${fullSessionId}/confirm`, payload: { rows: fullRows } });
    assert.equal(importedAll.statusCode, 201); assert.equal(importedAll.json().summary.added, 166);
    const repeat = await scoped.createImportSession({ source: 'classes', format: 'PDF', rows: fullRows, preview: buildImportPreview(fullRows) });
    sessions.push(repeat.id);
    const countBefore = (await scoped.getOverview())?.events.length;
    const skipped = await app.inject({ method: 'POST', url: `/api/import/sessions/${repeat.id}/confirm`, payload: { rows: fullRows.map(row => ({ ...row, duplicateDecision: 'skip' })) } });
    assert.equal(skipped.statusCode, 201); assert.equal(skipped.json().summary.skipped, 166);
    assert.equal((await scoped.getOverview())?.events.length, countBefore);
  } finally {
    await pool.query('delete from t_importy where id_importu = any($1)', [sessions]);
    await pool.query('delete from t_kalendarze where id_kalendarza = $1', [calendarId]);
    await app.close(); await pool.end();
  }
});
