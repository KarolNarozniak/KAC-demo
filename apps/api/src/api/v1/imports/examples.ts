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
  rows: {
    summary: 'Dwie zmiany z grafiku pracy',
    description: 'Wiersze odczytane z pliku, ewentualnie poprawione przez użytkownika na ekranie kontroli. Druga zmiana trwa 22:00–06:00, czyli kończy się następnego dnia (zmiana nocna). Podgląd niczego nie zapisuje – tylko sprawdza wiersze. importSessionId (opcjonalnie) przedłuża sesję importu o kolejne 15 minut.',
    value: { rows, importSessionId: sessionId },
  },
};

export const previewExamples: NamedExamples = {
  preview: {
    summary: 'Duplikat i zmiana nocna',
    description: 'Wynik sprawdzenia każdego wiersza. r1: w kalendarzu jest już taka sama zmiana (duplicateOfEvents) – przy zapisie użytkownik musi zdecydować, czy ją pominąć, zastąpić, czy zachować obie. r2: overnight: true – zmiana przechodzi przez północ i przy zapisie trzeba to potwierdzić. Czasy start/end są w UTC (13:00Z = 14:00 czasu polskiego).',
    value: { rows: previewRows },
  },
};

export const createSessionExamples: NamedExamples = {
  work: {
    summary: 'Import grafiku pracy z PDF',
    description: 'source mówi, co importujemy (work = grafik pracy, classes = plan zajęć), a format – skąd pochodzą dane. Serwer zapamiętuje wiersze do kontroli; kalendarz się nie zmienia, dopóki użytkownik nie zatwierdzi importu.',
    value: { source: 'work', format: 'PDF', rows },
  },
};

export const sessionExamples: NamedExamples = {
  created: {
    summary: 'Import czeka na sprawdzenie',
    description: 'importSessionId trzeba podać przy zatwierdzaniu albo anulowaniu importu. expiresAt to chwila wygaśnięcia: sesja wygasa po 15 minutach bez żadnej akcji. rows zawiera wynik sprawdzenia wierszy (jak w podglądzie).',
    value: { importSessionId: sessionId, expiresAt: '2026-11-10T16:15:00.000Z', rows: previewRows },
  },
};

export const confirmInputExamples: NamedExamples = {
  confirm: {
    summary: 'Zatwierdzenie z decyzjami użytkownika',
    description: 'Wysyłamy tylko wiersze, które użytkownik chce zapisać, razem z jego decyzjami. r1 była duplikatem: duplicateDecision: replace i replacementId: E-OLD znaczą „zastąp istniejące wydarzenie E-OLD” (inne opcje: skip – pomiń, keepBoth – zachowaj oba). r2 to zmiana nocna: overnightConfirmed: true potwierdza, że naprawdę kończy się następnego dnia.',
    value: { rows: [{ ...rows[0], duplicateDecision: 'replace', replacementId: 'E-OLD' }, { ...rows[1], overnightConfirmed: true }] },
  },
};

