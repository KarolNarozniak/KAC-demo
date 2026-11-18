// Testy z prawdziwą bazą: logowanie do KAC. Prawdziwe tokeny sesji w nagłówku Authorization (bez wstrzykiwania użytkownika),
// więc sprawdzają też ochronę wszystkich tras, izolację użytkowników, reset hasła kodem odzyskiwania, powrót z Google bez sesji
// i usunięcie konta z danymi.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test, { after } from 'node:test';
import type { FastifyInstance } from 'fastify';
import { buildApi } from '../src/app.js';
import { config } from '../src/config.js';
import { pool, PostgresCalendarRepository } from '../src/database.js';
import { recoveryCodeHash } from '../src/auth/password.js';
import { PostgresAuthRepository } from '../src/auth/repository.js';
import { AuthService, type AuthSettings } from '../src/auth/service.js';
import { PostgresGoogleIntegrationRepository } from '../src/integrations/google/repository.js';
import { GoogleIntegrationService } from '../src/integrations/google/service.js';
import { TokenCipher } from '../src/integrations/google/token-cipher.js';
import { FakeGoogle, OAUTH } from './google-integration-fakes.js';

const skip = !config.databaseUrl;
const PASSWORD = 'dluga-fraza-na-wiosne';
const emails = new Set<string>();

after(async () => {
  if (emails.size) {
    const users = (await pool!.query('select id_uzytkownika from t_uzytkownicy where lower(email) = any($1::text[])', [[...emails]])).rows.map((row) => row.id_uzytkownika);
    await pool!.query('delete from t_publikacje where id_uzytkownika = any($1::text[])', [users]);
    await pool!.query('delete from t_event_outbox where id_uzytkownika = any($1::text[])', [users]);
    await pool!.query('delete from t_uzytkownicy where id_uzytkownika = any($1::text[])', [users]);
  }
  await pool?.end();
});

const email = (name: string) => { const value = `${name}-${Date.now()}-${randomBytes(3).toString('hex')}@example.test`; emails.add(value); return value; };

function api(input: { settings?: Partial<AuthSettings>; google?: GoogleIntegrationService; loginPerMinute?: number } = {}) {
  const google = input.google ?? new GoogleIntegrationService(new PostgresGoogleIntegrationRepository(pool!), { oauth: null, cipher: null, sync: { sleep: async () => {} } });
  const auth = new AuthService(new PostgresAuthRepository(pool!), input.settings, (scope) => google.disconnect(scope));
  return buildApi(new PostgresCalendarRepository(pool!), [], { auth, googleIntegration: google,
    authRateLimits: { loginPerMinute: input.loginPerMinute ?? 1000, registerPerHour: 1000, sensitivePerQuarter: 1000 } });
}
const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
async function register(app: FastifyInstance, address = email('anna'), extra: Record<string, unknown> = {}) {
  const response = await app.inject({ method: 'POST', url: '/api/v1/auth/register', payload: { email: address, password: PASSWORD, firstName: 'Anna', lastName: 'Nowak', client: 'web', ...extra } });
  assert.equal(response.statusCode, 201, response.body);
  return response.json() as { token: string; recoveryCode: string; user: { id: string; email: string; hasRecoveryCode: boolean } };
}
const login = (app: FastifyInstance, address: string, password = PASSWORD) =>
  app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: address, password, client: 'android' } });
const recover = (app: FastifyInstance, address: string, recoveryCode: string, newPassword = NEW_PASSWORD) =>
  app.inject({ method: 'POST', url: '/api/v1/auth/recover', payload: { email: address, recoveryCode, newPassword, client: 'ios' } });
const NEW_PASSWORD = 'nowa-fraza-na-lato';
const CODE_FORMAT = /^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){3}$/;
const event = (title: string, day = '2035-04-02') => ({ title, start: `${day}T10:00`, end: `${day}T11:00`, category: 'Personal', location: '', mandatory: false, repeatWeekly: false });

