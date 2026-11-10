// Klient API profilu pracy (S23KC2S1P2-181): GET/PUT /api/v1/work-profile.
import { apiBaseUrl } from './importApi';

export type WorkMode = 'elastyczny' | 'zmianowy';
export type TargetPeriod = 'week' | 'month';
export type ShiftTemplate = { id: string; name: string; startTime: string; endTime: string; endsNextDay: boolean; daysOfWeek: number[]; active: boolean };
export type AvailabilityWindow = { id: string; dayOfWeek: number; startTime: string; endTime: string };
export type PreferredWorkWindow = AvailabilityWindow & { weight: number };
export type BlockedPeriod = { id: string; type: string; start: string; end: string; reason?: string };

/** Pola liczbowe profilu. */
export const NUMBER_FIELDS = ['minimumHours', 'targetHours', 'maximumHours', 'commuteBufferMinutes', 'minimumRestMinutes', 'minimumShiftMinutes', 'maximumSlotMinutes', 'maxHoursPerDay'] as const;
export type NumberField = typeof NUMBER_FIELDS[number];

/** Treść zapisu profilu. Puste pole liczbowe to null – serwer odpowie wtedy błędem przy polu. */
export type WorkProfileInput = Record<NumberField, number | null> & {
  hourlyRatePln?:number|null;
  rateKind?:'gross'|'net'|null;
  profileVersion: string;
  mode: WorkMode;
  targetPeriod: TargetPeriod;
  availability: AvailabilityWindow[];
  preferredWorkWindows: PreferredWorkWindow[];
  blockedPeriods: BlockedPeriod[];
  shiftTemplates: ShiftTemplate[];
};

/** Profil zwracany przez API. targetHours dotyczy okresu targetPeriod; weeklyTargetHours to cel tygodniowy dla generatora. */
export type WorkProfile = Omit<WorkProfileInput, NumberField> & Record<NumberField, number> & {
  commuteConfigured?:boolean;
  profileId: string;
  timeZone: string;
  targetMinutes: number;
  weeklyTargetHours: number;
  weeklyTargetMinutes: number;
};

/** Serwer odrzucił dane (422). Klucze to nazwy pól, np. „targetHours” albo „availability.0”. */
export class WorkProfileValidationError extends Error {
  constructor(public fields: Record<string, string>) { super('Popraw zaznaczone pola.'); }
}

/** Profil zmieniono w międzyczasie w innym miejscu (409). current to aktualna wersja z serwera. */
export class WorkProfileConflictError extends Error {
  constructor(public current: WorkProfile) { super('Profil został zmieniony w innym miejscu.'); }
}

async function call(method: 'GET' | 'PUT', body?: unknown): Promise<Response> {
  try {
    return await fetch(`${apiBaseUrl()}/api/v1/work-profile`, {
      method,
      headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    // S23KC2S1P2-15, 4b: brak połączenia – formularz zachowuje wpisane dane.
    throw new Error('Brak połączenia z serwerem. Wpisane dane zostały w formularzu – spróbuj zapisać ponownie.');
  }
}

export async function loadWorkProfile(): Promise<WorkProfile> {
  const response = await call('GET');
  if (response.status === 404) throw new Error('Nie masz jeszcze profilu pracy.');
  if (!response.ok) throw new Error('Nie udało się wczytać profilu pracy.');
  return response.json();
}

export async function saveWorkProfile(input: WorkProfileInput): Promise<WorkProfile> {
  const response = await call('PUT', input);
  if (response.status === 422) throw new WorkProfileValidationError((await response.json()).fields ?? {});
  if (response.status === 409) throw new WorkProfileConflictError((await response.json()).profile);
  if (!response.ok) throw new Error('Nie udało się zapisać profilu. Wpisane dane zostały w formularzu – spróbuj ponownie.');
  return response.json();
}
