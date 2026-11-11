// Kontrakt grafiku – zajęcia uwzględniane przy planowaniu (S23KC2S1P2-40, dokumentacja: S23KC2S1P2-197).
// Schematy opisują pola związane z zajęciami; pozostałe pola grafiku są przekazywane bez zmian (additionalProperties).

const localDateTime = { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}$', description: 'Lokalna data i godzina w strefie profilu (YYYY-MM-DDTHH:MM).' } as const;
const instant = { type: 'string', format: 'date-time' } as const;

/** BlockingEvent: wystąpienie wydarzenia w planowanym tygodniu, serie są rozwinięte na konkretne daty. */
export const blockingEventSchema = {
  type: 'object',
  title: 'BlockingEvent',
  description: 'Wystąpienie wydarzenia uwzględnione przy planowaniu tygodnia. Zajęcia cotygodniowe są rozwinięte na konkretne daty (z datą końca serii i lokalną godziną po zmianie czasu).',
  required: ['eventId', 'title', 'category', 'mandatory', 'repeatWeekly', 'start', 'end', 'startLocal', 'endLocal', 'effect', 'bufferMinutes'],
  properties: {
    eventId: { type: 'string' },
    title: { type: 'string' },
    category: { type: 'string', enum: ['Class', 'Work', 'Personal'] },
    mandatory: { type: 'boolean', description: 'Zajęcia obowiązkowe.' },
    repeatWeekly: { type: 'boolean', description: 'Wystąpienie pochodzi z serii cotygodniowej.' },
    start: instant, end: instant, startLocal: localDateTime, endLocal: localDateTime,
    effect: { type: 'string', enum: ['hard', 'soft'], description: 'hard – w tym czasie (z buforem) nie wolno planować pracy; soft – zajęcia nieobowiązkowe, pomijane tylko w ostateczności z ostrzeżeniem.' },
    bufferMinutes: { type: 'integer', description: 'Czas wolny wymagany przed i po wydarzeniu: dojazd, a przy pracy także odpoczynek.' },
  },
} as const;

export const freeWindowSchema = {
  type: 'object',
  title: 'FreeWindow',
  description: 'Przedział, w którym można zaplanować pracę: dostępność minus zajęcia obowiązkowe, inne wydarzenia (z buforem) i blokady. Pomija przedziały krótsze niż minimalna zmiana.',
  required: ['start', 'end', 'startLocal', 'endLocal', 'minutes'],
  properties: { start: instant, end: instant, startLocal: localDateTime, endLocal: localDateTime, minutes: { type: 'integer' } },
} as const;

/** ClassCollisionViolation: zmiana nachodzi na zajęcia obowiązkowe albo na czas dojazdu przed lub po nich. */
export const classCollisionViolationSchema = {
  type: 'object',
  title: 'ClassCollisionViolation',
  description: 'Zmiana pracy koliduje z zajęciami obowiązkowymi. Kolizja oznacza przecięcie przedziałów [początek zmiany, koniec zmiany) i [początek zajęć − bufor, koniec zajęć + bufor); samo zetknięcie granic nie jest kolizją.',
  required: ['code', 'severity', 'message', 'candidateIds', 'eventIds', 'details'],
  properties: {
    code: { type: 'string', enum: ['class_collision'] },
    severity: { type: 'string', enum: ['error'] },
    message: { type: 'string' },
    candidateIds: { type: 'array', items: { type: 'string' }, description: 'Identyfikator kolidującej zmiany.' },
    eventIds: { type: 'array', items: { type: 'string' }, description: 'Identyfikator zajęć.' },
    details: {
      type: 'object',
      required: ['eventId', 'title', 'mandatory', 'classStartLocal', 'classEndLocal', 'overlapStartLocal', 'overlapEndLocal', 'bufferMinutes'],
      properties: {
        eventId: { type: 'string' }, title: { type: 'string' }, mandatory: { type: 'boolean' },
        classStartLocal: localDateTime, classEndLocal: localDateTime,
        overlapStartLocal: { ...localDateTime, description: 'Początek części wspólnej zmiany i zajęć z buforem.' },
        overlapEndLocal: { ...localDateTime, description: 'Koniec części wspólnej zmiany i zajęć z buforem.' },
        bufferMinutes: { type: 'integer' },
      },
    },
  },
} as const;

const genericViolationSchema = {
  type: 'object',
  title: 'ScheduleViolation',
  description: [
    'Naruszenie albo ostrzeżenie grafiku. Najważniejsze kody:',
    '- maximum_hours (error) – łączny czas pracy w tygodniu (już zapisane zmiany + proponowane) przekracza maximumHours z profilu pracy. details: maximumMinutes, totalMinutes.',
    '- daily_maximum_hours (error) – czas pracy w jednym dniu przekracza maxHoursPerDay. details: date, maximumMinutes, totalMinutes.',
    '- existing_work_exceeds_maximum (error) – już zapisane zmiany w tym tygodniu same przekraczają maximumHours, więc nie da się dołożyć nowych. details: maximumMinutes, existingWorkMinutes.',
    '- insufficient_free_time – wolny czas po odjęciu zajęć nie wystarcza na cel.',
    '- target_shortfall, minimum_shortfall (warning) – grafik poniżej celu lub minimum godzin.',
    '- optional_lecture_conflict – zmiana nachodzi na zajęcia nieobowiązkowe.',
    'Wartości w details są w minutach.',
  ].join('\n'),
  required: ['code', 'severity', 'message'],
  properties: {
    code: { type: 'string' }, severity: { type: 'string', enum: ['warning', 'error'] }, message: { type: 'string' },
    candidateIds: { type: 'array', items: { type: 'string' } }, eventIds: { type: 'array', items: { type: 'string' } },
    details: { type: 'object', additionalProperties: true },
  },
} as const;

export const violationSchema = { anyOf: [classCollisionViolationSchema, genericViolationSchema] } as const;

/** Grafik w odpowiedzi API. */
export const scheduleResponseSchema = {
  type: 'object',
  title: 'WeeklySchedule',
  description: 'Propozycja albo zatwierdzony grafik tygodnia. blockingEvents i freeWindows są wyliczane z bieżącego kalendarza i profilu.',
  additionalProperties: true,
  properties: {
    estimatedPayPln:{type:'number',description:'Sum of individually rounded PLN pay snapshots for proposed shifts.'},
    shifts:{type:'array',items:{type:'object',additionalProperties:true,properties:{hourlyRatePln:{type:'number',description:'Hourly rate snapshot in PLN.'},estimatedPayPln:{type:'number',description:'halfUp(rateGrosz * elapsedMinutes / 60) / 100; commute is unpaid.'},rateKind:{anyOf:[{type:'string',enum:['gross','net']},{type:'null'}]}}}},
    blockingEvents: { type: 'array', items: blockingEventSchema, description: 'Zajęcia i inne wydarzenia tygodnia uwzględnione przy planowaniu.' },
    freeWindows: { type: 'array', items: freeWindowSchema },
    freeMinutes: { type: 'integer', description: 'Suma wolnych przedziałów w minutach.' },
    violations: { type: 'array', items: violationSchema },
  },
} as const;

export const invalidScheduleSchema = {
  type: 'object',
  title: 'InvalidSchedule',
  description: 'Grafik narusza ograniczenia. Kolizja z zajęciami obowiązkowymi ma kod class_collision i wskazuje zajęcia.',
  required: ['error', 'errors', 'warnings'],
  properties: {
    error: { type: 'string', enum: ['invalid_schedule'] },
    errors: { type: 'array', items: violationSchema },
    warnings: { type: 'array', items: violationSchema },
  },
} as const;
