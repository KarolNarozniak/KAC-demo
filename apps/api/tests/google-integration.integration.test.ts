// Testy z prawdziwą bazą: trwałe połączenie z Google (S23KC2S1P2-12, G01 / S23KC2S1P2-284).
// Makieta: odmowa (5a), wybór konta (5b), 1a, anulowana zmiana konta, konto bez kalendarzy (7a), wygasła próba.
// Udawany Google: jednorazowy state, błąd kodu (6a), brak tokenu odświeżania, tylko szyfrogramy w bazie i żadnych tokenów w odpowiedziach,
// jedno odświeżenie dla równoległych żądań, rotacja tokenu i „wymagane ponowne logowanie”. Połączenie nie zmienia wydarzeń.
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
import { FakeGoogle, FULL_GRANT, OAUTH, READ_SCOPE } from './google-integration-fakes.js';

const skip = !config.databaseUrl;
type Scope = { userId: string; calendarId: string };

after(async () => { await pool?.end(); });

/** Syntetyczny użytkownik z kalendarzem i jednym lokalnym wydarzeniem; usuwany razem z kontem Google (kaskada). */
async function withUser(work: (scope: Scope) => Promise<void>) {
  const userId = `UGI-${Date.now()}-${randomBytes(3).toString('hex')}`;
  await pool!.query(`insert into t_uzytkownicy (id_uzytkownika, imie, nazwisko, email, strefa_czasowa) values ($1, 'Test', 'Google', $2, 'Europe/Warsaw')`,
    [userId, `${userId}@example.invalid`]);
  const calendar = await pool!.query(`insert into t_kalendarze (id_uzytkownika, nazwa, typ) values ($1, 'Google test', 'Osobisty') returning id_kalendarza`, [userId]);
  const scope = { userId, calendarId: String(calendar.rows[0].id_kalendarza) };
  await pool!.query(`insert into t_wydarzenia (id_kalendarza, id_kategorii, tytul, rozpoczecie, zakonczenie)
    values ($1, 'CAT03', 'Lokalne wydarzenie', '2035-03-01T10:00:00Z', '2035-03-01T11:00:00Z')`, [scope.calendarId]);
  try {
    await work(scope);
  } finally {
    await pool!.query('delete from t_uzytkownicy where id_uzytkownika = $1', [userId]);
  }
}

const localEvents = async (scope: Scope) => (await pool!.query(`select id_wydarzenia, tytul, rozpoczecie, zakonczenie, status, zrodlo, updated_at
  from t_wydarzenia where id_kalendarza = $1 order by id_wydarzenia`, [scope.calendarId])).rows;
const status = async (app: FastifyInstance) => (await app.inject({ method: 'GET', url: '/api/v1/integrations/google' })).json();
const start = (app: FastifyInstance, purpose: string) => app.inject({ method: 'POST', url: '/api/v1/integrations/google/connect', payload: { purpose } });
const consent = (app: FastifyInstance, id: string, payload: Record<string, unknown>) =>
  app.inject({ method: 'POST', url: `/api/v1/integrations/google/attempts/${id}/demo-consent`, payload });
const attempt = async (app: FastifyInstance, id: string) => (await app.inject({ method: 'GET', url: `/api/v1/integrations/google/attempts/${id}` })).json();
const calendars = (app: FastifyInstance) => app.inject({ method: 'GET', url: '/api/v1/integrations/google/calendars' });
const stateOf = (started: { authUrl: string }) => new URL(started.authUrl).searchParams.get('state')!;
const callback = (app: FastifyInstance, query: Record<string, string>) =>
  app.inject({ method: 'GET', url: `/api/v1/integrations/google/callback?${new URLSearchParams(query)}` });
const tokenRow = async (scope: Scope) => (await pool!.query(`select t.* from t_google_tokeny t join t_konta_google k using (id_konta)
  where k.id_uzytkownika = $1 and k.status_polaczenia <> 'Niepołączone'`, [scope.userId])).rows[0];
const expireAccess = (accountId: string) => pool!.query(`update t_google_tokeny set access_expires_at = now() - interval '1 minute' where id_konta = $1`, [accountId]);