test('rejestracja zakłada konto z kalendarzem i sesją; bez tokenu chronione trasy dają 401; wylogowanie działa od razu', { skip }, async () => {
  const app = api();
  try {
    const address = email('Anna.Nowak');
    const created = await register(app, address.toUpperCase());
    assert.equal(created.user.email, address.toLowerCase());
    const calendar = await pool!.query(`select nazwa, aktywny from t_kalendarze where id_uzytkownika = $1`, [created.user.id]);
    assert.deepEqual(calendar.rows, [{ nazwa: 'Mój kalendarz', aktywny: true }]);
    // Pusty profil pracy (bez godzin i stawki) – formularz „Profil pracy”, blokady i grafik mają co wczytać i zapisać.
    const profile = await pool!.query('select min_godzin_tydzien, cel_godzin_tydzien, stawka_pln, czas_dojazdu_min from t_profile_pracy where id_uzytkownika = $1 and aktywny', [created.user.id]);
    assert.deepEqual(profile.rows, [{ min_godzin_tydzien: null, cel_godzin_tydzien: null, stawka_pln: null, czas_dojazdu_min: 0 }]);
    const stored = await pool!.query(`select token_hash, urzadzenie from t_sesje where id_uzytkownika = $1`, [created.user.id]);
    assert.notEqual(stored.rows[0].token_hash, created.token);
    assert.match(stored.rows[0].urzadzenie, /^web/);

    for (const url of ['/api/v1/calendar/overview', '/api/v1/auth/me', '/api/v1/integrations/google', '/api/v1/schedules']) {
      const anonymous = await app.inject({ method: 'GET', url });
      assert.deepEqual([anonymous.statusCode, anonymous.json()], [401, { error: 'unauthorized' }], url);
      assert.equal((await app.inject({ method: 'GET', url, headers: bearer('zly-token') })).statusCode, 401, url);
    }
    assert.equal((await app.inject({ method: 'GET', url: '/api/v1/health/live' })).statusCode, 200);
    const config = (await app.inject({ method: 'GET', url: '/api/v1/auth/config' })).json();
    assert.equal(config.registration, 'open');

    const me = await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: bearer(created.token) });
    assert.deepEqual([me.statusCode, me.json().email], [200, address.toLowerCase()]);
    const overview = await app.inject({ method: 'GET', url: '/api/v1/calendar/overview', headers: bearer(created.token) });
    assert.deepEqual([overview.statusCode, overview.json().events], [200, []]);

    assert.equal((await app.inject({ method: 'POST', url: '/api/v1/auth/logout', headers: bearer(created.token) })).statusCode, 200);
    assert.equal((await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: bearer(created.token) })).statusCode, 401);
    const relogin = await login(app, address);
    assert.equal(relogin.statusCode, 200);
    assert.equal((await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: bearer(relogin.json().token) })).statusCode, 200);
  } finally { await app.close(); }
});

test('rejestracja: zajęty adres (bez względu na wielkość liter), słabe hasło, zły e-mail, tryby invite i closed', { skip }, async () => {
  const app = api();
  try {
    const address = email('jan');
    await register(app, address);
    const taken = await app.inject({ method: 'POST', url: '/api/v1/auth/register', payload: { email: address.toUpperCase(), password: PASSWORD, firstName: 'Jan' } });
    assert.deepEqual([taken.statusCode, taken.json()], [409, { error: 'email_taken' }]);
    for (const [password, code] of [['krotkie', 'password_too_short'], ['qwertyuiopas', 'password_too_common']]) {
      const weak = await app.inject({ method: 'POST', url: '/api/v1/auth/register', payload: { email: email('slabe'), password, firstName: 'Jan' } });
      assert.deepEqual([weak.statusCode, weak.json()], [400, { error: code }]);
    }
    const badEmail = await app.inject({ method: 'POST', url: '/api/v1/auth/register', payload: { email: 'bez-malpy', password: PASSWORD, firstName: 'Jan' } });
    assert.deepEqual(badEmail.json(), { error: 'invalid_email' });
    const badZone = await app.inject({ method: 'POST', url: '/api/v1/auth/register', payload: { email: email('strefa'), password: PASSWORD, firstName: 'Jan', timeZone: 'Mars/Olympus' } });
    assert.deepEqual(badZone.json(), { error: 'invalid_time_zone' });
  } finally { await app.close(); }

  const invite = api({ settings: { registration: 'invite', inviteCode: 'kod-zespolu-2026' } });
  try {
    assert.equal((await invite.inject({ method: 'GET', url: '/api/v1/auth/config' })).json().registration, 'invite');
    const wrong = await invite.inject({ method: 'POST', url: '/api/v1/auth/register', payload: { email: email('zaproszenie'), password: PASSWORD, firstName: 'Ola', inviteCode: 'zly-kod' } });
    assert.deepEqual([wrong.statusCode, wrong.json()], [403, { error: 'invalid_invite_code' }]);
    await register(invite, email('zaproszenie'), { inviteCode: 'kod-zespolu-2026' });
  } finally { await invite.close(); }

  const closed = api({ settings: { registration: 'closed' } });
  try {
    assert.equal((await closed.inject({ method: 'GET', url: '/api/v1/auth/config' })).json().registration, 'closed');
    const refused = await closed.inject({ method: 'POST', url: '/api/v1/auth/register', payload: { email: email('zamknieta'), password: PASSWORD, firstName: 'Ola' } });
    assert.deepEqual([refused.statusCode, refused.json()], [403, { error: 'registration_closed' }]);
  } finally { await closed.close(); }
});

