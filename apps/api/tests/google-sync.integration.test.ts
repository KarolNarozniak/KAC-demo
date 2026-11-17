// Testy z prawdziwą bazą: rejestr prób synchronizacji, ostatni sukces i ponowienia (S23KC2S1P2-17, G06 / S23KC2S1P2-290).
// Atrapa zegara (sleep) zapisuje przerwy między ponowieniami zamiast czekać. Każdy scenariusz sprawdza, że wydarzenia lokalne są nietknięte.
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
import { FakeGoogle, OAUTH } from './google-integration-fakes.js';

const skip = !config.databaseUrl;
type Scope = { userId: string; calendarId: string };

after(async () => { await pool?.end(); });

async function withUser(work: (scope: Scope) => Promise<void>) {
  const userId = `UGS-${Date.now()}-${randomBytes(3).toString('hex')}`;
  await pool!.query(`insert into t_uzytkownicy (id_uzytkownika, imie, nazwisko, email, strefa_czasowa) values ($1, 'Test', 'Sync', $2, 'Europe/Warsaw')`,
    [userId, `${userId}@example.invalid`]);
  const calendar = await pool!.query(`insert into t_kalendarze (id_uzytkownika, nazwa, typ) values ($1, 'Sync test', 'Osobisty') returning id_kalendarza`, [userId]);
  const scope = { userId, calendarId: String(calendar.rows[0].id_kalendarza) };
  await pool!.query(`insert into t_wydarzenia (id_kalendarza, id_kategorii, tytul, rozpoczecie, zakonczenie)
    values ($1, 'CAT03', 'Lokalne wydarzenie', '2035-03-01T10:00:00Z', '2035-03-01T11:00:00Z')`, [scope.calendarId]);
  try {
    await work(scope);
  } finally {
    await pool!.query('delete from t_uzytkownicy where id_uzytkownika = $1', [userId]);
  }
}

// Wydarzenia lokalne poza tymi, które sama synchronizacja pobiera z Google (G05) – one mają własne testy w google-events-sync.
const localEvents = async (scope: Scope) => (await pool!.query(`select id_wydarzenia, tytul, rozpoczecie, zakonczenie, status, updated_at
  from t_wydarzenia where id_kalendarza = $1 and zrodlo <> 'Google (synchronizacja)' order by id_wydarzenia`, [scope.calendarId])).rows;
const sync = (app: FastifyInstance, body: Record<string, unknown> = {}) => app.inject({ method: 'POST', url: '/api/v1/integrations/google/sync', payload: body });
const syncStatus = async (app: FastifyInstance) => (await app.inject({ method: 'GET', url: '/api/v1/integrations/google/sync' })).json();
/** Historyjka 23 (krok 3): kalendarz do synchronizacji wybiera użytkownik – nie ma wyboru domyślnego. */
const choosePrimary = async (app: FastifyInstance) => {
  const current = (await app.inject({ method: 'GET', url: '/api/v1/integrations/google/calendar-selection' })).json();
  const saved = await app.inject({ method: 'PUT', url: '/api/v1/integrations/google/calendar-selection',
    payload: { version: current.version, sourceCalendarIds: ['primary'], publicationTargetCalendarId: current.publicationTargetCalendarId } });
  assert.equal(saved.statusCode, 200, saved.body);
};
const connectDemo = async (app: FastifyInstance, account = 'student.kac.demo@gmail.com', purpose = 'connect') => {
  const started = (await app.inject({ method: 'POST', url: '/api/v1/integrations/google/connect', payload: { purpose } })).json();
  return (await app.inject({ method: 'POST', url: `/api/v1/integrations/google/attempts/${started.attemptId}/demo-consent`, payload: { allow: true, account } })).json();
};
const denyDemo = async (app: FastifyInstance, purpose: string) => {
  const started = (await app.inject({ method: 'POST', url: '/api/v1/integrations/google/connect', payload: { purpose } })).json();
  return (await app.inject({ method: 'POST', url: `/api/v1/integrations/google/attempts/${started.attemptId}/demo-consent`, payload: { allow: false } })).json();
};

