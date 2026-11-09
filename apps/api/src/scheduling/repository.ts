import type { Pool } from 'pg';
import { config } from '../config.js';
import { localDateTimeString } from './time.js';
import type { PlanningContext, ScheduleGenerationResult } from './types.js';

export class ScheduleNotFoundError extends Error {}
export class ScheduleAlreadyApprovedError extends Error {}
export class ProfileVersionConflictError extends Error {}
export class ScheduleVersionConflictError extends Error {
  constructor(public expectedVersion: number, public actualVersion: number) { super('schedule_version_conflict'); }
}

export type ScheduleRepository = Pick<PostgresScheduleRepository, 'getPlanningContext' | 'saveSchedule' | 'getLatestSchedule' | 'getScheduleById' | 'listSchedules' | 'getApprovedShiftEventIds' | 'approveSchedule' | 'rejectSchedule'>;

export class PostgresScheduleRepository {
  constructor(private readonly connectionPool: Pool) {
    this.ensureBlocksTable().catch(() => {});
  }

  async ensureBlocksTable() {
    await this.connectionPool.query(`
      CREATE TABLE IF NOT EXISTS blocks (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id VARCHAR(255) NOT NULL,
        title VARCHAR(255) NOT NULL,
        start_time TIMESTAMP WITH TIME ZONE NOT NULL,
        end_time TIMESTAMP WITH TIME ZONE NOT NULL,
        type VARCHAR(50) NOT NULL CHECK (type IN ('vacation', 'exam_session', 'day_off')),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      )
    `);
  }

