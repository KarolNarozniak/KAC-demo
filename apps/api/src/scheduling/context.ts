import type { PoolClient } from 'pg';
import { toInstant } from '../import/rules.js';
import type { Interval } from '../profile/availability.js';
import { ProfileError } from '../profile/availability.js';
import type { TimedItem, Window } from './constraints.js';
export const addDays = (date: string, n: number) => new Date(Date.parse(date + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);
export function instant(date: string, time: string, zone: string) {
    const value = time === '24:00' ? toInstant(addDays(date, 1), '00:00', zone) : toInstant(date, time, zone);
    if (!value)
        throw new ProfileError('invalid_local_time', 422, { date, time });
    return value.toISOString();
}
export function availabilityWindows(week: string, intervals: Interval[], zone: string): Window[] {
    const windows = intervals.map(i => ({ start: instant(addDays(week, i.dayOfWeek - 1), i.startTime, zone), end: instant(addDays(week, i.dayOfWeek - 1), i.endTime, zone) }));
    // Adjacent weeks supply buffer space, while paid work stays inside the requested week.
    for (const i of intervals) {
        if (i.dayOfWeek === 7 && i.endTime === '24:00')
            windows.push({ start: instant(addDays(week, -1), i.startTime, zone), end: instant(week, '00:00', zone) });
        if (i.dayOfWeek === 1 && i.startTime === '00:00')
            windows.push({ start: instant(addDays(week, 7), '00:00', zone), end: instant(addDays(week, 7), i.endTime, zone) });
    }
    windows.sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
    const merged: Window[] = [];
    for (const w of windows) {
        const prev = merged.at(-1);
        if (prev && Date.parse(w.start) <= Date.parse(prev.end)) {
            if (Date.parse(w.end) > Date.parse(prev.end))
                prev.end = w.end;
        }
        else
            merged.push({ ...w });
    }
    return merged;
}
export async function calendarContext(c: PoolClient, userId: string, calendarId: string, week: string) {
    const owner = await c.query(`select u.strefa_czasowa from t_kalendarze c join t_uzytkownicy u using(id_uzytkownika) where c.id_kalendarza=$1 and c.id_uzytkownika=$2 and c.aktywny=true for update of c`, [calendarId, userId]);
    if (!owner.rowCount)
        throw new ProfileError('calendar_not_found', 404);
    const zone: string = owner.rows[0].strefa_czasowa;
    const r = await c.query(`select e.id_wydarzenia as id,e.tytul as title,e.rozpoczecie,e.zakonczenie,e.powtarzaj_co_tydzien,k.nazwa,to_char(e.rozpoczecie at time zone $2,'YYYY-MM-DD"T"HH24:MI') as local_start,to_char(e.zakonczenie at time zone $2,'YYYY-MM-DD"T"HH24:MI') as local_end from t_wydarzenia e join t_kategorie k using(id_kategorii) where e.id_kalendarza=$1 and e.status='Aktywne'`, [calendarId, zone]);
    const events: TimedItem[] = [];
    const categories: Record<string, TimedItem['category']> = { 'Praca': 'Work', 'Zajęcia': 'Class', 'Prywatne': 'Personal' };
    const from = Date.parse(instant(addDays(week, -8), '00:00', zone)), to = Date.parse(instant(addDays(week, 15), '00:00', zone));
    for (const e of r.rows) {
        const category = categories[e.nazwa] ?? 'Personal';
        if (!e.powtarzaj_co_tydzien) {
            if (e.zakonczenie.getTime() >= from && e.rozpoczecie.getTime() <= to)
                events.push({ id: e.id, title: e.title, start: e.rozpoczecie.toISOString(), end: e.zakonczenie.toISOString(), category });
            continue;
        }
        const base = e.local_start.slice(0, 10), endBase = e.local_end.slice(0, 10), durationDays = Math.round((Date.parse(endBase) - Date.parse(base)) / 86400000);
        for (let n = -8; n < 15; n++) {
            const day = addDays(week, n);
            if (day < base || (Date.parse(day) - Date.parse(base)) % 604800000 !== 0)
                continue;
            events.push({ id: e.id + '@' + day, title: e.title, start: instant(day, e.local_start.slice(11), zone), end: instant(addDays(day, durationDays), e.local_end.slice(11), zone), category });
        }
    }
    const blocks=await c.query('select id,title,start_time,end_time from blocks where user_id=$1',[userId]);
    for(const block of blocks.rows)events.push({id:'block:'+block.id,title:block.title,start:block.start_time.toISOString(),end:block.end_time.toISOString(),category:'Personal'});
    return { zone, events };
}
