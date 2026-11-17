// Testy z prawdziwą bazą: trwały wybór kalendarzy i kalendarza publikacji (S23KC2S1P2-41, G04 / S23KC2S1P2-288).
// Każdy scenariusz sprawdza, że wydarzenia lokalne są nietknięte – wybór niczego nie usuwa z KAC (założenie D04).
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test, { after } from 'node:test';
import type { FastifyInstance } from 'fastify';
import { buildApi } from '../src/app.js';
import { config } from '../src/config.js';
import { pool } from '../src/database.js';
import { PostgresGoogleIntegrationRepository } from '../src/integrations/google/repository.js';
import { GoogleIntegrationService } from '../src/integrations/google/service.js';
import { TokenCipher } from '../src/integrations/google/token-cipher.js';
import { FakeGoogle, OAUTH, READ_SCOPE } from './google-integration-fakes.js';

const skip = !config.databaseUrl;
type Scope = { userId: string; calendarId: string };

after(async () => { await pool?.end(); });

async function withUser(work: (scope: Scope) => Promise<void>) {
  const userId = `UGW-${Date.now()}-${randomBytes(3).toString('hex')}`;
  await pool!.query(`insert into t_uzytkownicy (id_uzytkownika, imie, nazwisko, email, strefa_czasowa) values ($1, 'Test', 'Wybor', $2, 'Europe/Warsaw')`,
    [userId, `${userId}@example.invalid`]);
  const calendar = await pool!.query(`insert into t_kalendarze (id_uzytkownika, nazwa, typ) values ($1, 'Wybór test', 'Osobisty') returning id_kalendarza`, [userId]);
  const scope = { userId, calendarId: String(calendar.rows[0].id_kalendarza) };
  await pool!.query(`insert into t_wydarzenia (id_kalendarza, id_kategorii, tytul, rozpoczecie, zakonczenie)
    values ($1, 'CAT03', 'Lokalne wydarzenie', '2035-03-01T10:00:00Z', '2035-03-01T11:00:00Z')`, [scope.calendarId]);
  try {
    await work(scope);
  } finally {
    await pool!.query('delete from t_uzytkownicy where id_uzytkownika = $1', [userId]);
  }
}

const localEvents = async (scope: Scope) => (await pool!.query(`select id_wydarzenia, tytul, rozpoczecie, zakonczenie, status, updated_at
  from t_wydarzenia where id_kalendarza = $1 order by id_wydarzenia`, [scope.calendarId])).rows;
const getSelection = (app: FastifyInstance) => app.inject({ method: 'GET', url: '/api/v1/integrations/google/calendar-selection' });
const putSelection = (app: FastifyInstance, payload: { version: number; sourceCalendarIds: string[]; publicationTargetCalendarId: string | null }) =>
  app.inject({ method: 'PUT', url: '/api/v1/integrations/google/calendar-selection', payload });
const refreshList = (app: FastifyInstance) => app.inject({ method: 'GET', url: '/api/v1/integrations/google/calendars' });

const CALENDARS = [
  { id: 'primary', summary: 'Student', primary: true, accessRole: 'owner', timeZone: 'Europe/Warsaw' },
  { id: 'praca@group.calendar.google.com', summary: 'Grafik pracy', accessRole: 'writer', timeZone: 'Europe/Warsaw' },
  { id: 'kolo@group.calendar.google.com', summary: 'Koło naukowe', accessRole: 'reader' },
  { id: 'pl.polish#holiday@group.v.calendar.google.com', summary: 'Święta', accessRole: 'reader' },
];

async function connected(scope: Scope, google: FakeGoogle, scopeGrant?: string) {
  const service = new GoogleIntegrationService(new PostgresGoogleIntegrationRepository(pool!), {
    oauth: OAUTH, cipher: new TokenCipher(randomBytes(32)), fetch: google.fetch, sync: { sleep: async () => {} },
  });
  const app = buildApi(null, [], { userScope: () => scope, googleIntegration: service });
  const started = (await app.inject({ method: 'POST', url: '/api/v1/integrations/google/connect', payload: {} })).json();
  google.grantCode('code-ok', { sub: `sub-${scope.userId}`, email: 'student@example.test', refreshToken: '1//r1', ...(scopeGrant ? { scope: scopeGrant } : {}) });
  const state = new URL(started.authUrl).searchParams.get('state')!;
  assert.equal((await app.inject({ method: 'GET', url: `/api/v1/integrations/google/callback?state=${state}&code=code-ok` })).statusCode, 200);
  return app;
}

