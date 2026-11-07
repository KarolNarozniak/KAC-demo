import {PostgresScheduleRepository} from '../src/scheduling/repository.js';
import {generateSchedule} from '../src/scheduling/generator.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { Pool } from 'pg';
import { config } from '../src/config.js';
import { WorkProfileRepository } from '../src/profile/repository.js';
import { SchedulingRepository } from '../src/scheduling/work-profile-repository.js';
import { buildApi } from '../src/app.js';
test('isolated PostgreSQL: ownership, rollback, concurrent version, snapshots and acceptance constraints', { skip: !config.databaseUrl }, async () => {
    const schema = 'test_planning_' + Date.now();
    const admin = new Pool({ connectionString: config.databaseUrl, connectionTimeoutMillis: 3000 });
    const pool = new Pool({ connectionString: config.databaseUrl, options: `-c search_path=${schema}`, connectionTimeoutMillis: 3000 });
    let app: ReturnType<typeof buildApi> | undefined;
    try {
        await admin.query(`create schema ${schema}`);
        for (const migration of (await readdir(new URL('../../../database/migrations/', import.meta.url))).filter(name => name.endsWith('.sql')).sort())
            await pool.query(await readFile(new URL('../../../database/migrations/' + migration, import.meta.url), 'utf8'));
        await pool.query(`insert into t_uzytkownicy(id_uzytkownika,imie,nazwisko,email) values ($1,'Test','Owner','owner@test'),('other','Other','Owner','other@test')`, [config.demoUserId]);
        await pool.query(`insert into t_kalendarze(id_kalendarza,id_uzytkownika,nazwa,typ) values ($1,$2,'Test','Osobisty')`, [config.demoCalendarId, config.demoUserId]);
        await pool.query(`insert into t_kategorie(id_kategorii,nazwa,kolor_hex) values ('work','Praca','#000000'),('class','Zajęcia','#000000'),('personal','Prywatne','#000000')`);
        await pool.query(`insert into t_profile_pracy(id_profilu,id_uzytkownika) values ('profile',$1),('other_profile','other')`, [config.demoUserId]);
        const profiles = new WorkProfileRepository(pool), planning = new SchedulingRepository(pool);
        app = buildApi(null, [], { workProfile: profiles, scheduling: planning });
        const request = (method: string, url: string, payload?: any) => app!.inject({ method: method as any, url, payload });
        const p = await profiles.getProfile(config.demoUserId);
        assert.equal(p.commuteMinutes, null);
        assert.equal((await request('POST', '/api/v1/work-profile/schedules/generate', { week: '2026-11-02' })).statusCode, 422);
        await profiles.saveProfile(config.demoUserId, { ...p, hourlyRatePln: 30, rateKind: 'gross', commuteMinutes: 30, targetHours: 20, maxHours: 30 });
        const a = await profiles.replaceAvailability(config.demoUserId, [{ dayOfWeek: 7, startTime: '22:00', endTime: '02:00' }, { dayOfWeek: 2, startTime: '08:00', endTime: '24:00' }, { dayOfWeek: 3, startTime: '08:00', endTime: '16:00' }], 2);
        assert.equal(a.intervals[0]?.endTime, '02:00');
        assert.equal(a.intervals.at(-1)?.endTime, '24:00');
        await assert.rejects(profiles.replaceAvailability('missing', [], 1), /profile_not_found/);
        await assert.rejects(profiles.replaceAvailability('other', [], a.version), /version_conflict/);
        assert.equal((await profiles.listAvailability(config.demoUserId)).intervals.length, 4);
        // Force an INSERT failure after DELETE using a trigger scoped only to this disposable schema.
        await pool.query(`create function fail_insert() returns trigger language plpgsql as $$ begin if NEW.od_godzina='13:00' then raise exception 'forced insert failure'; end if; return NEW; end $$; create trigger test_failure before insert on t_dostepnosc for each row execute function fail_insert()`);
        await assert.rejects(profiles.replaceAvailability(config.demoUserId, [{ dayOfWeek: 1, startTime: '08:00', endTime: '09:00' }, { dayOfWeek: 1, startTime: '13:00', endTime: '14:00' }], a.version), /forced insert failure/);
        assert.deepEqual(await profiles.listAvailability(config.demoUserId), a);
        await pool.query('drop trigger test_failure on t_dostepnosc');
        const concurrent = await Promise.allSettled([profiles.replaceAvailability(config.demoUserId, a.intervals, a.version), profiles.replaceAvailability(config.demoUserId, a.intervals, a.version)]);
        assert.equal(concurrent.filter(r => r.status === 'fulfilled').length, 1);
        const generated = await request('POST', '/api/v1/work-profile/schedules/generate', { week: '2026-11-02' });
        assert.equal(generated.statusCode, 200, generated.body);
        const schedule = generated.json();
        assert.equal(schedule.plannedHours, 20);
        assert.equal(schedule.estimatedPayPln, 600);
        assert.ok(schedule.shifts.length);
        assert.equal((await planning.get(schedule.id, config.demoUserId)).shifts[0]?.hourlyRatePln, 30);
        await assert.rejects(planning.get(schedule.id, 'other'), /schedule_not_found/);
        const shift = schedule.shifts[0];
        const invalid = await request('PUT', `/api/v1/work-profile/schedules/${schedule.id}/shifts/${shift.id}`, { start: '2026-11-02T00:00:00Z', end: '2026-11-02T01:00:00Z' });
        assert.equal(invalid.statusCode, 422);
        const accepted = await request('POST', `/api/v1/work-profile/schedules/${schedule.id}/accept`, {});
        assert.equal(accepted.statusCode, 200, accepted.body);
        assert.equal((await pool.query('select count(*)::int as n from t_wydarzenia')).rows[0].n, schedule.shifts.length);
        const before = await planning.get(schedule.id, config.demoUserId);
        const current = await profiles.getProfile(config.demoUserId);
        await profiles.saveProfile(config.demoUserId, { ...current, hourlyRatePln: 99, rateKind: 'net' });
        assert.deepEqual(await planning.get(schedule.id, config.demoUserId), before);
        assert.equal((await request('POST', `/api/v1/work-profile/schedules/${schedule.id}/accept`, {})).statusCode, 409);
        const next = await planning.generate(config.demoUserId, config.demoCalendarId, '2026-11-09');
        const count = (await pool.query('select count(*)::int as n from t_wydarzenia')).rows[0].n;
        await planning.change(config.demoUserId, config.demoCalendarId, next.id, 'reject');
        assert.equal((await pool.query('select count(*)::int as n from t_wydarzenia')).rows[0].n, count);
        // Revalidation catches a new event added after generation; no partial calendar writes.
        const pending = await planning.generate(config.demoUserId, config.demoCalendarId, '2026-11-16');
        const first = pending.shifts[0]!;
        await pool.query(`insert into t_wydarzenia(id_kalendarza,id_kategorii,tytul,rozpoczecie,zakonczenie) values($1,'class','Added after generation',$2,$3)`, [config.demoCalendarId, first.start, first.end]);
        await assert.rejects(planning.change(config.demoUserId, config.demoCalendarId, pending.id, 'accept'), /schedule_constraints/);
        assert.equal((await planning.get(pending.id, config.demoUserId)).status, 'Proposed');
        const smallProfile = await profiles.getProfile(config.demoUserId);
        await profiles.saveProfile(config.demoUserId, { ...smallProfile, hourlyRatePln: 0.01, rateKind: 'net', commuteMinutes: 0, targetHours: 1 });
        const smallA = await profiles.listAvailability(config.demoUserId);
        await profiles.replaceAvailability(config.demoUserId, [{ dayOfWeek: 1, startTime: '08:00', endTime: '08:30' }, { dayOfWeek: 2, startTime: '08:00', endTime: '08:30' }], smallA.version);
        const rounding = await planning.generate(config.demoUserId, config.demoCalendarId, '2026-11-23');
        assert.equal(rounding.shifts.length, 2);
        assert.equal(rounding.estimatedPayPln, 0.02);
        assert.equal(rounding.shifts[0]?.estimatedPayPln, 0.01);
        assert.equal(rounding.shifts[0]?.rateKind, 'net');
        const snapshotRate = await profiles.getProfile(config.demoUserId);
        await profiles.saveProfile(config.demoUserId, { ...snapshotRate, hourlyRatePln: null, rateKind: null });
        await planning.change(config.demoUserId, config.demoCalendarId, rounding.id, 'accept');
        assert.equal((await planning.get(rounding.id, config.demoUserId)).estimatedPayPln, 0.02);
        const emptyProfile = await profiles.getProfile(config.demoUserId);
        await profiles.saveProfile(config.demoUserId, { ...emptyProfile, hourlyRatePln: 0, rateKind: 'gross' });
        const currentA = await profiles.listAvailability(config.demoUserId);
        const cleared = await profiles.replaceAvailability(config.demoUserId, [], currentA.version);
        assert.deepEqual(cleared.intervals, []);
        assert.equal((await planning.generate(config.demoUserId, config.demoCalendarId, '2026-11-23')).estimatedPayPln, 0);
        // A neighbor from Sunday is read even though the requested week starts Monday.
        const boundaryProfile = await profiles.getProfile(config.demoUserId);
        await profiles.saveProfile(config.demoUserId, { ...boundaryProfile, commuteMinutes: 30, targetHours: 0.5 });
        const boundaryA = await profiles.listAvailability(config.demoUserId);
        await profiles.replaceAvailability(config.demoUserId, [
            { dayOfWeek: 1, startTime: '00:00', endTime: '03:00' },
            { dayOfWeek: 7, startTime: '22:00', endTime: '24:00' }
        ], boundaryA.version);
        await pool.query(`insert into t_wydarzenia(id_kalendarza,id_kategorii,tytul,rozpoczecie,zakonczenie,miejsce) values($1,'class','Sunday class','2026-11-29T21:00:00Z','2026-11-29T22:45:00Z','')`, [config.demoCalendarId]);
        const boundary = await planning.generate(config.demoUserId, config.demoCalendarId, '2026-11-30');
        assert.equal(boundary.shifts[0]?.start, '2026-11-29T23:15:00.000Z');
        const tooEarly = await request('PUT', `/api/v1/work-profile/schedules/${boundary.id}/shifts/${boundary.shifts[0]!.id}`, {
            start: '2026-11-29T23:14:00Z', end: '2026-11-29T23:44:00Z'
        });
        assert.equal(tooEarly.statusCode, 422);
        assert.equal(tooEarly.json().details.violations[0].actualMinutes, 29);
        await planning.change(config.demoUserId, config.demoCalendarId, boundary.id, 'accept');
        const advanced = new PostgresScheduleRepository(pool);
        const legacyBefore = await planning.get(schedule.id,config.demoUserId);
        assert.equal(await advanced.getLatestSchedule('2026-11-02',config.demoCalendarId),null);
        const advancedContext = (await advanced.getPlanningContext(config.demoUserId,config.demoCalendarId))!;
        advancedContext.events=[];
        advancedContext.profile.targetHours=2;
        advancedContext.profile.minimumHours=0;
        advancedContext.profile.commuteBufferMinutes=0;
        advancedContext.availability=[{id:'new-window',dayOfWeek:1,startTime:'08:00',endTime:'18:00'}];
        const advancedDraft=await advanced.saveSchedule(advancedContext,generateSchedule(advancedContext,'2026-11-02'));
        assert.equal(advancedDraft.shifts[0]?.hourlyRatePln,0);
        assert.equal(advancedDraft.estimatedPayPln,0);
        assert.equal(await advanced.getScheduleById(schedule.id),null);
        await assert.rejects(planning.get(advancedDraft.scheduleId!,config.demoUserId),/schedule_not_found/);
        const beforeAdvanced=await advanced.getScheduleById(advancedDraft.scheduleId!);
        const changed=await profiles.getProfile(config.demoUserId);
        await profiles.saveProfile(config.demoUserId,{...changed,hourlyRatePln:99,rateKind:'net'});
        assert.deepEqual(await advanced.getScheduleById(advancedDraft.scheduleId!),beforeAdvanced);
        const advancedShift=advancedDraft.shifts[0]!;
        await pool.query(`insert into t_wydarzenia(id_kalendarza,id_kategorii,tytul,rozpoczecie,zakonczenie) values($1,'class','Concurrent class',$2,$3)`,[config.demoCalendarId,advancedShift.start,advancedShift.end]);
        await assert.rejects(advanced.approveSchedule('2026-11-02',advancedDraft.version!,config.demoCalendarId),/invalid_schedule/);
        await advanced.rejectSchedule('2026-11-02',advancedDraft.version!,config.demoCalendarId);
        assert.deepEqual(await planning.get(schedule.id,config.demoUserId),legacyBefore);
        // Applying master's workflow normalization must preserve old accepted/rejected states.
        for(const migration of ['007_work_profile_workflow.sql','008_schedule_workflow_status.sql','009_work_profile_workflow_restore.sql'])
            await pool.query(await readFile(new URL('../../../database/migrations/'+migration,import.meta.url),'utf8'));
        assert.deepEqual(await planning.get(schedule.id,config.demoUserId),legacyBefore);
        assert.equal((await planning.get(next.id,config.demoUserId)).status,'Rejected');
    }
    finally {
        await app?.close();
        await pool.end();
        await admin.query(`drop schema if exists ${schema} cascade`);
        await admin.end();
    }
});
