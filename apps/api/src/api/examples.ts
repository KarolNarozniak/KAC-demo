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

/** Odpowiedź błędu z jednym albo kilkoma kodami `error`. */
export const errorExamples = (description: string, codes: Record<string, string>) => ({
  type: 'object',
  description,
  required: ['error'],
  additionalProperties: true,
  properties: { error: { type: 'string', enum: Object.keys(codes) } },
  'x-examples': Object.fromEntries(Object.entries(codes).map(([code, summary]) => [code, { summary, value: { error: code } }])),
}) as const;

/** Błąd walidacji schematu zwracany przez Fastify (400) – ten sam kształt dla wszystkich tras. */
export const validationError = (message: string) => documented({
  type: 'object',
  required: ['statusCode', 'code', 'error', 'message'],
  properties: { statusCode: { type: 'integer' }, code: { type: 'string' }, error: { type: 'string' }, message: { type: 'string' } },
}, 'Żądanie nie spełnia schematu JSON (walidacja Fastify); nic nie zostało zapisane.', {
  validation: { summary: 'Błąd walidacji', value: { statusCode: 400, code: 'FST_ERR_VALIDATION', error: 'Bad Request', message } },
});
