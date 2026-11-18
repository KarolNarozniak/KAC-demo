// Logowanie do KAC: konfiguracja rejestracji, rejestracja, logowanie, reset hasła kodem odzyskiwania, wylogowanie, bieżący użytkownik,
// nowy kod odzyskiwania, zmiana hasła i usunięcie konta.
// Publiczne są tylko config, register, login i recover (lista w api/auth-guard.ts); reszta wymaga sesji.
// Limity żądań na adres IP chronią przed zgadywaniem haseł i kodów; dodatkowo konto blokuje się po 10 nieudanych logowaniach (auth/service.ts).
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '../../../auth/password.js';
import { AuthError, type AuthService } from '../../../auth/service.js';
import { documented, errorExamples, withExamples } from '../../examples.js';

export type AuthRateLimits = { loginPerMinute: number; registerPerHour: number; sensitivePerQuarter: number };
export const DEFAULT_AUTH_RATE_LIMITS: AuthRateLimits = { loginPerMinute: 10, registerPerHour: 5, sensitivePerQuarter: 10 };

const user = { type: 'object', additionalProperties: false, required: ['id', 'email', 'firstName', 'lastName', 'timeZone', 'hasRecoveryCode'], properties: {
  id: { type: 'string' }, email: { type: 'string' }, firstName: { type: 'string' }, lastName: { type: 'string' }, timeZone: { type: 'string' },
  hasRecoveryCode: { type: 'boolean', description: 'Czy konto ma kod odzyskiwania. Bez kodu zapomniane hasło ustawi tylko administrator – nowy kod tworzy POST /auth/recovery-code.' },
} } as const;
const sessionProperties = {
  user, token: { type: 'string', description: 'Token sesji do nagłówka Authorization: Bearer. Pokazywany tylko raz – serwer przechowuje wyłącznie jego skrót.' },
  expiresAt: { type: 'string', format: 'date-time', description: 'Najpóźniejszy koniec sesji (90 dni od zalogowania); wcześniej kończy ją 30 dni bez użycia.' },
} as const;
const sessionResponse = { type: 'object', additionalProperties: false, required: ['user', 'token', 'expiresAt'], properties: sessionProperties } as const;
const recoveryCodeProperty = { type: 'string', description: 'Jednorazowy kod odzyskiwania (16 znaków w grupach po 4). Pokazywany tylko raz – serwer przechowuje wyłącznie jego skrót; poprzedni kod przestał działać.' } as const;
const sessionWithCodeResponse = { type: 'object', additionalProperties: false, required: ['user', 'token', 'expiresAt', 'recoveryCode'],
  properties: { ...sessionProperties, recoveryCode: recoveryCodeProperty } } as const;
const exampleUser = { id: 'f3c1d0a2-5b7e-4c1a-9d2e-6a8b1c2d3e4f', email: 'anna.nowak@example.test', firstName: 'Anna', lastName: 'Nowak', timeZone: 'Europe/Warsaw', hasRecoveryCode: true };
const exampleSession = { user: exampleUser, token: 'kac-example-session-token-not-real', expiresAt: '2027-02-16T09:30:00.000Z' };
const exampleRecoveryCode = '7F3Q-9XWM-2HDA-K8PR';
const client = { type: 'string', maxLength: 20, description: 'Rodzaj aplikacji (np. web, android, ios) – opis sesji na liście urządzeń.' } as const;
const password = { type: 'string', minLength: 1, maxLength: PASSWORD_MAX_LENGTH } as const;