test('makieta Google: odmowa, połączenie, 1a, anulowana i udana zmiana konta, konto bez kalendarzy, wygasła próba', { skip }, () => withUser(async (scope) => {
  const service = new GoogleIntegrationService(new PostgresGoogleIntegrationRepository(pool!), { oauth: null, cipher: null });
  const app = buildApi(null, [], { userScope: () => scope, googleIntegration: service });
  const eventsBefore = await localEvents(scope);
  try {
    let current = await status(app);
    assert.deepEqual([current.mode, current.ready, current.status, current.account], ['demo', true, 'not_connected', null]);
    assert.deepEqual(current.requestedAccess, { calendarsRead: true, eventsWrite: true });

    // 5a: odmowa – nic nie zostaje zapisane, a ponowna decyzja na tej samej próbie niczego nie zmienia.
    const refused = await start(app, 'connect');
    assert.equal(refused.statusCode, 201);
    assert.equal(refused.json().authUrl, undefined);
    assert.equal((await consent(app, refused.json().attemptId, { allow: false })).json().status, 'denied');
    assert.equal((await consent(app, refused.json().attemptId, { allow: true, account: 'student.kac.demo@gmail.com' })).json().status, 'denied');
    assert.equal((await status(app)).status, 'not_connected');

    // 5b + 6 + 7: wybór konta, zgoda, zapis połączenia i lista kalendarzy z rolami.
    const first = (await start(app, 'connect')).json();
    assert.equal((await consent(app, first.attemptId, { allow: true, account: 'student.kac.demo@gmail.com' })).json().status, 'connected');
    current = await status(app);
    assert.deepEqual([current.status, current.account.email], ['connected', 'student.kac.demo@gmail.com']);
    assert.deepEqual(current.account.access, { calendarsRead: true, eventsWrite: true });
    const listed = await calendars(app);
    assert.equal(listed.statusCode, 200);
    assert.deepEqual(listed.json().calendars.map((calendar: { id: string; accessRole: string }) => [calendar.id, calendar.accessRole]),
      [['primary', 'owner'], ['grafik-pracy', 'writer'], ['kolo-naukowe', 'reader'], ['urodziny', 'reader']]);
    const stored = await pool!.query(`select g.id_zewnetrzne, g.rola_dostepu, g.uprawnienia, g.glowny from t_kalendarze_google g
      join t_konta_google k using (id_konta) where k.id_uzytkownika = $1 order by g.id_zewnetrzne`, [scope.userId]);
    assert.deepEqual(stored.rows.find((row) => row.id_zewnetrzne === 'grafik-pracy'), { id_zewnetrzne: 'grafik-pracy', rola_dostepu: 'writer', uprawnienia: 'Odczyt/Zapis', glowny: false });
    assert.equal(stored.rowCount, 4);

    // 1a: zwykłe „Połącz” przy połączonym koncie jest odrzucane.
    const duplicate = await start(app, 'connect');
    assert.deepEqual([duplicate.statusCode, duplicate.json().error], [409, 'already_connected']);

    // „Zmień konto” anulowane: stare połączenie zostaje, a spóźniona zgoda na tej próbie niczego nie zapisuje.
    const cancelledChange = (await start(app, 'change_account')).json();
    assert.equal(cancelledChange.purpose, 'change_account');
    assert.equal((await app.inject({ method: 'POST', url: `/api/v1/integrations/google/attempts/${cancelledChange.attemptId}/cancel` })).json().status, 'cancelled');
    assert.equal((await consent(app, cancelledChange.attemptId, { allow: true, account: 'praca.kac.demo@gmail.com' })).json().status, 'cancelled');
    assert.equal((await status(app)).account.email, 'student.kac.demo@gmail.com');

    // Zmiana na konto bez kalendarzy (7a): połączenie zostaje, lista jest pusta; poprzednie konto jest odłączone z nową generacją.
    const change = (await start(app, 'change_account')).json();
    assert.equal((await consent(app, change.attemptId, { allow: true, account: 'praca.kac.demo@gmail.com' })).json().status, 'connected');
    const empty = await calendars(app);
    assert.deepEqual([empty.statusCode, empty.json().calendars, empty.json().complete], [200, [], true]);
    assert.deepEqual([(await status(app)).status, (await status(app)).account.email], ['connected', 'praca.kac.demo@gmail.com']);
    const accounts = await pool!.query(`select adres_email, status_polaczenia, generacja, zgoda_synchronizacja from t_konta_google where id_uzytkownika = $1 order by adres_email`, [scope.userId]);
    assert.deepEqual(accounts.rows.map((row) => [row.adres_email, row.status_polaczenia, row.generacja, row.zgoda_synchronizacja]), [
      ['praca.kac.demo@gmail.com', 'Połączone', 1, true], ['student.kac.demo@gmail.com', 'Niepołączone', 2, false],
    ]);

    // Wygasła próba: zgoda po terminie niczego nie zmienia.
    const stale = (await start(app, 'change_account')).json();
    await pool!.query(`update t_google_oauth_proby set expires_at = now() - interval '1 second' where id_proby = $1`, [stale.attemptId]);
    assert.equal((await consent(app, stale.attemptId, { allow: true, account: 'student.kac.demo@gmail.com' })).json().status, 'expired');
    assert.equal((await status(app)).account.email, 'praca.kac.demo@gmail.com');

    // Nieznane konto makiety i cudza próba.
    const other = (await start(app, 'change_account')).json();
    const unknown = await consent(app, other.attemptId, { allow: true, account: 'ktos@example.com' });
    assert.deepEqual([unknown.statusCode, unknown.json().error], [400, 'invalid_demo_account']);
    const stranger = buildApi(null, [], { userScope: () => ({ userId: 'U-nie-istnieje', calendarId: 'K-nie-istnieje' }), googleIntegration: service });
    assert.equal((await stranger.inject({ method: 'GET', url: `/api/v1/integrations/google/attempts/${other.attemptId}` })).statusCode, 404);
    assert.equal((await stranger.inject({ method: 'POST', url: `/api/v1/integrations/google/attempts/${other.attemptId}/cancel` })).statusCode, 404);
    await stranger.close();
    assert.equal((await attempt(app, other.attemptId)).status, 'pending');

    // Makieta nie ma tokenów, a samo połączenie nie zmieniło żadnego wydarzenia.
    assert.equal((await pool!.query(`select count(*)::int as n from t_google_tokeny t join t_konta_google k using (id_konta) where k.id_uzytkownika = $1`, [scope.userId])).rows[0].n, 0);
    assert.deepEqual(await localEvents(scope), eventsBefore);
  } finally {
    await app.close();
  }
}));