test('logowanie: ten sam komunikat dla złego hasła i nieznanego adresu, blokada po serii błędów, limit żądań z adresu IP', { skip }, async () => {
  const app = api({ settings: { lockAfterFailures: 3, lockMinutes: 15 } });
  try {
    const address = email('blokada');
    const { user } = await register(app, address);
    const unknown = await login(app, email('nieznany'));
    const wrong = await login(app, address, 'zla-fraza-na-wiosne');
    assert.deepEqual([unknown.statusCode, unknown.json(), wrong.statusCode, wrong.json()], [401, { error: 'invalid_credentials' }, 401, { error: 'invalid_credentials' }]);
    await login(app, address, 'zla-fraza-na-wiosne');
    const locked = await login(app, address, 'zla-fraza-na-wiosne');
    assert.deepEqual([locked.statusCode, locked.json()], [429, { error: 'too_many_attempts' }]);
    // Zablokowane konto nie wpuszcza nawet z dobrym hasłem; po upływie blokady logowanie działa i zeruje licznik.
    assert.equal((await login(app, address)).statusCode, 429);
    await pool!.query(`update t_dane_logowania set zablokowane_do = now() - interval '1 minute' where id_uzytkownika = $1`, [user.id]);
    assert.equal((await login(app, address)).statusCode, 200);
    assert.deepEqual((await pool!.query('select nieudane_proby, zablokowane_do from t_dane_logowania where id_uzytkownika = $1', [user.id])).rows[0],
      { nieudane_proby: 0, zablokowane_do: null });
  } finally { await app.close(); }

  const limited = api({ loginPerMinute: 2 });
  try {
    const address = email('limit');
    await register(limited, address);
    await login(limited, address); await login(limited, address);
    const third = await login(limited, address);
    assert.deepEqual([third.statusCode, third.json()], [429, { error: 'too_many_attempts' }]);
  } finally { await limited.close(); }
});

test('zmiana hasła: wymaga obecnego hasła (403 bez wylogowania), wylogowuje inne urządzenia, bieżące zostaje', { skip }, async () => {
  const app = api();
  try {
    const address = email('haslo');
    const web = await register(app, address);
    const phone = (await login(app, address)).json();
    const wrong = await app.inject({ method: 'POST', url: '/api/v1/auth/change-password', headers: bearer(web.token), payload: { currentPassword: 'zla-fraza-na-wiosne', newPassword: 'nowa-fraza-na-lato' } });
    assert.deepEqual([wrong.statusCode, wrong.json()], [403, { error: 'invalid_password' }]);
    const same = await app.inject({ method: 'POST', url: '/api/v1/auth/change-password', headers: bearer(web.token), payload: { currentPassword: PASSWORD, newPassword: PASSWORD } });
    assert.deepEqual(same.json(), { error: 'password_unchanged' });
    const changed = await app.inject({ method: 'POST', url: '/api/v1/auth/change-password', headers: bearer(web.token), payload: { currentPassword: PASSWORD, newPassword: 'nowa-fraza-na-lato' } });
    assert.deepEqual([changed.statusCode, changed.json()], [200, { otherSessionsRevoked: 1 }]);
    assert.equal((await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: bearer(web.token) })).statusCode, 200);
    assert.equal((await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: bearer(phone.token) })).statusCode, 401);
    assert.equal((await login(app, address)).statusCode, 401);
    assert.equal((await login(app, address, 'nowa-fraza-na-lato')).statusCode, 200);
  } finally { await app.close(); }
});