test('makieta: nigdy → sukces, błąd po ograniczonych ponowieniach nie nadpisuje sukcesu, chwilowy błąd i wynik częściowy', { skip }, () => withUser(async (scope) => {
  const delays: number[] = [];
  const service = new GoogleIntegrationService(new PostgresGoogleIntegrationRepository(pool!), { oauth: null, cipher: null,
    sync: { sleep: async (ms) => { delays.push(ms); }, maxTries: 3, baseDelayMs: 500 } });
  const app = buildApi(null, [], { userScope: () => scope, googleIntegration: service });
  const eventsBefore = await localEvents(scope);
  try {
    // Bez połączonego konta: stan „nigdy”, a synchronizacja wymaga połączenia.
    assert.deepEqual((await syncStatus(app)).connection, 'not_connected');
    assert.deepEqual((await sync(app)).json(), { error: 'not_connected' });
    await connectDemo(app);
    await choosePrimary(app);
    let status = await syncStatus(app);
    assert.deepEqual([status.state, status.enabled, status.lastAttempt, status.lastSuccess.read], ['never', true, null, null]);

    // 2a: sukces – zapisany ostatni udany odczyt.
    const ok = (await sync(app)).json();
    assert.deepEqual([ok.attempt.status, ok.attempt.tries, ok.attempt.direction, ok.attempt.scope], ['success', 1, 'read', 'events']);
    // G05: pierwszy odczyt pobiera wydarzenia wybranego kalendarza (domyślnie główny) – liczba zmian to utworzone wydarzenia.
    assert.ok(ok.attempt.changes > 0);
    assert.deepEqual(ok.summary.calendars.map((calendar: { calendarId: string; mode: string }) => [calendar.calendarId, calendar.mode]), [['primary', 'full']]);
    assert.equal(ok.status.state, 'success');
    const lastSuccess = ok.status.lastSuccess.read;
    assert.ok(lastSuccess);
    assert.equal(delays.length, 0);

    // Brak sieci przy każdej próbie: 3 próby z rosnącą przerwą, potem błąd. Ostatni sukces zostaje bez zmian.
    const failed = (await sync(app, { simulate: 'network' })).json();
    assert.deepEqual([failed.attempt.status, failed.attempt.tries, failed.attempt.errorCode, failed.attempt.errorClass, failed.attempt.retryable],
      ['error', 3, 'network_error', 'network', true]);
    assert.deepEqual(delays, [500, 1000]);
    assert.equal(failed.status.lastSuccess.read, lastSuccess);
    assert.equal(failed.status.state, 'error');
    assert.equal(failed.status.history.length, 2);

    // Błąd serwera i limit – też przejściowe; brak uprawnień – bez ponowień i bez wymuszania logowania.
    delays.length = 0;
    assert.equal((await sync(app, { simulate: 'server' })).json().attempt.errorClass, 'server');
    assert.equal((await sync(app, { simulate: 'rate_limit' })).json().attempt.errorClass, 'rate_limit');
    assert.deepEqual(delays, [500, 1000, 500, 1000]);
    delays.length = 0;
    const denied = (await sync(app, { simulate: 'permissions' })).json();
    assert.deepEqual([denied.attempt.tries, denied.attempt.errorClass, denied.status.connection], [1, 'permissions', 'connected']);
    assert.deepEqual(delays, []);

    // Chwilowy błąd: pierwsza próba bez sieci, druga udana – sukces z dwiema próbami.
    const flaky = (await sync(app, { simulate: 'flaky' })).json();
    assert.deepEqual([flaky.attempt.status, flaky.attempt.tries, flaky.attempt.errorCode], ['success', 2, null]);
    assert.notEqual(flaky.status.lastSuccess.read, lastSuccess);
    const afterFlaky = flaky.status.lastSuccess.read;

    // Wynik częściowy: nie jest sukcesem i nie usuwa kalendarzy, których lista nie objęła.
    const partial = (await sync(app, { simulate: 'partial' })).json();
    assert.deepEqual([partial.attempt.status, partial.status.state, partial.attempt.retryable], ['partial', 'partial', true]);
    assert.equal(partial.status.lastSuccess.read, afterFlaky);
    const calendars = await pool!.query(`select count(*)::int as n from t_kalendarze_google g join t_konta_google k using (id_konta) where k.id_uzytkownika = $1`, [scope.userId]);
    assert.equal(calendars.rows[0].n, 4);

    // Rejestr w bazie: kierunek, status, próby i kod błędu.
    const rows = await pool!.query(`select s.kierunek, s.status, s.proby, s.kod_bledu from t_synchronizacje s join t_konta_google k using (id_konta)
      where k.id_uzytkownika = $1 order by s.data_proby`, [scope.userId]);
    assert.deepEqual(rows.rows.map((row) => [row.kierunek, row.status, row.proby, row.kod_bledu]), [
      ['Odczyt', 'Sukces', 1, null], ['Odczyt', 'Błąd', 3, 'network_error'], ['Odczyt', 'Błąd', 3, 'google_unavailable'], ['Odczyt', 'Błąd', 3, 'rate_limited'],
      ['Odczyt', 'Błąd', 1, 'insufficient_permissions'], ['Odczyt', 'Sukces', 2, null], ['Odczyt', 'Częściowo', 1, 'incomplete_list'],
    ]);
    assert.deepEqual(await localEvents(scope), eventsBefore);
  } finally {
    await app.close();
  }
}));

