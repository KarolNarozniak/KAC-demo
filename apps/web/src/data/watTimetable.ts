import type { CalendarEvent } from '../domain/model';

type TimetableBlock = {
  code: string;
  title: string;
  form: string;
  instructor: string;
  hours: number;
  day: number;
  time: string;
};

const semesterStart = new Date(2026, 1, 23);
const semesterWeekCount = 22;
const meetingMinutes = 95;

const blocks: TimetableBlock[] = [
  { code: 'Asie', title: 'Ataki sieciowe', form: 'Wykład', instructor: 'mgr inż. Marcin Pachnik', hours: 16, day: 1, time: '16:00' },
  { code: 'Asie', title: 'Ataki sieciowe', form: 'Laboratorium', instructor: 'mgr inż. Łukasz Giro', hours: 28, day: 2, time: '16:00' },
  { code: 'Bsbp', title: 'Bezpieczeństwo sieci bezprzewodowych', form: 'Wykład', instructor: 'dr inż. Zbigniew Świerczynski', hours: 14, day: 1, time: '09:50' },
  { code: 'Bsbp', title: 'Bezpieczeństwo sieci bezprzewodowych', form: 'Laboratorium', instructor: 'dr inż. Michał Jarosz', hours: 16, day: 3, time: '16:00' },
  { code: 'Est', title: 'Eksploracja sieci teleinformatycznych', form: 'Zaliczenie', instructor: 'dr inż. Michał Jarosz', hours: 2, day: 3, time: '11:40' },
  { code: 'Oni', title: 'Oprogramowanie niepożądane i inspekcja kodu', form: 'Wykład', instructor: 'dr inż. Adam Patkowski', hours: 14, day: 1, time: '08:00' },
  { code: 'Oni', title: 'Oprogramowanie niepożądane i inspekcja kodu', form: 'Projekt', instructor: 'dr inż. Adam Patkowski', hours: 16, day: 4, time: '11:40' },
  { code: 'Oni', title: 'Oprogramowanie niepożądane i inspekcja kodu', form: 'Laboratorium', instructor: 'mgr inż. Waldemar Szylberg', hours: 14, day: 3, time: '08:00' },
  { code: 'Ppz', title: 'Podstawy przetwarzania rozproszonego', form: 'Laboratorium', instructor: 'mgr inż. Paweł Głębocki', hours: 20, day: 2, time: '11:40' },
  { code: 'Ppz', title: 'Podstawy przetwarzania rozproszonego', form: 'Wykład', instructor: 'dr inż. Łukasz Strzelecki', hours: 10, day: 4, time: '13:30' },
  { code: 'S.OP', title: 'Spotkanie z opiekunami praktyk', form: 'Inne', instructor: 'mgr inż. Łukasz Mielniczuk', hours: 2, day: 5, time: '13:30' },
  { code: 'SKII', title: 'Sieci komputerowe II', form: 'Laboratorium', instructor: 'mgr inż. Piotr Targowski', hours: 20, day: 1, time: '08:00' },
  { code: 'SKII', title: 'Sieci komputerowe II', form: 'Wykład', instructor: 'dr inż. Tomasz Malinowski', hours: 10, day: 4, time: '08:00' },
  { code: 'Sbs', title: 'Systemy bezpieczeństwa sieciowego', form: 'Wykład', instructor: 'dr inż. Zbigniew Świerczynski', hours: 10, day: 2, time: '08:00' },
  { code: 'Sbs', title: 'Systemy bezpieczeństwa sieciowego', form: 'Laboratorium', instructor: 'mgr inż. Sebastian Łeska', hours: 20, day: 3, time: '09:50' },
  { code: 'SoU', title: 'Systemy operacyjne UNIX', form: 'Zaliczenie', instructor: 'mgr inż. Michał Melaniuk', hours: 2, day: 5, time: '11:40' },
  { code: 'Sp', title: 'Seminarium przeddyplomowe', form: 'Seminarium', instructor: 'dr inż. Konrad Wrona', hours: 20, day: 3, time: '11:40' },
  { code: 'TpsT', title: 'Technologie projektowania systemów teleinformatycznych', form: 'Wykład', instructor: 'dr inż. Andrzej Stasiak', hours: 14, day: 2, time: '08:00' },
  { code: 'TpsT', title: 'Technologie projektowania systemów teleinformatycznych', form: 'Egzamin', instructor: 'dr inż. Andrzej Stasiak', hours: 4, day: 5, time: '09:50' },
  { code: 'TpsT', title: 'Technologie projektowania systemów teleinformatycznych', form: 'Ćwiczenia', instructor: 'dr Sławomir Machowski', hours: 6, day: 4, time: '16:00' },
  { code: 'TpsT', title: 'Technologie projektowania systemów teleinformatycznych', form: 'Laboratorium', instructor: 'dr Sławomir Machowski', hours: 24, day: 4, time: '17:50' },
  { code: 'Wpp', title: 'Wszystkie przedmioty prowadzącego', form: 'Zaliczenie', instructor: 'dr inż. Adam Patkowski, mgr inż. Waldemar Szylberg', hours: 2, day: 5, time: '16:00' },
  { code: 'zsw', title: 'Zarządzanie środowiskiem Windows', form: 'Wykład', instructor: 'mgr inż. Łukasz Mielniczuk', hours: 14, day: 5, time: '08:00' },
  { code: 'zsw', title: 'Zarządzanie środowiskiem Windows', form: 'Laboratorium', instructor: 'mgr inż. Łukasz Mielniczuk', hours: 30, day: 2, time: '09:50' },
  { code: 'zsw', title: 'Zarządzanie środowiskiem Windows', form: 'Egzamin', instructor: 'mgr inż. Łukasz Mielniczuk', hours: 4, day: 4, time: '13:30' },
];

const pad = (value: number) => String(value).padStart(2, '0');
const localDateKey = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

export const watTimetableStart = semesterStart;

export const watTimetableEvents: CalendarEvent[] = blocks.flatMap((block, blockIndex) => {
  const sessions = Math.ceil(block.hours / 2);
  const [hour, minute] = block.time.split(':').map(Number);
  return Array.from({ length: sessions }, (_, sessionIndex) => {
    const offset = blockIndex % 4;
    const finalWeek = semesterWeekCount - 1;
    const week = sessions === 1 ? offset : offset + Math.floor(sessionIndex * (finalWeek - offset) / (sessions - 1));
    const start = new Date(semesterStart.getFullYear(), semesterStart.getMonth(), semesterStart.getDate() + week * 7 + block.day - 1, hour, minute);
    const end = new Date(start.getTime() + meetingMinutes * 60_000);
    return {
      id: `wat-${blockIndex + 1}-${sessionIndex + 1}`,
      title: `${block.code} · ${block.title}`,
      start: `${localDateKey(start)}T${pad(start.getHours())}:${pad(start.getMinutes())}`,
      end: `${localDateKey(end)}T${pad(end.getHours())}:${pad(end.getMinutes())}`,
      category: 'Class',
      mandatory: block.form === 'Wykład'
        ? sessionIndex === 0 || sessionIndex === sessions - 1
        : true,
      repeatWeekly: false,
      source: 'demo',
      courseCode: block.code,
      courseForm: block.form,
      instructor: block.instructor,
      semesterHours: block.hours,
    } satisfies CalendarEvent;
  });
});
