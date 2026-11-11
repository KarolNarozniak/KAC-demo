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
  basic: {
    summary: 'Ułóż grafik na tydzień od 16 listopada',
    description: 'Najprostsze żądanie: serwer sam ułoży propozycję zmian na tydzień zaczynający się w poniedziałek weekStart (musi to być poniedziałek). profileVersion to wersja profilu pracy z ostatniego odczytu (GET /api/v1/work-profile) – jeśli profil zmienił się w międzyczasie, serwer zwróci 409, żeby nie układać grafiku na starych ustawieniach.',
    value: { weekStart, profileVersion: 'pv-7' },
  },
  noClasses: { summary: 'Tydzień bez zajęć (np. przerwa świąteczna)', description: 'W tym tygodniu w kalendarzu nie ma żadnych zajęć. To może być pomyłka (np. nie zaimportowano planu), więc serwer najpierw odpowiada 409 no_classes_for_week i pyta o potwierdzenie. confirmNoClasses: true oznacza: „wiem, że nie ma zajęć, układaj grafik”.', value: { weekStart: '2026-12-28', profileVersion: 'pv-7', confirmNoClasses: true } },
  overrides: { summary: 'Inne ustawienia tylko dla tego tygodnia', description: 'Student chce w tym tygodniu pracować mniej: cel 12 h zamiast 16 h i najwyżej 6 h dziennie. overrides zmieniają ustawienia tylko dla tej jednej propozycji – zapisany profil pracy zostaje bez zmian.', value: { weekStart, profileVersion: 'pv-7', overrides: { targetHours: 12, maxHoursPerDay: 6 } } },
};

/** Wynik generowania: pełny, częściowy i pusty to poprawne odpowiedzi 201 (S23KC2S1P2-207). */
export const scheduleExamples: NamedExamples = {
  full: {
    summary: 'Udało się osiągnąć cel (target_met)',
    description: 'Generator zaplanował 3 zmiany: pn 14:00–18:00, wt i śr 12:30–19:30 – razem 18 h (totalMinutes: 1080), przy celu 16 h (targetMinutes: 960), więc cel jest osiągnięty i shortfallMinutes = 0. Poniedziałkowa zmiana zaczyna się dopiero o 14:00, bo wykład kończy się o 13:15, a potem jest 30 min na dojazd. estimatedPayPln: 585 zł to szacowane wynagrodzenie przy stawce 32,50 zł/h. blockingEvents to zajęcia, które generator musiał ominąć, a freeWindows – wolne okna, w których mógł planować. Wszystkie czasy z literą Z są w UTC; startLocal/endLocal pokazują czas polski.',
    value: fullSchedule,
  },
  partial: {
    summary: 'Cel osiągnięty tylko częściowo (not_found)',
    description: 'Student jest dostępny tylko we wtorek 14:00–20:00, więc generator zaplanował jedną zmianę 14:30–19:30 (5 h) zamiast 16 h. shortfallMinutes: 660 – brakuje 11 h do celu, a minimumShortfallMinutes: 180 – brakuje 3 h nawet do minimum 8 h. violations wyjaśnia, dlaczego: za mało wolnego czasu po odjęciu zajęć i dojazdów. To nadal poprawna odpowiedź (201), nie błąd – użytkownik może zmienić dostępność albo cel i wygenerować grafik ponownie. not_found znaczy „nie znaleziono pełnego grafiku”, a nie „na pewno się nie da”.',
    value: partialSchedule,
  },
  empty: {
    summary: 'Nie da się ułożyć żadnej zmiany (proven_infeasible)',
    description: 'Student jest dostępny tylko w poniedziałek 9:00–14:00, a wtedy ma wykład 10:00–13:15 plus 30 min dojazdu – nie zostaje żaden wolny czas (freeMinutes: 0). Grafik jest pusty (shifts: []) i serwer wie na pewno, że przy tych ustawieniach nic się nie da zaplanować (proven_infeasible). To poprawna odpowiedź 201, nie awaria serwera – awaria to 503.',
    value: emptySchedule,
  },
};