test('makieta: wygasłe logowanie → „Połącz ponownie”; odmowa wyłącza synchronizację, zgoda ją przywraca; jedna próba naraz', { skip }, () => withUser(async (scope) => {
  const delays: number[] = [];
  const repository = new PostgresGoogleIntegrationRepository(pool!);
  const service = new GoogleIntegrationService(repository, { oauth: null, cipher: null, sync: { sleep: async (ms) => { delays.push(ms); } } });
  const app = buildApi(null, [], { userScope: () => scope, googleIntegration: service });
  const eventsBefore = await localEvents(scope);
  try {
    await connectDemo(app);
    await choosePrimary(app);
    assert.equal((await sync(app)).json().attempt.status, 'success');

    // Krok 2 + 3: błąd logowania – bez ponowień, konto „Wymaga ponownego logowania”, przycisk „Spróbuj ponownie” nie ma sensu.
    const auth = (await sync(app, { simulate: 'auth' })).json();
    assert.deepEqual([auth.attempt.errorClass, auth.attempt.tries, auth.attempt.retryable, auth.status.connection], ['reconnect', 1, false, 'reconnect_required']);
    assert.deepEqual(delays, []);
    // Kolejna próba bez ponownego logowania nie pyta Google, tylko zapisuje przyczynę.
    assert.equal((await sync(app)).json().attempt.errorCode, 'reconnect_required');

    // 5a: odmowa przy ponownym logowaniu – synchronizacja wyłączona, konto i dane lokalne zostają.
    assert.equal((await denyDemo(app, 'reconnect')).status, 'denied');
    const disabled = await syncStatus(app);
    assert.deepEqual([disabled.enabled, disabled.connection], [false, 'reconnect_required']);
    assert.deepEqual((await sync(app)).json(), { error: 'sync_disabled' });
    assert.deepEqual(await localEvents(scope), eventsBefore);

    // 5 + 6: zgoda przy ponownym logowaniu przywraca synchronizację i kolejna próba się udaje.
    assert.equal((await connectDemo(app, 'student.kac.demo@gmail.com', 'reconnect')).status, 'connected');
    assert.equal((await syncStatus(app)).enabled, true);
    assert.equal((await sync(app)).json().attempt.status, 'success');

    // Jedna trwająca próba na konto i kierunek; porzucona (np. restart serwera) po czasie zamienia się w błąd „przerwana”.
    const account = (await repository.getActiveAccount(scope.userId))!;
    const running = await repository.startSyncAttempt(account, { direction: 'read', scope: 'calendar_list', operation: 'Lista kalendarzy' });
    assert.ok(running);
    assert.equal(await repository.startSyncAttempt(account, { direction: 'read', scope: 'calendar_list', operation: 'Lista kalendarzy' }), null);
    assert.deepEqual((await sync(app)).json(), { error: 'sync_in_progress' });
    assert.equal((await syncStatus(app)).state, 'running');
    await pool!.query(`update t_synchronizacje set data_proby = now() - interval '10 minutes' where id_sync = $1`, [running!.id]);
    const interrupted = (await syncStatus(app)).history.find((attempt: { id: string }) => attempt.id === running!.id);
    assert.deepEqual([interrupted.status, interrupted.errorCode], ['error', 'sync_interrupted']);
    assert.equal((await sync(app)).json().attempt.status, 'success');
    assert.deepEqual(await localEvents(scope), eventsBefore);
  } finally {
    await app.close();
  }
}));

