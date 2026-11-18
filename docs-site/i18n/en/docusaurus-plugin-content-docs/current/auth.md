---
id: auth
title: Sign-in and accounts
sidebar_label: Sign-in
description: KAC accounts with e-mail and password, database sessions, a recovery code for a forgotten password, API protection, registration, account deletion and the daily AI limit.
---

# Sign-in and accounts

Every user has their own KAC account (e-mail and password) and sees only their own data. Google is used only to connect a calendar after signing in (Settings → Google Calendar) – it is not a way to sign in to KAC.

## Decisions

- **Own accounts instead of "Sign in with Google".** Google sign-in would need each person approved in the Google Cloud project. A Google account outside the app's test-user list cannot connect its calendar, but the rest of KAC works.
- **Database sessions instead of JWT.** A session token is 256 random bits; the database (`t_sesje`) stores only its SHA-256 hash. A session can be revoked immediately (sign-out, password change, account deletion), there is no JWT secret to keep and no token refresh across several tabs. Checking a session is one indexed query.
- **Session lifetime:** 30 days without use, at most 90 days after sign-in. Last use is written at most once every 10 minutes.

## In the app

- On start the app checks the stored session (`GET /api/v1/auth/me`). Without a session it shows the sign-in screen with a link to create an account.
- The session is remembered: on the phone in the system's encrypted store (`expo-secure-store`), in the browser in `localStorage`. No network at start does not sign out – the app offers a retry.
- Every request sends `Authorization: Bearer <token>`. A `401 {"error":"unauthorized"}` response (session expired or ended on another device) returns to the sign-in screen with a message. Other 401 errors (e.g. `google-unauthorized` from the Google import) do not sign out.
- Settings → Account: who is signed in, whether the account has a recovery code, "Wyloguj" (sign out), "Zmień hasło" (change password – signs out the other devices, the current one stays), "Nowy kod odzyskiwania" (new recovery code) and "Usuń konto" (delete account) – both confirmed with the password.
- Signing out turns off Web Push in this browser and clears the local assistant personalisation, so the next person on the device does not get someone else's reminders. After sign-in Web Push comes back by itself if the account has reminders on and the browser has permission.
- Forgotten password: sign-in screen → "Nie pamiętasz hasła?" → e-mail, recovery code and a new password (see below). Without a code an administrator sets a new password.

## Passwords and guessing protection

- **argon2id** hash (19 MiB memory, 2 iterations, 1 thread – OWASP parameters). The password never reaches logs or the database.
- Rules in the spirit of NIST SP 800-63B: 12–128 characters, no digit or special-character requirements. Common passwords, repeats, keyboard sequences and passwords containing the name from the e-mail address are rejected.
- A wrong e-mail and a wrong password give the same message and the same response time (a dummy check for unknown addresses), so nobody can probe who has an account.
- After 10 failed attempts the account is locked for 15 minutes (`429 too_many_attempts`). Per-IP limits on top: sign-in 10 per minute, registration 5 per hour, password change, reset with the recovery code, new recovery code and account deletion 10 per 15 minutes.
- E-mail addresses are unique regardless of letter case.

## Recovery code (forgotten password)

KAC does not send mail – a reset by e-mail would need a domain, a mail provider and another secret. Instead every account has a one-time **recovery code**, like the backup codes of two-step sign-in. It works without any outside service, in the browser and in Expo Go.

