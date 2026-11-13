import assert from 'node:assert/strict';
import test from 'node:test';
import { config } from '../src/config.js';
import { pool, PostgresCalendarRepository } from '../src/database.js';
import { AiRepository } from '../src/ai/repository.js';
import { AiActionStalePreviewError } from '../src/ai/repository.js';

test('AI conversation scope, pending actions and calendar writes are locally persisted and idempotent', { skip: !config.databaseUrl }, async () => {
  assert.ok(pool);
  const ai = new AiRepository(pool);
  const calendar = new PostgresCalendarRepository(pool);
  const owner = { userId: config.demoUserId, calendarId: config.demoCalendarId };
  const conversation = await ai.createConversation(owner, 'gpt-5-mini', 30, 'Integration test');
  let eventId = '';
  try {
    await ai.appendMessage(owner, conversation.id, 'user', { text: 'Create a synthetic personal reminder.' }, 30);
    assert.equal((await ai.listMessages(owner, conversation.id)).length, 1);
    assert.equal(await ai.getConversation({ userId: 'different-user', calendarId: owner.calendarId }, conversation.id), null);

    const payload = { event: { title: 'AI integration synthetic', start: '2035-02-14T12:00', end: '2035-02-14T13:00',
      category: 'Personal', location: '', mandatory: false, repeatWeekly: false } };
    const competing = await ai.createAction(owner, conversation.id, 'calendar_event_create', payload, 15);
    const competingClaims = await Promise.allSettled([ai.claimAction(owner, competing.id), ai.claimAction(owner, competing.id)]);
    assert.equal(competingClaims.filter((item) => item.status === 'fulfilled').length, 1);
    assert.equal(competingClaims.filter((item) => item.status === 'rejected').length, 1);
    await ai.failAction(owner, competing.id, 'synthetic_concurrent_claim_test');

    const action = await ai.createAction(owner, conversation.id, 'calendar_event_create', payload, 15);
    assert.equal((await ai.claimAction(owner, action.id)).status, 'processing');
    const created = await calendar.createEvent(payload.event, owner.userId, owner.calendarId, action.id);
    eventId = created.id;
    await pool.query(`update t_ai_akcje set updated_at = now() - interval '3 minutes' where id_akcji = $1`, [action.id]);
    assert.equal((await ai.claimAction(owner, action.id)).status, 'processing');
    const duplicate = await calendar.createEvent(payload.event, owner.userId, owner.calendarId, action.id);
    assert.equal(duplicate.id, eventId);
    await ai.completeAction(owner, action.id, eventId);
    assert.equal((await ai.claimAction(owner, action.id)).status, 'confirmed');

    const outbox = await pool.query('select status from t_event_outbox where id_agregatu = $1', [eventId]);
    assert.equal(outbox.rowCount, 1);
    assert.equal((await pool.query('select consumer from t_event_outbox_delivery where id_outbox = (select id_outbox from t_event_outbox where id_agregatu = $1)', [eventId])).rowCount, 2);

    let event = (await calendar.getOverview(owner.userId, owner.calendarId))!.events.find((item) => item.id === eventId)!;
    const updatePayload = { id: eventId, original: { title: event.title, start: event.start, end: event.end, category: event.category,
      location: event.location ?? '', mandatory: event.mandatory, repeatWeekly: event.repeatWeekly, eventVersion: event.eventVersion },
      event: { ...payload.event, title: 'AI updated synthetic' } };
    const updateAction = await ai.createAction(owner, conversation.id, 'calendar_event_update', updatePayload, 15);
    await ai.claimAction(owner, updateAction.id);
    const updateOptions = { actionId: updateAction.id, expected: updatePayload.original };
    const updated = await calendar.updateEvent(eventId, updatePayload.event, owner.userId, owner.calendarId, updateOptions);
    await pool.query(`update t_ai_akcje set updated_at = now() - interval '3 minutes' where id_akcji = $1`, [updateAction.id]);
    assert.equal((await ai.claimAction(owner, updateAction.id)).status, 'processing');
    const retried = await calendar.updateEvent(eventId, updatePayload.event, owner.userId, owner.calendarId, updateOptions);
    assert.equal(updated.id, eventId);
    assert.deepEqual(retried, updated);
    await ai.completeAction(owner, updateAction.id, eventId);

    event = (await calendar.getOverview(owner.userId, owner.calendarId))!.events.find((item) => item.id === eventId)!;
    const stalePayload = { id: eventId, original: { title: event.title, start: event.start, end: event.end, category: event.category,
      location: event.location ?? '', mandatory: event.mandatory, repeatWeekly: event.repeatWeekly, eventVersion: event.eventVersion },
      event: { ...payload.event, title: 'Should not overwrite a newer edit' } };
    const staleAction = await ai.createAction(owner, conversation.id, 'calendar_event_update', stalePayload, 15);
    await ai.claimAction(owner, staleAction.id);
    await calendar.updateEvent(eventId, { ...payload.event, title: 'Manual newer edit' }, owner.userId, owner.calendarId);
    await assert.rejects(() => calendar.updateEvent(eventId, stalePayload.event, owner.userId, owner.calendarId,
      { actionId: staleAction.id, expected: stalePayload.original }), AiActionStalePreviewError);
    await ai.failAction(owner, staleAction.id, 'ai_action_stale_preview');
    assert.equal((await calendar.getOverview(owner.userId, owner.calendarId))!.events.find((item) => item.id === eventId)?.title, 'Manual newer edit');

    event = (await calendar.getOverview(owner.userId, owner.calendarId))!.events.find((item) => item.id === eventId)!;
    const deletePayload = { id: eventId, original: { title: event.title, start: event.start, end: event.end, category: event.category,
      location: event.location ?? '', mandatory: event.mandatory, repeatWeekly: event.repeatWeekly, eventVersion: event.eventVersion } };
    const deleteAction = await ai.createAction(owner, conversation.id, 'calendar_event_delete', deletePayload, 15);
    await ai.claimAction(owner, deleteAction.id);
    const deleteOptions = { actionId: deleteAction.id, expected: deletePayload.original };
    const deleted = await calendar.deleteEvent(eventId, owner.userId, owner.calendarId, deleteOptions);
    await pool.query(`update t_ai_akcje set updated_at = now() - interval '3 minutes' where id_akcji = $1`, [deleteAction.id]);
    assert.equal((await ai.claimAction(owner, deleteAction.id)).status, 'processing');
    const deleteRetry = await calendar.deleteEvent(eventId, owner.userId, owner.calendarId, deleteOptions);
    assert.deepEqual(deleteRetry, deleted);
    assert.deepEqual(deleted, [eventId]);
    await ai.completeAction(owner, deleteAction.id, null);
    eventId = '';
  } finally {
    if (eventId) {
      await pool.query('delete from t_wydarzenia where id_wydarzenia = $1', [eventId]);
      await pool.query('delete from t_event_outbox where id_agregatu = $1', [eventId]);
    }
    await ai.closeConversation(owner, conversation.id);
    await pool.end();
  }
});
