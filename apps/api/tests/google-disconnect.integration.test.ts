// Testy z prawdziwą bazą: odłączenie konta i cofnięcie zgody (S23KC2S1P2-35, G03 / S23KC2S1P2-287, decyzja D03).
// Sprawdzają: stan „Niepołączone”, usunięte tokeny, nową generację, odrzucane stare prace i spóźnione powroty z Google,
// zatrzymane prace outboxa, osobny opis stanu lokalnego i w Google, bezpieczne powtórzenie oraz nietknięte wydarzenia lokalne.
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
  const userId = `UGD-${Date.now()}-${randomBytes(3).toString('hex')}`;
  await pool!.query(`insert into t_uzytkownicy (id_uzytkownika, imie, nazwisko, email, strefa_czasowa) values ($1, 'Test', 'Odlacz', $2, 'Europe/Warsaw')`,
    [userId, `${userId}@example.invalid`]);
  const calendar = await pool!.query(`insert into t_kalendarze (id_uzytkownika, nazwa, typ) values ($1, 'Odlaczenie test', 'Osobisty') returning id_kalendarza`, [userId]);
  const scope = { userId, calendarId: String(calendar.rows[0].id_kalendarza) };
  await pool!.query(`insert into t_wydarzenia (id_kalendarza, id_kategorii, tytul, rozpoczecie, zakonczenie)
    values ($1, 'CAT03', 'Lokalne wydarzenie', '2035-03-01T10:00:00Z', '2035-03-01T11:00:00Z')`, [scope.calendarId]);
  try {
    await work(scope);
  } finally {
    await pool!.query('delete from t_event_outbox where id_uzytkownika = $1', [userId]);
    await pool!.query('delete from t_uzytkownicy where id_uzytkownika = $1', [userId]);
  }
}

// Wydarzenia wpisane w KAC; pobrane przez synchronizację (G05) sprawdza osobno syncedCount – odłączenie też ich nie usuwa.
const localEvents = async (scope: Scope) => (await pool!.query(`select id_wydarzenia, tytul, rozpoczecie, zakonczenie, status, updated_at
  from t_wydarzenia where id_kalendarza = $1 and zrodlo <> 'Google (synchronizacja)' order by id_wydarzenia`, [scope.calendarId])).rows;
const syncedCount = async (scope: Scope) => (await pool!.query(`select count(*)::int as n from t_wydarzenia where id_kalendarza = $1 and zrodlo = 'Google (synchronizacja)'`,
  [scope.calendarId])).rows[0].n as number;
const disconnect = (app: FastifyInstance) => app.inject({ method: 'DELETE', url: '/api/v1/integrations/google' });
const status = async (app: FastifyInstance) => (await app.inject({ method: 'GET', url: '/api/v1/integrations/google' })).json();
const start = async (app: FastifyInstance, purpose = 'connect') =>
  (await app.inject({ method: 'POST', url: '/api/v1/integrations/google/connect', payload: { purpose } })).json();
const callback = (app: FastifyInstance, started: { authUrl: string }, code: string) =>
  app.inject({ method: 'GET', url: `/api/v1/integrations/google/callback?state=${new URL(started.authUrl).searchParams.get('state')}&code=${code}` });

