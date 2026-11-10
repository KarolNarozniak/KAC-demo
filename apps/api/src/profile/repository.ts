import { ProfileError, normalizeAvailability } from './availability.js';
import type { Pool, PoolClient } from 'pg';
import type { UserScope } from '../api/scope.js';
import { PostgresScheduleRepository } from '../scheduling/repository.js';
import { profileFromContext } from './rules.js';
import type { ValidWorkProfile, WorkProfile } from './types.js';

export type SaveProfileResult =
  | { kind: 'saved'; profile: WorkProfile }
  /** Ktoś zapisał profil w międzyczasie (inne okno, inne urządzenie) – zwracamy aktualną wersję. */
  | { kind: 'conflict'; current: WorkProfile }
  | { kind: 'not-found' };

export interface WorkProfileRepository {
  listAvailability?(scope:UserScope):Promise<{version:number;profileVersion:string;intervals:import('./availability.js').Interval[]}>;
  replaceAvailability?(scope:UserScope,intervals:import('./availability.js').Interval[],version:number):Promise<{version:number;profileVersion:string;intervals:import('./availability.js').Interval[]}>;
  /** Aktywny profil pracy użytkownika z zakresu albo null, gdy go nie ma. */
  getProfile(scope: UserScope): Promise<WorkProfile | null>;
  /** Zapisuje cały profil, tylko jeśli expectedVersion jest aktualną wersją profilu. */
  saveProfile(scope: UserScope, expectedVersion: string, value: ValidWorkProfile): Promise<SaveProfileResult>;
}

/**
 * Profil pracy w PostgreSQL (S23KC2S1P2-179).
 * Odczyt korzysta z tego samego zapytania co generator grafiku, więc ekran profilu i planowanie widzą identyczne dane.
 */
export class PostgresWorkProfileRepository implements WorkProfileRepository {
  private readonly planning: PostgresScheduleRepository;

  constructor(private readonly pool: Pool) {
    this.planning = new PostgresScheduleRepository(pool);
  }

  async getProfile(scope: UserScope): Promise<WorkProfile | null> {
    const context = await this.planning.getPlanningContext(scope.userId, scope.calendarId);
    return context ? profileFromContext(context) : null;
  }

