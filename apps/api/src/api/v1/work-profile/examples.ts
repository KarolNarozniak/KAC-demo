// Przykłady dostępności w Swagger UI (S23KC2S1P2-153): dzień z dwoma zakresami, pusty tydzień, koniec o 24:00.
import type { NamedExamples } from '../../examples.js';

const twoRanges = [
  { dayOfWeek: 1, startTime: '08:00', endTime: '12:00' },
  { dayOfWeek: 1, startTime: '16:00', endTime: '20:00' },
  { dayOfWeek: 3, startTime: '12:00', endTime: '20:00' },
];

export const replaceAvailabilityExamples: NamedExamples = {
  twoRanges: { summary: 'Dzień z dwoma zakresami', description: 'Poniedziałek rano i wieczorem, środa po południu.', value: { version: 3, intervals: twoRanges } },
  emptyWeek: { summary: 'Pusty tydzień', description: 'Usuwa całą dostępność. Bez dostępności nie można wygenerować grafiku.', value: { version: 3, intervals: [] } },
  untilMidnight: { summary: 'Koniec o 24:00', description: 'Piątek do końca dnia; 24:00 jest dozwolone tylko jako koniec przedziału.', value: { version: 3, intervals: [{ dayOfWeek: 5, startTime: '18:00', endTime: '24:00' }] } },
  overnight: {
    summary: 'Zakres przez północ',
    description: 'Sobota 22:00–02:00 zostanie zapisana jako sobota 22:00–24:00 i niedziela 00:00–02:00.',
    value: { version: 3, intervals: [{ dayOfWeek: 6, startTime: '22:00', endTime: '02:00' }] },
  },
};

export const availabilityExamples: NamedExamples = {
  twoRanges: { summary: 'Po zapisie dnia z dwoma zakresami', description: 'Lista jest zastępowana w całości; version rośnie o 1.', value: { version: 4, profileVersion: 'pv-8', intervals: twoRanges } },
  emptyWeek: { summary: 'Pusty tydzień', value: { version: 4, profileVersion: 'pv-8', intervals: [] } },
  overnight: {
    summary: 'Zakres przez północ po podziale',
    value: { version: 4, profileVersion: 'pv-8', intervals: [{ dayOfWeek: 6, startTime: '22:00', endTime: '24:00' }, { dayOfWeek: 7, startTime: '00:00', endTime: '02:00' }] },
  },
};

export const availabilityErrorExamples = {
  400: { invalid: { summary: 'Błędny przedział', description: 'Np. początek równy końcowi.', value: { error: 'invalid_availability', details: { dayOfWeek: 2 } } } },
  404: { missing: { summary: 'Brak profilu pracy', value: { error: 'profile_not_found' } } },
  409: { stale: { summary: 'Nieaktualna wersja dostępności', description: 'Odczytaj dostępność ponownie i wyślij aktualne version.', value: { error: 'version_conflict' } } },
  422: { overlap: { summary: 'Nakładające się przedziały', value: { error: 'availability_overlap', details: { dayOfWeek: 1 } } } },
  503: {
    unavailable: { summary: 'Baza danych niedostępna', value: { error: 'work_profile_unavailable' } },
    notConfigured: { summary: 'Repozytorium nieskonfigurowane', value: { error: 'work_profile_not_configured' } },
  },
} satisfies Record<number, NamedExamples>;