test('makieta: odłączenie, powtórne odłączenie, anulowana próba, zatrzymane prace outboxa i nietknięte wydarzenia', { skip }, () => withUser(async (scope) => {
  const service = new GoogleIntegrationService(new PostgresGoogleIntegrationRepository(pool!), { oauth: null, cipher: null, sync: { sleep: async () => {} } });
  const app = buildApi(null, [], { userScope: () => scope, googleIntegration: service });
  const eventsBefore = await localEvents(scope);
  try {
    // Bez połączenia odłączenie jest bezpieczne.
    assert.deepEqual((await disconnect(app)).json(), { status: 'not_connected', account: null, alreadyDisconnected: true, local: 'nothing_to_remove', remote: 'not_applicable' });

    const attempt = await start(app);
    await app.inject({ method: 'POST', url: `/api/v1/integrations/google/attempts/${attempt.attemptId}/demo-consent`, payload: { allow: true, account: 'student.kac.demo@gmail.com' } });
    assert.equal((await app.inject({ method: 'POST', url: '/api/v1/integrations/google/sync', payload: {} })).json().attempt.status, 'success');
    const synced = await syncedCount(scope);
    assert.ok(synced > 0);
    const before = await pool!.query('select id_konta, generacja from t_konta_google where id_uzytkownika = $1', [scope.userId]);

    // Zaplanowana praca dla Google (outbox) i otwarta próba „Zmień konto” w chwili odłączenia.
    const outbox = await pool!.query(`insert into t_event_outbox (id_uzytkownika, typ_agregatu, id_agregatu, typ_zdarzenia, klucz_idempotencji, payload)
      values ($1, 'calendar_event', 'E-test', 'calendar_event.created', $2, '{}'::jsonb) returning id_outbox`, [scope.userId, `test-${scope.userId}`]);
    await pool!.query(`insert into t_event_outbox_delivery (id_outbox, consumer) values ($1, 'google'), ($1, 'notifications')`, [outbox.rows[0].id_outbox]);
    const pending = await start(app, 'change_account');

    const result = await disconnect(app);
    assert.equal(result.statusCode, 200);
    assert.deepEqual(result.json(), { status: 'not_connected', account: 'student.kac.demo@gmail.com', alreadyDisconnected: false, local: 'removed', remote: 'not_applicable' });
    assert.deepEqual([(await status(app)).status, (await status(app)).account], ['not_connected', null]);

    // Konto w bazie: „Niepołączone”, zgoda wyłączona, nowa generacja.
    const row = await pool!.query('select status_polaczenia, zgoda_synchronizacja, generacja, odlaczono_at from t_konta_google where id_konta = $1', [before.rows[0].id_konta]);
    assert.deepEqual([row.rows[0].status_polaczenia, row.rows[0].zgoda_synchronizacja, row.rows[0].generacja], ['Niepołączone', false, before.rows[0].generacja + 1]);
    assert.ok(row.rows[0].odlaczono_at);

    // Spóźniona zgoda dla próby otwartej przed odłączeniem niczego nie zapisuje.
    const late = (await app.inject({ method: 'POST', url: `/api/v1/integrations/google/attempts/${pending.attemptId}/demo-consent`,
      payload: { allow: true, account: 'praca.kac.demo@gmail.com' } })).json();
    assert.equal(late.status, 'cancelled');
    assert.equal((await status(app)).status, 'not_connected');

    // Praca dla Google zatrzymana, praca powiadomień nietknięta; synchronizacja wymaga połączenia.
    const deliveries = await pool!.query(`select consumer, status, error_code from t_event_outbox_delivery where id_outbox = $1 order by consumer`, [outbox.rows[0].id_outbox]);
    assert.deepEqual(deliveries.rows.map((d) => [d.consumer, d.status, d.error_code]), [['google', 'dead', 'google_disconnected'], ['notifications', 'pending', null]]);
    assert.deepEqual((await app.inject({ method: 'POST', url: '/api/v1/integrations/google/sync', payload: {} })).json(), { error: 'not_connected' });

    // Powtórne odłączenie: ten sam stan, nic się nie psuje.
    assert.equal((await disconnect(app)).json().alreadyDisconnected, true);
    // Ponowne połączenie tego samego konta działa od zera.
    const again = await start(app);
    assert.equal((await app.inject({ method: 'POST', url: `/api/v1/integrations/google/attempts/${again.attemptId}/demo-consent`,
      payload: { allow: true, account: 'student.kac.demo@gmail.com' } })).json().status, 'connected');
    assert.deepEqual(await localEvents(scope), eventsBefore);
    // G03 + G05: odłączenie nie usuwa też wydarzeń pobranych z Google – przestają być tylko synchronizowane.
    assert.equal(await syncedCount(scope), synced);
  } finally {
    await app.close();
  }
}));

