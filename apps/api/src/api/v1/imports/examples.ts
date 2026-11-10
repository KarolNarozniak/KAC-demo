// Przykłady importów w Swagger UI. Wiersze i odpowiedzi odpowiadają prawdziwym wynikom podglądu (buildImportPreview).
import type { NamedExamples } from '../../examples.js';

const sessionId = '7e1d2c3b-4a59-4687-b6a5-9c8d7e6f5a40';
const rows = [
  { id: 'r1', title: 'Praca', date: '2026-11-18', startTime: '14:00', endTime: '18:00', category: 'Work' },
  { id: 'r2', title: 'Praca', date: '2026-11-19', startTime: '22:00', endTime: '06:00', category: 'Work' },
];
const previewRows = [
  { id: 'r1', status: 'ok', issues: [], start: '2026-11-18T13:00:00.000Z', end: '2026-11-18T17:00:00.000Z', location: null, confidence: null, overnight: false,
    duplicateOfEvents: [{ id: 'E-OLD', title: 'Praca', start: '2026-11-18T13:00:00.000Z' }], duplicateOfRows: [] },
  { id: 'r2', status: 'ok', issues: [], start: '2026-11-19T21:00:00.000Z', end: '2026-11-20T05:00:00.000Z', location: null, confidence: null, overnight: true,
    duplicateOfEvents: [], duplicateOfRows: [] },
];

export const previewInputExamples: NamedExamples = {
  rows: { summary: 'Wiersze po poprawkach użytkownika', description: 'Druga zmiana kończy się następnego dnia (zmiana nocna).', value: { rows, importSessionId: sessionId } },
};

export const previewExamples: NamedExamples = {
  preview: { summary: 'Duplikat i zmiana nocna', description: 'r1 pokrywa się z istniejącym wydarzeniem, r2 wymaga potwierdzenia nocy przy zapisie.', value: { rows: previewRows } },
};

export const createSessionExamples: NamedExamples = {
  work: { summary: 'Sesja importu grafiku pracy', value: { source: 'work', format: 'PDF', rows } },
};

export const sessionExamples: NamedExamples = {
  created: { summary: 'Sesja do kontroli (15 min)', value: { importSessionId: sessionId, expiresAt: '2026-11-10T16:15:00.000Z', rows: previewRows } },
};

export const confirmInputExamples: NamedExamples = {
  confirm: {
    summary: 'Zatwierdzenie z decyzjami',
    description: 'Duplikat r1 zastępuje istniejące wydarzenie, zmiana nocna r2 jest potwierdzona.',
    value: { rows: [{ ...rows[0], duplicateDecision: 'replace', replacementId: 'E-OLD' }, { ...rows[1], overnightConfirmed: true }] },
  },
};

export const confirmExamples: NamedExamples = {
  saved: {
    summary: 'Zapisane wydarzenia',
    value: {
      saved: 2, rejected: 0, summary: { added: 1, replaced: 1, skipped: 0, rejected: 0 },
      events: [
        { id: 'c3d4e5f6-0000-4000-8000-000000000011', rowId: 'r1', action: 'replaced', title: 'Praca', start: '2026-11-18T13:00:00.000Z', end: '2026-11-18T17:00:00.000Z', category: 'Work', location: null },
        { id: 'c3d4e5f6-0000-4000-8000-000000000012', rowId: 'r2', action: 'added', title: 'Praca', start: '2026-11-19T21:00:00.000Z', end: '2026-11-20T05:00:00.000Z', category: 'Work', location: null },
      ],
    },
  },
};

export const confirmRejectedExamples: NamedExamples = {
  overnight: { summary: 'Niepotwierdzona zmiana nocna', value: { error: 'overnight_not_confirmed', rowIds: ['r2'] } },
  duplicates: { summary: 'Brak decyzji o duplikacie', value: { error: 'duplicate_decision_required', missingDecisions: ['r1'], invalidDecisions: [] } },
  unknownRows: { summary: 'Wiersze spoza sesji', value: { error: 'unknown_rows', rowIds: ['r9'] } },
};

export const readFileExamples: NamedExamples = {
  pdf: { summary: 'Plik PDF w base64', description: 'Wartość skrócona – w praktyce cały plik (do 5 MB).', value: { fileName: 'grafik-listopad.pdf', dataBase64: 'JVBERi0xLjcKJcfsj6IKNSAwIG9iago8PC9MZW5ndGggNiAwIFI+PgpzdHJlYW0K...' } },
  ics: { summary: 'Plik ICS w base64', value: { fileName: 'plan.ics', dataBase64: 'QkVHSU46VkNBTEVOREFSDQpWRVJTSU9OOjIuMA0K...' } },
};