  async getPlanningContext(userId = config.demoUserId, calendarId = config.demoCalendarId, requestedProfileId?: string): Promise<PlanningContext | null> {
    await this.ensureBlocksTable();
    const profileResult = await this.connectionPool.query(`
      select p.id_profilu, p.id_uzytkownika, c.id_kalendarza, u.strefa_czasowa,
        p.min_godzin_tydzien, p.cel_godzin_tydzien, p.max_godzin_tydzien, p.stawka_pln,
        p.czas_dojazdu_min, p.min_odpoczynku_min, p.tryb_pracy, p.min_slot_min, p.max_slot_min,
        p.max_godzin_dzien, p.okres_celu, p.cel_godzin_miesiac, p.updated_at::text as profile_version
      from t_profile_pracy p
      join t_uzytkownicy u on u.id_uzytkownika = p.id_uzytkownika
      join t_kalendarze c on c.id_uzytkownika = p.id_uzytkownika and c.id_kalendarza = $2 and c.aktywny
      where p.id_uzytkownika = $1 and p.aktywny and ($3::text is null or p.id_profilu = $3)
      order by p.updated_at desc, p.created_at desc, p.id_profilu desc limit 1`, [userId, calendarId, requestedProfileId ?? null]);
    const profile = profileResult.rows[0];
    if (!profile) return null;
    const profileId: string = profile.id_profilu;
    
    const [availability, preferences, blocks, calendarBlocksResult, events, templates] = await Promise.all([
      this.connectionPool.query(`select id_dostepnosci, dzien_tygodnia, od_godzina, do_godzina
        from t_dostepnosc where id_profilu = $1 order by dzien_tygodnia, od_godzina`, [profileId]),
      this.connectionPool.query(`select id_preferencji, dzien_tygodnia, od_godzina, do_godzina, waga
        from t_prefer_godziny where id_profilu = $1 order by dzien_tygodnia, od_godzina`, [profileId]),
      this.connectionPool.query(`select id_blokady, typ, rozpoczecie, zakonczenie, powod
        from t_blokady where id_profilu = $1 order by rozpoczecie`, [profileId]),
      this.connectionPool.query(`select id, user_id, title, start_time, end_time, type
        from blocks where user_id = $1 order by start_time`, [userId]),
      this.connectionPool.query(`select e.id_wydarzenia, e.tytul, e.obowiazkowe, e.powtarzaj_co_tydzien, e.zrodlo,
          to_char(e.rozpoczecie at time zone $2, 'YYYY-MM-DD"T"HH24:MI') as start_local,
          to_char(e.zakonczenie at time zone $2, 'YYYY-MM-DD"T"HH24:MI') as end_local,
          k.nazwa as category, s.data_konca::text as series_end_date
        from t_wydarzenia e join t_kategorie k on k.id_kategorii = e.id_kategorii
        left join t_serie s on s.id_serii = e.id_serii
        where e.id_kalendarza = $1 and e.status = 'Aktywne' order by e.rozpoczecie`, [profile.id_kalendarza, profile.strefa_czasowa]),
      this.connectionPool.query(`select id_szablonu, nazwa, godzina_od, godzina_do, koniec_nastepnego_dnia, dni_tygodnia, aktywna
        from t_szablony_zmian where id_profilu = $1 order by nazwa`, [profileId]),
    ]);

    const number = (value: string | number | null, fallback: number) => value === null ? fallback : Number(value);
    const time = (value: string) => value.slice(0, 5);
    const categoryMap: Record<string, 'Class' | 'Work' | 'Personal'> = { Zajęcia: 'Class', Praca: 'Work', Prywatne: 'Personal' };

    return {
      profile: {
        id: profileId,
        userId: profile.id_uzytkownika,
        calendarId: profile.id_kalendarza,
        timeZone: profile.strefa_czasowa,
        minimumHours: number(profile.min_godzin_tydzien, 0),
        targetHours: number(profile.cel_godzin_tydzien, 0),
        maximumHours: number(profile.max_godzin_tydzien, 40),
        hourlyRatePln: number(profile.stawka_pln, 0),
        commuteBufferMinutes: Number(profile.czas_dojazdu_min),
        minimumRestMinutes: Number(profile.min_odpoczynku_min),
        mode: profile.tryb_pracy,
        minimumShiftMinutes: Number(profile.min_slot_min),
        maximumSlotMinutes: Number(profile.max_slot_min),
        maxHoursPerDay: Number(profile.max_godzin_dzien),
        profileVersion: profile.profile_version,
        targetPeriod: profile.okres_celu === 'Miesiac' ? 'month' : 'week',
        periodTargetHours: profile.okres_celu === 'Miesiac' ? number(profile.cel_godzin_miesiac, 0) : number(profile.cel_godzin_tydzien, 0),
      },
      availability: availability.rows.map((row) => ({ id: row.id_dostepnosci, dayOfWeek: Number(row.dzien_tygodnia), startTime: time(row.od_godzina), endTime: time(row.do_godzina) })),
      preferredWorkWindows: preferences.rows.map((row) => ({ id: row.id_preferencji, dayOfWeek: Number(row.dzien_tygodnia), startTime: time(row.od_godzina), endTime: time(row.do_godzina), weight: Number(row.waga) })),
      
      blockedPeriods: [
        ...blocks.rows.map((row) => ({ id: String(row.id_blokady), type: row.typ, start: new Date(row.rozpoczecie).toISOString(), end: new Date(row.zakonczenie).toISOString(), reason: row.powod ?? undefined })),
        ...calendarBlocksResult.rows.map((row) => ({ id: String(row.id), type: row.type, start: new Date(row.start_time).toISOString(), end: new Date(row.end_time).toISOString(), reason: row.title })),
      ],

      events: events.rows.map((row) => ({ id: row.id_wydarzenia, title: row.tytul, start: row.start_local, end: row.end_local,
        category: categoryMap[row.category] ?? 'Personal', mandatory: row.obowiazkowe, repeatWeekly: row.powtarzaj_co_tydzien, source: row.zrodlo, seriesEndDate: row.series_end_date })),
      shiftTemplates: templates.rows.map((row) => ({ id: row.id_szablonu, name: row.nazwa, startTime: time(row.godzina_od), endTime: time(row.godzina_do),
        endsNextDay: row.koniec_nastepnego_dnia, daysOfWeek: row.dni_tygodnia.map(Number), active: row.aktywna })),
    };
  }

