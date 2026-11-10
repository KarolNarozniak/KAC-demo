// Przykłady w kontrakcie OpenAPI (S23KC2S1P2-183, -153, -178, -191, -207, -217).
// Swagger UI pokazuje nazwane przykłady z `x-examples` w liście „Examples” zamiast wartości wygenerowanych z typów ("string", 0).
// Klucz jest zarejestrowany w Ajv (app.ts), więc schematy żądań nadal są walidowane w trybie strict.
// Dane są syntetyczne – bez prawdziwych osób, tokenów i sekretów (AGENTS.md).

export type NamedExamples = Record<string, { summary: string; description?: string; value: unknown }>;

/** Kopia schematu z nazwanymi przykładami; nie zmienia współdzielonych obiektów schematów. */
export const withExamples = <S extends object>(schema: S, examples: NamedExamples) => ({ ...schema, 'x-examples': examples });

/** Odpowiedź z opisem (zamiast „Default Response”) i przykładami. */
export const documented = <S extends object>(schema: S, description: string, examples: NamedExamples) =>
  withExamples({ ...schema, description }, examples);

const serverSide = 'Błąd po stronie serwera, nie danych – spróbuj ponownie za chwilę. Nic nie zostało zmienione.';
const noDatabase = 'API działa bez skonfigurowanej bazy danych (brak DATABASE_URL), więc ta operacja jest niedostępna.';

/** Wyjaśnienia kodów błędów, które powtarzają się w wielu modułach. */
const errorExplanations: Record<string, string> = {
  database_unavailable: serverSide,
  database_not_configured: noDatabase,
  blocks_unavailable: serverSide,
  blocks_not_configured: noDatabase,
  block_not_saved: serverSide,
  block_not_deleted: serverSide,
  event_not_saved: serverSide,
  event_not_deleted: serverSide,
  invalid_block: 'Tytuł jest pusty albo koniec blokady nie jest później niż jej początek. Nic nie zostało zapisane.',
  block_not_found: 'Nie ma blokady o tym identyfikatorze albo należy ona do innego użytkownika (cudzych blokad nie widać).',
  event_not_found: 'Nie ma wydarzenia o tym identyfikatorze – mogło zostać już usunięte.',
  calendar_not_found: 'Użytkownik nie ma jeszcze kalendarza.',
  'reader-busy': 'Serwer odczytuje teraz inny plik (OCR działa po jednym pliku naraz). Wyślij plik ponownie za kilka sekund.',
  import_session_not_found: 'Nie ma sesji importu o tym identyfikatorze. Trzeba wczytać plik od nowa.',
  import_session_closed: 'Ten import został już zatwierdzony albo anulowany – nie można go zatwierdzić drugi raz.',
  import_session_expired: 'Sesja importu wygasa po 15 minutach bez żadnej akcji. Wczytaj plik ponownie.',
  import_session_not_active: 'Ten import został już zatwierdzony, anulowany albo wygasł, więc nie ma czego anulować.',
};

/** Odpowiedź błędu z jednym albo kilkoma kodami `error`; dla kodu podaj tytuł albo [tytuł, wyjaśnienie]. */
export const errorExamples = (description: string, codes: Record<string, string | [string, string]>) => ({
  type: 'object',
  description,
  required: ['error'],
  additionalProperties: true,
  properties: { error: { type: 'string', enum: Object.keys(codes) } },
  'x-examples': Object.fromEntries(Object.entries(codes).map(([code, text]) => {
    const [summary, explanation] = typeof text === 'string' ? [text, errorExplanations[code]] : text;
    return [code, { summary, ...(explanation ? { description: explanation } : {}), value: { error: code } }];
  })),
}) as const;

/** Błąd walidacji schematu zwracany przez Fastify (400) – ten sam kształt dla wszystkich tras. */
export const validationError = (message: string) => documented({
  type: 'object',
  required: ['statusCode', 'code', 'error', 'message'],
  properties: { statusCode: { type: 'integer' }, code: { type: 'string' }, error: { type: 'string' }, message: { type: 'string' } },
}, 'Żądanie nie spełnia schematu JSON (walidacja Fastify); nic nie zostało zapisane.', {
  validation: {
    summary: 'Dane nie mają wymaganego formatu',
    description: 'Serwer odrzucił żądanie, zanim cokolwiek zrobił: brakuje wymaganego pola albo wartość ma zły format. message mówi, które pole jest złe (np. body/startTime = pole startTime w treści żądania).',
    value: { statusCode: 400, code: 'FST_ERR_VALIDATION', error: 'Bad Request', message },
  },
});