  /**
   * Atomowy zapis profilu: jedna transakcja, wiersz profilu zablokowany (FOR UPDATE) od sprawdzenia wersji
   * do zapisu dostępności, preferencji, blokad i szablonów. Przy błędzie nic się nie zmienia.
   * Dwa równoczesne zapisy z tą samą wersją: pierwszy przechodzi, drugi dostaje konflikt.
   */
  async saveProfile(scope: UserScope, expectedVersion: string, value: ValidWorkProfile): Promise<SaveProfileResult> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const current = await client.query<{ id_profilu: string; version: string }>(
        `select id_profilu, updated_at::text as version from t_profile_pracy
         where id_uzytkownika = $1 and aktywny and exists(select 1 from t_kalendarze c where c.id_kalendarza=$2 and c.id_uzytkownika=$1 and c.aktywny) for update`, [scope.userId,scope.calendarId]);
      const row = current.rows[0];
      if (!row) {
        await client.query('rollback');
        return { kind: 'not-found' };
      }
      if (row.version !== expectedVersion) {
        await client.query('rollback');
        const latest = await this.getProfile(scope);
        return latest ? { kind: 'conflict', current: latest } : { kind: 'not-found' };
      }
      await this.writeProfile(client, row.id_profilu, value);
      await client.query('commit');
    } catch (error) {
      await client.query('rollback').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
    const saved = await this.getProfile(scope);
    return saved ? { kind: 'saved', profile: saved } : { kind: 'not-found' };
  }

  private async writeProfile(client: PoolClient, profileId: string, value: ValidWorkProfile) {
    const monthly = value.targetPeriod === 'month';
    await client.query(`update t_profile_pracy set
      min_godzin_tydzien = $2, cel_godzin_tydzien = $3, max_godzin_tydzien = $4,
      okres_celu = $5, cel_godzin_miesiac = $6,
      czas_dojazdu_min = $7, min_odpoczynku_min = $8, tryb_pracy = $9,
      min_slot_min = $10, max_slot_min = $11, max_godzin_dzien = $12, stawka_pln=case when $13 then $14::numeric else stawka_pln end, rodzaj_stawki=case when $15 then $16::text else rodzaj_stawki end, version=version+1, updated_at = clock_timestamp()
      where id_profilu = $1`, [profileId, value.minimumHours, value.weeklyTargetHours, value.maximumHours,
      monthly ? 'Miesiac' : 'Tydzien', monthly ? value.targetHours : null,
      value.commuteBufferMinutes, value.minimumRestMinutes, value.mode,
      value.minimumShiftMinutes, value.maximumSlotMinutes, value.maxHoursPerDay,value.hourlyRatePln!==undefined,value.hourlyRatePln??null,value.rateKind!==undefined,value.rateKind??null]);

    // Listy zapisujemy jako „stan docelowy”: usuwamy pozycje, których nie ma w formularzu, resztę dodajemy albo zmieniamy.
    const availability=normalizeAvailability(value.availability);
    await client.query(`delete from t_dostepnosc where id_profilu=$1 and rodzaj='Dostępny'`,[profileId]);
    for(const window of availability) await client.query(`insert into t_dostepnosc(id_profilu,dzien_tygodnia,od_godzina,do_godzina,rodzaj) values($1,$2,$3::time,$4::time,'Dostępny')`,[profileId,window.dayOfWeek,window.startTime,window.endTime]);
    await client.query(`delete from t_prefer_godziny where id_profilu = $1 and not (id_preferencji = any($2::text[]))`,
      [profileId, value.preferredWorkWindows.map((window) => window.id)]);
    for (const window of value.preferredWorkWindows) {
      await client.query(`insert into t_prefer_godziny (id_preferencji, id_profilu, dzien_tygodnia, od_godzina, do_godzina, waga)
        values ($1, $2, $3, $4::time, $5::time, $6)
        on conflict (id_preferencji) do update set dzien_tygodnia = excluded.dzien_tygodnia,
          od_godzina = excluded.od_godzina, do_godzina = excluded.do_godzina, waga = excluded.waga
        where t_prefer_godziny.id_profilu = excluded.id_profilu`, [window.id, profileId, window.dayOfWeek, window.startTime, window.endTime, window.weight]);
    }

    await client.query(`delete from t_blokady where id_profilu = $1 and not (id_blokady = any($2::text[]))`,
      [profileId, value.blockedPeriods.map((period) => period.id)]);
    for (const period of value.blockedPeriods) {
      await client.query(`insert into t_blokady (id_blokady, id_profilu, typ, rozpoczecie, zakonczenie, powod)
        values ($1, $2, $3, $4::timestamptz, $5::timestamptz, $6)
        on conflict (id_blokady) do update set typ = excluded.typ, rozpoczecie = excluded.rozpoczecie,
          zakonczenie = excluded.zakonczenie, powod = excluded.powod where t_blokady.id_profilu = excluded.id_profilu`,
      [period.id, profileId, period.type, period.start, period.end, period.reason ?? null]);
    }

    await client.query(`delete from t_szablony_zmian where id_profilu = $1 and not (id_szablonu = any($2::text[]))`,
      [profileId, value.shiftTemplates.map((template) => template.id)]);
    for (const template of value.shiftTemplates) {
      await client.query(`insert into t_szablony_zmian
        (id_szablonu, id_profilu, nazwa, godzina_od, godzina_do, koniec_nastepnego_dnia, dni_tygodnia, aktywna)
        values ($1, $2, $3, $4::time, $5::time, $6, $7::smallint[], $8)
        on conflict (id_szablonu) do update set nazwa = excluded.nazwa, godzina_od = excluded.godzina_od,
          godzina_do = excluded.godzina_do, koniec_nastepnego_dnia = excluded.koniec_nastepnego_dnia,
          dni_tygodnia = excluded.dni_tygodnia, aktywna = excluded.aktywna
        where t_szablony_zmian.id_profilu = excluded.id_profilu`, [template.id, profileId, template.name,
        template.startTime, template.endTime, template.endsNextDay, template.daysOfWeek, template.active]);
    }
  }
  private async availability(scope:UserScope, intervals?:import('./availability.js').Interval[], version?:number){
    const normalized=intervals===undefined?undefined:normalizeAvailability(intervals);
    const client=await this.pool.connect();
    try{
      await client.query('BEGIN');
      const locked=await client.query(`select p.id_profilu,p.version,p.updated_at::text as profile_version from t_profile_pracy p join t_kalendarze c on c.id_uzytkownika=p.id_uzytkownika where p.id_uzytkownika=$1 and p.aktywny and c.id_kalendarza=$2 and c.aktywny for update of p`,[scope.userId,scope.calendarId]);
      const row=locked.rows[0];if(!row)throw new ProfileError('profile_not_found',404);
      if(version!==undefined&&version!==row.version)throw new ProfileError('version_conflict',409);
      if(normalized!==undefined){
        await client.query("delete from t_dostepnosc where id_profilu=$1 and rodzaj='Dostępny'",[row.id_profilu]);
        for(const i of normalized)await client.query("insert into t_dostepnosc(id_profilu,dzien_tygodnia,od_godzina,do_godzina,rodzaj) values($1,$2,$3::time,$4::time,'Dostępny')",[row.id_profilu,i.dayOfWeek,i.startTime,i.endTime]);
        const updated=await client.query('update t_profile_pracy set version=version+1,updated_at=clock_timestamp() where id_profilu=$1 returning version,updated_at::text as profile_version',[row.id_profilu]);
        Object.assign(row,updated.rows[0]);
      }
      const saved=await client.query(`select dzien_tygodnia as "dayOfWeek",left(od_godzina::text,5) as "startTime",left(do_godzina::text,5) as "endTime" from t_dostepnosc where id_profilu=$1 and rodzaj='Dostępny' order by dzien_tygodnia,od_godzina`,[row.id_profilu]);
      await client.query('COMMIT');return {version:row.version,profileVersion:row.profile_version,intervals:saved.rows};
    }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
  }
  listAvailability(scope:UserScope){return this.availability(scope);}
  replaceAvailability(scope:UserScope,intervals:import('./availability.js').Interval[],version:number){return this.availability(scope,intervals,version);}

}