const tooMany = errorExamples('Za dużo prób – limit żądań z tego adresu albo czasowa blokada konta.', {
  too_many_attempts: ['Za dużo prób', 'Po 10 nieudanych logowaniach konto jest blokowane na 15 minut; niezależnie od tego obowiązuje limit żądań z jednego adresu IP. Spróbuj ponownie później.'],
});
const notConfigured = errorExamples('Logowanie wymaga bazy danych.', {
  auth_not_configured: ['Logowanie niedostępne', 'API działa bez skonfigurowanej bazy danych (brak DATABASE_URL), więc nie ma kont ani sesji.'],
});
const weakPassword: Record<string, [string, string]> = {
  password_too_short: ['Hasło za krótkie', `Hasło musi mieć co najmniej ${PASSWORD_MIN_LENGTH} znaków. Długość chroni lepiej niż wymóg cyfr i znaków specjalnych.`],
  password_too_long: ['Hasło za długie', `Hasło może mieć najwyżej ${PASSWORD_MAX_LENGTH} znaków.`],
  password_too_common: ['Hasło zbyt oczywiste', 'Hasło jest na liście popularnych haseł albo składa się z powtórzeń lub ciągu klawiszy.'],
  password_contains_email: ['Hasło zawiera adres e-mail', 'Hasło nie może zawierać nazwy z adresu e-mail.'],
};

