// Odczyt grafiku z pliku (S23KC2S1P2-44, SUB-03).
//
// To jest „gniazdo” na mechanizm odczytu. Reszta importu (walidacja, podgląd, duplikaty, zapis) korzysta
// wyłącznie z interfejsu ScheduleReader, więc sposób odczytu można później podmienić w jednym miejscu.
//
// Prawdziwy odczyt to LocalScheduleReader (local-reader.ts): warstwa tekstowa PDF albo lokalny OCR zdjęcia
// (Tesseract.js, tak jak w imporcie planu zajęć – historyjka 38). DemoScheduleReader zostaje do testów
// i pokazów bez OCR (WORK_SCHEDULE_READER=demo). Ekran importu informuje, gdy działa czytnik demonstracyjny.

import type { ScheduleFileType } from './file-check.js';

/** Zmiana odczytana z grafiku. Brakujące pola oznaczają częściowy odczyt (dane do uzupełnienia). */
export type RawShift = {
  employee?: string;
  title?: string;
  date?: string;
  startTime?: string;
  endTime?: string;
  location?: string;
  /** Pewność odczytu od 0 do 1. */
  confidence: number;
};

export type ScheduleFile = { name: string; type: ScheduleFileType; bytes: Buffer };

/** Dane pomocnicze odczytu: kto importuje i względem jakiej daty uzupełniać rok w datach typu „02.11”. */
export type ReadContext = { userName: string; now?: Date };

export interface ScheduleReader {
  /** Czy odczyt jest prawdziwy (false = czytnik demonstracyjny). */
  readonly real: boolean;
  read(file: ScheduleFile, context: ReadContext): Promise<RawShift[]>;
}

/** Przykładowy grafik kawiarni dla kilku pracowników. */
function sampleSchedule(employee: string, confidence: number): RawShift[] {
  return [
    { employee, title: 'Praca', date: '2026-11-02', startTime: '16:00', endTime: '20:00', location: 'Kawiarnia Zachodnia', confidence },
    { employee: 'Anna Nowak', title: 'Praca', date: '2026-11-02', startTime: '08:00', endTime: '14:00', location: 'Kawiarnia Zachodnia', confidence },
    { employee, title: 'Praca', date: '2026-11-04', startTime: '22:00', endTime: '06:00', location: 'Kawiarnia Zachodnia', confidence },
    { employee, title: 'Praca', date: '2026-11-06', startTime: '15:00', location: 'Kawiarnia Zachodnia', confidence: Math.min(confidence, 0.55) },
    { employee: 'Piotr Wiśniewski', title: 'Praca', date: '2026-11-06', startTime: '12:00', endTime: '18:00', location: 'Kawiarnia Zachodnia', confidence },
    // Ta sama zmiana wpisana w grafiku drugi raz – pokazuje wykrywanie powtórzeń w imporcie.
    // Po zapisie i ponownym imporcie te same zmiany pojawią się też jako duplikaty w kalendarzu.
    { employee, title: 'Praca', date: '2026-11-02', startTime: '16:00', endTime: '20:00', location: 'Kawiarnia Zachodnia', confidence },
  ];
}

const DEMO_CONFIDENCE: Record<ScheduleFileType, number> = { PDF: 0.9, PNG: 0.8, JPG: 0.75 };

/**
 * Czytnik demonstracyjny. Zwraca przykładowy grafik z zmianami podanego pracownika.
 * Plik, którego nazwa zawiera słowo „pusty”, udaje grafik, z którego nie udało się odczytać żadnej zmiany
 * (pozwala pokazać scenariusz 4b bez prawdziwego odczytu).
 */
export class DemoScheduleReader implements ScheduleReader {
  readonly real = false;

  async read(file: ScheduleFile, context: ReadContext): Promise<RawShift[]> {
    if (/pusty/i.test(file.name)) return [];
    return sampleSchedule(context.userName, DEMO_CONFIDENCE[file.type]);
  }
}
