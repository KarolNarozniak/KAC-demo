// Klient API importu: kontrola rozpoznanych danych przed zapisem (S23KC2S1P2-32)
// i import grafiku pracy ze zdjęcia lub pliku (S23KC2S1P2-44).

const baseUrl = () => {
  const configured = process.env.EXPO_PUBLIC_API_URL?.trim();
  if (configured) return configured.replace(/\/$/, '');
  const host = globalThis.location?.hostname;
  if (host === 'localhost' || host === '127.0.0.1') return 'http://localhost:4000';
  throw new Error('Brak konfiguracji adresu API.');
};

/** Adres API – wspólny dla klientów importu (także Google Calendar). */
export const apiBaseUrl = baseUrl;

async function postJson(path: string, body: unknown, signal?: AbortSignal): Promise<Response> {
  return fetch(`${baseUrl()}${path}`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: signal ?? AbortSignal.timeout(30000),
  });
}

export type ImportIssue = 'missing-title' | 'invalid-date' | 'invalid-time' | 'end-not-after-start';
export type ImportCategory = 'Class' | 'Work' | 'Personal';
export type DuplicateDecision = 'skip' | 'replace' | 'keepBoth';

export type ImportPreviewRow = {
  id: string;
  status: 'ok' | 'error';
  issues: ImportIssue[];
  start: string | null;
  end: string | null;
  location: string | null;
  confidence: number | null;
  sourcePage: number | null;
  sourceSnippet: string | null;
  unresolvedFields: string[];
  overnight: boolean;
  duplicateOfEvents: { id: string; title: string; start: string; repeatWeekly?: boolean }[];
  duplicateOfRows: string[];
};

export type ImportRowInput = {
  id: string;
  title: string;
  date: string;
  startTime: string;
  endTime: string;
  /** Data końca, gdy wydarzenie kończy się następnego dnia (np. z pliku ICS lub Google Calendar). */
  endDate?: string;
  category: ImportCategory;
  location?: string;
  confidence?: number;
  sourcePage?: number;
  sourceSnippet?: string;
  unresolvedFields?: string[];
  employee?: string;
  overnightConfirmed?: boolean;
  duplicateDecision?: DuplicateDecision;
  replacementId?: string;
};

/** Sprawdza wiersze po poprawkach użytkownika. Nic nie zapisuje; przedłuża sesję importu, jeśli ją podano. */
export async function previewImport(rows: ImportRowInput[], importSessionId?: string, signal?: AbortSignal): Promise<ImportPreviewRow[]> {
  const response = await postJson('/api/v1/import/preview', importSessionId ? { rows, importSessionId } : { rows }, signal);
  if (!response.ok) throw new Error(`API zwróciło status ${response.status}.`);
  return ((await response.json()) as { rows: ImportPreviewRow[] }).rows;
}

export type ImportSummary = { added: number; replaced: number; skipped: number; rejected: number };

export type ConfirmImportResult =
  | { kind: 'saved'; saved: number; rejected: number; summary?: ImportSummary }
  | { kind: 'invalid-rows' | 'expired' | 'closed' | 'not-found' | 'failed'; status: number; error?: string };

/** Zatwierdza import: API jeszcze raz sprawdza wiersze i zapisuje zaakceptowane w kalendarzu (wszystkie albo żaden). */
export async function confirmImport(sessionId: string, rows: ImportRowInput[]): Promise<ConfirmImportResult> {
  const response = await postJson(`/api/v1/import/sessions/${encodeURIComponent(sessionId)}/confirm`, { rows });
  if (response.status === 201) return { kind: 'saved', ...((await response.json()) as { saved: number; rejected: number; summary?: ImportSummary }) };
  const kind = response.status === 422 ? 'invalid-rows' : response.status === 410 ? 'expired' : response.status === 409 ? 'closed' : response.status === 404 ? 'not-found' : 'failed';
  const body = (await response.json().catch(() => ({}))) as { error?: string };
  return { kind, status: response.status, error: body.error };
}

/** Anuluje import: sesja kończy się bez zmian w kalendarzu. */
export async function cancelImport(sessionId: string): Promise<void> {
  const response = await postJson(`/api/v1/import/sessions/${encodeURIComponent(sessionId)}/cancel`, {});
  if (!response.ok) throw new Error('Nie udało się anulować sesji importu.');
}

export type ScheduleRow = {
  id: string;
  title: string;
  date: string;
  startTime: string;
  endTime: string;
  category: 'Work';
  location?: string;
  confidence?: number;
  employee?: string;
  isOwn: boolean;
  incomplete: boolean;
  sourcePage?: number;
  sourceSnippet?: string;
  unresolvedFields?: string[];
};

export type ScheduleReadResult =
  | {
      kind: 'read';
      importSessionId: string;
      fileType: 'JPG' | 'PNG' | 'PDF';
      readStatus: 'all' | 'partial';
      readStatusLabel: string;
      readerIsDemo: boolean;
      readerProvider?: 'local' | 'azure-ai-foundry';
      userName: string;
      rows: ScheduleRow[];
      preview: ImportPreviewRow[];
    }
  | { kind: 'rejected'; error: string }
  | { kind: 'unavailable' };

