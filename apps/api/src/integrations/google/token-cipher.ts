// Szyfrowanie danych dostępu Google (S23KC2S1P2-284, G01).
// AES-256-GCM z losowym IV; dane dodatkowe (AAD) wiążą szyfrogram z kontem, więc tokenu jednego konta nie da się
// „przełożyć” do innego wiersza. Klucz pochodzi spoza bazy (GOOGLE_TOKEN_ENCRYPTION_KEY, 32 bajty w base64).
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

export class TokenKeyError extends Error {
  constructor(readonly code: 'token_key_invalid' | 'token_key_mismatch' | 'token_corrupted') { super(code); }
}

const b64 = (value: Buffer) => value.toString('base64url');

export class TokenCipher {
  /** Krótki identyfikator klucza (nie klucz): pozwala wykryć, że szyfrogram powstał innym kluczem. */
  readonly keyId: string;

  constructor(private readonly key: Buffer) {
    if (key.length !== 32) throw new TokenKeyError('token_key_invalid');
    this.keyId = createHash('sha256').update(key).digest('hex').slice(0, 12);
  }

  /** null, gdy klucza nie skonfigurowano; wyjątek, gdy jest, ale ma złą długość (błąd konfiguracji ma być widoczny). */
  static fromBase64(value: string | undefined): TokenCipher | null {
    const text = value?.trim();
    if (!text) return null;
    return new TokenCipher(Buffer.from(text, 'base64'));
  }

  encrypt(plain: string, aad: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    cipher.setAAD(Buffer.from(aad, 'utf8'));
    const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return ['v1', this.keyId, b64(iv), b64(cipher.getAuthTag()), b64(encrypted)].join('.');
  }

  decrypt(payload: string, aad: string): string {
    const [version, keyId, iv, tag, data] = payload.split('.');
    if (version !== 'v1' || !iv || !tag || data === undefined) throw new TokenKeyError('token_corrupted');
    if (keyId !== this.keyId) throw new TokenKeyError('token_key_mismatch');
    try {
      const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'base64url'));
      decipher.setAAD(Buffer.from(aad, 'utf8'));
      decipher.setAuthTag(Buffer.from(tag, 'base64url'));
      return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
    } catch {
      throw new TokenKeyError('token_corrupted');
    }
  }
}