test('Google OAuth (udawany): odmowa, jednorazowy i wygasły state, błąd kodu, brak trwałego dostępu, szyfrogramy i ponowne logowanie', { skip }, () => withUser(async (scope) => {
  const google = new FakeGoogle();
  const cipher = new TokenCipher(randomBytes(32));
  const service = new GoogleIntegrationService(new PostgresGoogleIntegrationRepository(pool!), { oauth: OAUTH, cipher, fetch: google.fetch });
  const app = buildApi(null, [], { userScope: () => scope, googleIntegration: service });
  const eventsBefore = await localEvents(scope);
  const accountRows = async () => (await pool!.query('select count(*)::int as n from t_konta_google where id_uzytkownika = $1', [scope.userId])).rows[0].n;
  try {
    const current = await status(app);
    assert.deepEqual([current.mode, current.ready, current.demoAccounts], ['google', true, []]);

    // 5a: odmowa na stronie Google.
    let started = (await start(app, 'connect')).json();
    assert.equal(started.mode, 'google');
    const deniedState = stateOf(started);
    const denied = await callback(app, { state: deniedState, error: 'access_denied' });
    assert.equal(denied.statusCode, 200);
    assert.match(denied.body, /Brak zgody/);
    assert.match(String(denied.headers['content-type']), /text\/html/);
    assert.deepEqual([(await attempt(app, started.attemptId)).status, (await attempt(app, started.attemptId)).errorCode], ['denied', 'access_denied']);
    // Ten sam state drugi raz (odświeżona strona powrotu) – nic się nie dzieje, kod nie jest wymieniany.
    google.grantCode('code-late', { sub: 'sub-1', email: 'student@example.test' });
    assert.equal((await callback(app, { state: deniedState, code: 'code-late' })).statusCode, 400);
    // Wygasły state.
    started = (await start(app, 'connect')).json();
    await pool!.query(`update t_google_oauth_proby set expires_at = now() - interval '1 second' where id_proby = $1`, [started.attemptId]);
    const expired = await callback(app, { state: stateOf(started), code: 'code-late' });
    assert.equal(expired.statusCode, 400);
    assert.match(expired.body, /wygasł/);
    assert.equal((await attempt(app, started.attemptId)).status, 'expired');
    // Nieznany state.
    assert.equal((await callback(app, { state: 'zgadniety-state', code: 'code-late' })).statusCode, 400);
    assert.equal(google.tokenRequests.length, 0);

    // 6a: Google odrzuca kod (wygasł albo już użyty).
    started = (await start(app, 'connect')).json();
    const rejected = await callback(app, { state: stateOf(started), code: 'nieznany-kod' });
    assert.equal(rejected.statusCode, 502);
    assert.match(rejected.body, /Kod logowania wygasł/);
    assert.deepEqual([(await attempt(app, started.attemptId)).status, (await attempt(app, started.attemptId)).errorCode], ['error', 'authorization_code_invalid']);
    // Brak tokenu odświeżania przy pierwszym połączeniu – kontrolowany błąd zamiast „połączone” na godzinę.
    started = (await start(app, 'connect')).json();
    google.grantCode('code-no-refresh', { sub: 'sub-1', email: 'student@example.test', refreshToken: null });
    const noRefresh = await callback(app, { state: stateOf(started), code: 'code-no-refresh' });
    assert.equal(noRefresh.statusCode, 409);
    assert.match(noRefresh.body, /trwałego dostępu/);
    // Zgoda bez dostępu do kalendarza (odznaczone pole na stronie Google).
    started = (await start(app, 'connect')).json();
    google.grantCode('code-no-calendar', { sub: 'sub-1', email: 'student@example.test', scope: 'openid email' });
    const noCalendar = await callback(app, { state: stateOf(started), code: 'code-no-calendar' });
    assert.equal(noCalendar.statusCode, 200);
    assert.match(noCalendar.body, /Brak dostępu do kalendarza/);
    assert.equal((await attempt(app, started.attemptId)).errorCode, 'calendar_scope_missing');
    assert.deepEqual([(await status(app)).status, await accountRows()], ['not_connected', 0]);

    // Udane połączenie: użytkownik przyznał odczyt bez zapisu – zapisujemy to, co realnie przyznał.
    google.calendarPages = [
      [{ id: 'primary', summary: 'Student', primary: true, accessRole: 'owner', timeZone: 'Europe/Warsaw' }],
      [{ id: 'praca@group.calendar.google.com', summary: 'Grafik pracy', accessRole: 'writer', timeZone: 'Europe/Warsaw' }],
    ];
    started = (await start(app, 'connect')).json();
    const authUrl = new URL(started.authUrl);
    assert.deepEqual([authUrl.searchParams.get('access_type'), authUrl.searchParams.get('code_challenge_method'), authUrl.searchParams.get('login_hint')], ['offline', 'S256', null]);
    google.grantCode('code-ok', { sub: 'sub-1', email: 'student@example.test', refreshToken: '1//refresh-secret-A', accessToken: 'ya29.access-secret-A', scope: `openid email ${READ_SCOPE}` });
    // Przeglądarka wracająca ze strony zgody Google nie ma sesji KAC: właściciela wskazuje jednorazowy state próby,
    // więc powrót obsłużony przy innym „bieżącym” użytkowniku i tak łączy konto właściciela próby.
    assert.equal((await attempt(app, started.attemptId)).status, 'pending');
    const stranger = buildApi(null, [], { userScope: () => ({ userId: 'U-obcy', calendarId: 'K-obcy' }), googleIntegration: service });
    const connected = await callback(stranger, { state: stateOf(started), code: 'code-ok' });
    await stranger.close();
    assert.equal(connected.statusCode, 200);
    assert.match(connected.body, /Połączono z Google/);
    // PKCE: weryfikator odszyfrowany z próby trafia tylko do serwera tokenów Google.
    assert.match(google.tokenRequests.at(-1)!.get('code_verifier') ?? '', /^[A-Za-z0-9_-]{43,128}$/);
    const afterConnect = await status(app);
    assert.deepEqual([afterConnect.status, afterConnect.account.email], ['connected', 'student@example.test']);
    assert.deepEqual(afterConnect.account.access, { calendarsRead: true, eventsWrite: false });
    assert.deepEqual(afterConnect.account.grantedScopes, ['openid', 'email', READ_SCOPE]);

    // Tokeny tylko jako szyfrogramy powiązane z kontem; weryfikator PKCE usunięty po użyciu.
    const tokens = await tokenRow(scope);
    assert.match(tokens.refresh_token_enc, /^v1\./);
    assert.match(tokens.access_token_enc, /^v1\./);
    assert.equal(tokens.klucz_id, cipher.keyId);
    assert.ok(!JSON.stringify(tokens).includes('secret-A'));
    assert.equal(cipher.decrypt(tokens.refresh_token_enc, `${tokens.id_konta}:refresh`), '1//refresh-secret-A');
    const verifiers = await pool!.query(`select count(*)::int as n from t_google_oauth_proby where id_uzytkownika = $1 and code_verifier_enc is not null and status <> 'pending'`, [scope.userId]);
    assert.equal(verifiers.rows[0].n, 0);
    const account = await pool!.query('select google_sub, tryb, uprawnienia from t_konta_google where id_uzytkownika = $1', [scope.userId]);
    assert.deepEqual(account.rows[0], { google_sub: 'sub-1', tryb: 'google', uprawnienia: ['openid', 'email', READ_SCOPE] });

    // Lista kalendarzy ze wszystkich stron; ani lista, ani stan, ani strona powrotu nie zawierają tokenów.
    const listed = await calendars(app);
    assert.equal(listed.statusCode, 200);
    assert.deepEqual(listed.json().calendars.map((calendar: { id: string }) => calendar.id), ['primary', 'praca@group.calendar.google.com']);
    for (const body of [JSON.stringify(afterConnect), listed.body, connected.body, JSON.stringify(await attempt(app, started.attemptId))]) {
      assert.ok(!body.includes('secret-A'), 'odpowiedź API nie zawiera tokenu');
      assert.ok(!body.includes('v1.'), 'odpowiedź API nie zawiera szyfrogramu');
    }

    // „Połącz ponownie” to samo konto: Google nie przysłał nowego refresh_token – zapisany zostaje, zakresy się aktualizują.
    started = (await start(app, 'reconnect')).json();
    assert.equal(new URL(started.authUrl).searchParams.get('login_hint'), 'student@example.test');
    google.grantCode('code-reconnect', { sub: 'sub-1', email: 'student@example.test', refreshToken: null, scope: FULL_GRANT });
    assert.equal((await callback(app, { state: stateOf(started), code: 'code-reconnect' })).statusCode, 200);
    const reconnectedTokens = await tokenRow(scope);
    assert.equal(reconnectedTokens.refresh_token_enc, tokens.refresh_token_enc);
    assert.deepEqual((await status(app)).account.access, { calendarsRead: true, eventsWrite: true });

    // „Połącz ponownie”, ale wybrano inne konto – nic się nie zmienia.
    started = (await start(app, 'reconnect')).json();
    google.grantCode('code-other', { sub: 'sub-2', email: 'inny@example.test' });
    const mismatch = await callback(app, { state: stateOf(started), code: 'code-other' });
    assert.equal(mismatch.statusCode, 409);
    assert.match(mismatch.body, /inne konto Google/);
    assert.equal((await status(app)).account.email, 'student@example.test');
    assert.equal(await accountRows(), 1);

    // „Połącz” zamiast „Zmień konto” dla innego konta, gdy strona Google była otwarta przed połączeniem.
    // (Próba z celem connect, a w międzyczasie połączono konto – drugie konto nie nadpisuje pierwszego.)
    assert.equal((await start(app, 'connect')).statusCode, 409);
    assert.deepEqual(await localEvents(scope), eventsBefore);
  } finally {
    await app.close();
  }
}));