/** Wysyła plik z grafikiem do API: API sprawdza plik, odczytuje zmiany i zakłada sesję importu. */
export async function readWorkSchedule(fileName: string, dataBase64: string): Promise<ScheduleReadResult> {
  // OCR zdjęcia na serwerze może trwać do 60 s, dlatego dłuższy limit niż dla pozostałych żądań.
  const response = await postJson('/api/v1/import/work-schedule/read', { fileName, dataBase64 }, AbortSignal.timeout(75000));
  if (response.status === 201) return { kind: 'read', ...((await response.json()) as Omit<Extract<ScheduleReadResult, { kind: 'read' }>, 'kind'>) };
  if (response.status === 422 || response.status === 429) return { kind: 'rejected', error: ((await response.json()) as { error: string }).error };
  if (response.status === 413) return { kind: 'rejected', error: 'file-too-large' };
  return { kind: 'unavailable' };
}

const aiReadErrors: Record<string, string> = {
  azure_ai_not_configured: 'Azure AI Foundry nie jest skonfigurowane. Sprawdź endpoint projektu, deployment modelu i logowanie API.',
  azure_ai_rate_limited: 'Azure AI ograniczył liczbę żądań. Poczekaj chwilę i spróbuj ponownie.',
  azure_ai_timeout: 'Odczyt AI przekroczył limit czasu. Wybierz mniejszy fragment i spróbuj ponownie.',
  database_not_configured: 'Serwer nie ma skonfigurowanej bazy danych. Plik nie został zapisany.',
  'file-too-large': 'Plik może mieć maksymalnie 5 MB.',
  'too-many-pages': 'PDF przekracza skonfigurowany limit stron. Podziel dokument na mniejsze części.',
  'image-too-large': 'Obraz ma zbyt dużą rozdzielczość. Zmniejsz go przed importem.',
  'ai-payload-too-large': 'Nie można bezpiecznie zmieścić obrazu w limicie Azure AI. Zapisz mniejszą lub bardziej skompresowaną kopię.',
  'unsupported-format': 'AI obsługuje tylko PDF, PNG i JPG/JPEG.',
  'corrupted-file': 'Plik jest uszkodzony lub niekompletny.',
  'encrypted-pdf': 'PDF zabezpieczony hasłem nie jest obsługiwany.',
  'unreadable-pdf': 'Nie udało się sprawdzić PDF. Wybierz inny plik.',
  'unreadable-image': 'Nie udało się odczytać obrazu. Wybierz wyraźniejszy PNG/JPG.',
  nothing_recognized: 'Nie znaleziono żadnych zmian. Sprawdź czytelność i układ dokumentu.',
  invalid_ai_output: 'AI zwróciło dane w nieprawidłowym formacie. Nic nie zapisano.',
  azure_ai_request_failed: 'Nie udało się połączyć z Azure AI Foundry. Sprawdź rolę i deployment modelu.',
};

async function readAiFile(fileName: string, dataBase64: string, source: 'classes' | 'work', signal?: AbortSignal) {
  const timeout = AbortSignal.timeout(120000);
  const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
  let response: Response;
  try { response = await postJson('/api/v1/import/ai/read', { fileName, dataBase64, source }, requestSignal); }
  catch (error) {
    if (signal?.aborted) throw error;
    if (timeout.aborted) throw new Error(aiReadErrors.azure_ai_timeout);
    throw error;
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const code = typeof body.error === 'string' ? body.error : '';
    const fallback = response.status === 503 ? aiReadErrors.azure_ai_not_configured : `Odczyt AI nie powiódł się (HTTP ${response.status}).`;
    throw new Error(aiReadErrors[code] ?? fallback);
  }
  return body as Record<string, unknown>;
}

export async function readAiClassSchedule(fileName: string, dataBase64: string, signal?: AbortSignal): Promise<ClassReadResult> {
  return await readAiFile(fileName, dataBase64, 'classes', signal) as unknown as ClassReadResult;
}

export async function readAiWorkSchedule(fileName: string, dataBase64: string, signal?: AbortSignal): Promise<ScheduleReadResult> {
  const result = await readAiFile(fileName, dataBase64, 'work', signal);
  return { kind: 'read', ...result, readerProvider: 'azure-ai-foundry' } as unknown as Extract<ScheduleReadResult, { kind: 'read' }>;
}

/** Wydarzenie z kalendarza, z którym koliduje importowany wiersz (informacja, nie blokuje importu). */
export type ImportCollision = { id: string; title: string; category: string; mandatory: boolean; start: string; end: string };

export type ClassRow = ImportRowInput & { reviewRequired: boolean; sourcePage: number; endDate?: string;
  /** Tylko ICS: opis powtarzania, np. „co tydzień (pn), do 31.01.2027”. */
  repeat?: string | null };
