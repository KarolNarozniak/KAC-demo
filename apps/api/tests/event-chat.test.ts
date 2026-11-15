// S23KC2S1P2-252 / S23KC2S1P2-262: dodawanie wydarzeń z czatu – walidacja, kolizje, zastępowanie podglądu i zatwierdzenie.
import assert from 'node:assert/strict';
import test from 'node:test';
import { buildApi } from '../src/app.js';
import type { ApiOptions } from '../src/api/contracts.js';
import { executeAssistantTool } from '../src/ai/tools.js';
import { withPreviewCollisions } from '../src/ai/event-preview.js';
import { CollisionError } from '../src/collisions.js';

const zone = 'Europe/Warsaw';
const calendarEvents = [
  { id: 'E001', title: 'Laboratorium', start: '2026-10-12T08:00', end: '2026-10-12T09:35', category: 'Zajęcia', mandatory: true, repeatWeekly: true, color: '#000' },
  { id: 'W1', title: 'Praca', start: '2026-11-17T12:00', end: '2026-11-17T16:00', category: 'Praca', mandatory: false, repeatWeekly: false, color: '#000' },
];
const calendar = {
  checkConnection: async () => {},
  getOverview: async () => ({ source: 'postgresql', user: { id: 'U001', name: 'Demo', timezone: zone }, calendar: { id: 'K001', name: 'Demo' },
    counts: { events: calendarEvents.length, categories: 2 }, events: calendarEvents }),
} as never;
const event = (overrides: Record<string, unknown> = {}) => ({ title: 'Trening', start: '2026-11-16T18:00', end: '2026-11-16T19:00',
  category: 'Personal', location: 'Bemowo', mandatory: false, repeatWeekly: false, ...overrides });

function toolContext() {
  const created: Array<{ kind: string; payload: Record<string, unknown> }> = [];
  const superseded: string[] = [];
  const context = { scope: { userId: 'U001', calendarId: 'K001' }, conversationId: 'c1', calendar, actionTtlMinutes: 15,
    ai: {
      createAction: async (_scope: unknown, _conversation: string, kind: string, payload: Record<string, unknown>) => {
        created.push({ kind, payload }); return { id: `a${created.length}`, expiresAt: '2026-11-16T12:15:00.000Z' };
      },
      cancelPendingActionsOfKind: async (_scope: unknown, _conversation: string, kind: string) => { superseded.push(kind); return 1; },
    } } as never;
  return { context, created, superseded };
}

test('S23KC2S1P2-262: podgląd bez kolizji – zapis dopiero po zatwierdzeniu, nowy podgląd zastępuje poprzedni (KA1, KA5)', async () => {
  const { context, created, superseded } = toolContext();
  const result = await executeAssistantTool('calendar_prepare_event_create', JSON.stringify(event({ title: '  Trening ', mandatory: true })), context);
  assert.equal(result.status, 'awaiting_user_confirmation');
  assert.deepEqual(result.collisions, []);
  assert.deepEqual(superseded, ['calendar_event_create'], 'poprzednie podglądy dodania w rozmowie są anulowane');
  const saved = created[0]?.payload.event as Record<string, unknown>;
  assert.equal(saved.title, 'Trening');
  assert.equal(saved.mandatory, false, 'obowiązkowość tylko dla zajęć');
});

test('S23KC2S1P2-262: kolizja jest zwracana modelowi, a nieistniejący czas przy zmianie czasu odrzucony (5a, KA4)', async () => {
  const { context, created } = toolContext();
  const colliding = await executeAssistantTool('calendar_prepare_event_create', JSON.stringify(event({ start: '2026-11-23T09:00', end: '2026-11-23T10:00' })), context);
  assert.deepEqual(colliding.collisions, [{ id: 'E001', title: 'Laboratorium', category: 'Class', startLocal: '2026-11-23T08:00', endLocal: '2026-11-23T09:35' }],
    'seria cotygodniowa jest rozwijana na datę propozycji');
  assert.match(String(colliding.collisionNotice), /koliduje/);
  const before = created.length;
  const dst = await executeAssistantTool('calendar_prepare_event_create', JSON.stringify(event({ start: '2027-03-28T02:30', end: '2027-03-28T03:30' })), context);
  assert.deepEqual(dst, { error: 'invalid_event_time' });
  assert.equal(created.length, before, 'błędny termin nie tworzy akcji');
});

test('S23KC2S1P2-263: oczekujące akcje mają aktualne kolizje liczone przy odczycie', () => {
  const actions = [
    { id: 'a1', conversationId: 'c1', kind: 'calendar_event_create', payload: { event: event({ start: '2026-11-17T15:00', end: '2026-11-17T17:00' }) }, status: 'pending', expiresAt: '' },
    { id: 'a2', conversationId: 'c1', kind: 'calendar_event_create', payload: { event: event() }, status: 'pending', expiresAt: '' },
    { id: 'a3', conversationId: 'c1', kind: 'calendar_event_delete', payload: { id: 'W1' }, status: 'pending', expiresAt: '' },
  ];
  const enriched = withPreviewCollisions(actions, calendarEvents, zone);
  assert.deepEqual(enriched[0]?.collisions?.map((item) => item.title), ['Praca']);
  assert.deepEqual(enriched[1]?.collisions, []);
  assert.equal('collisions' in (enriched[2] ?? {}), false);
});

test('S23KC2S1P2-252: GET wiadomości zwraca kolizje, a zatwierdzenie kolizji daje 409 i zostawia podgląd (KA4, 5b)', async () => {
  const released: string[] = [];
  const pending = { id: 'a1', conversationId: 'c1', kind: 'calendar_event_create', payload: { event: event({ start: '2026-11-17T15:00', end: '2026-11-17T17:00' }) },
    status: 'pending', expiresAt: '2026-11-17T12:00:00.000Z' };
  const options: ApiOptions = {
    userScope: () => ({ userId: 'U001', calendarId: 'K001' }),
    aiRepository: {
      listMessages: async () => [], listPendingActions: async () => [pending],
      claimAction: async () => ({ ...pending, status: 'processing' }),
      releaseAction: async (_scope: unknown, id: string, code: string) => { released.push(`${id}:${code}`); },
      completeAction: async () => { throw new Error('must not complete a colliding action'); },
    } as never,
  };
  const app = buildApi({ ...calendar as object,
    createEvent: async () => { throw new CollisionError([{ id: 'W1', title: 'Praca', category: 'Praca', start: '2026-11-17T11:00:00.000Z', end: '2026-11-17T15:00:00.000Z',
      overlapStart: '2026-11-17T14:00:00.000Z', overlapEnd: '2026-11-17T15:00:00.000Z' }], 'token'); },
  } as never, [], options);
  try {
    const messages = await app.inject({ method: 'GET', url: '/api/v1/assistant/conversations/c1/messages' });
    assert.equal(messages.statusCode, 200, messages.body);
    assert.deepEqual(messages.json().pendingActions[0].collisions, [{ id: 'W1', title: 'Praca', category: 'Work', startLocal: '2026-11-17T12:00', endLocal: '2026-11-17T16:00' }]);
    const confirmed = await app.inject({ method: 'POST', url: '/api/v1/assistant/actions/a1/confirm', payload: {} });
    assert.equal(confirmed.statusCode, 409);
    assert.equal(confirmed.json().error, 'event_collision');
    assert.deepEqual(released, ['a1:event_collision'], 'akcja wraca do stanu pending – można poprawić albo anulować');
  } finally { await app.close(); }
});
