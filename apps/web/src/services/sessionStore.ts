// Token sesji na telefonie: zaszyfrowany magazyn systemu (Keychain na iOS, Keystore na Androidzie) przez expo-secure-store.
// Wersja dla przeglądarki: sessionStore.web.ts. Błąd magazynu nie blokuje aplikacji – sesja działa wtedy do zamknięcia aplikacji.
import * as SecureStore from 'expo-secure-store';

const KEY = 'kac-session';

export async function loadSessionToken(): Promise<string | null> {
  try { return await SecureStore.getItemAsync(KEY); } catch { return null; }
}

export async function saveSessionToken(token: string): Promise<void> {
  try { await SecureStore.setItemAsync(KEY, token); } catch { /* sesja tylko do zamknięcia aplikacji */ }
}

export async function clearSessionToken(): Promise<void> {
  try { await SecureStore.deleteItemAsync(KEY); } catch { /* nic do usunięcia */ }
}