test('udawany Google: 503 dwa razy i sukces za trzecim, zerwane połączenie, Calendar API wyłączone, cofnięta zgoda; makieta błędów tylko w demo', { skip }, () => withUser(async (scope) => {
  const google = new FakeGoogle();
  const delays: number[] = [];
  const service = new GoogleIntegrationService(new PostgresGoogleIntegrationRepository(pool!), {
    oauth: OAUTH, cipher: new TokenCipher(randomBytes(32)), fetch: google.fetch, sync: { sleep: async (ms) => { delays.push(ms); } },
  });
  const app = buildApi(null, [], { userScope: () => scope, googleIntegration: service });
  const eventsBefore = await localEvents(scope);
  try {
    const started = (await app.inject({ method: 'POST', url: '/api/v1/integrations/google/connect', payload: {} })).json();
    google.grantCode('code-ok', { sub: 'sub-1', email: 'student@example.test', refreshToken: '1//r1' });
    const state = new URL(started.authUrl).searchParams.get('state')!;
    assert.equal((await app.inject({ method: 'GET', url: `/api/v1/integrations/google/callback?state=${state}&code=code-ok` })).statusCode, 200);
    await choosePrimary(app);

    // Symulacja błędów jest dostępna tylko w makiecie.
    assert.deepEqual((await sync(app, { simulate: 'network' })).json(), { error: 'demo_only' });

    google.calendarScript = [{ status: 503, body: {} }, { status: 503, body: {} }];
    const recovered = (await sync(app)).json();
    assert.deepEqual([recovered.attempt.status, recovered.attempt.tries], ['success', 3]);
    assert.deepEqual(delays, [500, 1000]);

    delays.length = 0;
    google.calendarScript = ['network', 'network', 'network'];
    const offline = (await sync(app)).json();
    assert.deepEqual([offline.attempt.status, offline.attempt.errorClass, offline.attempt.tries], ['error', 'network', 3]);
    assert.equal(offline.status.lastSuccess.read, recovered.status.lastSuccess.read);

    // Calendar API wyłączone w projekcie: błąd serwera/konfiguracji, bez ponowień i bez żądania ponownego logowania.
    delays.length = 0;
    google.calendarScript = [{ status: 403, body: { error: { code: 403, status: 'PERMISSION_DENIED', errors: [{ reason: 'accessNotConfigured' }] } } }];
    const disabledApi = (await sync(app)).json();
    assert.deepEqual([disabledApi.attempt.errorCode, disabledApi.attempt.errorClass, disabledApi.attempt.tries, disabledApi.status.connection],
      ['api_not_enabled', 'server', 1, 'connected']);
    assert.deepEqual(delays, []);

    // Cofnięta zgoda w Google: 401, jedno wymuszone odświeżenie, invalid_grant → „Połącz ponownie”.
    google.rejectedAccessTokens.add(google.calendarTokens.at(-1)!);
    google.refresh = () => ({ status: 400, body: { error: 'invalid_grant' } });
    const revoked = (await sync(app)).json();
    assert.deepEqual([revoked.attempt.errorClass, revoked.attempt.retryable, revoked.status.connection], ['reconnect', false, 'reconnect_required']);
    assert.deepEqual(await localEvents(scope), eventsBefore);
  } finally {
    await app.close();
  }
}));
