// Przykłady grafików w Swagger UI (S23KC2S1P2-191, -207, -217).
// Wartości pochodzą z prawdziwego generatora (greedy-v1) uruchomionego dla profilu z api/v1/profile/examples.ts:
// dostępność pn–pt 12:00–20:00, cel 16 h, dojazd 30 min, stawka 32,50 zł brutto, zajęcia w poniedziałek 10:00–13:15.
import type { NamedExamples } from '../../examples.js';

const scheduleId = 'b7d2c1e0-4f5a-4c3e-9a10-2f6d8e9b1a01';
const weekStart = '2026-11-16';
const parameters = {
  mode: 'elastyczny', minimumMinutes: 480, targetMinutes: 960, maximumMinutes: 1200, commuteBufferMinutes: 30, minimumRestMinutes: 0,
  minimumShiftMinutes: 240, maximumSlotMinutes: 480, maxHoursPerDay: 8, candidateStepMinutes: 30, workaholic: false, shiftTemplateIds: [],
  optionalLecturePenalty: 10, extraWorkdayPenalty: 2, profileVersion: 'pv-7',
};
const lecture = (date: string, utcStart: string, utcEnd: string) => ({
  eventId: 'E-ALG', title: 'Algorytmy – wykład', category: 'Class', mandatory: true, repeatWeekly: true,
  start: `${date}T${utcStart}:00.000Z`, end: `${date}T${utcEnd}:00.000Z`, startLocal: `${date}T10:00`, endLocal: `${date}T13:15`, effect: 'hard', bufferMinutes: 30,
});
const blockingEvents = [lecture('2026-11-16', '09:00', '12:15'), lecture('2026-11-23', '09:00', '12:15')];
const shift = (date: string, start: string, end: string, minutes: number, pay: number) => ({
  candidateId: `flex-${date}-${start.replace(':', '')}-${minutes}`, title: 'Praca',
  start: `${date}T${utc(start)}:00.000Z`, end: `${date}T${utc(end)}:00.000Z`, startLocal: `${date}T${start}`, endLocal: `${date}T${end}`,
  durationMinutes: minutes, workDate: date, mode: 'elastyczny', optionalLectureIds: [], softPenalty: 0,
  hourlyRatePln: 32.5, estimatedPayPln: pay, rateKind: 'gross',
});
// Europe/Warsaw w listopadzie to UTC+1.
function utc(local: string) { return `${String(Number(local.slice(0, 2)) - 1).padStart(2, '0')}${local.slice(2)}`; }
const window = (date: string, start: string, minutes: number) => ({
  start: `${date}T${utc(start)}:00.000Z`, end: `${date}T19:00:00.000Z`, startLocal: `${date}T${start}`, endLocal: `${date}T20:00`, minutes,
});
const summary = { weekStart, timeZone: 'Europe/Warsaw', mode: 'elastyczny', isApproved: false, workflowStatus: 'proposed', minimumMinutes: 480, targetMinutes: 960, maximumMinutes: 1200,
  existingWorkMinutes: 0, optionalLecturesSkipped: [], generatedAt: '2026-11-10T16:00:00.000Z', generatorVersion: 'greedy-v1', parameters, scheduleId, version: 1 };

export const fullSchedule = {
  ...summary,
  solutionStatus: 'target_met', maximumCapacityMinutes: 1200, proposedMinutes: 1080, totalMinutes: 1080, shortfallMinutes: 0, minimumShortfallMinutes: 0, upperBoundMinutes: 1200, workdaysUsed: 3,
  estimatedPayPln: 585,
  shifts: [shift('2026-11-16', '14:00', '18:00', 240, 130), shift('2026-11-17', '12:30', '19:30', 420, 227.5), shift('2026-11-18', '12:30', '19:30', 420, 227.5)],
  violations: [],
  blockingEvents,
  freeWindows: [window('2026-11-16', '13:45', 375), window('2026-11-17', '12:00', 480), window('2026-11-18', '12:00', 480), window('2026-11-19', '12:00', 480), window('2026-11-20', '12:00', 480)],
  freeMinutes: 2295,
};

