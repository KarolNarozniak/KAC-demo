// Przykłady blokad w Swagger UI (S23KC2S1P2-178): sesja na kilka dni, dzień wolny i urlop godzinowy.
// Żądanie może podać czas z dowolnym offsetem; odpowiedź zawiera instanty w UTC.
import type { NamedExamples } from '../../examples.js';

const userId = 'U001';

export const createBlockExamples: NamedExamples = {
  examSession: {
    summary: 'Sesja egzaminacyjna na dwa tygodnie',
    description: 'W czasie sesji generator grafiku nie zaplanuje żadnej pracy. Blokada trwa od poniedziałku 25 stycznia 00:00 do niedzieli 7 lutego włącznie – dlatego endTime to poniedziałek 8 lutego 00:00 (koniec nie jest wliczany). Czas podajemy z przesunięciem strefy: +01:00 to czas polski zimą.',
    value: { title: 'Sesja zimowa', type: 'exam_session', startTime: '2027-01-25T00:00:00+01:00', endTime: '2027-02-08T00:00:00+01:00' },
  },
  dayOff: {
    summary: 'Jeden dzień wolny',
    description: 'Cały dzień 24 grudnia bez pracy: od 24.12 00:00 do 25.12 00:00. Tak zapisuje się każdy pełny dzień – koniec to północ następnego dnia.',
    value: { title: 'Wigilia', type: 'day_off', startTime: '2026-12-24T00:00:00+01:00', endTime: '2026-12-25T00:00:00+01:00' },
  },
  vacation: {
    summary: 'Kilka godzin wolnego',
    description: 'Blokada nie musi obejmować całego dnia: tu tylko czwartek 8:00–12:30 (np. wizyta u lekarza). Poza tymi godzinami praca w tym dniu jest możliwa.',
    value: { title: 'Wizyta u lekarza', type: 'vacation', startTime: '2026-11-19T08:00:00+01:00', endTime: '2026-11-19T12:30:00+01:00' },
  },
};

const examSession = {
  id: '3f6c1a2e-8b4d-4e7f-a1c2-5d9e0b7f6a31', userId, title: 'Sesja zimowa', type: 'exam_session',
  startTime: '2027-01-24T23:00:00.000Z', endTime: '2027-02-07T23:00:00.000Z',
};
const dayOff = {
  id: '9a0b4c7d-2e1f-4a6b-8c3d-1f2e3a4b5c62', userId, title: 'Wigilia', type: 'day_off',
  startTime: '2026-12-23T23:00:00.000Z', endTime: '2026-12-24T23:00:00.000Z',
};

export const blockExamples: NamedExamples = {
  examSession: {
    summary: 'Zapisana sesja egzaminacyjna',
    description: 'Serwer nadał blokadzie id (potrzebne do usunięcia) i przypisał ją do zalogowanego użytkownika (userId). Czasy są zwracane w UTC (litera Z na końcu), dlatego 25.01 00:00 czasu polskiego to 24.01 23:00Z – to ta sama chwila.',
    value: examSession,
  },
};

export const blockListExamples: NamedExamples = {
  blocks: { summary: 'Dzień wolny i sesja', description: 'Lista wszystkich blokad zalogowanego użytkownika. Czasy w UTC (Z), np. 23.12 23:00Z to 24.12 00:00 czasu polskiego.', value: [dayOff, examSession] },
  empty: { summary: 'Brak blokad', description: 'Użytkownik nie ma żadnych blokad – pusta lista to poprawna odpowiedź, nie błąd.', value: [] },
};
