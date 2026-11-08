// Przykładowy plan zajęć w formacie ICS (taki jak eksport z USOS/Google), budowany w teście – bez plików binarnych.
export const ics = (...events: string[]) => ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//KAC test//PL', ...events, 'END:VCALENDAR', ''].join('\r\n');

export const vevent = (fields: Record<string, string>) =>
  ['BEGIN:VEVENT', ...Object.entries(fields).map(([key, value]) => `${key}${key.includes(';') ? '' : ':'}${value}`), 'END:VEVENT'].join('\r\n');

/** Plan semestralny: seria z wyjątkiem, przeniesione i odwołane zajęcia, lab co dwa tygodnie w UTC, wydarzenie całodniowe. */
export const semesterPlan = (title = 'Analiza matematyczna (W)') => ics(
  'X-WR-CALNAME:Plan WCY23KC2S1',
  'BEGIN:VTIMEZONE', 'TZID:Europe/Warsaw', 'BEGIN:STANDARD', 'DTSTART:19701025T030000', 'TZOFFSETFROM:+0200', 'TZOFFSETTO:+0100', 'END:STANDARD', 'END:VTIMEZONE',
  vevent({ UID: 'ana@usos', SUMMARY: title, LOCATION: 'Sala 101\\, bud. 65',
    'DTSTART;TZID=Europe/Warsaw:': '20261019T081500', 'DTEND;TZID=Europe/Warsaw:': '20261019T095000',
    RRULE: 'FREQ=WEEKLY;UNTIL=20261130T235959Z;BYDAY=MO', 'EXDATE;TZID=Europe/Warsaw:': '20261102T081500' }),
  vevent({ UID: 'ana@usos', 'RECURRENCE-ID;TZID=Europe/Warsaw:': '20261109T081500', SUMMARY: `${title} - przeniesione`,
    'DTSTART;TZID=Europe/Warsaw:': '20261110T120000', 'DTEND;TZID=Europe/Warsaw:': '20261110T133500' }),
  vevent({ UID: 'ana@usos', 'RECURRENCE-ID;TZID=Europe/Warsaw:': '20261116T081500', STATUS: 'CANCELLED',
    'DTSTART;TZID=Europe/Warsaw:': '20261116T081500', 'DTEND;TZID=Europe/Warsaw:': '20261116T095000' }),
  vevent({ UID: 'so@usos', SUMMARY: 'Systemy operacyjne (L)', DTSTART: '20261021T090000Z', DURATION: 'PT1H35M', RRULE: 'FREQ=WEEKLY;INTERVAL=2;COUNT=3' }),
  vevent({ UID: 'wolne', SUMMARY: 'Dzień wolny od zajęć', 'DTSTART;VALUE=DATE:': '20261111', 'DTEND;VALUE=DATE:': '20261112' }),
);