test('Google: cofnięcie zgody, błąd cofnięcia opisany osobno, stara generacja i spóźniony powrót odrzucone, zmiana konta cofa zgodę poprzedniego', { skip }, () => withUser(async (scope) => {
  const google = new FakeGoogle();
  const repository = new PostgresGoogleIntegrationRepository(pool!);
  const service = new GoogleIntegrationService(repository, { oauth: OAUTH, cipher: new TokenCipher(randomBytes(32)), fetch: google.fetch, sync: { sleep: async () => {} } });
  const app = buildApi(null, [], { userScope: () => scope, googleIntegration: service });
  const eventsBefore = await localEvents(scope);
  const connect = async (code: string, sub: string, email: string, refresh: string, purpose = 'connect') => {
    const started = await start(app, purpose);
    google.grantCode(code, { sub, email, refreshToken: refresh });
    assert.equal((await callback(app, started, code)).statusCode, 200);
  };
  try {
    // Zmiana konta: nowe konto zapisane, a zgoda poprzedniego cofnięta w Google (D03).
    await connect('c1', 'sub-1', 'pierwsze@example.test', '1//refresh-first');
    await connect('c2', 'sub-2', 'drugie@example.test', '1//refresh-second', 'change_account');
    assert.deepEqual(google.revoked, ['1//refresh-first']);
    assert.equal((await status(app)).account.email, 'drugie@example.test');

    // Odłączenie: Google potwierdza cofnięcie – remote „revoked”, tokenów nie ma już w bazie.
    const account = (await repository.getActiveAccount(scope.userId))!;
    const done = (await disconnect(app)).json();
    assert.deepEqual([done.local, done.remote, done.account], ['removed', 'revoked', 'drugie@example.test']);
    assert.deepEqual(google.revoked, ['1//refresh-first', '1//refresh-second']);
    assert.equal((await pool!.query('select count(*)::int as n from t_google_tokeny where id_konta = $1', [account.accountId])).rows[0].n, 0);

    // Praca ze starą generacją (odebrana przed odłączeniem) nie dostaje tokenu i nie wysyła żądania do Google.
    const requestsBefore = google.tokenRequests.length;
    await assert.rejects(service.tokens.accessToken(account), (error: { code?: string }) => error.code === 'reconnect_required');
    assert.equal(google.tokenRequests.length, requestsBefore);

    // Google nie odpowiada przy cofaniu: lokalnie odłączone, ale nie twierdzimy, że zgoda w Google została cofnięta.
    await connect('c3', 'sub-2', 'drugie@example.test', '1//refresh-third');
    google.revokeFailure = 'network';
    const offline = (await disconnect(app)).json();
    assert.deepEqual([offline.local, offline.remote], ['removed', 'failed']);
    assert.equal((await status(app)).status, 'not_connected');
    google.revokeFailure = 503;
    await connect('c4', 'sub-2', 'drugie@example.test', '1//refresh-fourth');
    assert.equal((await disconnect(app)).json().remote, 'failed');
    google.revokeFailure = null;

    // Powrót z Google, który był już w trakcie (próba przejęta), a w międzyczasie konto odłączono – nic nie zostaje zapisane.
    const raced = await start(app);
    const stateHash = (await pool!.query('select state_hash from t_google_oauth_proby where id_proby = $1', [raced.attemptId])).rows[0].state_hash;
    const claimed = await repository.claimAttempt(stateHash, scope, 'google');
    assert.ok(claimed);
    await disconnect(app);
    await assert.rejects(repository.saveConnectionWith(scope, { purpose: 'connect', mode: 'google', sub: 'sub-9', email: 'spoznione@example.test',
      grantedScopes: ['openid'], attemptId: claimed!.id }, null), (error: { code?: string }) => error.code === 'attempt_cancelled');
    assert.equal((await status(app)).status, 'not_connected');
    assert.deepEqual(await localEvents(scope), eventsBefore);
  } finally {
    await app.close();
  }
}));