- **Format:** 16 characters in groups of 4, e.g. `7F3Q-9XWM-2HDA-K8PR` – 80 random bits in the Crockford alphabet (no I, L, O or U, which are confused with 1 and 0). Letter case, spaces and dashes do not matter; O is read as 0, I and L as 1.
- **The database** (`t_dane_logowania.kod_odzyskiwania_hash`) stores only a SHA-256 hash. An 80-bit code cannot be guessed or recovered from the hash, so a slow hash such as argon2 is not needed (same as for session tokens).
- **When the code is shown:** only once – after registration (a screen before entering the app; it continues only after ticking "Zapisałem kod w bezpiecznym miejscu" – I saved the code), after a reset (a new code) and after creating a new one in Settings → Account (with the password; the previous one stops working). The "Kopiuj kod" (copy) button uses `expo-clipboard`.
- **Reset** (`POST /auth/recover`, public): e-mail, code and a new password. In one transaction KAC sets the new password, clears the lockout after failed sign-ins (the code works during a lockout too), signs out every device (reason `reset_hasla`), signs in this device and stores a new code. The code is single-use – of two simultaneous uses of the same code only one succeeds. A new password equal to the current one is refused (`400 password_unchanged`) and the code stays unused – that password simply signs in.
- A wrong e-mail, an account without a code and a wrong code give the same `401 invalid_recovery_code`, and every path runs the same query and fast hash, so the answer does not reveal who has an account. Guessing is also limited per IP.
- Whoever knows the code and the e-mail can set a new password. That is why the app shows the code once, asks to keep it in a password manager or on paper and warns not to send it to anyone.
- A password set by an administrator (`auth:set-password`) invalidates the code – usually it happens because the code was lost. An account without a code (including accounts from before this feature) sees a reminder and a "Utwórz kod odzyskiwania" (create recovery code) button in Settings → Account.

## API protection

All `/api/v1` routes require a session except: `GET /health/live`, `GET /health/ready`, the documentation (`/openapi.json`, `/docs`), `GET /auth/config`, `POST /auth/register`, `POST /auth/login`, `POST /auth/recover` and the Google return URLs (`GET /integrations/google/callback`, `GET /import/google/callback`). Missing or invalid token: `401 {"error":"unauthorized"}`; database unavailable: `503 database_unavailable`.

The data scope (user and their active calendar) comes from the session, so one user cannot read or change someone else's events, schedules, conversations or Google connection – such a request ends with `404`.

A browser returning from Google's consent page has no KAC session. The attempt owner is identified by the single-use `state` (32 random bytes, valid for 10 minutes, only its hash stored). One Google account can be connected to only one KAC account at a time (`google_account_in_use`); the shared mock accounts are exempt.

An API started without a database (tests, demo mode) works as before on demo data, and the `/auth/*` routes return `503 auth_not_configured`.

## Registration

`REGISTRATION_MODE` decides who can create an account:

| Mode | Behaviour |
| --- | --- |
| `open` (default) | Anyone can create an account. |
| `invite` | Registration requires the `REGISTRATION_INVITE_CODE` code (constant-time comparison). Without a configured code it behaves like `closed`. |
| `closed` | Only an administrator creates accounts (`npm run auth:set-password -- address --create`). |

A new account gets the calendar "Mój kalendarz", an empty work profile (no hours or rate, 0 min commute – filled in under Grafik → "Edytuj profil") and the device time zone (default `Europe/Warsaw`). An account without a calendar or profile (e.g. created by the administrator script) gets them at sign-in. The app reads the mode from `GET /auth/config` and shows the code field or a note that registration is closed.

## Account deletion (GDPR)

`DELETE /api/v1/auth/account` requires the password. In order: KAC revokes the Google consent (best effort), revokes all sessions and in one transaction deletes the account with all its data – calendars, events, class timetable, work profile and schedules, blocks, assistant conversations, imports, notifications, Web Push subscriptions, the Google connection with its tokens and publications. Only events published earlier to Google Calendar (they live in Google, not in KAC) and anonymous AI usage statistics without content (`t_ai_uzycie`, user id cleared) remain.

## Daily AI limit

The assistant and AI timetable reading cost Azure calls. `AI_DAILY_LIMIT` (default 200 calls per account in the last 24 hours, `0` disables it) stops further calls before they reach Azure: `429 {"error":"ai_daily_limit"}`. Reading an attachment with the local parser is not counted.

## API

| Method and path | Description |
| --- | --- |
| `GET /api/v1/auth/config` | Registration mode and password length (public). |
| `POST /api/v1/auth/register` | New account and session (`201 {user, token, expiresAt, recoveryCode}`); `inviteCode` in `invite` mode. |
| `POST /api/v1/auth/login` | Session for e-mail and password (`{user, token, expiresAt}`). |
| `POST /api/v1/auth/recover` | Forgotten password: `{email, recoveryCode, newPassword}` → a new session and a new code (`{user, token, expiresAt, recoveryCode}`); public. |
| `POST /api/v1/auth/logout` | Revokes the current session. |
| `GET /api/v1/auth/me` | The signed-in user, including `hasRecoveryCode`. |
| `POST /api/v1/auth/recovery-code` | New recovery code after checking the password (`{password}` → `{recoveryCode}`); the previous one stops working. |
| `POST /api/v1/auth/change-password` | Password change; `{otherSessionsRevoked}` – how many other devices were signed out. |
| `DELETE /api/v1/auth/account` | Deletes the account with its data; body `{password}`. |