const partialSchedule = {
  ...summary,
  solutionStatus: 'not_found', maximumCapacityMinutes: 300, proposedMinutes: 300, totalMinutes: 300, shortfallMinutes: 660, minimumShortfallMinutes: 180, upperBoundMinutes: 1200, workdaysUsed: 1,
  estimatedPayPln: 162.5,
  shifts: [shift('2026-11-17', '14:30', '19:30', 300, 162.5)],
  violations: [
    { code: 'minimum_hours_shortfall', severity: 'warning', message: 'Do minimalnego wymiaru brakuje 180 minut.', candidateIds: [], eventIds: [], details: { minimumMinutes: 480, totalMinutes: 300, minimumShortfallMinutes: 180 } },
    { code: 'target_shortfall', severity: 'warning', message: 'Heurystyka nie znalazła pełnego grafiku; cel może być osiągalny po zmianie ustawień.', candidateIds: [], eventIds: [], details: { targetMinutes: 960, totalMinutes: 300, upperBoundMinutes: 1200 } },
    { code: 'insufficient_free_time', severity: 'warning', message: 'Po odjęciu zajęć i dojazdów w dostępności zostaje 6 h 0 min wolnego czasu – za mało, żeby osiągnąć cel. Zmień dostępność albo cel w profilu pracy.', candidateIds: [], eventIds: ['E-ALG', 'E-ALG'], details: { freeMinutes: 360, existingWorkMinutes: 0, targetMinutes: 960, missingMinutes: 600 } },
  ],
  blockingEvents,
  freeWindows: [window('2026-11-17', '14:00', 360)],
  freeMinutes: 360,
};

const emptySchedule = {
  ...summary,
  solutionStatus: 'proven_infeasible', maximumCapacityMinutes: 0, proposedMinutes: 0, totalMinutes: 0, shortfallMinutes: 960, minimumShortfallMinutes: 480, upperBoundMinutes: 0, workdaysUsed: 0,
  estimatedPayPln: 0,
  shifts: [],
  violations: [
    { code: 'minimum_hours_shortfall', severity: 'warning', message: 'Do minimalnego wymiaru brakuje 480 minut.', candidateIds: [], eventIds: [], details: { minimumMinutes: 480, totalMinutes: 0, minimumShortfallMinutes: 480 } },
    { code: 'upper_bound_below_target', severity: 'warning', message: 'Górna granica dostępnych godzin jest niższa od celu.', candidateIds: [], eventIds: [], details: { targetMinutes: 960, totalMinutes: 0, upperBoundMinutes: 0 } },
    { code: 'insufficient_free_time', severity: 'warning', message: 'Po odjęciu zajęć i dojazdów w dostępności zostaje 0 h 0 min wolnego czasu – za mało, żeby osiągnąć cel. Zmień dostępność albo cel w profilu pracy.', candidateIds: [], eventIds: ['E-ALG', 'E-ALG'], details: { freeMinutes: 0, existingWorkMinutes: 0, targetMinutes: 960, missingMinutes: 960 } },
  ],
  blockingEvents: [lecture('2026-11-16', '09:00', '12:15')],
  freeWindows: [],
  freeMinutes: 0,
};

export const generateScheduleExamples: NamedExamples = {
  basic: { summary: 'Grafik na tydzień', description: 'profileVersion pochodzi z GET /api/v1/work-profile.', value: { weekStart, profileVersion: 'pv-7' } },
  noClasses: { summary: 'Tydzień bez zajęć (potwierdzony)', description: 'Bez confirmNoClasses tydzień bez zajęć zwraca 409 no_classes_for_week.', value: { weekStart: '2026-12-28', profileVersion: 'pv-7', confirmNoClasses: true } },
  overrides: { summary: 'Jednorazowa zmiana ustawień', description: 'overrides dotyczą tylko tej propozycji; profil pozostaje bez zmian.', value: { weekStart, profileVersion: 'pv-7', overrides: { targetHours: 12, maxHoursPerDay: 6 } } },
};