test('zapis atomowy z wersją, konflikt, obcy kalendarz, kalendarz tylko do odczytu jako cel i synchronizacja bez wyboru', { skip }, () => withUser(async (scope) => {
  const google = new FakeGoogle();
  google.calendarPages = [CALENDARS];
  const app = await connected(scope, google);
  const eventsBefore = await localEvents(scope);
  try {
    // Historyjka 23 (3a): kalendarz wybiera użytkownik – po połączeniu nic nie jest wybrane, a synchronizacja prosi o wybór.
    let selection = (await getSelection(app)).json();
    assert.equal(selection.version, 1);
    assert.deepEqual(selection.sourceCalendarIds, []);
    assert.equal(selection.publicationTargetCalendarId, null);
    const beforeChoice = await app.inject({ method: 'POST', url: '/api/v1/integrations/google/sync', payload: {} });
    assert.deepEqual([beforeChoice.statusCode, beforeChoice.json()], [409, { error: 'no_calendars_selected' }]);
    assert.equal(selection.canPublish, true);
    assert.deepEqual(selection.calendars.map((calendar: { id: string; writable: boolean }) => [calendar.id, calendar.writable]),
      [['primary', true], ['praca@group.calendar.google.com', true], ['kolo@group.calendar.google.com', false], ['pl.polish#holiday@group.v.calendar.google.com', false]]);

    // Krok 6–7: źródła i cel zapisują się razem; wersja rośnie.
    const saved = await putSelection(app, { version: 1, sourceCalendarIds: ['primary', 'kolo@group.calendar.google.com'], publicationTargetCalendarId: 'praca@group.calendar.google.com' });
    assert.equal(saved.statusCode, 200);
    selection = saved.json();
    assert.equal(selection.version, 2);
    assert.deepEqual(selection.sourceCalendarIds, ['primary', 'kolo@group.calendar.google.com']);
    assert.equal(selection.publicationTargetCalendarId, 'praca@group.calendar.google.com');
    assert.equal(selection.targetProblem, null);
    // Odświeżenie listy z Google zachowuje wybór.
    assert.equal((await refreshList(app)).statusCode, 200);
    assert.deepEqual((await getSelection(app)).json().sourceCalendarIds, ['primary', 'kolo@group.calendar.google.com']);

    // Zmiana w innym oknie: stara wersja kończy się konfliktem, nic się nie zmienia.
    const stale = await putSelection(app, { version: 1, sourceCalendarIds: ['primary'], publicationTargetCalendarId: null });
    assert.deepEqual([stale.statusCode, stale.json()], [409, { error: 'selection_conflict' }]);
    // Obcy kalendarz w zbiorze źródeł – 400 i bez częściowego zapisu.
    const foreign = await putSelection(app, { version: 2, sourceCalendarIds: ['primary', 'cudzy@group.calendar.google.com'], publicationTargetCalendarId: null });
    assert.deepEqual([foreign.statusCode, foreign.json()], [400, { error: 'unknown_calendar' }]);
    // Kalendarz tylko do odczytu jako cel – serwer odrzuca, nawet gdy interfejs by go pokazał.
    const reader = await putSelection(app, { version: 2, sourceCalendarIds: ['primary'], publicationTargetCalendarId: 'kolo@group.calendar.google.com' });
    assert.deepEqual([reader.statusCode, reader.json()], [422, { error: 'target_not_writable' }]);
    selection = (await getSelection(app)).json();
    assert.deepEqual([selection.version, selection.sourceCalendarIds, selection.publicationTargetCalendarId],
      [2, ['primary', 'kolo@group.calendar.google.com'], 'praca@group.calendar.google.com']);

    // Dwa równoległe zapisy tej samej wersji: dokładnie jeden wygrywa.
    const parallel = await Promise.all([
      putSelection(app, { version: 2, sourceCalendarIds: ['primary'], publicationTargetCalendarId: null }),
      putSelection(app, { version: 2, sourceCalendarIds: ['kolo@group.calendar.google.com'], publicationTargetCalendarId: 'primary' }),
    ]);
    assert.deepEqual(parallel.map((reply) => reply.statusCode).sort(), [200, 409]);
    assert.equal((await getSelection(app)).json().version, 3);

    // Bez kalendarzy źródłowych synchronizacja nie rusza, a konto zostaje połączone.
    const cleared = await putSelection(app, { version: 3, sourceCalendarIds: [], publicationTargetCalendarId: null });
    assert.equal(cleared.statusCode, 200);
    const blocked = await app.inject({ method: 'POST', url: '/api/v1/integrations/google/sync', payload: {} });
    assert.deepEqual([blocked.statusCode, blocked.json()], [409, { error: 'no_calendars_selected' }]);
    const syncStatus = (await app.inject({ method: 'GET', url: '/api/v1/integrations/google/sync' })).json();
    assert.deepEqual([syncStatus.sourcesSelected, syncStatus.connection], [0, 'connected']);
    // Ponowne połączenie (kolejny odczyt listy) nie przywraca domyślnego wyboru – użytkownik już wybrał.
    assert.equal((await refreshList(app)).statusCode, 200);
    assert.deepEqual((await getSelection(app)).json().sourceCalendarIds, []);
    assert.deepEqual(await localEvents(scope), eventsBefore);
  } finally {
    await app.close();
  }
}));

