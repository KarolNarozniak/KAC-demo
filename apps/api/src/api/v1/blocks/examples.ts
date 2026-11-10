// Przykłady blokad w Swagger UI (S23KC2S1P2-178): sesja na kilka dni, dzień wolny i urlop godzinowy.
// Żądanie może podać czas z dowolnym offsetem; odpowiedź zawiera instanty w UTC.
import type { NamedExamples } from '../../examples.js';

const userId = 'U001';

export const createBlockExamples: NamedExamples = {
  examSession: {
    summary: 'Sesja egzaminacyjna (kilka dni)',
    description: 'Cały okres od poniedziałku 00:00 do niedzieli 24:00 czasu polskiego – koniec to początek następnego dnia.',
    value: { title: 'Sesja zimowa', type: 'exam_session', startTime: '2027-01-25T00:00:00+01:00', endTime: '2027-02-08T00:00:00+01:00' },
  },
  dayOff: {
    summary: 'Dzień wolny',
    value: { title: 'Wigilia', type: 'day_off', startTime: '2026-12-24T00:00:00+01:00', endTime: '2026-12-25T00:00:00+01:00' },
  },
  vacation: {
    summary: 'Urlop w godzinach',
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
  examSession: { summary: 'Zapisana sesja egzaminacyjna', description: 'Czas jest zwracany w UTC (+01:00 → Z).', value: examSession },
};

export const blockListExamples: NamedExamples = {
  blocks: { summary: 'Blokady użytkownika', value: [dayOff, examSession] },
  empty: { summary: 'Brak blokad', value: [] },
};