test('kod odzyskiwania: rejestracja go pokazuje, reset ustawia nowe hasło mimo blokady, wylogowuje wszystkie urządzenia i wymienia kod', { skip }, async () => {
  const app = api({ settings: { lockAfterFailures: 3, lockMinutes: 15 } });
  try {
    const address = email('odzyskiwanie');
    const web = await register(app, address);
    assert.match(web.recoveryCode, CODE_FORMAT);
    assert.equal(web.user.hasRecoveryCode, true);
    // W bazie tylko skrót kodu.
    const stored = (await pool!.query('select kod_odzyskiwania_hash from t_dane_logowania where id_uzytkownika = $1', [web.user.id])).rows[0].kod_odzyskiwania_hash;
    assert.equal(stored, recoveryCodeHash(web.recoveryCode));
    assert.ok(!stored.includes(web.recoveryCode.replaceAll('-', '')));
    const phone = (await login(app, address)).json();
    assert.equal(phone.user.hasRecoveryCode, true);
    assert.equal(phone.recoveryCode, undefined);

    // Zapomniane hasło: seria błędnych logowań blokuje konto.
    for (let attempt = 0; attempt < 3; attempt++) await login(app, address, 'chyba-taka-fraza');
    assert.equal((await login(app, address)).statusCode, 429);

    // Zły kod, nieznany adres i konto bez kodu – ten sam błąd; słabe nowe hasło odrzucone bez zużycia kodu.
    const wrongCode = await recover(app, address, 'M4ZT-0QB8-XK2N-7VHD');
    const unknown = await recover(app, email('nieznany'), web.recoveryCode);
    const garbage = await recover(app, address, 'to-nie-jest-kod');
    for (const response of [wrongCode, unknown, garbage]) assert.deepEqual([response.statusCode, response.json()], [401, { error: 'invalid_recovery_code' }]);
    const weak = await recover(app, address, web.recoveryCode, 'krotkie');
    assert.deepEqual([weak.statusCode, weak.json()], [400, { error: 'password_too_short' }]);
    // To samo hasło co obecne – odrzucone, kod nie zużyty, sesje i blokada bez zmian.
    const same = await recover(app, address, web.recoveryCode, PASSWORD);
    assert.deepEqual([same.statusCode, same.json()], [400, { error: 'password_unchanged' }]);
    assert.equal((await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: bearer(phone.token) })).statusCode, 200);

    // Kod wpisany małymi literami i ze spacjami.
    const typed = web.recoveryCode.toLowerCase().replaceAll('-', ' ');
    const recovered = await recover(app, address, typed);
    assert.equal(recovered.statusCode, 200, recovered.body);
    const body = recovered.json();
    assert.match(body.recoveryCode, CODE_FORMAT);
    assert.notEqual(body.recoveryCode, web.recoveryCode);
    assert.deepEqual([body.user.email, body.user.hasRecoveryCode], [address, true]);

    // Wszystkie wcześniejsze sesje unieważnione, nowa działa.
    for (const token of [web.token, phone.token]) assert.equal((await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: bearer(token) })).statusCode, 401);
    assert.equal((await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: bearer(body.token) })).statusCode, 200);
    const reasons = await pool!.query(`select powod_uniewaznienia, count(*)::int as n from t_sesje where id_uzytkownika = $1 group by 1 order by 1 nulls last`, [web.user.id]);
    assert.deepEqual(reasons.rows, [{ powod_uniewaznienia: 'reset_hasla', n: 2 }, { powod_uniewaznienia: null, n: 1 }]);
    const device = await pool!.query('select urzadzenie from t_sesje where id_uzytkownika = $1 and uniewazniono_at is null', [web.user.id]);
    assert.match(device.rows[0].urzadzenie, /^ios/);

    // Blokada zdjęta, stare hasło nie działa, nowe tak; zużyty kod już nie działa, nowy tak.
    assert.deepEqual((await pool!.query('select nieudane_proby, zablokowane_do from t_dane_logowania where id_uzytkownika = $1', [web.user.id])).rows[0],
      { nieudane_proby: 0, zablokowane_do: null });
    assert.equal((await login(app, address)).statusCode, 401);
    assert.equal((await login(app, address, NEW_PASSWORD)).statusCode, 200);
    assert.deepEqual((await recover(app, address, web.recoveryCode, 'trzecia-fraza-na-jesien')).json(), { error: 'invalid_recovery_code' });
    assert.equal((await recover(app, address, body.recoveryCode, 'trzecia-fraza-na-jesien')).statusCode, 200);
  } finally { await app.close(); }
});

