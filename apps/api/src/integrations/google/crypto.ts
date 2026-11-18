// Szyfrowanie refresh tokenu Google (AES-256-GCM). Klucz żyje WYŁĄCZNIE w zmiennej środowiskowej
// GOOGLE_TOKEN_ENCRYPTION_KEY (base64, 32 bajty) — nigdy w bazie danych.
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

export class MissingEncryptionKeyError extends Error { constructor() { super('missing-encryption-key'); } }

function loadKey(): Buffer {
  const raw = process.env.GOOGLE_TOKEN_ENCRYPTION_KEY?.trim();
  if (!raw) throw new MissingEncryptionKeyError();
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) throw new MissingEncryptionKeyError();
  return key;
}

/** Zwraca jeden blob (iv || authTag || ciphertext) do zapisania jako bytea. */
export function encryptRefreshToken(plaintext: string): Buffer {
  const key = loadKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);
}

export function decryptRefreshToken(blob: Buffer): string {
  const key = loadKey();
  const iv = blob.subarray(0, IV_LENGTH);
  const authTag = blob.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const ciphertext = blob.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}