/** Wynik generowania: pełny, częściowy i pusty to poprawne odpowiedzi 201 (S23KC2S1P2-207). */
export const scheduleExamples: NamedExamples = {
  full: { summary: 'Pełna propozycja (target_met)', description: 'Cel 16 h osiągnięty; zmiany omijają wykład wraz z 30 min dojazdu.', value: fullSchedule },
  partial: {
    summary: 'Częściowa propozycja (not_found)',
    description: 'Heurystyka nie znalazła pełnego grafiku – nie oznacza to dowodu, że cel jest nieosiągalny. shortfallMinutes podaje brakujące minuty.',
    value: partialSchedule,
  },
  empty: {
    summary: 'Pusty wynik (proven_infeasible)',
    description: 'Po odjęciu zajęć i dojazdu nie zostaje wolny czas – brak zmian jest udowodniony, to nie jest błąd serwera.',
    value: emptySchedule,
  },
};

export const approvedScheduleExamples: NamedExamples = {
  approved: { summary: 'Zatwierdzony grafik', description: 'Zmiany zapisano w kalendarzu jako wydarzenia kategorii Work.', value: { ...fullSchedule, isApproved: true, workflowStatus: 'accepted', approvedAt: '2026-11-10T16:05:00.000Z' } },
};

export const updatedScheduleExamples: NamedExamples = {
  moved: {
    summary: 'Zmiana przesunięta ręcznie',
    description: 'Sukces zwiększa version i przelicza podsumowanie; wydarzenia kalendarza powstają dopiero po zatwierdzeniu.',
    value: { ...fullSchedule, version: 2, shifts: [fullSchedule.shifts[0], { ...fullSchedule.shifts[1], start: '2026-11-17T12:00:00.000Z', end: '2026-11-17T19:00:00.000Z', startLocal: '2026-11-17T13:00', endLocal: '2026-11-17T20:00' }, fullSchedule.shifts[2]] },
  },
};

/** PUT /schedules/{weekStart}: lista zmian po korekcie (S23KC2S1P2-217). */
export const updateScheduleExamples: NamedExamples = {
  move: {
    summary: 'Przesunięcie wtorkowej zmiany o 30 min',
    description: 'Wysyłamy pełną listę zmian tygodnia i expectedVersion z ostatniego odczytu.',
    value: { expectedVersion: 1, shifts: [
      { id: 'flex-2026-11-16-1400-240', startLocal: '2026-11-16T14:00', endLocal: '2026-11-16T18:00' },
      { id: 'flex-2026-11-17-1230-420', startLocal: '2026-11-17T13:00', endLocal: '2026-11-17T20:00' },
      { id: 'flex-2026-11-18-1230-420', startLocal: '2026-11-18T12:30', endLocal: '2026-11-18T19:30' },
    ] },
  },
  collision: {
    summary: 'Zmiana nachodząca na zajęcia (zwróci 422)',
    value: { expectedVersion: 1, shifts: [{ id: 'X1', startLocal: '2026-11-16T12:00', endLocal: '2026-11-16T16:00' }] },
  },
};