test('nowy kod odzyskiwania: wymaga hasła i sesji, unieważnia poprzedni; konto bez kodu (po administratorze); ten sam kod użyty dwa razy naraz', { skip }, async () => {
  const app = api();
  try {
    const address = email('nowykod');
    const created = await register(app, address);
    const newCode = (password: string, token = created.token) =>
      app.inject({ method: 'POST', url: '/api/v1/auth/recovery-code', headers: bearer(token), payload: { password } });

    assert.deepEqual((await app.inject({ method: 'POST', url: '/api/v1/auth/recovery-code', payload: { password: PASSWORD } })).json(), { error: 'unauthorized' });
    const wrong = await newCode('zla-fraza-na-wiosne');
    assert.deepEqual([wrong.statusCode, wrong.json()], [403, { error: 'invalid_password' }]);
    // Złe hasło nie wylogowuje i nie zmienia kodu.
    assert.equal((await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: bearer(created.token) })).statusCode, 200);
    const second = await newCode(PASSWORD);
    assert.equal(second.statusCode, 200);
    const code = second.json().recoveryCode;
    assert.match(code, CODE_FORMAT);
    assert.deepEqual((await recover(app, address, created.recoveryCode)).json(), { error: 'invalid_recovery_code' });

    // Administrator ustawił hasło (scripts/set-password.ts unieważnia kod): konto bez kodu, kod nie działa.
    await new PostgresAuthRepository(pool!).setRecoveryCode(created.user.id, null);
    const me = await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: bearer(created.token) });
    assert.equal(me.json().hasRecoveryCode, false);
    assert.deepEqual((await recover(app, address, code)).json(), { error: 'invalid_recovery_code' });

    // Nowy kod w Ustawieniach, potem dwa równoczesne użycia tego samego kodu: wygrywa jedno.
    const third = (await newCode(PASSWORD)).json().recoveryCode;
    assert.equal((await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: bearer(created.token) })).json().hasRecoveryCode, true);
    const results = await Promise.all([recover(app, address, third, 'pierwsza-fraza-na-lato'), recover(app, address, third, 'druga-fraza-na-lato')]);
    assert.deepEqual(results.map((response) => response.statusCode).sort(), [200, 401]);
    const winner = results.find((response) => response.statusCode === 200)!.json();
    assert.equal((await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: bearer(winner.token) })).statusCode, 200);
    assert.equal((await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: bearer(created.token) })).statusCode, 401);
  } finally { await app.close(); }
});

