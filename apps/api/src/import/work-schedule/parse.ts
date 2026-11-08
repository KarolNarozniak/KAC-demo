// Interpretacja tekstu odczytanego z grafiku pracy (S23KC2S1P2-44, SUB-03 i SUB-04).
//
// Wejście: linie tekstu z PDF (warstwa tekstowa) albo ze zdjęcia (OCR) wraz z pewnością odczytu.
// Wyjście: zmiany (RawShift). Brakujące pola oznaczają częściowy odczyt – użytkownik uzupełnia je na podglądzie.
//
// Obsługiwane układy grafiku (jedna linia = jeden wiersz tabeli):
//  1. Lista:        „02.11.2026  Jan Kowalski  16:00-20:00” (kolejność kolumn dowolna)
//  2. Grupy dat:    „Poniedziałek 02.11” → niżej „Jan Kowalski 16-20”, „Anna Nowak 8-14”
//  3. Grupy osób:   „Jan Kowalski” → niżej „02.11 16:00-20:00”, „04.11 22:00-06:00”
//  4. Tabela tygodniowa: nagłówek z datami „02.11 03.11 04.11”, wiersze „Jan Kowalski 16-20 wolne 22-6”
//
// Dni wolne („wolne”, „urlop”, „L4”, „X”, „-”) są pomijane. Godzina „24:00” oznacza północ (koniec następnego dnia).
// Każdy wynik i tak trafia na podgląd (historyjka 32) – nic nie jest zapisywane bez sprawdzenia przez użytkownika.

import type { RawShift } from './reader.js';

/** Słowo z położeniem w poziomie (piksele obrazu albo punkty PDF) – pozwala dopasować komórki tabeli do kolumn. */
export type PositionedWord = { text: string; x0: number; x1: number };
export type TextLine = { text: string; confidence: number; words?: PositionedWord[] };
export type ParseOptions = { now?: Date };

type Day = { year?: number; month: number; day: number };
type Range = { start: string; end: string };
type Cell = { index: number } & ({ kind: 'range'; range: Range } | { kind: 'off' });

const MONTH_NAMES: Record<string, number> = {
  stycznia: 1, styczeń: 1, styczen: 1, lutego: 2, luty: 2, marca: 3, marzec: 3, kwietnia: 4, kwiecień: 4, kwiecien: 4,
  maja: 5, maj: 5, czerwca: 6, czerwiec: 6, lipca: 7, lipiec: 7, sierpnia: 8, sierpień: 8, sierpien: 8,
  września: 9, wrzesnia: 9, wrzesień: 9, wrzesien: 9, października: 10, pazdziernika: 10, październik: 10, pazdziernik: 10,
  listopada: 11, listopad: 11, grudnia: 12, grudzień: 12, grudzien: 12,
};
const MONTH_PATTERN = Object.keys(MONTH_NAMES).sort((a, b) => b.length - a.length).join('|');

// Słowa, które nie są nazwiskiem: dni tygodnia, nagłówki kolumn i opisy.
const NOISE_WORDS = new Set([
  'pon', 'pn', 'wt', 'sr', 'śr', 'czw', 'cz', 'pt', 'pia', 'sob', 'so', 'nd', 'ndz', 'nie', 'niedz',
  'poniedziałek', 'poniedzialek', 'wtorek', 'środa', 'sroda', 'czwartek', 'piątek', 'piatek', 'sobota', 'niedziela',
  'data', 'dzień', 'dzien', 'godziny', 'godzina', 'godz', 'od', 'do', 'zmiana', 'zmiany', 'pracownik', 'imię', 'imie',
  'nazwisko', 'grafik', 'pracy', 'praca', 'tydzień', 'tydzien', 'r', 'h', 'pan', 'pani', 'rano', 'noc', 'nocka', 'dzienna', 'nocna',
]);
const OFF_PATTERN = /^(wolne|wolny|wolna|urlop|l4|off|x|-+|—)$/i;

/**
 * Tekst linii i położenie w poziomie każdego znaku. Gdy linia ma słowa z położeniem, tekst składamy z nich,
 * żeby numer znaku wskazywał właściwe słowo. Znaki wewnątrz słowa dostają położenie proporcjonalne do pozycji w słowie.
 */