export const workScheduleReadExamples: NamedExamples = {
  read: {
    summary: 'Odczytany grafik pracy',
    value: { importSessionId: sessionId, expiresAt: '2026-11-10T16:15:00.000Z', fileType: 'PDF', readStatus: 'all', readStatusLabel: 'Odczytano wszystkie zmiany',
      readerIsDemo: false, userName: 'Student Demo', rows: rows.map((row) => ({ ...row, isOwn: true, incomplete: false })), preview: previewRows },
  },
};

export const fileErrorExamples: NamedExamples = {
  unsupported: { summary: 'Nieobsługiwany format', value: { error: 'unsupported-format' } },
  tooLarge: { summary: 'Plik większy niż 5 MB', value: { error: 'file-too-large' } },
  nothing: { summary: 'Nic nie rozpoznano', value: { error: 'nothing_recognized', readStatusLabel: 'Nie odczytano zmian' } },
};

export const googleConnectionExamples: NamedExamples = {
  demo: { summary: 'Tryb demonstracyjny', description: 'Bez GOOGLE_CLIENT_ID; zgodę zapisuje POST .../consent.', value: { connectionId: 'a07c583a-58a7-4a43-a4bf-e0da0c8cfb70', mode: 'demo', demoAccount: 'student.kac.demo@gmail.com' } },
  google: { summary: 'OAuth Google', description: 'Aplikacja otwiera authUrl; Google wraca na /callback.', value: { connectionId: 'a07c583a-58a7-4a43-a4bf-e0da0c8cfb70', mode: 'google', authUrl: 'https://accounts.google.com/o/oauth2/v2/auth?client_id=...&code_challenge_method=S256' } },
};

export const googleCalendarsExamples: NamedExamples = {
  calendars: { summary: 'Kalendarze konta', value: { email: 'student.kac.demo@gmail.com', calendars: [
    { id: 'primary', name: 'Student KAC (prywatny)', primary: true }, { id: 'kolo-naukowe', name: 'Koło naukowe Cyberbezpieczeństwa', primary: false },
  ] } },
};

export const googleReadInputExamples: NamedExamples = {
  month: { summary: 'Listopad z kalendarza głównego', value: { calendarId: 'primary', from: '2026-11-01', to: '2026-11-30', category: 'Personal' } },
};

export const classReadExamples: NamedExamples = {
  ics: {
    summary: 'Plan zajęć z pliku ICS',
    description: 'Pliki PDF i zdjęcia zwracają te same pola sesji (importSessionId, rows, preview, collisions) oraz dane semestru.',
    value: {
      source: 'ics', importSessionId: sessionId, expiresAt: '2026-11-10T16:15:00.000Z', academicYear: 'Plan WCY23KC2S1', calendarName: 'Plan WCY23KC2S1',
      dateFrom: '2026-11-16', dateTo: '2026-11-20', eventCount: 1, skipped: 0, fileTimeZone: 'Europe/Warsaw', userTimeZone: 'Europe/Warsaw', warnings: [],
      rows: [{ id: 'ics-1', title: 'Algorytmy – wykład', date: '2026-11-16', startTime: '10:00', endTime: '13:15', category: 'Class', location: 'Bud. 100, aula 2', reviewRequired: false, sourcePage: 1 }],
      preview: [{ id: 'ics-1', status: 'ok', issues: [], start: '2026-11-16T09:00:00.000Z', end: '2026-11-16T12:15:00.000Z', location: 'Bud. 100, aula 2', confidence: null, overnight: false, duplicateOfEvents: [], duplicateOfRows: [] }],
      collisions: [],
    },
  },
};

export const googleReadExamples: NamedExamples = {
  read: {
    summary: 'Wydarzenia do kontroli',
    description: 'Wydarzenia całodniowe są pomijane i liczone w skippedAllDay. Zapis – wspólnym endpointem /import/sessions/{id}/confirm.',
    value: {
      importSessionId: sessionId, expiresAt: '2026-11-10T16:15:00.000Z', email: 'student.kac.demo@gmail.com', calendarName: 'Student KAC (prywatny)', from: '2026-11-01', to: '2026-11-30',
      rows: [{ id: 'g-1', title: 'Spotkanie koła naukowego', date: '2026-11-18', startTime: '18:00', endTime: '19:30', category: 'Personal' }],
      preview: [{ id: 'g-1', status: 'ok', issues: [], start: '2026-11-18T17:00:00.000Z', end: '2026-11-18T18:30:00.000Z', location: null, confidence: null, overnight: false, duplicateOfEvents: [], duplicateOfRows: [] }],
      skippedAllDay: 2, collisions: [],
    },
  },
};