test('izolacja: drugi użytkownik nie widzi ani nie zmienia cudzych wydarzeń, połączenia Google i prób logowania', { skip }, async () => {
  const app = api();
  try {
    const anna = await register(app, email('anna'));
    const piotr = await register(app, email('piotr'));
    const saved = await app.inject({ method: 'POST', url: '/api/v1/calendar/events', headers: bearer(anna.token), payload: event('Spotkanie Anny') });
    assert.equal(saved.statusCode, 201, saved.body);
    const id = saved.json().id;
    const piotrView = (await app.inject({ method: 'GET', url: '/api/v1/calendar/overview', headers: bearer(piotr.token) })).json();
    assert.equal(piotrView.events.some((item: { id: string }) => item.id === id), false);
    assert.equal((await app.inject({ method: 'PUT', url: `/api/v1/calendar/events/${id}`, headers: bearer(piotr.token), payload: event('Przejęte') })).statusCode, 404);
    assert.equal((await app.inject({ method: 'DELETE', url: `/api/v1/calendar/events/${id}`, headers: bearer(piotr.token) })).statusCode, 404);
    assert.equal((await app.inject({ method: 'GET', url: '/api/v1/calendar/overview', headers: bearer(anna.token) })).json().events.length, 1);

    const started = (await app.inject({ method: 'POST', url: '/api/v1/integrations/google/connect', headers: bearer(anna.token), payload: {} })).json();
    assert.equal((await app.inject({ method: 'GET', url: `/api/v1/integrations/google/attempts/${started.attemptId}`, headers: bearer(piotr.token) })).statusCode, 404);
    const consent = await app.inject({ method: 'POST', url: `/api/v1/integrations/google/attempts/${started.attemptId}/demo-consent`, headers: bearer(piotr.token),
      payload: { allow: true, account: 'student.kac.demo@gmail.com' } });
    assert.equal(consent.statusCode, 404);
    await app.inject({ method: 'POST', url: `/api/v1/integrations/google/attempts/${started.attemptId}/demo-consent`, headers: bearer(anna.token),
      payload: { allow: true, account: 'student.kac.demo@gmail.com' } });
    assert.equal((await app.inject({ method: 'GET', url: '/api/v1/integrations/google', headers: bearer(anna.token) })).json().status, 'connected');
    assert.equal((await app.inject({ method: 'GET', url: '/api/v1/integrations/google', headers: bearer(piotr.token) })).json().status, 'not_connected');
    // Konto demonstracyjne Google jest wspólne – drugi użytkownik KAC też może je połączyć.
    const piotrStart = (await app.inject({ method: 'POST', url: '/api/v1/integrations/google/connect', headers: bearer(piotr.token), payload: {} })).json();
    await app.inject({ method: 'POST', url: `/api/v1/integrations/google/attempts/${piotrStart.attemptId}/demo-consent`, headers: bearer(piotr.token),
      payload: { allow: true, account: 'student.kac.demo@gmail.com' } });
    assert.equal((await app.inject({ method: 'GET', url: '/api/v1/integrations/google', headers: bearer(piotr.token) })).json().status, 'connected');
  } finally { await app.close(); }
});

test('powrót z Google bez sesji KAC łączy konto właściciela próby; to samo konto Google nie połączy się z drugim kontem KAC', { skip }, async () => {
  const google = new FakeGoogle();
  const service = new GoogleIntegrationService(new PostgresGoogleIntegrationRepository(pool!), {
    oauth: OAUTH, cipher: new TokenCipher(randomBytes(32)), fetch: google.fetch, sync: { sleep: async () => {} } });
  const app = api({ google: service });
  try {
    const anna = await register(app, email('anna-google'));
    const piotr = await register(app, email('piotr-google'));
    const sub = `sub-wspolne-${randomBytes(4).toString('hex')}`;
    const connect = async (token: string, code: string) => {
      const started = (await app.inject({ method: 'POST', url: '/api/v1/integrations/google/connect', headers: bearer(token), payload: {} })).json();
      google.grantCode(code, { sub, email: 'wspolne@example.test', refreshToken: `1//${code}` });
      const state = new URL(started.authUrl).searchParams.get('state');
      // Bez nagłówka Authorization – tak jak przeglądarka wracająca ze strony zgody Google.
      const callback = await app.inject({ method: 'GET', url: `/api/v1/integrations/google/callback?state=${state}&code=${code}` });
      return { started, callback };
    };
    const first = await connect(anna.token, 'code-anna');
    assert.equal(first.callback.statusCode, 200, first.callback.body);
    assert.equal((await app.inject({ method: 'GET', url: '/api/v1/integrations/google', headers: bearer(anna.token) })).json().account.email, 'wspolne@example.test');

    const second = await connect(piotr.token, 'code-piotr');
    assert.equal(second.callback.statusCode, 409);
    assert.match(second.callback.body, /już połączone z innym kontem KAC/);
    const attempt = (await app.inject({ method: 'GET', url: `/api/v1/integrations/google/attempts/${second.started.attemptId}`, headers: bearer(piotr.token) })).json();
    assert.deepEqual([attempt.status, attempt.errorCode], ['error', 'google_account_in_use']);
    assert.equal((await app.inject({ method: 'GET', url: '/api/v1/integrations/google', headers: bearer(piotr.token) })).json().status, 'not_connected');

    // Po odłączeniu u Anny to konto Google może połączyć Piotr.
    assert.equal((await app.inject({ method: 'DELETE', url: '/api/v1/integrations/google', headers: bearer(anna.token) })).statusCode, 200);
    assert.equal((await connect(piotr.token, 'code-piotr-2')).callback.statusCode, 200);
  } finally { await app.close(); }
});

