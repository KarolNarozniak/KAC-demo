// Import planu zajęć z pliku ICS (S23KC2S1P2-8): odczyt pliku, powtarzanie, strefy czasowe, pominięte wydarzenia i API.
import assert from 'node:assert/strict';
import test from 'node:test';
import { buildApi, type CalendarRepository } from '../src/app.js';
import { decodeIcsFile, IcsError, MAX_ICS_ROWS, parseIcs, resolveZone } from '../src/import/ics/parse.js';
import { ics, semesterPlan, vevent } from './ics-fixture.js';

const slot = (row: { date: string; startTime: string; endTime: string; title: string }) => `${row.date} ${row.startTime}-${row.endTime} ${row.title}`;
const b64 = (text: string) => Buffer.from(text, 'utf8').toString('base64');

test('seria cotygodniowa: wyjątek EXDATE, przeniesione i odwołane wystąpienie, miejsce ze znakami ucieczki', () => {
  const result = parseIcs(semesterPlan());
  const lecture = result.rows.filter((row) => row.uid === 'ana@usos');
  assert.deepEqual(lecture.map(slot), [
    '2026-10-19 08:15-09:50 Analiza matematyczna (W)',
    '2026-10-26 08:15-09:50 Analiza matematyczna (W)', // po zmianie czasu ta sama godzina lokalna
    '2026-11-10 12:00-13:35 Analiza matematyczna (W) - przeniesione',
    '2026-11-23 08:15-09:50 Analiza matematyczna (W)',
    '2026-11-30 08:15-09:50 Analiza matematyczna (W)',
  ]);
  assert.equal(lecture[0]?.location, 'Sala 101, bud. 65');
  assert.equal(lecture[0]?.repeat, 'co tydzień (pn), do 30.11.2026');
  assert.ok(result.rows.every((row) => row.category === 'Class' && row.confidence === 1));
  assert.equal(result.calendarName, 'Plan WCY23KC2S1');
});

test('seria w UTC co dwa tygodnie z COUNT i wydarzenie całodniowe pominięte z podaniem przyczyny (4a)', () => {
  const result = parseIcs(semesterPlan());
  assert.deepEqual(result.rows.filter((row) => row.uid === 'so@usos').map(slot), [
    '2026-10-21 11:00-12:35 Systemy operacyjne (L)', // 09:00 UTC = 11:00 czasu letniego
    '2026-11-04 10:00-11:35 Systemy operacyjne (L)', // 09:00 UTC = 10:00 czasu zimowego
    '2026-11-18 10:00-11:35 Systemy operacyjne (L)',
  ]);
  assert.deepEqual(result.skipped, { count: 1, reasons: { 'all-day': 1 } });
  assert.equal(result.eventCount, 3); // seria wykładu, seria labu, dzień wolny (przeniesienia należą do serii)
  assert.equal(result.dateFrom, '2026-10-19');
  assert.equal(result.dateTo, '2026-11-30');
});

test('strefy czasowe: Windows (Outlook), X-WR-TIMEZONE dla czasu „pływającego” i inna strefa niż użytkownika', () => {
  assert.equal(resolveZone('Central European Standard Time'), 'Europe/Warsaw');
  assert.equal(resolveZone('/mozilla.org/20050126_1/Europe/Warsaw'), 'Europe/Warsaw');
  assert.equal(resolveZone('Nieznana strefa'), null);

  const london = parseIcs(ics('X-WR-TIMEZONE:Europe/London',
    vevent({ UID: 'a', SUMMARY: 'Wykład gościnny', DTSTART: '20261105T100000', DTEND: '20261105T110000' })));
  assert.deepEqual(london.rows.map(slot), ['2026-11-05 11:00-12:00 Wykład gościnny']);
  assert.equal(london.fileTimeZone, 'Europe/London');
  assert.match(london.warnings.join(' '), /przeliczono/);

  const unknown = parseIcs(ics(vevent({ UID: 'b', SUMMARY: 'Konsultacje', 'DTSTART;TZID=Moja strefa:': '20261105T100000', 'DTEND;TZID=Moja strefa:': '20261105T110000' })));
  assert.deepEqual(unknown.rows.map(slot), ['2026-11-05 10:00-11:00 Konsultacje']);
  assert.match(unknown.warnings.join(' '), /Nie rozpoznano strefy/);
});

test('zawijanie linii, wydarzenie przez północ, brak końca i nieobsługiwane powtarzanie', () => {
  const result = parseIcs(ics(
    ['BEGIN:VEVENT', 'UID:x', 'SUMMARY:Seminarium z bardzo długą', '  nazwą przedmiotu', 'DTSTART;TZID=Europe/Warsaw:20261105T230000', 'DTEND;TZID=Europe/Warsaw:20261106T010000', 'END:VEVENT'].join('\r\n'),
    vevent({ UID: 'y', SUMMARY: 'Bez końca', 'DTSTART;TZID=Europe/Warsaw:': '20261105T100000' }),
    vevent({ UID: 'z', SUMMARY: 'Drugi wtorek', 'DTSTART;TZID=Europe/Warsaw:': '20261110T100000', 'DTEND;TZID=Europe/Warsaw:': '20261110T110000', RRULE: 'FREQ=MONTHLY;BYDAY=2TU' }),
  ));
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0]?.title, 'Seminarium z bardzo długą nazwą przedmiotu');
  assert.equal(result.rows[0]?.endDate, '2026-11-06');
  assert.deepEqual(result.skipped, { count: 2, reasons: { 'missing-time': 1, 'unsupported-repeat': 1 } });
});

