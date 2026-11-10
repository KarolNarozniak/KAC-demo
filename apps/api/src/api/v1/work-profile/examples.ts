// Przykłady dostępności w Swagger UI (S23KC2S1P2-153): dzień z dwoma zakresami, pusty tydzień, koniec o 24:00.
import type { NamedExamples } from '../../examples.js';

const twoRanges = [
  { dayOfWeek: 1, startTime: '08:00', endTime: '12:00' },
  { dayOfWeek: 1, startTime: '16:00', endTime: '20:00' },
  { dayOfWeek: 3, startTime: '12:00', endTime: '20:00' },
];

// Wspólne wyjaśnienie pola version, żeby każdy przykład żądania był zrozumiały samodzielnie.
const versionNote = 'Pole version to numer wersji dostępności z ostatniego odczytu (GET). Serwer sprawdza, czy nikt w międzyczasie nie zmienił dostępności – jeśli zmienił, zwróci 409 zamiast nadpisać cudze zmiany.';

export const replaceAvailabilityExamples: NamedExamples = {
  twoRanges: {
    summary: 'Dwa przedziały w jednym dniu',
    description: `Student może pracować w poniedziałek rano (8:00–12:00) i wieczorem (16:00–20:00), a w środę po południu (12:00–20:00). dayOfWeek: 1 = poniedziałek … 7 = niedziela. Wysłana lista zastępuje całą dotychczasową dostępność. ${versionNote}`,
    value: { version: 3, intervals: twoRanges },
  },
  emptyWeek: {
    summary: 'Usunięcie całej dostępności',
    description: `Pusta lista intervals kasuje wszystkie przedziały – student nie może teraz pracować w żadnym dniu. Uwaga: dopóki dostępność jest pusta, nie da się wygenerować grafiku pracy. ${versionNote}`,
    value: { version: 3, intervals: [] },
  },
  untilMidnight: {
    summary: 'Praca do końca dnia (24:00)',
    description: `Piątek od 18:00 do północy. Wartość 24:00 oznacza „do końca dnia” i wolno jej użyć tylko jako godziny zakończenia, nigdy jako początku. ${versionNote}`,
    value: { version: 3, intervals: [{ dayOfWeek: 5, startTime: '18:00', endTime: '24:00' }] },
  },
  overnight: {
    summary: 'Przedział przez północ',
    description: `Sobota od 22:00 do 2:00 w nocy. Koniec jest wcześniej niż początek, więc serwer sam podzieli to na dwa przedziały: sobota 22:00–24:00 i niedziela 00:00–02:00 (zobacz przykład odpowiedzi „Przedział przez północ – po zapisie”). ${versionNote}`,
    value: { version: 3, intervals: [{ dayOfWeek: 6, startTime: '22:00', endTime: '02:00' }] },
  },
};

const responseNote = 'version to nowy numer wersji dostępności – wyślij go przy następnym zapisie. profileVersion to wersja całego profilu pracy, potrzebna do generowania grafiku.';

export const availabilityExamples: NamedExamples = {
  twoRanges: {
    summary: 'Dwa przedziały w jednym dniu – po zapisie',
    description: `Serwer zapisał dostępność i zwraca ją w całości. Numer wersji wzrósł z 3 na 4, bo dostępność się zmieniła. ${responseNote}`,
    value: { version: 4, profileVersion: 'pv-8', intervals: twoRanges },
  },
  emptyWeek: {
    summary: 'Pusty tydzień – po zapisie',
    description: `Dostępność jest pusta: student nie ma żadnych godzin do pracy. ${responseNote}`,
    value: { version: 4, profileVersion: 'pv-8', intervals: [] },
  },
  overnight: {
    summary: 'Przedział przez północ – po zapisie',
    description: `Wysłany przedział sobota 22:00–02:00 został podzielony na sobotę 22:00–24:00 i niedzielę 00:00–02:00. ${responseNote}`,
    value: { version: 4, profileVersion: 'pv-8', intervals: [{ dayOfWeek: 6, startTime: '22:00', endTime: '24:00' }, { dayOfWeek: 7, startTime: '00:00', endTime: '02:00' }] },
  },
};

export const availabilityErrorExamples = {
  400: { invalid: {
    summary: 'Błędne godziny w przedziale',
    description: 'Jeden z przedziałów ma złe godziny, np. początek równy końcowi (12:00–12:00). details.dayOfWeek wskazuje dzień, w którym jest błąd. Nic nie zostało zapisane.',
    value: { error: 'invalid_availability', details: { dayOfWeek: 2 } },
  } },
  404: { missing: {
    summary: 'Użytkownik nie ma profilu pracy',
    description: 'Dostępność należy do profilu pracy, a ten użytkownik jeszcze go nie ma. Najpierw trzeba utworzyć profil.',
    value: { error: 'profile_not_found' },
  } },
  409: { stale: {
    summary: 'Ktoś zmienił dostępność w międzyczasie',
    description: 'Wysłane version jest starsze niż zapisane – dostępność zmieniono np. w drugiej karcie przeglądarki. Pobierz ją ponownie (GET), nanieś zmiany i wyślij z nowym version. Nic nie zostało nadpisane.',
    value: { error: 'version_conflict' },
  } },
  422: { overlap: {
    summary: 'Przedziały nachodzą na siebie',
    description: 'Dwa przedziały w tym samym dniu się nakładają, np. 8:00–12:00 i 11:00–14:00. details.dayOfWeek wskazuje ten dzień. Połącz je w jeden albo rozdziel. Nic nie zostało zapisane.',
    value: { error: 'availability_overlap', details: { dayOfWeek: 1 } },
  } },
  503: {
    unavailable: { summary: 'Baza danych nie odpowiada', description: 'Błąd po stronie serwera, nie danych. Spróbuj ponownie za chwilę.', value: { error: 'work_profile_unavailable' } },
    notConfigured: { summary: 'Serwer uruchomiony bez bazy danych', description: 'API działa bez skonfigurowanej bazy (brak DATABASE_URL), więc profilu nie da się odczytać ani zapisać.', value: { error: 'work_profile_not_configured' } },
  },
} satisfies Record<number, NamedExamples>;