export const approvedScheduleExamples: NamedExamples = {
  approved: { summary: 'Grafik zatwierdzony', description: 'Użytkownik zaakceptował propozycję: zmiany zostały zapisane w kalendarzu jako wydarzenia kategorii Praca. isApproved: true, workflowStatus: accepted, a approvedAt mówi, kiedy to się stało. Przed zapisem serwer jeszcze raz sprawdza grafik z aktualnym kalendarzem.', value: { ...fullSchedule, isApproved: true, workflowStatus: 'accepted', approvedAt: '2026-11-10T16:05:00.000Z' } },
};

export const updatedScheduleExamples: NamedExamples = {
  moved: {
    summary: 'Wtorkowa zmiana przesunięta',
    description: 'Korekta zapisana: wtorkowa zmiana trwa teraz 13:00–20:00 zamiast 12:30–19:30. version wzrósł z 1 na 2 – przy kolejnej korekcie albo zatwierdzeniu trzeba wysłać expectedVersion: 2. Zmiany są zapisane tylko w propozycji grafiku; w kalendarzu pojawią się dopiero po zatwierdzeniu (POST .../approve).',
    value: { ...fullSchedule, version: 2, shifts: [fullSchedule.shifts[0], { ...fullSchedule.shifts[1], start: '2026-11-17T12:00:00.000Z', end: '2026-11-17T19:00:00.000Z', startLocal: '2026-11-17T13:00', endLocal: '2026-11-17T20:00' }, fullSchedule.shifts[2]] },
  },
};

/** PUT /schedules/{weekStart}: lista zmian po korekcie (S23KC2S1P2-217). */
export const updateScheduleExamples: NamedExamples = {
  move: {
    summary: 'Przesuń wtorkową zmianę o 30 minut',
    description: 'Wysyłamy wszystkie zmiany tygodnia – także te, których nie ruszamy. Zmieniona jest tylko druga: wtorek 13:00–20:00 zamiast 12:30–19:30. id to identyfikator zmiany z propozycji (candidateId), godziny są w czasie polskim. expectedVersion to version grafiku z ostatniego odczytu – jeśli ktoś w międzyczasie zmienił grafik, serwer zwróci 409.',
    value: { expectedVersion: 1, shifts: [
      { id: 'flex-2026-11-16-1400-240', startLocal: '2026-11-16T14:00', endLocal: '2026-11-16T18:00' },
      { id: 'flex-2026-11-17-1230-420', startLocal: '2026-11-17T13:00', endLocal: '2026-11-17T20:00' },
      { id: 'flex-2026-11-18-1230-420', startLocal: '2026-11-18T12:30', endLocal: '2026-11-18T19:30' },
    ] },
  },
  collision: {
    summary: 'Zmiana nachodząca na wykład (serwer odrzuci)',
    description: 'Próba ustawienia zmiany w poniedziałek 12:00–16:00, choć do 13:15 trwa wykład obowiązkowy, a potem jest 30 min dojazdu. Serwer odrzuci to z kodem 422 i wyjaśni dlaczego (zobacz przykład odpowiedzi 422 „Zmiana koliduje z wykładem”).',
    value: { expectedVersion: 1, shifts: [{ id: 'X1', startLocal: '2026-11-16T12:00', endLocal: '2026-11-16T16:00' }] },
  },
};

