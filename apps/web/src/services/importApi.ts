// Klient API importu: kontrola rozpoznanych danych przed zapisem (S23KC2S1P2-32)
// i import grafiku pracy ze zdjęcia lub pliku (S23KC2S1P2-44).

const baseUrl = () => {
  const configured = process.env.EXPO_PUBLIC_API_URL?.trim();
  if (configured) return configured.replace(/\/$/, '');
  const host = globalThis.location?.hostname;
  if (host === 'localhost' || host === '127.0.0.1') return 'http://localhost:4000';
  throw new Error('Brak konfiguracji adresu API.');
};

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
  category: ImportCategory;
  location?: string;
  confidence?: number;
  employee?: string;
  overnightConfirmed?: boolean;
  duplicateDecision?: DuplicateDecision;
  replacementId?: string;
};

/** Sprawdza wiersze po poprawkach użytkownika. Nic nie zapisuje; przedłuża sesję importu, jeśli ją podano. */
export async function previewImport(rows: ImportRowInput[], importSessionId?: string, signal?: AbortSignal): Promise<ImportPreviewRow[]> {
  const response = await postJson('/api/import/preview', importSessionId ? { rows, importSessionId } : { rows }, signal);
  if (!response.ok) throw new Error(`API zwróciło status ${response.status}.`);
  return ((await response.json()) as { rows: ImportPreviewRow[] }).rows;
}

export type ImportSummary = { added: number; replaced: number; skipped: number; rejected: number };

export type ConfirmImportResult =
  | { kind: 'saved'; saved: number; rejected: number; summary?: ImportSummary }
  | { kind: 'invalid-rows' | 'expired' | 'closed' | 'not-found' | 'failed'; status: number; error?: string };

/** Zatwierdza import: API jeszcze raz sprawdza wiersze i zapisuje zaakceptowane w kalendarzu (wszystkie albo żaden). */
export async function confirmImport(sessionId: string, rows: ImportRowInput[]): Promise<ConfirmImportResult> {
  const response = await postJson(`/api/import/sessions/${encodeURIComponent(sessionId)}/confirm`, { rows });
  if (response.status === 201) return { kind: 'saved', ...((await response.json()) as { saved: number; rejected: number; summary?: ImportSummary }) };
  const kind = response.status === 422 ? 'invalid-rows' : response.status === 410 ? 'expired' : response.status === 409 ? 'closed' : response.status === 404 ? 'not-found' : 'failed';
  const body = (await response.json().catch(() => ({}))) as { error?: string };
  return { kind, status: response.status, error: body.error };
}

/** Anuluje import: sesja kończy się bez zmian w kalendarzu. */
export async function cancelImport(sessionId: string): Promise<void> {
  const response = await postJson(`/api/import/sessions/${encodeURIComponent(sessionId)}/cancel`, {});
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
};

export type ScheduleReadResult =
  | {
      kind: 'read';
      importSessionId: string;
      fileType: 'JPG' | 'PNG' | 'PDF';
      readStatus: 'all' | 'partial';
      readStatusLabel: string;
      readerIsDemo: boolean;
      userName: string;
      rows: ScheduleRow[];
      preview: ImportPreviewRow[];
    }
  | { kind: 'rejected'; error: string }
  | { kind: 'unavailable' };

/** Wysyła plik z grafikiem do API: API sprawdza plik, odczytuje zmiany i zakłada sesję importu. */
export async function readWorkSchedule(fileName: string, dataBase64: string): Promise<ScheduleReadResult> {
  const response = await postJson('/api/import/work-schedule/read', { fileName, dataBase64 });
  if (response.status === 201) return { kind: 'read', ...((await response.json()) as Omit<Extract<ScheduleReadResult, { kind: 'read' }>, 'kind'>) };
  if (response.status === 422) return { kind: 'rejected', error: ((await response.json()) as { error: string }).error };
  return { kind: 'unavailable' };
}

export type ClassRow = ImportRowInput & { reviewRequired: boolean; sourcePage: number };
export type ClassReadResult = { importSessionId: string; academicYear: string; dateFrom: string; dateTo: string;
  rows: ClassRow[]; preview: ImportPreviewRow[]; warnings: string[] };
const pdfErrors: Record<string, string> = {
  'unreadable-image': 'Nie można odczytać obrazu. Wybierz PNG lub JPG do 20 megapikseli.',
  'unsupported-image-layout': 'Nie rozpoznano pełnej tabeli Miniatura WAT. Wybierz wyraźny, prosty zrzut ekranu z nagłówkiem semestru.',
  'unreadable-image-dates': 'Nie można potwierdzić dat. Wybierz wyraźniejszy zrzut całej tabeli.',
  'unreadable-image-times': 'Nie można odczytać godzin. Wybierz wyraźniejszy zrzut ekranu.',
  'empty-image-timetable': 'Na obrazie nie znaleziono zajęć.',
  'unsupported-format': 'Wybierz PDF, PNG lub JPG z e-Dziekanatu WAT.',
  'unsupported-layout': 'Nie rozpoznano planu WAT. Wybierz PDF z tekstem w układzie mini e-D (plan semestru). Skany nie są obsługiwane.',
  'unreadable-pdf': 'Nie można odczytać PDF. Plik może być uszkodzony lub być skanem.',
  'encrypted-pdf': 'PDF zabezpieczony hasłem nie jest obsługiwany.',
  'file-too-large': 'Plik może mieć maksymalnie 5 MB.',
  'reader-busy': 'Trwa odczyt innych plików. Spróbuj za chwilę.',
  'read-timeout': 'Odczyt planu trwał zbyt długo. Wybierz mniejszy plik.',
};
export async function readClassSchedule(name: string, base64: string): Promise<ClassReadResult> {
  const response = await postJson('/api/import/classes/read', { fileName: name, dataBase64: base64 }, AbortSignal.timeout(75000));
  const body = await response.json();
  if (!response.ok) throw new Error(pdfErrors[body.error] ?? 'Nie udało się odczytać planu. Sprawdź plik i połączenie, a następnie spróbuj ponownie.');
  return body;
}
