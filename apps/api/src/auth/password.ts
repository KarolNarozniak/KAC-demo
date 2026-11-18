// Hasła kont KAC: argon2id (parametry OWASP: 19 MiB pamięci, 2 iteracje, 1 wątek) i zasady w duchu NIST SP 800-63B –
// długość zamiast wymogów typu „wielka litera i cyfra”, odrzucanie oczywistych haseł. Hasło nigdy nie trafia do logów ani do bazy.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { hash, verify } from '@node-rs/argon2';

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;
const ARGON2 = { memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

export type PasswordProblem = 'password_too_short' | 'password_too_long' | 'password_too_common' | 'password_contains_email';

/** Ciągi, których fragmenty są najczęstszymi „długimi” hasłami (klawiatura, alfabet, cyfry). */
const SEQUENCES = ['01234567890123456789', '98765432109876543210', 'qwertyuiopasdfghjklzxcvbnm', 'qwertzuiopasdfghjklyxcvbnm', 'abcdefghijklmnopqrstuvwxyz',
  '1q2w3e4r5t6y7u8i9o0p', 'zaq12wsxcde34rfvbgt56yhn', '1qaz2wsx3edc4rfv5tgb', 'qazwsxedcrfvtgbyhnujm'];
const COMMON = new Set(['password1234', 'password12345', 'password123!', 'passw0rd1234', 'haslo1234567', 'haslo12345678', 'administrator', 'administrator1',
  'iloveyou1234', 'qwerty123456', 'qwertyuiop123', '1234567890qwe', 'zaq1@wsx3edc', 'kochamcie1234', 'polska123456', 'warszawa1234', 'welcome12345',
  'letmein12345', 'football1234', 'monkey123456', 'dragon123456', 'superman1234', 'trustno1trustno1', 'aurakalendar', 'kackalendarz']);

/** Problem z nowym hasłem albo null. email – żeby hasło nie zawierało loginu. */
export function passwordProblem(password: string, email?: string): PasswordProblem | null {
  if (password.length < PASSWORD_MIN_LENGTH) return 'password_too_short';
  if (password.length > PASSWORD_MAX_LENGTH) return 'password_too_long';
  const lower = password.toLowerCase();
  if (/^(.)\1+$/u.test(password) || /^(.{1,4})\1+$/u.test(lower) || COMMON.has(lower) || SEQUENCES.some((sequence) => sequence.includes(lower)))
    return 'password_too_common';
  const local = email?.split('@')[0]?.toLowerCase() ?? '';
  if (local.length >= 4 && lower.includes(local)) return 'password_contains_email';
  return null;
}

export const hashPassword = (password: string) => hash(password, ARGON2);

/** Porównanie z zapisanym skrótem. Uszkodzony skrót to po prostu „nie pasuje”, nie błąd serwera. */
export async function verifyPassword(stored: string, password: string): Promise<boolean> {
  try { return await verify(stored, password); } catch { return false; }
}

let dummy: Promise<string> | null = null;
/**
 * Ten sam koszt sprawdzenia dla nieistniejącego konta: bez tego czas odpowiedzi zdradzałby, czy adres ma konto w KAC.
 * Skrót losowego hasła liczony raz na proces.
 */
export async function verifyAgainstDummy(password: string): Promise<false> {
  dummy ??= hashPassword(randomBytes(24).toString('base64url'));
  await verifyPassword(await dummy, password);
  return false;
}

/** Token sesji: 256 losowych bitów w base64url. W bazie leży tylko skrót SHA-256 (token ma pełną entropię, więc wolny skrót nie jest potrzebny). */
export const newSessionToken = () => randomBytes(32).toString('base64url');
export const sessionTokenHash = (token: string) => createHash('sha256').update(token, 'utf8').digest('hex');

/**
 * Kod odzyskiwania (samodzielne ustawienie nowego hasła bez poczty): 80 losowych bitów zapisanych 16 znakami alfabetu Crockforda
 * w grupach po 4, np. 7F3Q-9XWM-2HDA-K8PR. Alfabet nie ma liter I, L, O i U, więc nie myli się ich z 1 i 0 przy przepisywaniu z kartki.
 * 80 bitów nie da się zgadnąć (także mając skrót z bazy), dlatego wystarcza szybki skrót SHA-256, jak przy tokenach sesji.
 */
const RECOVERY_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export function newRecoveryCode(): string {
  const bytes = randomBytes(10);
  let bits = 0n;
  for (const byte of bytes) bits = (bits << 8n) | BigInt(byte);
  let code = '';
  for (let index = 15; index >= 0; index--) code += RECOVERY_ALPHABET[Number((bits >> BigInt(index * 5)) & 31n)];
  return code.match(/.{4}/g)!.join('-');
}

/** Kod wpisany przez człowieka → postać kanoniczna: bez spacji i myślników, wielkie litery, O→0, I i L→1. null – to nie jest kod. */
export function normalizeRecoveryCode(input: string): string | null {
  const value = input.toUpperCase().replace(/[\s\p{Pd}]+/gu, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  return /^[0-9A-HJKMNP-TV-Z]{16}$/.test(value) ? value : null;
}

/** Skrót kodu do bazy; liczony z postaci kanonicznej, więc „7f3q 9xwm…” i „7F3Q-9XWM-…” to ten sam kod. */
export function recoveryCodeHash(code: string): string {
  return createHash('sha256').update(normalizeRecoveryCode(code) ?? code, 'utf8').digest('hex');
}

/** Porównanie skrótów w stałym czasie. */
export function sameHash(left: string, right: string): boolean {
  const a = Buffer.from(left, 'hex'); const b = Buffer.from(right, 'hex');
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
}