export const invalidScheduleExamples: NamedExamples = {
  classCollision: {
    summary: 'Zmiana koliduje z wykładem',
    description: 'Nic nie zostało zapisane. errors to powody odrzucenia: class_collision – zmiana 12:00–16:00 nachodzi na wykład 10:00–13:15 razem z 30 min dojazdu, czyli część wspólna to 12:00–13:45 (overlapStartLocal–overlapEndLocal); outside_availability – z doliczonym 30 min dojazdu zmiana zaczynałaby się już o 11:30, a student jest dostępny dopiero od 12:00. warnings to tylko ostrzeżenia, które same nie blokują zapisu (tu: grafik byłby poniżej celu godzin).',
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
  weeklyLimit: {
    summary: 'Przekroczony limit godzin',
    description: 'Nic nie zostało zapisane. maximum_hours – profil pozwala na 20 h tygodniowo (maximumHours: 20 → 1200 min), a zmiany dałyby 22 h (1320 min). daily_maximum_hours – we wtorek wyszłoby 10 h przy limicie 8 h (maxHoursPerDay: 8 → 480 min).',
    value: {
      error: 'invalid_schedule',
      errors: [
        { code: 'maximum_hours', severity: 'error', message: 'Łączny czas pracy przekracza maksymalny limit tygodniowy.', candidateIds: ['X1', 'X2', 'X3'], eventIds: [], details: { maximumMinutes: 1200, totalMinutes: 1320 } },
        { code: 'daily_maximum_hours', severity: 'error', message: 'Limit pracy na dzień 2026-11-17 wynosi 480 minut.', candidateIds: ['X2', 'X3'], eventIds: [], details: { date: '2026-11-17', maximumMinutes: 480, totalMinutes: 600 } },
      ],
      warnings: [],
    },
  },
  restViolation: {
    summary: 'Za krótka przerwa między zmianami',
    description: 'Nic nie zostało zapisane. Zmiany 08:00–12:00 i 13:00–17:00 w poniedziałek mają 60 min przerwy, a profil wymaga max(dojazd 30 min, odpoczynek 120 min) = 120 min. commute_gap_too_short pokazuje wymaganą i faktyczną przerwę; shift_overlap_or_rest wskazuje parę zmian, której to dotyczy.',
    value: {
      error: 'invalid_schedule',
      errors: [
        { code: 'commute_gap_too_short', severity: 'error', message: 'Za krótka przerwa między Zmiana pracy i Zmiana pracy: brakuje 60 min.', candidateIds: ['X1', 'X2'], eventIds: [],
          details: { error: 'commute_gap_too_short', requiredMinutes: 120, actualMinutes: 60, leftId: 'X1', rightId: 'X2', leftTitle: 'Zmiana pracy', rightTitle: 'Zmiana pracy' } },
        { code: 'shift_overlap_or_rest', severity: 'error', message: 'Zmiany nakładają się lub nie zachowują bufora i odpoczynku.', candidateIds: ['X1', 'X2'], eventIds: [], details: {} },
      ],
      warnings: [],
    },
  },
};

export const scheduleListExamples: NamedExamples = {
  page: {
    summary: 'Dwa ostatnie tygodnie',
    description: 'Lista wersji grafików w podanym zakresie dat, od najnowszego tygodnia. Tydzień 16.11 ma propozycję czekającą na zatwierdzenie (status: proposed), a tydzień 9.11 – zatwierdzony grafik, w którym zabrakło 4 h do celu (shortfallMinutes: 240). total to liczba wszystkich grafików w zakresie; limit i offset służą do stronicowania (np. offset: 20 = druga strona po 20).',
    value: { items: [
      { scheduleId, weekStart, status: 'proposed', solutionStatus: 'target_met', version: 2, generatorVersion: 'greedy-v1', isApproved: false, isRejected: false, targetMinutes: 960, totalMinutes: 1080, shortfallMinutes: 0 },
      { scheduleId: '5c4b3a29-1807-4f6e-9d5c-4b3a29180716', weekStart: '2026-11-09', status: 'accepted', solutionStatus: 'not_found', version: 1, generatorVersion: 'greedy-v1', isApproved: true, isRejected: false, targetMinutes: 960, totalMinutes: 720, shortfallMinutes: 240 },
    ], total: 2, limit: 20, offset: 0 },
  },
};

export const rejectedScheduleExamples: NamedExamples = {
  rejected: { summary: 'Propozycja odrzucona', description: 'Wszystkie niezatwierdzone propozycje dla tego tygodnia zostały odrzucone. Kalendarz się nie zmienił – wcześniej zatwierdzone zmiany zostają. schedule pokazuje grafik, który teraz obowiązuje w tym tygodniu (wcześniej zatwierdzony), albo null, jeśli żadnego nie ma.', value: { rejected: true, schedule: null } },
};

export const scheduleErrorExamples = {
  400: {
    invalid_week_start: { summary: 'Data nie jest poniedziałkiem', description: 'weekStart musi być poniedziałkiem w formacie RRRR-MM-DD, np. 2026-11-16. Nic nie zostało zrobione.', value: { error: 'invalid_week_start' } },
    invalid_scheduler_settings: { summary: 'Sprzeczne limity godzin', description: 'Ustawienia (z profilu albo z overrides) się wykluczają – np. cel 20 h przy maksimum 16 h. message wyjaśnia, jaki warunek musi być spełniony.', value: { error: 'invalid_scheduler_settings', message: 'Ustawienia muszą spełniać: 0 ≤ minimum ≤ cel ≤ maksimum w tygodniu.' } },
  },
  404: {
    work_profile_not_found: { summary: 'Użytkownik nie ma profilu pracy', description: 'Bez profilu pracy (dostępności, celu godzin) nie da się ułożyć grafiku. Najpierw trzeba go utworzyć.', value: { error: 'work_profile_not_found' } },
    schedule_not_found: { summary: 'Nie ma takiego grafiku', description: 'Dla tego tygodnia (albo id) nie ma żadnej propozycji – trzeba ją najpierw wygenerować.', value: { error: 'schedule_not_found' } },
  },
  409: {
    profile_version_conflict: { summary: 'Profil pracy zmienił się w międzyczasie', description: 'Ktoś zmienił profil po tym, jak go odczytano (np. w innej karcie), więc grafik byłby ułożony na starych ustawieniach. profileVersion w odpowiedzi to aktualna wersja – odśwież profil i spróbuj ponownie.', value: { error: 'profile_version_conflict', profileVersion: 'pv-8' } },
    schedule_version_conflict: { summary: 'Grafik zmienił się w międzyczasie', description: 'Wysłane expectedVersion jest nieaktualne – ktoś już poprawił ten grafik. currentVersion to aktualna wersja: odczytaj grafik ponownie i powtórz zmianę. Nic nie zostało nadpisane.', value: { error: 'schedule_version_conflict', currentVersion: 3 } },
    schedule_already_approved: { summary: 'Grafik jest już zatwierdzony', description: 'Zatwierdzonego grafiku nie można już poprawiać, zatwierdzać ponownie ani odrzucać. Żeby coś zmienić, wygeneruj nową propozycję na ten tydzień.', value: { error: 'schedule_already_approved' } },
    profile_setup_required: { summary: 'Profil nie jest uzupełniony', description: 'W profilu brakuje danych potrzebnych do ułożenia grafiku. missing mówi czego: availability – dostępności, target – celu godzin.', value: { error: 'profile_setup_required', missing: ['availability'] } },
    no_classes_for_week: { summary: 'Tydzień bez zajęć – potrzebne potwierdzenie', description: 'W tym tygodniu w kalendarzu nie ma zajęć. Może to być przerwa, ale też brak zaimportowanego planu. Jeśli to zamierzone, wyślij żądanie ponownie z confirmNoClasses: true.', value: { error: 'no_classes_for_week', requiresConfirmation: true } },
  },
  503: {
    scheduling_not_configured: { summary: 'Serwer uruchomiony bez bazy danych', description: 'API działa bez skonfigurowanej bazy (brak DATABASE_URL), więc grafików nie da się zapisać ani odczytać.', value: { error: 'scheduling_not_configured' } },
    schedule_generation_failed: { summary: 'Awaria serwera przy układaniu grafiku', description: 'Coś poszło nie tak po stronie serwera (np. baza przestała odpowiadać). To co innego niż pusty grafik proven_infeasible – tamten jest poprawną odpowiedzią 201. Spróbuj ponownie za chwilę.', value: { error: 'schedule_generation_failed' } },
  },
} satisfies Record<number, NamedExamples>;