export type ClassReadResult = { importSessionId: string; academicYear: string; dateFrom: string; dateTo: string;
  rows: ClassRow[]; preview: ImportPreviewRow[]; warnings: string[];
  /** Kolizje z wydarzeniami już zapisanymi w kalendarzu, według identyfikatora wiersza. */
  collisions?: Record<string, ImportCollision[]>;
  // Tylko dla pliku ICS (historyjka S23KC2S1P2-8):
  source?: 'ics' | 'ai'; readerProvider?: 'local' | 'azure-ai-foundry'; calendarName?: string | null; eventCount?: number;
  skipped?: { count: number; reasons: Partial<Record<'all-day' | 'missing-time' | 'invalid-date' | 'unsupported-repeat', number>> } };

/** Pola formularza, które wymagają poprawy (historyjka S23KC2S1P2-20: system wskazuje pola). */
export type InvalidFields = { title: boolean; date: boolean; start: boolean; end: boolean };
const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;
export function invalidFields(row: { title: string; date: string; startTime: string; endTime: string }, issues: ImportIssue[] = []): InvalidFields {
  const timeIssue = issues.includes('invalid-time');
  return {
    title: issues.includes('missing-title'),
    date: issues.includes('invalid-date'),
    start: timeIssue && !timePattern.test(row.startTime),
    end: (timeIssue && !timePattern.test(row.endTime)) || issues.includes('end-not-after-start'),
  };
}
const classReadErrors: Record<string, string> = {
  'database_unavailable': 'Nie można połączyć się z bazą danych. Uruchom PostgreSQL i sprawdź konfigurację API. Plik nie został zapisany.',
  'database_not_configured': 'Serwer nie ma skonfigurowanej bazy danych. Sprawdź DATABASE_URL i uruchom API ponownie.',
  'empty-file': 'Wybrany plik jest pusty. Pobierz oryginał i wybierz go ponownie.',
  'corrupted-file': 'Plik jest uszkodzony lub niekompletny. Pobierz oryginał jako plik, bez konwersji, i wybierz go ponownie.',
  'FST_ERR_VALIDATION': 'Serwer odrzucił dane przesłanego pliku. Spróbuj ponownie wybrać plik z krótszą nazwą.',
  'FST_ERR_CTP_BODY_TOO_LARGE': 'Przesłany plik przekracza limit 5 MB.',
  'unreadable-image': 'Nie można odczytać obrazu. Wybierz PNG lub JPG do 20 megapikseli.',
  'unsupported-image-layout': 'Nie rozpoznano pełnej tabeli Miniatura WAT. Wybierz wyraźny, prosty zrzut ekranu z nagłówkiem semestru.',
  'unreadable-image-dates': 'Nie można potwierdzić dat. Wybierz wyraźniejszy zrzut całej tabeli.',
  'unreadable-image-times': 'Nie można odczytać godzin. Wybierz wyraźniejszy zrzut ekranu.',
  'empty-image-timetable': 'Na obrazie nie znaleziono zajęć.',
  'unsupported-format': 'Nieobsługiwany format. Wybierz plik ICS (np. z USOS lub Google Calendar), PDF, PNG lub JPG.',
  'empty-calendar': 'Plik ICS nie zawiera żadnych wydarzeń. Wybierz inny plik.',
  'no-importable-events': 'Żadnego wydarzenia z pliku ICS nie można zaimportować – brakuje im godzin (np. wydarzenia całodniowe). Wybierz inny plik.',
  'unsupported-layout': 'Nie rozpoznano planu WAT. Wybierz PDF z tekstem w układzie mini e-D (plan semestru). Skany nie są obsługiwane.',
  'unreadable-pdf': 'Nie można odczytać PDF. Plik może być uszkodzony lub być skanem.',
  'encrypted-pdf': 'PDF zabezpieczony hasłem nie jest obsługiwany.',
  'file-too-large': 'Plik może mieć maksymalnie 5 MB.',
  'reader-busy': 'Trwa odczyt innych plików. Spróbuj za chwilę.',
  'read-timeout': 'Odczyt planu trwał zbyt długo. Wybierz mniejszy plik.',
};
export async function readClassSchedule(name: string, base64: string): Promise<ClassReadResult> {
  const response = await postJson('/api/v1/import/classes/read', { fileName: name, dataBase64: base64 }, AbortSignal.timeout(75000));
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const code = typeof body?.error === 'string' ? body.error : '';
    const fallback = response.status === 503 ? classReadErrors.database_unavailable
      : response.status === 413 ? classReadErrors.FST_ERR_CTP_BODY_TOO_LARGE
      : `Serwer nie zakończył importu (HTTP ${response.status}). Sprawdź komunikat w terminalu API.`;
    throw new Error(classReadErrors[code] ?? fallback);
  }
  if (!body || !Array.isArray(body.rows)) throw new Error('Serwer zwrócił niepoprawny wynik importu. Sprawdź terminal API.');
  return body;
}