export async function authRoutes(app: FastifyInstance, options: { auth: AuthService | null; limits?: Partial<AuthRateLimits> }) {
  const auth = options.auth;
  const limits = { ...DEFAULT_AUTH_RATE_LIMITS, ...options.limits };

  // Własne odpowiedzi błędów w tej grupie tras: AuthError → jego kod, limit żądań → too_many_attempts; reszta (np. walidacja) bez zmian.
  app.setErrorHandler((error: { statusCode?: number }, request, reply) => {
    if (error instanceof AuthError) return reply.code(error.status).send({ error: error.code });
    if (error.statusCode === 429) return reply.code(429).send({ error: 'too_many_attempts' });
    return reply.send(error);
  });

  const sessionOf = (request: FastifyRequest) => request.authSession!;
  const unavailable = (reply: FastifyReply) => reply.code(503).send({ error: 'auth_not_configured' });

  app.get('/auth/config', { schema: {
    tags: ['Auth'], summary: 'Registration settings', operationId: 'getAuthConfig',
    description: 'Public settings for the sign-up screen: whether registration is open, needs an invite code or is closed, and the password length rules.',
    response: {
      200: documented({ type: 'object', additionalProperties: false, required: ['registration', 'passwordMinLength', 'passwordMaxLength'], properties: {
        registration: { type: 'string', enum: ['open', 'invite', 'closed'] }, passwordMinLength: { type: 'integer' }, passwordMaxLength: { type: 'integer' },
      } }, 'Ustawienia rejestracji.', {
        open: { summary: 'Rejestracja otwarta', description: 'Każdy może założyć konto (np. lokalnie).', value: { registration: 'open', passwordMinLength: PASSWORD_MIN_LENGTH, passwordMaxLength: PASSWORD_MAX_LENGTH } },
        invite: { summary: 'Rejestracja z kodem zaproszenia', description: 'Formularz pokazuje pole na kod zaproszenia (REGISTRATION_MODE=invite).', value: { registration: 'invite', passwordMinLength: PASSWORD_MIN_LENGTH, passwordMaxLength: PASSWORD_MAX_LENGTH } },
      }),
      503: notConfigured,
    },
  } }, async (_request, reply) => (auth ? auth.publicConfig() : unavailable(reply)));

  app.post<{ Body: { email: string; password: string; firstName: string; lastName?: string; timeZone?: string; inviteCode?: string; client?: string } }>('/auth/register', {
    config: { rateLimit: { max: limits.registerPerHour, timeWindow: '1 hour' } },
    schema: {
      tags: ['Auth'], summary: 'Create an account', operationId: 'register',
      description: `Creates a KAC account (e-mail and password, at least ${PASSWORD_MIN_LENGTH} characters), its own calendar and a signed-in session. The response carries a one-time recovery code shown only once – it sets a new password when the old one is forgotten. Google is not needed to use KAC – a Google account is connected later only for Google Calendar.`,
      body: withExamples({ type: 'object', additionalProperties: false, required: ['email', 'password', 'firstName'], properties: {
        email: { type: 'string', maxLength: 254 }, password, firstName: { type: 'string', maxLength: 60 }, lastName: { type: 'string', maxLength: 80 },
        timeZone: { type: 'string', maxLength: 64, description: 'Strefa IANA, domyślnie Europe/Warsaw.' }, inviteCode: { type: 'string', maxLength: 200 }, client,
      } }, {
        register: { summary: 'Nowe konto', value: { email: 'anna.nowak@example.test', password: 'dluga-fraza-na-wiosne', firstName: 'Anna', lastName: 'Nowak', timeZone: 'Europe/Warsaw', client: 'web' } },
        invite: { summary: 'Rejestracja z kodem zaproszenia', value: { email: 'jan.kowalski@example.test', password: 'trzy-slowa-i-rower', firstName: 'Jan', inviteCode: 'kod-od-zespolu', client: 'android' } },
      }),
      response: {
        201: documented(sessionWithCodeResponse, 'Konto utworzone i zalogowane.', { created: { summary: 'Konto utworzone',
          description: 'Token zapisuje aplikacja (na telefonie w bezpiecznym magazynie systemu). Kod odzyskiwania aplikacja pokazuje raz, z prośbą o zapisanie.',
          value: { ...exampleSession, recoveryCode: exampleRecoveryCode } } }),
        400: errorExamples('Niepoprawne dane albo słabe hasło. Nic nie zostało zapisane.', {
          invalid_email: ['Niepoprawny e-mail', 'Adres nie ma postaci nazwa@domena.'],
          invalid_name: ['Brak imienia', 'Imię jest wymagane (do 60 znaków), nazwisko jest opcjonalne.'],
          invalid_time_zone: ['Nieznana strefa czasowa', 'Strefa musi być nazwą IANA, np. Europe/Warsaw.'],
          ...weakPassword,
        }),
        403: errorExamples('Rejestracja wyłączona albo zły kod zaproszenia.', {
          registration_closed: ['Rejestracja wyłączona', 'Konta zakłada administrator (REGISTRATION_MODE=closed).'],
          invalid_invite_code: ['Zły kod zaproszenia', 'Rejestracja wymaga kodu zaproszenia od zespołu (REGISTRATION_MODE=invite).'],
        }),
        409: errorExamples('Adres e-mail ma już konto.', { email_taken: ['Konto już istnieje', 'Na ten adres jest już konto KAC – zaloguj się albo użyj innego adresu.'] }),
        429: tooMany, 503: notConfigured,
      },
    },
  }, async (request, reply) => {
    if (!auth) return unavailable(reply);
    return reply.code(201).send(await auth.register(request.body, request.headers['user-agent']));
  });

  app.post<{ Body: { email: string; password: string; client?: string } }>('/auth/login', {
    config: { rateLimit: { max: limits.loginPerMinute, timeWindow: '1 minute' } },
    schema: {
      tags: ['Auth'], summary: 'Sign in', operationId: 'login',
      description: 'Signs in with e-mail and password and returns a session token for the Authorization: Bearer header. A wrong e-mail and a wrong password give the same answer.',
      body: withExamples({ type: 'object', additionalProperties: false, required: ['email', 'password'], properties: { email: { type: 'string', maxLength: 254 }, password, client } }, {
        login: { summary: 'Logowanie', value: { email: 'anna.nowak@example.test', password: 'dluga-fraza-na-wiosne', client: 'web' } },
      }),
      response: {
        200: documented(sessionResponse, 'Zalogowano.', { signedIn: { summary: 'Zalogowano', value: exampleSession } }),
        401: errorExamples('Zły e-mail albo hasło.', { invalid_credentials: ['Nieprawidłowy e-mail lub hasło', 'Ten sam komunikat dla nieistniejącego konta i złego hasła – odpowiedź nie zdradza, czy adres ma konto.'] }),
        429: tooMany, 503: notConfigured,
      },
    },
  }, async (request, reply) => (auth ? auth.login(request.body, request.headers['user-agent']) : unavailable(reply)));

  app.post<{ Body: { email: string; recoveryCode: string; newPassword: string; client?: string } }>('/auth/recover', {
    config: { rateLimit: { max: limits.sensitivePerQuarter, timeWindow: '15 minutes' } },
    schema: {
      tags: ['Auth'], summary: 'Reset a forgotten password with the recovery code', operationId: 'recoverAccount',
      description: 'Sets a new password with the one-time recovery code shown at registration (no e-mail needed). Signs out every device, clears the lockout after failed sign-ins, signs in this device and returns a new recovery code – the used one stops working. A wrong e-mail, an account without a code and a wrong code give the same answer.',
      body: withExamples({ type: 'object', additionalProperties: false, required: ['email', 'recoveryCode', 'newPassword'], properties: {
        email: { type: 'string', maxLength: 254 },
        recoveryCode: { type: 'string', minLength: 1, maxLength: 64, description: 'Kod odzyskiwania; wielkość liter, spacje i myślniki nie mają znaczenia.' },
        newPassword: password, client,
      } }, {
        recover: { summary: 'Nowe hasło z kodem', value: { email: 'anna.nowak@example.test', recoveryCode: exampleRecoveryCode, newPassword: 'inna-dluga-fraza-na-lato', client: 'android' } },
      }),
      response: {
        200: documented(sessionWithCodeResponse, 'Nowe hasło ustawione i zalogowano.', { recovered: { summary: 'Hasło ustawione',
          description: 'Wszystkie wcześniejsze sesje zostały unieważnione. Aplikacja pokazuje nowy kod odzyskiwania z prośbą o zapisanie.',
          value: { ...exampleSession, recoveryCode: 'M4ZT-0QB8-XK2N-7VHD' } } }),
        400: errorExamples('Nowe hasło nie spełnia zasad albo jest takie jak obecne. Nic nie zostało zmienione, kod nadal działa.', {
          ...weakPassword, password_unchanged: ['To samo hasło', 'Nowe hasło jest takie jak obecne – wystarczy się nim zalogować. Kod odzyskiwania nie został zużyty.'] }),
        401: errorExamples('Zły e-mail albo kod odzyskiwania.', { invalid_recovery_code: ['Nieprawidłowy e-mail lub kod odzyskiwania',
          'Ten sam komunikat dla nieistniejącego konta, konta bez kodu i złego kodu. Kod jest jednorazowy – po użyciu działa tylko nowy.'] }),
        429: tooMany, 503: notConfigured,
      },
    },
  }, async (request, reply) => (auth ? auth.recover(request.body, request.headers['user-agent']) : unavailable(reply)));

  app.post('/auth/logout', { schema: {
    tags: ['Auth'], summary: 'Sign out', operationId: 'logout', description: 'Ends the current session immediately; the token stops working on every request.',
    response: { 200: documented({ type: 'object', additionalProperties: false, required: ['loggedOut'], properties: { loggedOut: { type: 'boolean' } } }, 'Wylogowano.', {
      loggedOut: { summary: 'Wylogowano', value: { loggedOut: true } } }), 503: notConfigured },
  } }, async (request, reply) => {
    if (!auth) return unavailable(reply);
    await auth.logout(sessionOf(request));
    return { loggedOut: true };
  });

  app.get('/auth/me', { schema: {
    tags: ['Auth'], summary: 'Current user', operationId: 'getCurrentUser', description: 'The signed-in user. The app calls it at start to check that the saved session still works.',
    response: { 200: documented(user, 'Zalogowany użytkownik.', { me: { summary: 'Zalogowany użytkownik', value: exampleUser } }),
      404: errorExamples('Konto usunięte.', { account_not_found: 'Konto nie istnieje' }), 503: notConfigured },
  } }, async (request, reply) => (auth ? auth.me(sessionOf(request)) : unavailable(reply)));

  app.post<{ Body: { password: string } }>('/auth/recovery-code', {
    config: { rateLimit: { max: limits.sensitivePerQuarter, timeWindow: '15 minutes' } },
    schema: {
      tags: ['Auth'], summary: 'New recovery code', operationId: 'newRecoveryCode',
      description: 'Creates a new one-time recovery code after checking the password – for a lost code or an account created before recovery codes. The previous code stops working.',
      body: withExamples({ type: 'object', additionalProperties: false, required: ['password'], properties: { password } }, {
        confirm: { summary: 'Potwierdzenie hasłem', value: { password: 'dluga-fraza-na-wiosne' } },
      }),
      response: {
        200: documented({ type: 'object', additionalProperties: false, required: ['recoveryCode'], properties: { recoveryCode: recoveryCodeProperty } }, 'Nowy kod odzyskiwania.', {
          created: { summary: 'Nowy kod', description: 'Aplikacja pokazuje kod raz, z prośbą o zapisanie.', value: { recoveryCode: exampleRecoveryCode } } }),
        403: errorExamples('Złe hasło.', { invalid_password: ['Złe hasło', 'Kod nie został zmieniony. To nie wylogowuje – sesja nadal działa.'] }),
        429: tooMany, 503: notConfigured,
      },
    },
  }, async (request, reply) => (auth ? auth.newRecoveryCode(sessionOf(request), request.body.password) : unavailable(reply)));

  app.post<{ Body: { currentPassword: string; newPassword: string } }>('/auth/change-password', {
    config: { rateLimit: { max: limits.sensitivePerQuarter, timeWindow: '15 minutes' } },
    schema: {
      tags: ['Auth'], summary: 'Change password', operationId: 'changePassword',
      description: 'Changes the password after checking the current one. Other devices are signed out; this one stays signed in.',
      body: withExamples({ type: 'object', additionalProperties: false, required: ['currentPassword', 'newPassword'], properties: { currentPassword: password, newPassword: password } }, {
        change: { summary: 'Nowe hasło', value: { currentPassword: 'dluga-fraza-na-wiosne', newPassword: 'inna-dluga-fraza-na-lato' } },
      }),
      response: {
        200: documented({ type: 'object', additionalProperties: false, required: ['otherSessionsRevoked'], properties: { otherSessionsRevoked: { type: 'integer' } } },
          'Hasło zmienione.', { changed: { summary: 'Hasło zmienione', description: 'Dwa inne urządzenia zostały wylogowane.', value: { otherSessionsRevoked: 2 } } }),
        400: errorExamples('Nowe hasło nie spełnia zasad.', { ...weakPassword, password_unchanged: ['To samo hasło', 'Nowe hasło musi się różnić od obecnego.'] }),
        403: errorExamples('Złe obecne hasło.', { invalid_password: ['Złe obecne hasło', 'Hasło nie zostało zmienione. To nie wylogowuje – sesja nadal działa.'] }),
        429: tooMany, 503: notConfigured,
      },
    },
  }, async (request, reply) => (auth ? auth.changePassword(sessionOf(request), request.body.currentPassword, request.body.newPassword) : unavailable(reply)));

  app.delete<{ Body: { password: string } }>('/auth/account', {
    config: { rateLimit: { max: limits.sensitivePerQuarter, timeWindow: '15 minutes' } },
    schema: {
      tags: ['Auth'], summary: 'Delete account', operationId: 'deleteAccount',
      description: 'Deletes the account and all its data (calendar, schedules, imports, assistant conversations, Google connection). The Google consent is revoked first (best effort). Requires the password. Cannot be undone.',
      body: withExamples({ type: 'object', additionalProperties: false, required: ['password'], properties: { password } }, {
        confirm: { summary: 'Potwierdzenie hasłem', value: { password: 'dluga-fraza-na-wiosne' } },
      }),
      response: {
        200: documented({ type: 'object', additionalProperties: false, required: ['deleted'], properties: { deleted: { type: 'boolean' } } }, 'Konto usunięte.', {
          deleted: { summary: 'Konto usunięte', description: 'Wszystkie dane użytkownika zostały usunięte, a sesje unieważnione.', value: { deleted: true } } }),
        403: errorExamples('Złe hasło.', { invalid_password: ['Złe hasło', 'Konto nie zostało usunięte.'] }),
        429: tooMany, 503: notConfigured,
      },
    },
  }, async (request, reply) => {
    if (!auth) return unavailable(reply);
    await auth.deleteAccount(sessionOf(request), request.body.password);
    return { deleted: true };
  });
}
