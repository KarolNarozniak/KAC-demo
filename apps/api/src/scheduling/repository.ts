import type { Pool, PoolClient } from 'pg';
import { WorkProfileRepository, mapProfile } from '../profile/repository.js';
import { ProfileError } from '../profile/availability.js';
import { calculatePay, rateGrosz } from './pay.js';
import { calendarContext, availabilityWindows, addDays, instant } from './context.js';
import { generateShifts, validateAvailability, validateCommuteGaps, type TimedItem } from './constraints.js';
export class SchedulingRepository {
    profiles: WorkProfileRepository;
    constructor(pool: Pool) { this.profiles = new WorkProfileRepository(pool); }
    async context(c: PoolClient, user: string, calendar: string, week: string, requirePay = true) {
        const context = await calendarContext(c, user, calendar, week);
        const row = await this.profiles.lock(c, user);
        const profile = mapProfile(row);
        const missing = Object.entries(requirePay ? { hourlyRatePln: profile.hourlyRatePln, rateKind: profile.rateKind, commuteMinutes: profile.commuteMinutes, targetHours: profile.targetHours } : { commuteMinutes: profile.commuteMinutes }).filter(([, v]) => v === null).map(([k]) => k);
        if (missing.length)
            throw new ProfileError('profile_incomplete', 422, { fields: missing });
        if (requirePay)
            rateGrosz(profile.hourlyRatePln);
        const windows = availabilityWindows(week, await this.profiles.readIntervals(c, row.id_profilu), context.zone);
        return { ...context, row, profile, windows };
    }
    validate(shifts: TimedItem[], ctx: Awaited<ReturnType<SchedulingRepository['context']>>) {
        const ids = new Set(shifts.map(s => s.id));
        const violations = [...validateAvailability(shifts, ctx.windows, ctx.profile.commuteMinutes!), ...validateCommuteGaps([...ctx.events, ...shifts], ctx.profile.commuteMinutes!, ctx.profile.minRestMinutes).filter(v => ids.has(v.leftId) || ids.has(v.rightId))];
        if (violations.length)
            throw new ProfileError('schedule_constraints', 422, { violations });
        const minutes = shifts.reduce((n, s) => n + (Date.parse(s.end) - Date.parse(s.start)) / 60000, 0);
        if (ctx.profile.maxHours !== null && minutes > ctx.profile.maxHours * 60)
            throw new ProfileError('max_hours_exceeded');
    }
    async read(c: PoolClient, id: string, user: string) {
        const r = await c.query(`select g.*,to_char(g.tydzien_od,'YYYY-MM-DD') as week from t_grafiki g join t_profile_pracy p using(id_profilu) where g.id_grafiku=$1 and p.id_uzytkownika=$2`, [id, user]);
        if (!r.rowCount)
            throw new ProfileError('schedule_not_found', 404);
        const g = r.rows[0];
        const s = await c.query(`select id_zmiany as id,rozpoczecie,zakonczenie,stawka_pln,wynagrodzenie_pln,rodzaj_stawki from t_zmiany_pracy where id_grafiku=$1 order by rozpoczecie,id_zmiany`, [id]);
        return { id, status: g.status, week: g.week, commuteMinutes: g.czas_dojazdu_min, plannedHours: Number(g.plan_godzin), targetHours: Number(g.cel_godzin), estimatedPayPln: Number(g.szac_placa_pln), achievable: g.czy_osiagalny, shifts: s.rows.map(s => ({ id: s.id, start: s.rozpoczecie.toISOString(), end: s.zakonczenie.toISOString(), category: 'Work' as const, hourlyRatePln: Number(s.stawka_pln), estimatedPayPln: Number(s.wynagrodzenie_pln), rateKind: s.rodzaj_stawki })) };
    }
    async list(user: string, week: string) {
        return this.profiles.transaction(async (c) => {
            const r = await c.query(`select g.id_grafiku from t_grafiki g join t_profile_pracy p using(id_profilu) where p.id_uzytkownika=$1 and g.tydzien_od=$2::date order by g.created_at desc,g.id_grafiku`, [user, week]);
            const result = [];
            for (const row of r.rows)
                result.push(await this.read(c, row.id_grafiku, user));
            return result;
        });
    }
    async get(id: string, user: string) { return this.profiles.transaction(c => this.read(c, id, user)); }
    async summarize(c: PoolClient, id: string) {
        const total = await c.query('select coalesce(sum(wynagrodzenie_pln),0) as amount from t_zmiany_pracy where id_grafiku=$1', [id]);
        if (Number(total.rows[0].amount) > 9999999999.99)
            throw new ProfileError('pay_overflow');
        await c.query(`update t_grafiki set plan_godzin=(select coalesce(sum(extract(epoch from (zakonczenie-rozpoczecie))/3600),0) from t_zmiany_pracy where id_grafiku=$1),szac_placa_pln=(select coalesce(sum(wynagrodzenie_pln),0) from t_zmiany_pracy where id_grafiku=$1),updated_at=now() where id_grafiku=$1`, [id]);
        await c.query('update t_grafiki set czy_osiagalny=plan_godzin>=cel_godzin where id_grafiku=$1', [id]);
    }
    async generate(user: string, calendar: string, week: string) {
        return this.profiles.transaction(async (c) => {
            const ctx = await this.context(c, user, calendar, week);
            const shifts = generateShifts(ctx.windows, ctx.events, Math.round(ctx.profile.targetHours! * 60), ctx.profile.commuteMinutes!, ctx.profile.minRestMinutes, { start: instant(week, '00:00', ctx.zone), end: instant(addDays(week, 7), '00:00', ctx.zone) });
            this.validate(shifts, ctx);
            const g = await c.query(`insert into t_grafiki(id_profilu,id_kalendarza,tydzien_od,tydzien_do,status,cel_godzin,czas_dojazdu_min) values($1,$2,$3,$4,'Proposed',$5,$6) returning id_grafiku`, [ctx.row.id_profilu, calendar, week, addDays(week, 6), ctx.profile.targetHours, ctx.profile.commuteMinutes]);
            const id = g.rows[0].id_grafiku;
            for (const s of shifts) {
                const pay = calculatePay(ctx.profile.hourlyRatePln, s.start, s.end);
                await c.query(`insert into t_zmiany_pracy(id_grafiku,rozpoczecie,zakonczenie,godziny,stawka_pln,wynagrodzenie_pln,rodzaj_stawki,status) values($1,$2,$3,$4,$5,$6,$7,'Proposed')`, [id, s.start, s.end, pay.durationMinutes / 60, ctx.profile.hourlyRatePln, pay.estimatedPayPln, ctx.profile.rateKind]);
            }
            await this.summarize(c, id);
            return { ...await this.read(c, id, user), commuteMinutes: ctx.profile.commuteMinutes };
        });
    }
    async change(user: string, calendar: string, id: string, action: 'accept' | 'reject' | 'edit', edit?: {
        shiftId: string;
        start: string;
        end: string;
    }) {
        return this.profiles.transaction(async (c) => {
            // Calendar lock is shared with all existing event writers and imports.
            const owned = await c.query('select id_kalendarza from t_kalendarze where id_kalendarza=$1 and id_uzytkownika=$2 and aktywny=true for update', [calendar, user]);
            if (!owned.rowCount)
                throw new ProfileError('calendar_not_found', 404);
            const locked = await c.query(`select g.id_grafiku from t_grafiki g join t_profile_pracy p using(id_profilu) where g.id_grafiku=$1 and g.id_kalendarza=$2 and p.id_uzytkownika=$3 for update of g`, [id, calendar, user]);
            if (!locked.rowCount)
                throw new ProfileError('schedule_not_found', 404);
            const schedule = await this.read(c, id, user);
            if (schedule.status !== 'Proposed')
                throw new ProfileError('schedule_closed', 409);
            if (action === 'reject') {
                await c.query("update t_grafiki set status='Rejected' where id_grafiku=$1", [id]);
                await c.query("update t_zmiany_pracy set status='Rejected' where id_grafiku=$1", [id]);
                return this.read(c, id, user);
            }
            const ctx = await this.context(c, user, calendar, schedule.week, false);
            const shifts = schedule.shifts.map(s => edit && s.id === edit.shiftId ? { ...s, start: edit.start, end: edit.end } : s);
            if (edit && !schedule.shifts.some(s => s.id === edit.shiftId))
                throw new ProfileError('shift_not_found', 404);
            for (const s of shifts)
                calculatePay(s.hourlyRatePln, s.start, s.end);
            this.validate(shifts, ctx);
            if (action === 'edit' && edit) {
                const shift = shifts.find(s => s.id === edit.shiftId)!;
                const pay = calculatePay(shift.hourlyRatePln, edit.start, edit.end);
                await c.query(`update t_zmiany_pracy set rozpoczecie=$2,zakonczenie=$3,godziny=$4,wynagrodzenie_pln=$5 where id_zmiany=$1`, [edit.shiftId, edit.start, edit.end, pay.durationMinutes / 60, pay.estimatedPayPln]);
                await this.summarize(c, id);
            }
            if (action === 'accept') {
                for (const s of shifts) {
                    const event = await c.query(`insert into t_wydarzenia(id_kalendarza,id_kategorii,tytul,rozpoczecie,zakonczenie,obowiazkowe,powtarzaj_co_tydzien) values($1,(select id_kategorii from t_kategorie where nazwa='Praca'),'Praca',$2,$3,false,false) returning id_wydarzenia`, [calendar, s.start, s.end]);
                    await c.query("update t_zmiany_pracy set id_wydarzenia=$2,status='Accepted' where id_zmiany=$1", [s.id, event.rows[0].id_wydarzenia]);
                }
                await c.query("update t_grafiki set status='Accepted',updated_at=now() where id_grafiku=$1", [id]);
            }
            return this.read(c, id, user);
        });
    }
}