export const invalidScheduleExamples: NamedExamples = {
  classCollision: {
    summary: 'Kolizja z zajęciami obowiązkowymi',
    description: 'Zmiana 12:00–16:00 nachodzi na wykład 10:00–13:15 z 30 min dojazdu (część wspólna 12:00–13:45).',
    value: {
      error: 'invalid_schedule',
      errors: [
        { code: 'outside_availability', severity: 'error', message: 'Zmiana wraz z buforem dojazdu wykracza poza dostępność studenta.', candidateIds: ['X1'], eventIds: [], details: {} },
        { code: 'class_collision', severity: 'error', message: 'Zmiana koliduje z zajęciami obowiązkowymi „Algorytmy – wykład” (2026-11-16 10:00–13:15, z dojazdem 30 min).', candidateIds: ['X1'], eventIds: ['E-ALG'],
          details: { eventId: 'E-ALG', title: 'Algorytmy – wykład', mandatory: true, classStartLocal: '2026-11-16T10:00', classEndLocal: '2026-11-16T13:15', overlapStartLocal: '2026-11-16T12:00', overlapEndLocal: '2026-11-16T13:45', bufferMinutes: 30 } },
      ],
      warnings: [
        { code: 'target_shortfall', severity: 'warning', message: 'Propozycja jest poniżej celu godzinowego.', candidateIds: ['X1'], eventIds: [], details: { targetMinutes: 960, totalMinutes: 240 } },
      ],
    },
  },
};

export const scheduleListExamples: NamedExamples = {
  page: {
    summary: 'Strona listy grafików',
    value: { items: [
      { scheduleId, weekStart, status: 'proposed', solutionStatus: 'target_met', version: 2, generatorVersion: 'greedy-v1', isApproved: false, isRejected: false, targetMinutes: 960, totalMinutes: 1080, shortfallMinutes: 0 },
      { scheduleId: '5c4b3a29-1807-4f6e-9d5c-4b3a29180716', weekStart: '2026-11-09', status: 'accepted', solutionStatus: 'not_found', version: 1, generatorVersion: 'greedy-v1', isApproved: true, isRejected: false, targetMinutes: 960, totalMinutes: 720, shortfallMinutes: 240 },
    ], total: 2, limit: 20, offset: 0 },
  },
};

export const rejectedScheduleExamples: NamedExamples = {
  rejected: { summary: 'Propozycje odrzucone', description: 'schedule to ostatni nieodrzucony grafik tygodnia (np. wcześniej zatwierdzony) albo null.', value: { rejected: true, schedule: null } },
};

export const scheduleErrorExamples = {
  400: {
    invalid_week_start: { summary: 'weekStart nie jest poniedziałkiem', value: { error: 'invalid_week_start' } },
    invalid_scheduler_settings: { summary: 'Sprzeczne ustawienia generatora', value: { error: 'invalid_scheduler_settings', message: 'Ustawienia muszą spełniać: 0 ≤ minimum ≤ cel ≤ maksimum w tygodniu.' } },
  },
  404: {
    work_profile_not_found: { summary: 'Brak profilu pracy', value: { error: 'work_profile_not_found' } },
    schedule_not_found: { summary: 'Brak grafiku', value: { error: 'schedule_not_found' } },
  },
  409: {
    profile_version_conflict: { summary: 'Profil zmienił się po odczycie', value: { error: 'profile_version_conflict', profileVersion: 'pv-8' } },
    schedule_version_conflict: { summary: 'Grafik zmienił się po odczycie', value: { error: 'schedule_version_conflict', currentVersion: 3 } },
    schedule_already_approved: { summary: 'Grafik jest już zatwierdzony', value: { error: 'schedule_already_approved' } },
    profile_setup_required: { summary: 'Brak dostępności albo celu', value: { error: 'profile_setup_required', missing: ['availability'] } },
    no_classes_for_week: { summary: 'Tydzień bez zajęć – wymagane potwierdzenie', value: { error: 'no_classes_for_week', requiresConfirmation: true } },
  },
  503: {
    scheduling_not_configured: { summary: 'Repozytorium grafików nieskonfigurowane', value: { error: 'scheduling_not_configured' } },
    schedule_generation_failed: { summary: 'Błąd infrastruktury przy generowaniu', description: 'Nie mylić z pustym wynikiem proven_infeasible (201).', value: { error: 'schedule_generation_failed' } },
  },
} satisfies Record<number, NamedExamples>;
