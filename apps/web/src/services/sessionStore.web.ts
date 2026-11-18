// Token sesji w przeglądarce: localStorage tego adresu (wspólny dla kart, znika po „Wyloguj” albo wyczyszczeniu danych witryny).
// Tryb prywatny albo zablokowane dane witryny: zapis się nie udaje i sesja trwa do zamknięcia karty.
const KEY = 'kac-session';

export async function loadSessionToken(): Promise<string | null> {
  try { return globalThis.localStorage?.getItem(KEY) ?? null; } catch { return null; }
}

export async function saveSessionToken(token: string): Promise<void> {
  try { globalThis.localStorage?.setItem(KEY, token); } catch { /* sesja tylko do zamknięcia karty */ }
}

export async function clearSessionToken(): Promise<void> {
  try { globalThis.localStorage?.removeItem(KEY); } catch { /* nic do usunięcia */ }
}
