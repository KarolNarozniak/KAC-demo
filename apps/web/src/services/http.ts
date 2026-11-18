// Zapytania do API KAC z sesją logowania. Token sesji trzyma tylko pamięć aplikacji (zapis na urządzeniu – sessionStore),
// a każde zapytanie dostaje nagłówek Authorization: Bearer. Odpowiedź 401 {error:'unauthorized'} oznacza wygasłą albo cofniętą
// sesję (wylogowanie na innym urządzeniu, zmiana hasła, usunięcie konta) – zgłaszamy ją raz i aplikacja wraca do ekranu logowania.
// Inne 401 (np. google-unauthorized z importu Google) dotyczą dostępu do Google, nie sesji KAC, więc nie wylogowują.

let token: string | null = null;
let expired: (() => void) | null = null;

export function setSessionToken(value: string | null) { token = value; }
export const hasSessionToken = () => token !== null;

/** Reakcja na wygaśnięcie sesji (jedna naraz); zwraca funkcję, która ją wyrejestrowuje. */
export function onSessionExpired(listener: () => void) {
  expired = listener;
  return () => { if (expired === listener) expired = null; };
}

function withAuthorization(headers: HeadersInit | undefined, value: string): HeadersInit {
  const authorization = `Bearer ${value}`;
  if (typeof Headers !== 'undefined' && headers instanceof Headers) {
    const copy = new Headers(headers);
    copy.set('Authorization', authorization);
    return copy;
  }
  if (Array.isArray(headers)) return [...headers.filter(([name]) => name.toLowerCase() !== 'authorization'), ['Authorization', authorization]];
  return { ...(headers as Record<string, string> | undefined), Authorization: authorization };
}

async function isSessionError(response: Response) {
  try { return ((await response.clone().json()) as { error?: unknown }).error === 'unauthorized'; } catch { return false; }
}

/** fetch z sesją KAC – adres to pełny URL API (każdy klient liczy go sam, np. apiBaseUrl()). */
export async function authFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const sent = token;
  const response = await globalThis.fetch(input, sent ? { ...init, headers: withAuthorization(init.headers, sent) } : init);
  // Równoległe zapytania z tą samą sesją: wylogowanie zgłasza tylko pierwsze z nich (stąd sprawdzenie tokenu po odczycie treści).
  if (response.status === 401 && sent !== null && await isSessionError(response) && sent === token) {
    token = null;
    expired?.();
  }
  return response;
}