test('seria bez daty końca jest ograniczona do roku, a cały import do limitu wierszy', () => {
  const open = parseIcs(ics(vevent({ UID: 'o', SUMMARY: 'Lektorat', 'DTSTART;TZID=Europe/Warsaw:': '20261005T100000', 'DTEND;TZID=Europe/Warsaw:': '20261005T113000', RRULE: 'FREQ=WEEKLY' })));
  assert.equal(open.rows.length, 53);
  assert.match(open.warnings.join(' '), /nie ma daty końca/);
  const daily = parseIcs(ics(...[1, 2, 3, 4].map((n) => vevent({ UID: `d${n}`, SUMMARY: `Zajęcia ${n}`,
    'DTSTART;TZID=Europe/Warsaw:': `2026100${n}T0${n}0000`, 'DTEND;TZID=Europe/Warsaw:': `2026100${n}T0${n}3000`, RRULE: 'FREQ=DAILY' }))));
  assert.equal(daily.rows.length, MAX_ICS_ROWS);
  assert.match(daily.warnings.join(' '), /ponad 1000/);
});

test('plik uszkodzony, nie-ICS albo za duży jest odrzucany przed odczytem (3a)', () => {
  assert.throws(() => parseIcs('BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nEND:VCALENDAR'), IcsError);
  assert.deepEqual(decodeIcsFile(b64('to nie jest kalendarz'), 1000), { ok: false, reason: 'unsupported-format' });
  assert.deepEqual(decodeIcsFile(b64('BEGIN:VCALENDAR\r\nVERSION:2.0'), 1000), { ok: false, reason: 'corrupted-file' });
  assert.deepEqual(decodeIcsFile(b64(semesterPlan()), 100), { ok: false, reason: 'file-too-large' });
  assert.equal(decodeIcsFile(b64(`﻿${semesterPlan()}`), 100_000).ok, true);
});

function fakeRepository() {
  const sessions: unknown[] = [];
  const repository: CalendarRepository = {
    checkConnection: async () => {},
    getOverview: async () => ({ source: 'postgresql', user: { id: 'U001', name: 'Student', timezone: 'Europe/Warsaw' }, calendar: { id: 'K001', name: 'K' },
      counts: { events: 1, categories: 3 },
      events: [{ id: 'E1', title: 'Praca', start: '2026-10-19T09:00', end: '2026-10-19T12:00', category: 'Praca', color: '#000000', mandatory: false, repeatWeekly: false }] }),
    listEventsForImport: async () => [{ id: 'E2', title: 'Analiza matematyczna (W)', start: new Date('2026-10-26T07:15:00Z') }],
    createImportSession: async (input) => { sessions.push(input); return { id: 'IMP-ICS', expiresAt: new Date('2026-10-28T20:00:00Z') }; },
  };
  return { repository, sessions };
}

test('API: plik ICS daje podgląd z duplikatami, kolizjami i liczbą pominiętych; sesja ma format ICS', async () => {
  const { repository, sessions } = fakeRepository();
  const app = buildApi(repository);
  try {
    const response = await app.inject({ method: 'POST', url: '/api/import/classes/read', payload: { fileName: 'plan.ics', dataBase64: b64(semesterPlan()) } });
    assert.equal(response.statusCode, 201);
    const body = response.json();
    assert.equal(body.source, 'ics');
    assert.equal(body.rows.length, 8);
    assert.deepEqual(body.skipped, { count: 1, reasons: { 'all-day': 1 } });
    // 26.10 08:15 – taki sam tytuł i początek jak wydarzenie E2 → duplikat (4b).
    const lecture26 = body.rows.find((row: { date: string }) => row.date === '2026-10-26').id;
    assert.deepEqual(body.preview.find((row: { id: string }) => row.id === lecture26).duplicateOfEvents.map((event: { id: string }) => event.id), ['E2']);
    // 19.10 08:15–09:50 nachodzi na „Praca” 09:00–12:00 → kolizja (7a).
    assert.deepEqual(body.collisions.ics1.map((event: { id: string }) => event.id), ['E1']);
    assert.equal((sessions[0] as { format: string }).format, 'ICS/CSV');
  } finally { await app.close(); }
});

test('API: ICS bez wydarzeń i ICS z samymi wydarzeniami całodniowymi nie tworzą sesji (3b, 4a)', async () => {
  const { repository, sessions } = fakeRepository();
  const app = buildApi(repository);
  try {
    const empty = await app.inject({ method: 'POST', url: '/api/import/classes/read', payload: { fileName: 'pusty.ics', dataBase64: b64(ics()) } });
    assert.equal(empty.statusCode, 422);
    assert.equal(empty.json().error, 'empty-calendar');
    const allDay = await app.inject({ method: 'POST', url: '/api/import/classes/read', payload: { fileName: 'swieta.ics',
      dataBase64: b64(ics(vevent({ UID: 'h', SUMMARY: 'Święto', 'DTSTART;VALUE=DATE:': '20261111' }))) } });
    assert.equal(allDay.statusCode, 422);
    assert.equal(allDay.json().error, 'no-importable-events');
    assert.equal(allDay.json().skipped.count, 1);
    assert.equal(sessions.length, 0);
  } finally { await app.close(); }
});