function withPositions(line: TextLine): { text: string; xs?: number[] } {
  const words = (line.words ?? []).map((word) => ({ ...word, text: word.text.replace(/\s+/g, ' ').trim() })).filter((word) => word.text);
  if (!words.length) return { text: line.text };
  const xs: number[] = [];
  const text = words.map((word, i) => {
    for (let c = 0; c < word.text.length; c++) xs.push(word.x0 + ((word.x1 - word.x0) * c) / Math.max(1, word.text.length));
    if (i < words.length - 1) xs.push(word.x1);
    return word.text;
  }).join(' ');
  return normalizeLine(text).length === text.length ? { text, xs } : { text };
}

/**
 * Przypisuje komórki wiersza do kolumn nagłówka według położenia, gdy OCR zgubił lub dodał komórkę (np. „-”).
 * Szuka przesunięcia i dopasowania zachowującego kolejność, które najmniej odbiega od kolumn. Zwraca numery kolumn
 * albo null, gdy dopasowanie nie jest pewne (wtedy data zostaje do uzupełnienia przez użytkownika).
 */
export function alignToColumns(cells: number[], columns: number[], knownOffset?: number): number[] | null {
  if (!cells.length || cells.length > columns.length || columns.length < 2) return null;
  const spacing = Math.min(...columns.slice(1).map((x, i) => x - columns[i]!));
  if (!(spacing > 0)) return null;
  let best: { cost: number; assignment: number[]; worst: number } | null = null;
  let tie = false;
  // Przesunięcie komórek względem nagłówka znamy z wierszy, w których liczba komórek się zgadzała.
  // Bez niego bierzemy wszystkie możliwe, ale remis dwóch różnych dopasowań oznacza niepewność.
  const offsets = knownOffset !== undefined ? [knownOffset] : new Set(columns.flatMap((column) => cells.map((cell) => column - cell)));
  for (const offset of offsets) {
    // dp[i][j] – najmniejszy koszt dopasowania komórek 0..i, gdy komórka i trafia do kolumny j.
    const dp = cells.map(() => columns.map(() => Infinity));
    const from = cells.map(() => columns.map(() => -1));
    columns.forEach((column, j) => { dp[0]![j] = Math.abs(cells[0]! + offset - column); });
    for (let i = 1; i < cells.length; i++) {
      for (let j = i; j < columns.length; j++) {
        for (let prev = i - 1; prev < j; prev++) {
          const cost = dp[i - 1]![prev]! + Math.abs(cells[i]! + offset - columns[j]!);
          if (cost < dp[i]![j]!) { dp[i]![j] = cost; from[i]![j] = prev; }
        }
      }
    }
    const last = cells.length - 1;
    let end = -1;
    dp[last]!.forEach((cost, j) => { if (end < 0 || cost < dp[last]![end]!) end = j; });
    if (!Number.isFinite(dp[last]![end]!)) continue;
    const assignment: number[] = [];
    for (let i = last, j = end; i >= 0; j = from[i]![j]!, i--) assignment.unshift(j);
    const worst = Math.max(...assignment.map((j, i) => Math.abs(cells[i]! + offset - columns[j]!)));
    const cost = dp[last]![end]!;
    if (!best || cost < best.cost - 1e-6) { best = { cost, assignment, worst }; tie = false; }
    else if (Math.abs(cost - best.cost) <= 1e-6 && assignment.join() !== best.assignment.join()) tie = true;
  }
  return best && !tie && best.worst <= spacing * 0.35 ? best.assignment : null;
}

/** Zmiana dłuższa niż 14 godzin to najpewniej błąd odczytu (np. „12-18” odczytane jako „02-18”). */
function suspiciousLength(range: Range): boolean {
  const minutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
  return (minutes(range.end) - minutes(range.start) + 1440) % 1440 > 14 * 60;
}