Error codes: `invalid_credentials` and `invalid_recovery_code` (401), `too_many_attempts` (429), `email_taken` (409), `invalid_email`, `invalid_name`, `invalid_time_zone`, `password_too_short`, `password_too_long`, `password_too_common`, `password_contains_email`, `password_unchanged` (400), `registration_closed`, `invalid_invite_code` and `invalid_password` (403 – a wrong password when changing the password, creating a new code or deleting the account does not sign out), `account_not_found` (404). Swagger UI has an "Authorize" button for the session token.

## Configuration

| Variable | Meaning |
| --- | --- |
| `REGISTRATION_MODE` | `open`, `invite` or `closed`. On a public server use `invite` or `closed`. |
| `REGISTRATION_INVITE_CODE` | Invite code for `invite` mode. Keep it out of the repository (locally `.env`, on Azure the app settings). |
| `AI_DAILY_LIMIT` | Daily AI call limit per account, default `200`; `0` disables it. |
| `TRUST_PROXY` | How many proxies to trust when resolving the client address for per-IP limits (`X-Forwarded-For`, the port is stripped). Default `1` on Azure App Service, no proxy locally. Without it every user behind the proxy would share one counter. |

## Administrator

```bash
npm run auth:set-password -- student.demo@example.test
npm run auth:set-password -- anna@example.test --create --first Anna --last Nowak
```

The script asks for the password twice (characters are not shown) or reads it from `KAC_NEW_PASSWORD`. It applies the same rules as registration, clears the lockout, signs out all devices of the account and invalidates the recovery code (the user creates a new one in Settings → Account). `--create` creates the account (default time zone `Europe/Warsaw`, another one with `--zone`).

Existing database (e.g. a local one with demo data or production): `npm run db:migrate`, then set a password for the account whose data should stay – e.g. `student.demo@example.test`. Accounts from before sign-in have no password, so without this step nobody can open them.

## Limitations

- No password reset by e-mail (the recovery code replaces it – whoever loses both the password and the code needs an administrator) and no list of signed-in devices in the app (device data is already in `t_sesje`: description, last use).
- In the browser the token lives in `localStorage`, so the protection is the absence of script injection (KAC does not insert raw HTML). An HttpOnly cookie would need the app and the API under a shared domain.
- A Google consent link with someone else's `state` (e.g. sent by another user) would connect the Google account of the person who picks an account and clicks "Allow" to the sender's KAC account. Google always shows the account picker and a consent screen naming KAC, the link expires after 10 minutes and in testing mode only listed test users can sign in. Full protection is confirming the return in the app that started the connection.

## Data

Migration `024_auth_sessions.sql`: `t_dane_logowania` (password hash, failed-attempt counter, lockout, last sign-in), `t_sesje` (token hash, device, last use, expiry, revocation with reason), unique e-mail regardless of case and one active Google account (`google_sub`) per KAC account. Migration `025_recovery_codes.sql`: column `t_dane_logowania.kod_odzyskiwania_hash` (null – account without a code). Migration `026_default_work_profiles.sql`: an empty work profile for accounts that had none.

## Tests

- `apps/api/tests/auth.test.ts` – password rules, argon2id and token hash, recovery code format and hash, public route list, OpenAPI contract (every protected route documents 401), API without a database, daily AI limit.
- `apps/api/tests/auth.integration.test.ts` (PostgreSQL, real tokens in the header) – registration, 401 without a session, sign-out, taken e-mail, weak passwords, `invite` and `closed` modes, lockout and per-IP limit, password change signing out other devices, reset with the recovery code (also during a lockout, signing out every device, single use, simultaneous use), new code with the password and an account without a code, isolation of two users, Google return without a session, `google_account_in_use`, account deletion with a published schedule.
- `apps/web/tests/auth.test.ts` – form validation (including the reset with a code), session header, sign-out only on `401 unauthorized` (once for parallel requests), `/auth/*` client with reset and new code, AI limit messages.
