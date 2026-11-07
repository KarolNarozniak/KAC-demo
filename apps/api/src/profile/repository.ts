// Preferowane godziny pracy (user story: określenie preferowanych godzin).
// t_prefer_godziny i t_dostepnosc już istnieją w 001_initial_model.sql — żadna nowa migracja nie jest potrzebna.
import type { Pool, PoolClient } from 'pg';

export type PreferenceInterval = { dayOfWeek: number; startTime: string; endTime: string; weight: number };
export type AvailabilityInterval = { dayOfWeek: number; startTime: string; endTime: string };
export type PreferencesSnapshot = { version: string; intervals: PreferenceInterval[]; availability: AvailabilityInterval[] };

export class PreferencesValidationError extends Error {
  constructor(message: 'invalid_interval' | 'invalid_weight' | 'preference_outside_availability' | 'profile_not_found', public rowIndex?: number) { super(message); }
}
export class PreferencesConflictError extends Error { constructor() { super('profile_version_conflict'); } }

const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;
const hasTwoDecimals = (value: number) => Math.abs(Math.round(value * 100) - value * 100) < 1e-9;

async function activeProfile(client: PoolClient | Pool, userId: string) {
  const result = await client.query(
    `select id_profilu, updated_at from t_profile_pracy where id_uzytkownika = $1 and aktywny = true order by created_at desc limit 1`,
    [userId]);
  return result.rows[0] as { id_profilu: string; updated_at: Date } | undefined;
}

const toRow = (row: { dzien_tygodnia: number; od_godzina: string; do_godzina: string }) =>
  ({ dayOfWeek: row.dzien_tygodnia, startTime: row.od_godzina.slice(0, 5), endTime: row.do_godzina.slice(0, 5) });

export async function listPreferences(pool: Pool, userId: string): Promise<PreferencesSnapshot> {
  const profile = await activeProfile(pool, userId);
  if (!profile) return { version: '', intervals: [], availability: [] };
  const [preferences, availability] = await Promise.all([
    pool.query(`select dzien_tygodnia, od_godzina, do_godzina, waga from t_prefer_godziny where id_profilu = $1 order by dzien_tygodnia, od_godzina`, [profile.id_profilu]),
    pool.query(`select dzien_tygodnia, od_godzina, do_godzina from t_dostepnosc where id_profilu = $1 order by dzien_tygodnia, od_godzina`, [profile.id_profilu]),
  ]);
  return {
    version: profile.updated_at.toISOString(),
    intervals: preferences.rows.map((row) => ({ ...toRow(row), weight: Number(row.waga) })),
    availability: availability.rows.map(toRow),
  };
}

const withinAvailability = (interval: PreferenceInterval, availability: AvailabilityInterval[]) =>
  availability.some((slot) => slot.dayOfWeek === interval.dayOfWeek && interval.startTime >= slot.startTime && interval.endTime <= slot.endTime);

/** Zastępuje całą listę preferencji w transakcji, z kontrolą wersji profilu (optymistyczna blokada na `updated_at`). */
export async function replacePreferences(pool: Pool, userId: string, expectedVersion: string, intervals: PreferenceInterval[]): Promise<PreferencesSnapshot> {
  intervals.forEach((interval, rowIndex) => {
    if (!Number.isInteger(interval.dayOfWeek) || interval.dayOfWeek < 1 || interval.dayOfWeek > 7) throw new PreferencesValidationError('invalid_interval', rowIndex);
    if (!timePattern.test(interval.startTime) || !timePattern.test(interval.endTime) || interval.endTime <= interval.startTime) throw new PreferencesValidationError('invalid_interval', rowIndex);
    if (!Number.isFinite(interval.weight) || interval.weight < 0 || !hasTwoDecimals(interval.weight)) throw new PreferencesValidationError('invalid_weight', rowIndex);
  });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const profile = await activeProfile(client, userId);
    if (!profile) throw new PreferencesValidationError('profile_not_found');
    if (profile.updated_at.toISOString() !== expectedVersion) throw new PreferencesConflictError();

    const availabilityResult = await client.query(`select dzien_tygodnia, od_godzina, do_godzina from t_dostepnosc where id_profilu = $1`, [profile.id_profilu]);
    const availability: AvailabilityInterval[] = availabilityResult.rows.map(toRow);
    // Niedozwolone zakresy zgłaszamy bez przycinania danych w ciszy — błąd z numerem wiersza, zero automatycznej korekty.
    if (availability.length) {
      intervals.forEach((interval, rowIndex) => {
        if (!withinAvailability(interval, availability)) throw new PreferencesValidationError('preference_outside_availability', rowIndex);
      });
    }

    await client.query(`delete from t_prefer_godziny where id_profilu = $1`, [profile.id_profilu]);
    for (const interval of intervals) {
      await client.query(
        `insert into t_prefer_godziny (id_profilu, dzien_tygodnia, od_godzina, do_godzina, waga) values ($1, $2, $3, $4, $5)`,
        [profile.id_profilu, interval.dayOfWeek, interval.startTime, interval.endTime, interval.weight]);
    }
    const touched = await client.query(`update t_profile_pracy set updated_at = now() where id_profilu = $1 returning updated_at`, [profile.id_profilu]);
    await client.query('COMMIT');
    return { version: touched.rows[0].updated_at.toISOString(), intervals, availability };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}