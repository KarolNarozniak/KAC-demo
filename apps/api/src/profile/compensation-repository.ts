import type { Pool, PoolClient } from 'pg';
import { ProfileError, normalizeAvailability, type Interval } from './availability.js';
export type WorkProfile = {
    version: number;
    hourlyRatePln: number | null;
    rateKind: 'gross' | 'net' | null;
    commuteMinutes: number | null;
    minRestMinutes: number;
    minHours: number | null;
    targetHours: number | null;
    maxHours: number | null;
};
export const mapProfile = (r: any): WorkProfile => ({ version: r.version, hourlyRatePln: r.stawka_pln === null ? null : Number(r.stawka_pln), rateKind: r.rodzaj_stawki, commuteMinutes: r.czas_dojazdu_min, minRestMinutes: r.min_odpoczynku_min, minHours: r.min_godzin_tydzien === null ? null : Number(r.min_godzin_tydzien), targetHours: r.cel_godzin_tydzien === null ? null : Number(r.cel_godzin_tydzien), maxHours: r.max_godzin_tydzien === null ? null : Number(r.max_godzin_tydzien) });
export class WorkProfileRepository {
    constructor(public pool: Pool) { }
    async transaction<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
        const c = await this.pool.connect();
        try {
            await c.query('BEGIN');
            const value = await fn(c);
            await c.query('COMMIT');
            return value;
        }
        catch (e) {
            await c.query('ROLLBACK');
            throw e;
        }
        finally {
            c.release();
        }
    }
    async lock(c: PoolClient, userId: string, version?: number) {
        const r = await c.query('select * from t_profile_pracy where id_uzytkownika=$1 and aktywny=true order by id_profilu for update', [userId]);
        if (r.rows.length !== 1)
            throw new ProfileError('profile_not_found', 404);
        const row = r.rows[0];
        if (version !== undefined && row.version !== version)
            throw new ProfileError('version_conflict', 409);
        return row;
    }
    async getProfile(userId: string) { return this.transaction(async (c) => mapProfile(await this.lock(c, userId))); }
    async saveProfile(userId: string, p: WorkProfile) {
        return this.transaction(async (c) => {
            const row = await this.lock(c, userId, p.version);
            const r = await c.query(`update t_profile_pracy set okres_celu=case when cel_godzin_tydzien is distinct from $7::numeric then 'Tydzien' else okres_celu end,cel_godzin_miesiac=case when cel_godzin_tydzien is distinct from $7::numeric then null else cel_godzin_miesiac end,stawka_pln=$2, rodzaj_stawki=$3, czas_dojazdu_min=$4,min_odpoczynku_min=$5,min_godzin_tydzien=$6,cel_godzin_tydzien=$7,max_godzin_tydzien=$8,version=version+1,updated_at=now() where id_profilu=$1 returning *`, [row.id_profilu, p.hourlyRatePln, p.rateKind, p.commuteMinutes, p.minRestMinutes, p.minHours, p.targetHours, p.maxHours]);
            return mapProfile(r.rows[0]);
        });
    }
    async readIntervals(c: PoolClient, id: string): Promise<Interval[]> {
        const r = await c.query(`select dzien_tygodnia as "dayOfWeek",left(od_godzina::text,5) as "startTime",left(do_godzina::text,5) as "endTime" from t_dostepnosc where id_profilu=$1 order by dzien_tygodnia,od_godzina`, [id]);
        return r.rows;
    }
    async listAvailability(userId: string) { return this.transaction(async (c) => { const p = await this.lock(c, userId); return { version: p.version, intervals: await this.readIntervals(c, p.id_profilu) }; }); }
    async replaceAvailability(userId: string, intervals: Interval[], version: number) {
        const normalized = normalizeAvailability(intervals);
        return this.transaction(async (c) => {
            const p = await this.lock(c, userId, version);
            await c.query('delete from t_dostepnosc where id_profilu=$1', [p.id_profilu]);
            for (const i of normalized)
                await c.query(`insert into t_dostepnosc(id_profilu,dzien_tygodnia,od_godzina,do_godzina,rodzaj) values($1,$2,$3::time,$4::time,'Dostępny')`, [p.id_profilu, i.dayOfWeek, i.startTime, i.endTime]);
            await c.query('update t_profile_pracy set version=version+1,updated_at=now() where id_profilu=$1', [p.id_profilu]);
            return { version: p.version + 1, intervals: normalized };
        });
    }
}