export const confirmExamples: NamedExamples = {
  saved: {
    summary: 'Zapisane wydarzenia',
    description: 'Zapis jest „wszystko albo nic”: albo zapisano wszystkie wiersze, albo żaden. summary podsumowuje: added – nowe wydarzenia, replaced – zastąpione duplikaty, skipped – pominięte, rejected – odrzucone. events to zapisane wydarzenia z nowymi id; rowId łączy je z wierszami z pliku.',
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
  overnight: { summary: 'Niepotwierdzona zmiana nocna', description: 'Wiersz r2 kończy się następnego dnia, a nie ma overnightConfirmed: true. Nic nie zapisano – trzeba zapytać użytkownika i wysłać ponownie z potwierdzeniem.', value: { error: 'overnight_not_confirmed', rowIds: ['r2'] } },
  duplicates: { summary: 'Brak decyzji o duplikacie', description: 'Wiersz r1 pokrywa się z wydarzeniem w kalendarzu, ale nie podano duplicateDecision (skip, replace albo keepBoth). Nic nie zapisano.', value: { error: 'duplicate_decision_required', missingDecisions: ['r1'], invalidDecisions: [] } },
  unknownRows: { summary: 'Wiersz spoza tego importu', description: 'Wiersza r9 nie było w odczytanym pliku – można zatwierdzać tylko wiersze z tej sesji importu. Nic nie zapisano.', value: { error: 'unknown_rows', rowIds: ['r9'] } },
};

export const readFileExamples: NamedExamples = {
  pdf: { summary: 'Plik PDF', description: 'Plik wysyłamy jako tekst base64 (zakodowana zawartość pliku) razem z jego nazwą. Tu wartość jest skrócona – w praktyce to cała zawartość pliku, maksymalnie 5 MB. Kalendarz się nie zmienia: serwer tylko odczytuje plik i zakłada import do sprawdzenia.', value: { fileName: 'grafik-listopad.pdf', dataBase64: 'JVBERi0xLjcKJcfsj6IKNSAwIG9iago8PC9MZW5ndGggNiAwIFI+PgpzdHJlYW0K...' } },
  ics: { summary: 'Plik kalendarza ICS', description: 'Eksport kalendarza z USOS, Google, Outlooka albo Apple. Rodzaj pliku serwer rozpoznaje po zawartości, nie po rozszerzeniu. Wartość skrócona – w praktyce cały plik w base64.', value: { fileName: 'plan.ics', dataBase64: 'QkVHSU46VkNBTEVOREFSDQpWRVJTSU9OOjIuMA0K...' } },
};

export const workScheduleReadExamples: NamedExamples = {
  read: {
    summary: 'Odczytany grafik pracy',
    description: 'readStatus mówi, ile udało się odczytać (all – wszystko, partial – część). isOwn: true oznacza zmianę przypisaną do zalogowanego użytkownika (userName), a nie do współpracownika z tego samego grafiku. readerIsDemo: false – plik czytał prawdziwy OCR, nie dane demonstracyjne. Dalej: sprawdzenie wierszy i zatwierdzenie importu.',
    value: { importSessionId: sessionId, expiresAt: '2026-11-10T16:15:00.000Z', fileType: 'PDF', readStatus: 'all', readStatusLabel: 'Odczytano wszystkie zmiany',
      readerIsDemo: false, userName: 'Student Demo', rows: rows.map((row) => ({ ...row, isOwn: true, incomplete: false })), preview: previewRows },
  },
};

export const fileErrorExamples: NamedExamples = {
  unsupported: { summary: 'Nieobsługiwany rodzaj pliku', description: 'Plik nie jest PDF-em, zdjęciem PNG/JPG ani plikiem ICS (np. dokument Word). Kalendarz bez zmian.', value: { error: 'unsupported-format' } },
  tooLarge: { summary: 'Plik większy niż 5 MB', description: 'Zmniejsz plik albo zrób zrzut ekranu tylko potrzebnej części. Kalendarz bez zmian.', value: { error: 'file-too-large' } },
  nothing: { summary: 'Nic nie odczytano', description: 'Plik został otwarty, ale nie znaleziono w nim żadnych zmian (np. nieczytelne zdjęcie albo inny układ grafiku). Kalendarz bez zmian.', value: { error: 'nothing_recognized', readStatusLabel: 'Nie odczytano zmian' } },
};

export const googleConnectionExamples: NamedExamples = {
  demo: { summary: 'Konto demonstracyjne', description: 'Serwer nie ma skonfigurowanego dostępu do Google, więc używa przykładowego konta. Zamiast logowania w Google aplikacja pyta o zgodę u siebie i wysyła odpowiedź na POST /import/google/connections/{id}/consent. connectionId jest potrzebne we wszystkich kolejnych krokach.', value: { connectionId: 'a07c583a-58a7-4a43-a4bf-e0da0c8cfb70', mode: 'demo', demoAccount: 'student.kac.demo@gmail.com' } },
  google: { summary: 'Prawdziwe konto Google', description: 'Aplikacja otwiera authUrl – stronę Google, na której użytkownik loguje się i zgadza na odczyt kalendarza (tylko odczyt). Potem Google sam przekierowuje na /import/google/callback, a aplikacja sprawdza stan połączenia przez GET /import/google/connections/{id}.', value: { connectionId: 'a07c583a-58a7-4a43-a4bf-e0da0c8cfb70', mode: 'google', authUrl: 'https://accounts.google.com/o/oauth2/v2/auth?client_id=...&code_challenge_method=S256' } },
};

export const googleCalendarsExamples: NamedExamples = {
  calendars: { summary: 'Kalendarze na koncie Google', description: 'Lista kalendarzy do wyboru. primary: true to główny kalendarz konta. id wybranego kalendarza wysyła się w następnym kroku (odczyt wydarzeń).', value: { email: 'student.kac.demo@gmail.com', calendars: [
    { id: 'primary', name: 'Student KAC (prywatny)', primary: true }, { id: 'kolo-naukowe', name: 'Koło naukowe Cyberbezpieczeństwa', primary: false },
  ] } },
};

export const googleReadInputExamples: NamedExamples = {
  month: { summary: 'Listopad z głównego kalendarza', description: 'Odczyt wydarzeń z kalendarza primary od 1 do 30 listopada (obie daty włącznie, zakres najwyżej rok). category mówi, jako co zapisać wydarzenia w KAC (Personal = osobiste). Kalendarz KAC się jeszcze nie zmienia.', value: { calendarId: 'primary', from: '2026-11-01', to: '2026-11-30', category: 'Personal' } },
};

export const classReadExamples: NamedExamples = {
  ics: {
    summary: 'Odczytany plan zajęć (plik ICS)',
    description: 'rows to odczytane zajęcia, preview – wynik ich sprawdzenia, collisions – kolizje z wydarzeniami już zapisanymi w kalendarzu (tu brak). eventCount to liczba wydarzeń w pliku, skipped – ile pominięto (np. całodniowe). Jeśli strefa czasowa pliku różni się od strefy użytkownika, godziny są przeliczane. Dla PDF i zdjęć odpowiedź ma te same pola sesji importu.',
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
    summary: 'Wydarzenia z Google do sprawdzenia',
    description: 'Odczytane wydarzenia trafiają do importu do sprawdzenia – nic nie jest jeszcze zapisane w kalendarzu KAC. Wydarzenia całodniowe (np. urodziny) są pomijane; skippedAllDay mówi, ile ich było. Zapis następuje przez zatwierdzenie importu: POST /import/sessions/{importSessionId}/confirm.',
    value: {
      importSessionId: sessionId, expiresAt: '2026-11-10T16:15:00.000Z', email: 'student.kac.demo@gmail.com', calendarName: 'Student KAC (prywatny)', from: '2026-11-01', to: '2026-11-30',
      rows: [{ id: 'g-1', title: 'Spotkanie koła naukowego', date: '2026-11-18', startTime: '18:00', endTime: '19:30', category: 'Personal' }],
      preview: [{ id: 'g-1', status: 'ok', issues: [], start: '2026-11-18T17:00:00.000Z', end: '2026-11-18T18:30:00.000Z', location: null, confidence: null, overnight: false, duplicateOfEvents: [], duplicateOfRows: [] }],
      skippedAllDay: 2, collisions: [],
    },
  },
};