test('Google OAuth (udawany): równoległe żądania odświeżają token raz, 401 wymusza jedno odświeżenie, invalid_grant wymaga ponownego logowania', { skip }, () => withUser(async (scope) => {
  const google = new FakeGoogle();
  const key = randomBytes(32);
  const repository = new PostgresGoogleIntegrationRepository(pool!);
  const service = new GoogleIntegrationService(repository, { oauth: OAUTH, cipher: new TokenCipher(key), fetch: google.fetch });
  // Drugi proces API (np. druga instancja w Azure) z tym samym kluczem i tą samą bazą.
  const secondProcess = new GoogleIntegrationService(repository, { oauth: OAUTH, cipher: new TokenCipher(key), fetch: google.fetch });
  const app = buildApi(null, [], { userScope: () => scope, googleIntegration: service });
  const cipher = new TokenCipher(key);
  const eventsBefore = await localEvents(scope);
  try {
    const started = (await start(app, 'connect')).json();
    google.grantCode('code-ok', { sub: 'sub-1', email: 'student@example.test', refreshToken: '1//refresh-1', accessToken: 'ya29.first' });
    assert.equal((await callback(app, { state: stateOf(started), code: 'code-ok' })).statusCode, 200);
    const account = (await repository.getActiveAccount(scope.userId))!;

    // Ważny token dostępu jest używany ponownie – bez zapytania do Google.
    assert.equal(await service.tokens.accessToken(account), 'ya29.first');
    assert.equal(google.refreshCount(), 0);

    // Wygasły token: cztery równoległe żądania z dwóch procesów → jedno odświeżenie.
    await expireAccess(account.accountId);
    google.delayMs = 40;
    const tokens = await Promise.all([service.tokens.accessToken(account), service.tokens.accessToken(account),
      secondProcess.tokens.accessToken(account), secondProcess.tokens.accessToken(account)]);
    google.delayMs = 0;
    assert.equal(google.refreshCount(), 1);
    assert.equal(new Set(tokens).size, 1);
    assert.notEqual(tokens[0], 'ya29.first');
    // Odpowiedź bez refresh_token – zapisany token odświeżania zostaje.
    let row = await tokenRow(scope);
    assert.equal(cipher.decrypt(row.refresh_token_enc, `${account.accountId}:refresh`), '1//refresh-1');
    assert.equal(cipher.decrypt(row.access_token_enc, `${account.accountId}:access`), tokens[0]);

    // Rotacja tokenu odświeżania.
    google.refresh = () => ({ body: { access_token: 'ya29.rotated', expires_in: 3600, scope: FULL_GRANT, refresh_token: '1//refresh-2' } });
    await expireAccess(account.accountId);
    assert.equal(await service.tokens.accessToken(account), 'ya29.rotated');
    row = await tokenRow(scope);
    assert.equal(cipher.decrypt(row.refresh_token_enc, `${account.accountId}:refresh`), '1//refresh-2');

    // 401 mimo ważnego terminu (np. cofnięty token dostępu): jedno wymuszone odświeżenie i ponowienie.
    google.rejectedAccessTokens.add('ya29.rotated');
    google.refresh = () => ({ body: { access_token: 'ya29.after-401', expires_in: 3600, scope: FULL_GRANT } });
    const retried = await calendars(app);
    assert.equal(retried.statusCode, 200);
    assert.deepEqual(google.calendarTokens.slice(-2), ['ya29.rotated', 'ya29.after-401']);

    // Chwilowy błąd Google: połączenie zostaje, użytkownik dostaje komunikat „spróbuj ponownie”.
    google.calendarFailure = { status: 503, body: {} };
    const unavailable = await calendars(app);
    assert.deepEqual([unavailable.statusCode, unavailable.json().error], [502, 'google_unavailable']);
    google.calendarFailure = { status: 403, body: { error: { errors: [{ reason: 'rateLimitExceeded' }] } } };
    assert.deepEqual((await calendars(app)).json(), { error: 'rate_limited' });
    google.calendarFailure = null;
    assert.equal((await status(app)).status, 'connected');

    // Google odrzuca token odświeżania (cofnięta zgoda): „wymagane ponowne logowanie”, dane lokalne bez zmian.
    google.refresh = () => ({ status: 400, body: { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' } });
    await expireAccess(account.accountId);
    const revoked = await calendars(app);
    assert.deepEqual([revoked.statusCode, revoked.json().error], [409, 'reconnect_required']);
    assert.equal((await status(app)).status, 'reconnect_required');
    assert.deepEqual((await calendars(app)).json(), { error: 'reconnect_required' });
    const refreshesAfterRevoke = google.refreshCount();
    await assert.rejects(service.tokens.accessToken((await repository.getActiveAccount(scope.userId))!));
    assert.equal(google.refreshCount(), refreshesAfterRevoke, 'po odrzuceniu nie odpytujemy Google w kółko');
    // Zwykłe „Połącz” nie jest drogą naprawy (konto nadal jest przypisane); „Połącz ponownie” przywraca połączenie.
    assert.equal((await start(app, 'connect')).statusCode, 409);
    const again = (await start(app, 'reconnect')).json();
    google.grantCode('code-again', { sub: 'sub-1', email: 'student@example.test', refreshToken: '1//refresh-3', accessToken: 'ya29.again' });
    assert.equal((await callback(app, { state: stateOf(again), code: 'code-again' })).statusCode, 200);
    assert.equal((await status(app)).status, 'connected');
    assert.equal(cipher.decrypt((await tokenRow(scope)).refresh_token_enc, `${account.accountId}:refresh`), '1//refresh-3');
    assert.equal((await calendars(app)).statusCode, 200);
    assert.deepEqual(await localEvents(scope), eventsBefore);
  } finally {
    await app.close();
  }
}));