  async saveSchedule(context: PlanningContext, schedule: ScheduleGenerationResult, expectedVersion?: number): Promise<ScheduleGenerationResult> {
    const client = await this.connectionPool.connect();
    try {
      await client.query('begin');
      await client.query('select id_kalendarza from t_kalendarze where id_kalendarza = $1 for update', [context.profile.calendarId]);
      const latest = await client.query(`select coalesce(max(version), 0)::integer as version from t_grafiki where id_kalendarza = $1 and tydzien_od = $2`, [context.profile.calendarId, schedule.weekStart]);
      const currentVersion = Number(latest.rows[0].version);
      if (expectedVersion !== undefined && expectedVersion !== currentVersion) throw new ScheduleVersionConflictError(expectedVersion, currentVersion);
      const version = currentVersion + 1;
      const snapshot = { ...schedule.parameters, upperBoundMinutes: schedule.upperBoundMinutes,
        minimumShortfallMinutes: schedule.minimumShortfallMinutes, optionalLecturesSkipped: schedule.optionalLecturesSkipped,
        workdaysUsed: schedule.workdaysUsed, maximumCapacityMinutes: schedule.maximumCapacityMinutes, context };
      const inserted = await client.query(`insert into t_grafiki
        (id_profilu, id_kalendarza, tydzien_od, tydzien_do, status, cel_godzin, plan_godzin, szac_placa_pln, czy_osiagalny,
         min_godzin, max_godzin, target_minutes, existing_work_minutes, proposed_minutes, total_minutes, shortfall_minutes,
         version, generator_version, input_snapshot, tryb_pracy, solution_status)
        values ($1, $2, $3::date, ($3::date + 6), 'proposed', $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17::jsonb, $18, $19)
        returning id_grafiku`, [context.profile.id, context.profile.calendarId, schedule.weekStart,
        schedule.targetMinutes / 60, schedule.totalMinutes / 60, schedule.totalMinutes / 60 * context.profile.hourlyRatePln,
        schedule.solutionStatus === 'target_met', schedule.minimumMinutes / 60, schedule.maximumMinutes / 60, schedule.targetMinutes,
        schedule.existingWorkMinutes, schedule.proposedMinutes, schedule.totalMinutes, schedule.shortfallMinutes,
        version, schedule.generatorVersion, JSON.stringify(snapshot), schedule.mode, schedule.solutionStatus]);
      const scheduleId: string = inserted.rows[0].id_grafiku;
      for (const shift of schedule.shifts) {
        await client.query(`insert into t_zmiany_pracy
          (id_grafiku, rozpoczecie, zakonczenie, godziny, stawka_pln, wynagrodzenie_pln, status, candidate_id, template_id, optional_lecture_ids, soft_penalty)
          values ($1, $2::timestamptz, $3::timestamptz, $4, $5, $6, 'Proponowana', $7, $8, $9, $10)`, [scheduleId, shift.start, shift.end,
          shift.durationMinutes / 60, context.profile.hourlyRatePln, shift.durationMinutes / 60 * context.profile.hourlyRatePln,
          shift.candidateId, shift.templateId ?? null, shift.optionalLectureIds, shift.softPenalty]);
      }
      for (const violation of schedule.violations) {
        await client.query(`insert into t_ograniczenia_grafiku
          (id_grafiku, typ, parametr, wartosc, wynik, opis, kod, szczegoly)
          values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`, [scheduleId, violation.severity, violation.code,
          typeof violation.details.minutes === 'number' ? violation.details.minutes : null, violation.severity, violation.message,
          violation.code, JSON.stringify({ ...violation.details, candidateIds: violation.candidateIds, eventIds: violation.eventIds })]);
      }
      await client.query('commit');
      return { ...schedule, scheduleId, version, isApproved: false, workflowStatus: 'proposed', approvedAt: undefined };
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally { client.release(); }
  }

  async approveSchedule(weekStart: string, expectedVersion: number, calendarId = config.demoCalendarId): Promise<ScheduleGenerationResult | null> {
    const client = await this.connectionPool.connect();
    try {
      await client.query('begin');
      await client.query('select id_kalendarza from t_kalendarze where id_kalendarza = $1 for update', [calendarId]);
      const latest = await client.query(`select id_grafiku, version, approved_at from t_grafiki
        where id_kalendarza = $1 and tydzien_od = $2::date and rejected_at is null order by version desc limit 1 for update`, [calendarId, weekStart]);
      const row = latest.rows[0];
      if (!row) { await client.query('rollback'); return null; }
      if (Number(row.version) !== expectedVersion) throw new ScheduleVersionConflictError(expectedVersion, Number(row.version));
      if (row.approved_at) {
        await client.query('commit');
        return this.getLatestSchedule(weekStart, calendarId);
      }
      const previousApproved = await client.query(`select id_grafiku from t_grafiki
        where id_kalendarza = $1 and tydzien_od = $2::date and approved_at is not null and id_grafiku <> $3 for update`,
      [calendarId, weekStart, row.id_grafiku]);
      for (const previous of previousApproved.rows) {
        await client.query(`delete from t_wydarzenia where zrodlo = 'Plan pracy' and id_wydarzenia = any(
          select id_wydarzenia from t_zmiany_pracy where id_grafiku = $1 and id_wydarzenia is not null)`, [previous.id_grafiku]);
        await client.query(`update t_zmiany_pracy set status = 'Zastąpiona' where id_grafiku = $1`, [previous.id_grafiku]);
        await client.query(`update t_grafiki set status = 'superseded' where id_grafiku = $1`, [previous.id_grafiku]);
      }
      const shifts = await client.query(`select id_zmiany, rozpoczecie, zakonczenie from t_zmiany_pracy
        where id_grafiku = $1 and id_wydarzenia is null order by rozpoczecie`, [row.id_grafiku]);
      for (const shift of shifts.rows) {
        const event = await client.query(`insert into t_wydarzenia
          (id_kalendarza, id_kategorii, tytul, rozpoczecie, zakonczenie, obowiazkowe, powtarzaj_co_tydzien, zrodlo, status, miejsce)
          values ($1, (select id_kategorii from t_kategorie where nazwa = 'Praca' limit 1), 'Zmiana pracy',
            $2, $3, false, false, 'Plan pracy', 'Aktywne', '') returning id_wydarzenia`, [calendarId, shift.rozpoczecie, shift.zakonczenie]);
        await client.query(`update t_zmiany_pracy set id_wydarzenia = $2, status = 'Zatwierdzona' where id_zmiany = $1`, [shift.id_zmiany, event.rows[0].id_wydarzenia]);
      }
      await client.query(`update t_grafiki set approved_at = now(), status = 'accepted' where id_grafiku = $1`, [row.id_grafiku]);
      await client.query('commit');
      return this.getLatestSchedule(weekStart, calendarId);
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally { client.release(); }
  }

  async rejectSchedule(weekStart: string, expectedVersion: number, calendarId = config.demoCalendarId): Promise<ScheduleGenerationResult | null> {
    const client = await this.connectionPool.connect();
    try {
      await client.query('begin');
      await client.query('select id_kalendarza from t_kalendarze where id_kalendarza = $1 for update', [calendarId]);
      const latest = await client.query(`select id_grafiku, version, approved_at from t_grafiki
        where id_kalendarza = $1 and tydzien_od = $2::date and rejected_at is null order by version desc limit 1 for update`, [calendarId, weekStart]);
      const row = latest.rows[0];
      if (!row) { await client.query('rollback'); return null; }
      if (Number(row.version) !== expectedVersion) throw new ScheduleVersionConflictError(expectedVersion, Number(row.version));
      if (row.approved_at) throw new ScheduleAlreadyApprovedError('accepted_schedule_cannot_be_rejected');
      await client.query(`update t_grafiki set rejected_at = now(), status = 'rejected'
        where id_kalendarza = $1 and tydzien_od = $2::date and approved_at is null and rejected_at is null`, [calendarId, weekStart]);
      await client.query('commit');
      return this.getLatestSchedule(weekStart, calendarId);
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally { client.release(); }
  }

  async getApprovedShiftEventIds(weekStart: string, calendarId = config.demoCalendarId): Promise<string[]> {
    const result = await this.connectionPool.query(`select z.id_wydarzenia from t_grafiki g
      join t_zmiany_pracy z on z.id_grafiku = g.id_grafiku
      where g.id_kalendarza = $1 and g.tydzien_od = $2::date and g.approved_at is not null and z.id_wydarzenia is not null`, [calendarId, weekStart]);
    return result.rows.map((row) => row.id_wydarzenia as string);
  }

  async getLatestSchedule(weekStart: string, calendarId = config.demoCalendarId): Promise<ScheduleGenerationResult | null> {
    return this.readSchedule(weekStart, calendarId);
  }

  async getScheduleById(scheduleId: string): Promise<ScheduleGenerationResult | null> {
    const result = await this.connectionPool.query(`select id_kalendarza, to_char(tydzien_od, 'YYYY-MM-DD') as week_start
      from t_grafiki where id_grafiku = $1`, [scheduleId]);
    const row = result.rows[0];
    return row ? this.readSchedule(row.week_start, row.id_kalendarza, scheduleId) : null;
  }

  async listSchedules(filters: { from: string; to: string; limit: number; offset: number }, calendarId = config.demoCalendarId) {
    const [result, countResult] = await Promise.all([this.connectionPool.query(`select g.id_grafiku, g.tydzien_od::text as week_start, g.status,
        g.solution_status, g.version, g.approved_at, g.rejected_at, g.target_minutes, g.total_minutes, g.shortfall_minutes,
        count(*) over()::integer as total_count
      from t_grafiki g where g.id_kalendarza = $1 and g.tydzien_od between $2::date and $3::date
      order by g.tydzien_od desc, g.version desc limit $4 offset $5`, [calendarId, filters.from, filters.to, filters.limit, filters.offset]),
      this.connectionPool.query(`select count(*)::integer as total from t_grafiki where id_kalendarza = $1 and tydzien_od between $2::date and $3::date`, [calendarId, filters.from, filters.to])]);
    return { items: result.rows.map((row) => ({ scheduleId: row.id_grafiku, weekStart: row.week_start, status: row.status,
      solutionStatus: row.solution_status, version: Number(row.version), isApproved: Boolean(row.approved_at), isRejected: Boolean(row.rejected_at),
      targetMinutes: Number(row.target_minutes), totalMinutes: Number(row.total_minutes), shortfallMinutes: Number(row.shortfall_minutes) })),
       total: Number(countResult.rows[0].total), limit: filters.limit, offset: filters.offset };
  }

  private async readSchedule(weekStart: string, calendarId: string, scheduleId?: string): Promise<ScheduleGenerationResult | null> {
    const result = await this.connectionPool.query(`select g.*, to_char(g.tydzien_od, 'YYYY-MM-DD') as week_start,
        (select coalesce(jsonb_agg(jsonb_build_object(
        'candidateId', z.candidate_id, 'templateId', z.template_id, 'optionalLectureIds', z.optional_lecture_ids,
        'softPenalty', z.soft_penalty, 'calendarEventId', z.id_wydarzenia, 'title', 'Praca', 'start', z.rozpoczecie, 'end', z.zakonczenie,
        'durationMinutes', round(z.godziny * 60)::integer, 'mode', g.tryb_pracy)), '[]'::jsonb) from t_zmiany_pracy z where z.id_grafiku = g.id_grafiku) as shift_rows,
        (select coalesce(jsonb_agg(jsonb_build_object('code', o.kod, 'severity', o.typ, 'message', o.opis,
        'candidateIds', o.szczegoly->'candidateIds', 'eventIds', o.szczegoly->'eventIds', 'details', o.szczegoly)), '[]'::jsonb) from t_ograniczenia_grafiku o where o.id_grafiku = g.id_grafiku) as violation_rows
      from t_grafiki g where g.id_kalendarza = $1 and g.tydzien_od = $2::date
        and ($3::text is not null or g.rejected_at is null) and ($3::text is null or g.id_grafiku = $3)
      order by g.version desc limit 1`, [calendarId, weekStart, scheduleId ?? null]);
    const row = result.rows[0];
    if (!row) return null;
    const snapshot = row.input_snapshot ?? {};
    const snapshotContext = snapshot.context ?? {};
    const { context: _context, ...savedParameters } = snapshot;
    const savedShifts = (row.shift_rows ?? []).map((shift: Record<string, unknown>) => {
      const start = new Date(shift.start as string), end = new Date(shift.end as string);
      const startLocal = localDateTimeString(start, snapshotContext.profile?.timeZone ?? 'Europe/Warsaw');
      const endLocal = localDateTimeString(end, snapshotContext.profile?.timeZone ?? 'Europe/Warsaw');
      return { candidateId: shift.candidateId as string, title: 'Praca', start: start.toISOString(), end: end.toISOString(), startLocal, endLocal,
        durationMinutes: Number(shift.durationMinutes), workDate: startLocal.slice(0, 10), mode: row.tryb_pracy,
        templateId: shift.templateId as string | undefined, calendarEventId: shift.calendarEventId as string | undefined,
        optionalLectureIds: shift.optionalLectureIds as string[] ?? [], softPenalty: Number(shift.softPenalty ?? 0) };
    });
    return {
      scheduleId: row.id_grafiku, version: Number(row.version), workflowStatus: row.status, isApproved: Boolean(row.approved_at), approvedAt: row.approved_at?.toISOString(), weekStart: row.week_start,
      maximumCapacityMinutes: Number(snapshot.maximumCapacityMinutes ?? row.total_minutes),
      timeZone: snapshotContext.profile?.timeZone ?? 'Europe/Warsaw', mode: row.tryb_pracy, solutionStatus: row.solution_status,
      minimumMinutes: Number(row.min_godzin) * 60, targetMinutes: Number(row.target_minutes), maximumMinutes: Number(row.max_godzin) * 60,
      existingWorkMinutes: Number(row.existing_work_minutes), proposedMinutes: Number(row.proposed_minutes), totalMinutes: Number(row.total_minutes),
      shortfallMinutes: Number(row.shortfall_minutes), minimumShortfallMinutes: Number(snapshot.minimumShortfallMinutes ?? Math.max(0, Number(row.min_godzin) * 60 - Number(row.total_minutes))),
      upperBoundMinutes: Number(snapshot.upperBoundMinutes ?? Number(row.total_minutes) + Number(row.shortfall_minutes)),
      optionalLecturesSkipped: snapshot.optionalLecturesSkipped ?? [...new Set(savedShifts.flatMap((shift: { optionalLectureIds: string[] }) => shift.optionalLectureIds))],
      workdaysUsed: Number(snapshot.workdaysUsed ?? new Set(savedShifts.map((shift: { workDate: string }) => shift.workDate)).size),
      shifts: savedShifts,
      violations: (row.violation_rows ?? []).map((violation: Record<string, unknown>) => ({ ...violation, candidateIds: violation.candidateIds ?? [], eventIds: violation.eventIds ?? [], details: violation.details ?? {} })),
      generatedAt: row.created_at.toISOString(), generatorVersion: row.generator_version,
      parameters: savedParameters,
    };
  }
}
```[cite: 7]

### Co zrobić teraz?
1. Zapisz plik `apps/api/src/scheduling/repository.ts`.
2. Zrób commita i wyślij zmiany na GitHuba:
   ```bash
   git add apps/api/src/scheduling/repository.ts
   git commit -m "fix: ensure blocks table is auto-created in PostgresScheduleRepository too"
   git push origin Krzysztof_Blokowanie_dni