test('utrata uprawnień: zniknięty cel zostaje z problemem, kalendarz zdegradowany do odczytu i brak zgody na zapis', { skip }, () => withUser(async (scope) => {
  const google = new FakeGoogle();
  google.calendarPages = [CALENDARS];
  const app = await connected(scope, google);
  const eventsBefore = await localEvents(scope);
  try {
    assert.equal((await putSelection(app, { version: 1, sourceCalendarIds: ['primary', 'kolo@group.calendar.google.com'],
      publicationTargetCalendarId: 'praca@group.calendar.google.com' })).statusCode, 200);

    // Cel publikacji i jeden kalendarz źródłowy znikają z konta Google.
    google.calendarPages = [[CALENDARS[0], CALENDARS[3]]];
    assert.equal((await refreshList(app)).statusCode, 200);
    let selection = (await getSelection(app)).json();
    assert.equal(selection.targetProblem, 'unavailable');
    assert.equal(selection.publicationTargetCalendarId, 'praca@group.calendar.google.com');
    const gone = selection.calendars.filter((calendar: { available: boolean }) => !calendar.available).map((calendar: { id: string }) => calendar.id);
    assert.deepEqual(gone.sort(), ['kolo@group.calendar.google.com', 'praca@group.calendar.google.com']);
    // Niedostępny kalendarz można zostawić w źródłach, ale nie da się go wybrać na nowo ani ustawić jako celu.
    assert.equal((await putSelection(app, { version: 2, sourceCalendarIds: ['primary', 'kolo@group.calendar.google.com'], publicationTargetCalendarId: null })).statusCode, 200);
    const asTarget = await putSelection(app, { version: 3, sourceCalendarIds: ['primary'], publicationTargetCalendarId: 'praca@group.calendar.google.com' });
    assert.deepEqual([asTarget.statusCode, asTarget.json()], [409, { error: 'calendar_unavailable' }]);
    // Kalendarz zniknięty i niewybrany usuwa się przy następnym odczycie.
    assert.equal((await refreshList(app)).statusCode, 200);
    selection = (await getSelection(app)).json();
    assert.ok(!selection.calendars.some((calendar: { id: string }) => calendar.id === 'praca@group.calendar.google.com'));
    const readd = await putSelection(app, { version: 3, sourceCalendarIds: ['primary', 'praca@group.calendar.google.com'], publicationTargetCalendarId: null });
    assert.deepEqual([readd.statusCode, readd.json()], [400, { error: 'unknown_calendar' }]);

    // Cel zdegradowany z właściciela do odczytu.
    assert.equal((await putSelection(app, { version: 3, sourceCalendarIds: ['primary'], publicationTargetCalendarId: 'primary' })).statusCode, 200);
    google.calendarPages = [[{ ...CALENDARS[0], accessRole: 'reader' }]];
    assert.equal((await refreshList(app)).statusCode, 200);
    assert.equal((await getSelection(app)).json().targetProblem, 'not_writable');
    assert.deepEqual(await localEvents(scope), eventsBefore);
  } finally {
    await app.close();
  }
}));

test('zgoda tylko na odczyt nie pozwala ustawić celu; ponad 250 kalendarzy na kilku stronach', { skip }, () => withUser(async (scope) => {
  const google = new FakeGoogle();
  const many = Array.from({ length: 260 }, (_, index) => ({ id: `cal-${index}@group.calendar.google.com`, summary: `Kalendarz ${index}`, accessRole: index % 2 ? 'reader' : 'writer' }));
  google.calendarPages = [[CALENDARS[0], ...many.slice(0, 99)], many.slice(99, 199), many.slice(199)];
  const app = await connected(scope, google, `openid email ${READ_SCOPE}`);
  try {
    let selection = (await getSelection(app)).json();
    assert.equal(selection.calendars.length, 261);
    assert.equal(selection.canPublish, false);
    const noWrite = await putSelection(app, { version: 1, sourceCalendarIds: ['primary'], publicationTargetCalendarId: 'cal-0@group.calendar.google.com' });
    assert.deepEqual([noWrite.statusCode, noWrite.json()], [422, { error: 'write_access_missing' }]);
    const all = await putSelection(app, { version: 1, sourceCalendarIds: ['primary', ...many.map((calendar) => calendar.id)], publicationTargetCalendarId: null });
    assert.equal(all.statusCode, 200);
    selection = all.json();
    assert.equal(selection.sourceCalendarIds.length, 261);
    assert.equal((await app.inject({ method: 'GET', url: '/api/v1/integrations/google/sync' })).json().sourcesSelected, 261);
  } finally {
    await app.close();
  }
}));

test('bez połączonego konta wybór zwraca 404', { skip }, () => withUser(async (scope) => {
  const service = new GoogleIntegrationService(new PostgresGoogleIntegrationRepository(pool!), { oauth: null, cipher: null });
  const app = buildApi(null, [], { userScope: () => scope, googleIntegration: service });
  try {
    assert.deepEqual([(await getSelection(app)).statusCode, (await getSelection(app)).json()], [404, { error: 'not_connected' }]);
    assert.equal((await putSelection(app, { version: 1, sourceCalendarIds: [], publicationTargetCalendarId: null })).statusCode, 404);
  } finally {
    await app.close();
  }
}));
