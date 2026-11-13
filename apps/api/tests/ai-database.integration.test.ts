import assert from 'node:assert/strict';
import test from 'node:test';
import { config } from '../src/config.js';
import { pool, PostgresCalendarRepository } from '../src/database.js';
import { AiRepository } from '../src/ai/repository.js';

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
    const action = await ai.createAction(owner, conversation.id, 'calendar_event_create', payload, 15);
    assert.equal((await ai.claimAction(owner, action.id)).status, 'processing');
    const created = await calendar.createEvent(payload.event, owner.userId, owner.calendarId, action.id);
    eventId = created.id;
    await ai.completeAction(owner, action.id, eventId);
    const duplicate = await calendar.createEvent(payload.event, owner.userId, owner.calendarId, action.id);
    assert.equal(duplicate.id, eventId);
    assert.equal((await ai.claimAction(owner, action.id)).status, 'confirmed');

    const outbox = await pool.query('select status from t_event_outbox where id_agregatu = $1', [eventId]);
    assert.equal(outbox.rowCount, 1);
    assert.equal((await pool.query('select consumer from t_event_outbox_delivery where id_outbox = (select id_outbox from t_event_outbox where id_agregatu = $1)', [eventId])).rowCount, 2);
  } finally {
    if (eventId) {
      await pool.query('delete from t_wydarzenia where id_wydarzenia = $1', [eventId]);
      await pool.query('delete from t_event_outbox where id_agregatu = $1', [eventId]);
    }
    await ai.closeConversation(owner, conversation.id);
    await pool.end();
  }
});