const pad = (value: number) => String(value).padStart(2, '0');
const validDay = (year: number, month: number, day: number) => {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
};
const toTime = (hour: string, minute: string | undefined) => {
  const h = Number(hour);
  const m = minute === undefined ? 0 : Number(minute);
  if (h > 24 || m > 59 || (h === 24 && m > 0)) return null;
  return `${pad(h % 24)}:${pad(m)}`;
};

/** Typowe pomyłki OCR w liczbach: „O” zamiast 0, „l”/„I”/„|” zamiast 1 – poprawiane tylko w słowach, które są liczbami. */
function fixDigits(text: string): string {
  return text.replace(/[\dOoIl|:.\-/]+/g, (token) =>
    (token.match(/\d/g)?.length ?? 0) >= 2 ? token.replace(/[Oo]/g, '0').replace(/[Il|]/g, '1') : token,
  );
}

function normalizeLine(text: string): string {
  return fixDigits(text.replace(/[–—−‒]/g, '-').replace(/\s+/g, ' ').trim());
}

/** Zamienia dopasowany fragment na spacje, żeby kolejne wzorce go nie widziały, ale pozycje pozostały te same. */
function blank(text: string, index: number, length: number): string {
  return text.slice(0, index) + ' '.repeat(length) + text.slice(index + length);
}

type Found<T> = { index: number; value: T };

function takeAll<T>(text: string, pattern: RegExp, convert: (match: RegExpExecArray) => T | null): { text: string; found: Found<T>[] } {
  const found: Found<T>[] = [];
  let rest = text;
  for (const match of text.matchAll(pattern)) {
    const value = convert(match as RegExpExecArray);
    if (value === null) continue;
    found.push({ index: match.index!, value });
    rest = blank(rest, match.index!, match[0].length);
  }
  return { text: rest, found };
}

type LineParts = { dates: Found<Day>[]; ranges: Found<Range>[]; times: Found<string>[]; offs: Found<true>[]; name?: string };

function splitLine(raw: string): LineParts {
  let text = normalizeLine(raw);

  // 1. Pełne daty z rokiem (2026-11-02, 02.11.2026, 2.11.26, 2 listopada 2026).
  const iso = takeAll(text, /\b(\d{4})-(\d{1,2})-(\d{1,2})\b/g, (m) =>
    validDay(+m[1]!, +m[2]!, +m[3]!) ? { year: +m[1]!, month: +m[2]!, day: +m[3]! } : null);
  text = iso.text;
  // Ten sam separator w całej dacie – żeby zakres „02.11-06.11.2026” nie dał fałszywej daty „02.11-06”.
  const dmy = takeAll(text, /\b(\d{1,2})([./-])(\d{1,2})\2(\d{4}|\d{2})\b/g, (m) => {
    const year = m[4]!.length === 2 ? 2000 + +m[4]! : +m[4]!;
    return validDay(year, +m[3]!, +m[1]!) ? { year, month: +m[3]!, day: +m[1]! } : null;
  });
  text = dmy.text;
  const named = takeAll(text, new RegExp(`\\b(\\d{1,2})\\s+(${MONTH_PATTERN})(?:\\s+(\\d{4}))?(?![\\p{L}])`, 'giu'), (m) => {
    const month = MONTH_NAMES[m[2]!.toLocaleLowerCase('pl')]!;
    const year = m[3] ? +m[3] : undefined;
    return validDay(year ?? 2024, month, +m[1]!) ? { year, month, day: +m[1]! } : null;
  });
  text = named.text;

  // 2. Przedziały godzin (16:00-20:00, 16.00 - 20.00, 8-14, 22-6).
  const ranges = takeAll(text, /(?<![\d:.])(\d{1,2})(?:[:.](\d{2}))?\s*-\s*(\d{1,2})(?:[:.](\d{2}))?(?![\d:.])/g, (m) => {
    const start = toTime(m[1]!, m[2]);
    const end = toTime(m[3]!, m[4]);
    // Bez minut przyjmujemy pełne godziny (0–24). Początek i koniec muszą się różnić.
    return start && end && start !== end ? { start, end } : null;
  });
  text = ranges.text;

  // 3. Daty bez roku (02.11, 2/11) – dopiero teraz, żeby „16.00” z godzin nie zostało uznane za datę.
  const dm = takeAll(text, /(?<![\d.])(\d{1,2})[./](\d{1,2})(?![\d])\.?/g, (m) =>
    validDay(2024, +m[2]!, +m[1]!) ? { month: +m[2]!, day: +m[1]! } : null);
  text = dm.text;

  // 4. Pojedyncze godziny z dwukropkiem (np. sam początek zmiany).
  const times = takeAll(text, /(?<![\d:])(\d{1,2}):(\d{2})(?![\d:])/g, (m) => toTime(m[1]!, m[2]));
  text = times.text;

  // 5. Oznaczenia dni wolnych i pozostałe słowa.
  const offs: Found<true>[] = [];
  const words: string[] = [];
  for (const match of text.matchAll(/\S+/g)) {
    const word = match[0].replace(/^[|;,.:()[\]]+|[|;,.:()[\]]+$/g, '');
    if (!word) continue;
    if (OFF_PATTERN.test(word)) { offs.push({ index: match.index!, value: true }); continue; }
    if (NOISE_WORDS.has(word.toLocaleLowerCase('pl'))) continue;
    words.push(word);
  }

  return {
    dates: [...iso.found, ...dmy.found, ...named.found, ...dm.found].sort((a, b) => a.index - b.index),
    ranges: ranges.found,
    times: times.found,
    offs,
    name: asName(words, ranges.found.length + times.found.length > 0),
  };
}