test('usunięcie konta: wymaga hasła, cofa połączenie Google i usuwa wszystkie dane – także publikacje grafiku', { skip }, async () => {
  const app = api();
  try {
    const address = email('usun');
    const { token, user } = await register(app, address);
    const calendarId = (await pool!.query('select id_kalendarza from t_kalendarze where id_uzytkownika = $1', [user.id])).rows[0].id_kalendarza;
    assert.equal((await app.inject({ method: 'POST', url: '/api/v1/calendar/events', headers: bearer(token), payload: event('Prywatne') })).statusCode, 201);
    const started = (await app.inject({ method: 'POST', url: '/api/v1/integrations/google/connect', headers: bearer(token), payload: {} })).json();
    await app.inject({ method: 'POST', url: `/api/v1/integrations/google/attempts/${started.attemptId}/demo-consent`, headers: bearer(token), payload: { allow: true, account: 'student.kac.demo@gmail.com' } });
    const selection = (await app.inject({ method: 'GET', url: '/api/v1/integrations/google/calendar-selection', headers: bearer(token) })).json();
    await app.inject({ method: 'PUT', url: '/api/v1/integrations/google/calendar-selection', headers: bearer(token),
      payload: { version: selection.version, sourceCalendarIds: [], publicationTargetCalendarId: 'grafik-pracy' } });
    const profile = await pool!.query('select id_profilu from t_profile_pracy where id_uzytkownika = $1 and aktywny', [user.id]);
    const schedule = await pool!.query(`insert into t_grafiki (id_profilu, id_kalendarza, tydzien_od, tydzien_do, status, cel_godzin, version, approved_at)
      values ($1, $2, '2035-03-05'::date, '2035-03-11'::date, 'accepted', 5, 1, now()) returning id_grafiku`, [profile.rows[0].id_profilu, calendarId]);
    const shift = await pool!.query(`insert into t_wydarzenia (id_kalendarza, id_kategorii, tytul, rozpoczecie, zakonczenie, zrodlo)
      values ($1, 'CAT03', 'Zmiana pracy', '2035-03-05T08:00:00Z', '2035-03-05T13:00:00Z', 'Plan pracy') returning id_wydarzenia`, [calendarId]);
    await pool!.query(`insert into t_zmiany_pracy (id_grafiku, id_wydarzenia, rozpoczecie, zakonczenie, godziny, stawka_pln, wynagrodzenie_pln, status)
      values ($1, $2, '2035-03-05T08:00:00Z', '2035-03-05T13:00:00Z', 5, 30, 150, 'Zatwierdzona')`, [schedule.rows[0].id_grafiku, shift.rows[0].id_wydarzenia]);
    const published = await app.inject({ method: 'POST', url: '/api/v1/integrations/google/publications/2035-03-05', headers: bearer(token), payload: { expectedVersion: 1 } });
    assert.equal(published.json().attempt.status, 'success', published.body);

    const wrong = await app.inject({ method: 'DELETE', url: '/api/v1/auth/account', headers: bearer(token), payload: { password: 'zla-fraza-na-wiosne' } });
    assert.deepEqual([wrong.statusCode, wrong.json()], [403, { error: 'invalid_password' }]);
    const deleted = await app.inject({ method: 'DELETE', url: '/api/v1/auth/account', headers: bearer(token), payload: { password: PASSWORD } });
    assert.deepEqual([deleted.statusCode, deleted.json()], [200, { deleted: true }], deleted.body);

    for (const [table, column] of [['t_uzytkownicy', 'id_uzytkownika'], ['t_kalendarze', 'id_uzytkownika'], ['t_konta_google', 'id_uzytkownika'], ['t_publikacje', 'id_uzytkownika'],
      ['t_sesje', 'id_uzytkownika'], ['t_dane_logowania', 'id_uzytkownika'], ['t_event_outbox', 'id_uzytkownika'], ['t_profile_pracy', 'id_uzytkownika']])
      assert.equal((await pool!.query(`select 1 from ${table} where ${column} = $1`, [user.id])).rowCount, 0, table);
    assert.equal((await pool!.query('select 1 from t_wydarzenia where id_kalendarza = $1', [calendarId])).rowCount, 0);
    assert.equal((await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: bearer(token) })).statusCode, 401);
    assert.equal((await login(app, address)).statusCode, 401);
  } finally { await app.close(); }
});
