export type DemoCalendarOverview = {
  source: 'postgresql';
  user: { id: string; name: string; timezone: string };
  calendar: { id: string; name: string };
  counts: { events: number; categories: number };
  events: Array<{
    id: string;
    title: string;
    start: string;
    end: string;
    category: string;
    color: string;
    mandatory: boolean;
  }>;
};

export type DemoConnection = {
  api: 'connected';
  database: 'connected' | 'not-configured' | 'unavailable';
  overview: DemoCalendarOverview | null;
};

function apiBaseUrl() {
  const configured = process.env.EXPO_PUBLIC_API_URL?.trim();
  if (configured) return configured.replace(/\/$/, '');
  const hostname = (globalThis as { location?: { hostname?: string } }).location?.hostname;
  if (hostname === 'localhost' || hostname === '127.0.0.1') return 'http://localhost:4000';
  return null;
}

export async function getDemoConnection(signal?: AbortSignal): Promise<DemoConnection> {
  const base = apiBaseUrl();
  if (!base) throw new Error('Adres API nie jest skonfigurowany dla tego wdrożenia.');
  const response = await fetch(`${base}/api/demo/connection`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    signal,
  });
  if (!response.ok) throw new Error(`API zwróciło status ${response.status}.`);
  return response.json() as Promise<DemoConnection>;
}

// --- Import: kontrola rozpoznanych danych przed zapisem (S23KC2S1P2-32) ---

export type ImportIssue = 'missing-title' | 'invalid-date' | 'invalid-time' | 'end-not-after-start';
export type ImportCategory = 'Class' | 'Work' | 'Personal';

export type ImportPreviewRow = {
  id: string;
  status: 'ok' | 'error';
  issues: ImportIssue[];
  start: string | null;
  end: string | null;
  location: string | null;
  confidence: number | null;
};

export type ImportRowInput = {
  id: string;
  title: string;
  date: string;
  startTime: string;
  endTime: string;
  category: ImportCategory;
  location?: string;
  confidence?: number;
};

async function postJson(path: string, body: unknown, signal?: AbortSignal): Promise<Response> {
  const base = apiBaseUrl();
  if (!base) throw new Error('Adres API nie jest skonfigurowany dla tego wdrożenia.');
  return fetch(`${base}${path}`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
}

/** Sprawdza wiersze po poprawkach użytkownika. Nic nie zapisuje; przedłuża sesję importu, jeśli ją podano. */
export async function previewImport(rows: ImportRowInput[], importSessionId?: string, signal?: AbortSignal): Promise<ImportPreviewRow[]> {
  const response = await postJson('/api/import/preview', importSessionId ? { rows, importSessionId } : { rows }, signal);
  if (!response.ok) throw new Error(`API zwróciło status ${response.status}.`);
  return ((await response.json()) as { rows: ImportPreviewRow[] }).rows;
}

/** Tworzy sesję importu: API zapamiętuje odczytane wiersze do kontroli, ale niczego nie dodaje do kalendarza. */
export async function createImportSession(
  source: 'classes' | 'work',
  format: 'PDF' | 'Zdjęcie' | 'ICS/CSV',
  rows: ImportRowInput[],
): Promise<{ importSessionId: string; expiresAt: string; rows: ImportPreviewRow[] }> {
  const response = await postJson('/api/import/sessions', { source, format, rows });
  if (response.status !== 201) throw new Error(`API zwróciło status ${response.status}.`);
  return response.json() as Promise<{ importSessionId: string; expiresAt: string; rows: ImportPreviewRow[] }>;
}

export type ConfirmedEvent = { id: string; rowId: string; title: string; start: string; end: string; category: ImportCategory; location: string | null };

export type ConfirmImportResult =
  | { kind: 'saved'; saved: number; rejected: number; events: ConfirmedEvent[] }
  | { kind: 'invalid-rows' | 'expired' | 'closed' | 'not-found' | 'failed'; status: number };

/** Zatwierdza import: API jeszcze raz sprawdza wiersze i zapisuje zaakceptowane w kalendarzu (wszystkie albo żaden). */
export async function confirmImport(sessionId: string, rows: ImportRowInput[]): Promise<ConfirmImportResult> {
  const response = await postJson(`/api/import/sessions/${encodeURIComponent(sessionId)}/confirm`, { rows });
  if (response.status === 201) return { kind: 'saved', ...((await response.json()) as { saved: number; rejected: number; events: ConfirmedEvent[] }) };
  const kind = response.status === 422 ? 'invalid-rows' : response.status === 410 ? 'expired' : response.status === 409 ? 'closed' : response.status === 404 ? 'not-found' : 'failed';
  return { kind, status: response.status };
}