/**
 * Imię i nazwisko z pozostałych słów wiersza. Bierzemy słowa z liter zaczynające się wielką literą
 * (OCR czasem skleja je w jedno, np. „Użytkowniklokalny”); małe śmieci z sąsiednich kolumn są pomijane.
 * W wierszu bez godzin nazwisko musi mieć co najmniej dwa słowa, żeby tytuł typu „Kawiarnia” nie został pracownikiem.
 */
function asName(words: string[], hasShift: boolean): string | undefined {
  const candidates = words.filter((word) => /^\p{Lu}[\p{L}'-]{2,}$/u.test(word) && !/^\p{Lu}+$/u.test(word));
  const min = hasShift ? 1 : 2;
  if (candidates.length < min || candidates.length > 4) return undefined;
  return candidates.join(' ');
}

/** Rok dla dat bez roku: rok podany w dokumencie, a jeśli go brak – najbliższy wystąpieniu względem dzisiejszej daty. */
function yearResolver(lines: string[], now: Date) {
  const documentYear = lines.map((line) => line.match(/\b(20\d{2})\b/)).find(Boolean)?.[1];
  let previousMonth: number | undefined;
  let offset = 0;
  return (day: Day): number => {
    if (day.year) return day.year;
    if (documentYear) {
      // Grafik na przełomie roku: po grudniu przychodzi styczeń następnego roku.
      if (previousMonth !== undefined && day.month < previousMonth - 6) offset += 1;
      previousMonth = day.month;
      return +documentYear + offset;
    }
    const candidates = [now.getUTCFullYear() - 1, now.getUTCFullYear(), now.getUTCFullYear() + 1];
    const distance = (year: number) => {
      const diff = Date.UTC(year, day.month - 1, day.day) - now.getTime();
      return diff < -60 * 86_400_000 ? Infinity : Math.abs(diff); // grafiki dotyczą zwykle przyszłości lub ostatnich tygodni
    };
    return candidates.reduce((best, year) => (distance(year) < distance(best) ? year : best));
  };
}

export function parseScheduleLines(lines: TextLine[], options: ParseOptions = {}): RawShift[] {
  const now = options.now ?? new Date();
  const yearOf = yearResolver(lines.map((line) => line.text), now);
  const iso = (day: Day) => `${yearOf(day)}-${pad(day.month)}-${pad(day.day)}`;

  const shifts: RawShift[] = [];
  let currentDate: string | undefined;
  let currentEmployee: string | undefined;
  let headerDates: string[] | undefined;
  let headerXs: number[] | undefined;
  let columnOffset: number | undefined;

  const push = (shift: Omit<RawShift, 'title'>) => shifts.push({ title: 'Praca', ...shift });

  for (const line of lines) {
    const confidence = Math.max(0, Math.min(1, line.confidence));
    const { text, xs } = withPositions(line);
    const parts = splitLine(text);
    const { ranges, times, offs } = parts;
    const dates = parts.dates.map((found) => ({ index: found.index, value: iso(found.value) }));
    const employee = parts.name ?? currentEmployee;

    // Nagłówek tabeli tygodniowej: kilka dat, bez godzin.
    if (dates.length >= 2 && ranges.length === 0 && times.length === 0) {
      headerDates = dates.map((found) => found.value);
      headerXs = xs ? dates.map((found) => xs[found.index]!) : undefined;
      columnOffset = undefined;
      continue;
    }

    // Wiersz tabeli tygodniowej: nazwisko i komórki (godziny albo dzień wolny) w kolejności kolumn.
    if (headerDates && dates.length === 0 && ranges.length + offs.length >= 2) {
      const cells: Cell[] = [
        ...ranges.map((found): Cell => ({ index: found.index, kind: 'range', range: found.value })),
        ...offs.map((found): Cell => ({ index: found.index, kind: 'off' })),
      ].sort((a, b) => a.index - b.index);
      // Ta sama liczba komórek co dat – przypisujemy po kolei. Inaczej (OCR zgubił np. „-”) – według położenia w poziomie.
      // Gdy i to się nie uda, nie zgadujemy daty – użytkownik uzupełni ją na podglądzie.
      const exact = cells.length === headerDates.length;
      if (exact && xs && headerXs) {
        // Zapamiętujemy, o ile komórki są przesunięte względem dat w nagłówku (mediana) – pomoże w kolejnych wierszach.
        const diffs = cells.map((cell, column) => headerXs![column]! - xs[cell.index]!).sort((a, b) => a - b);
        columnOffset = diffs[Math.floor(diffs.length / 2)];
      }
      const columns = exact
        ? cells.map((_, column) => column)
        : xs && headerXs ? alignToColumns(cells.map((cell) => xs[cell.index]!), headerXs, columnOffset) : null;
      cells.forEach((cell, i) => {
        if (cell.kind !== 'range') return;
        const column = columns?.[i];
        const date = column === undefined ? undefined : headerDates![column];
        const certain = exact && !suspiciousLength(cell.range);
        push({ employee: parts.name, date, startTime: cell.range.start, endTime: cell.range.end,
          confidence: certain ? confidence : Math.min(confidence, date ? 0.65 : 0.5) });
      });
      continue;
    }

    if (dates.length === 1) currentDate = dates[0]!.value;
    if (parts.name && ranges.length === 0 && times.length === 0) currentEmployee = parts.name;

    // Dzień wolny w danym wierszu – nie ma czego importować.
    if (ranges.length === 0 && times.length === 0 && offs.length > 0) continue;

    if (ranges.length > 0) {
      const pairDates = dates.length === ranges.length && dates.length > 1;
      ranges.forEach((range, i) => {
        const date = pairDates ? dates[i]!.value : dates[0]?.value ?? currentDate;
        push({ employee, date, startTime: range.value.start, endTime: range.value.end,
          confidence: suspiciousLength(range.value) ? Math.min(confidence, 0.5) : confidence });
      });
      continue;
    }

    if (times.length >= 2) {
      // „16:00 20:00” bez łącznika – początek i koniec w osobnych kolumnach.
      push({ employee, date: dates[0]?.value ?? currentDate, startTime: times[0]!.value, endTime: times[1]!.value, confidence });
      continue;
    }

    if (times.length === 1 && (dates.length > 0 || parts.name)) {
      // Odczytano tylko jedną godzinę – zmiana częściowa (scenariusz 4c).
      push({ employee, date: dates[0]?.value ?? currentDate, startTime: times[0]!.value, confidence: Math.min(confidence, 0.5) });
      continue;
    }

    if (dates.length === 1 && parts.name) {
      // Jest data i osoba, ale godziny nieczytelne – zmiana częściowa do uzupełnienia.
      push({ employee: parts.name, date: dates[0]!.value, confidence: Math.min(confidence, 0.5) });
    }
  }

  return shifts;
}
