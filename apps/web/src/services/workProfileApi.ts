export type PreferenceInterval = { dayOfWeek: number; startTime: string; endTime: string; weight: number };
export type AvailabilityInterval = { dayOfWeek: number; startTime: string; endTime: string };
export type PreferencesSnapshot = { version: string; intervals: PreferenceInterval[]; availability: AvailabilityInterval[] };

const messages: Record<string, string> = {
  invalid_interval: 'Sprawdź dzień i godziny tego przedziału.',
  invalid_weight: 'Waga musi być liczbą ≥ 0, z maksymalnie dwoma miejscami po przecinku.',
  preference_outside_availability: 'Ten przedział wykracza poza Twoją dostępność.',
  profile_not_found: 'Nie znaleziono profilu pracy.',
};

export class WorkPreferencesError extends Error {
  constructor(code: string, public rowIndex?: number) { super(messages[code] ?? 'Nie udało się zapisać preferencji.'); }
}
export class WorkPreferencesConflictError extends Error {
  constructor() { super('Preferencje zostały zmienione w międzyczasie — wczytano najnowszą wersję.'); }
}

const baseUrl = () => {
  const configured = process.env.EXPO_PUBLIC_API_URL?.trim();
  if (configured) return configured.replace(/\/$/, '');
  const host = globalThis.location?.hostname;
  if (host === 'localhost' || host === '127.0.0.1') return 'http://localhost:4000';
  throw new Error('Brak konfiguracji adresu API.');
};

async function request(path: string, options?: RequestInit, handlers?: { onConflict?: () => Error; onError?: (code: string, data: any) => Error }) {
  const response = await fetch(`${baseUrl()}${path}`, { ...options, headers: { Accept: 'application/json', ...(options?.body ? { 'Content-Type': 'application/json' } : {}) } });
  if (response.status === 409) throw handlers?.onConflict?.() ?? new WorkPreferencesConflictError();
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw handlers?.onError?.(data.error, data) ?? new WorkPreferencesError(data.error, data.rowIndex);
  }
  return response.json();
}

export const loadWorkPreferences = (): Promise<PreferencesSnapshot> => request('/api/work-profile/preferences');
export const saveWorkPreferences = (version: string, intervals: PreferenceInterval[]): Promise<PreferencesSnapshot> =>
  request('/api/work-profile/preferences', { method: 'PUT', body: JSON.stringify({ version, intervals }) });

export type WorkProfile = { version: string; minRestMinutes: number };

export class WorkProfileError extends Error {
  constructor(code: string) { super(code === 'invalid_min_rest_minutes' ? 'Wpisz poprawną, nieujemną liczbę minut.' : 'Nie udało się zapisać ustawień odpoczynku.'); }
}
export class WorkProfileConflictError extends Error {
  constructor() { super('Ustawienia odpoczynku zostały zmienione w międzyczasie — wczytano najnowszą wersję.'); }
}

export const loadWorkProfile = (): Promise<WorkProfile> => request('/api/work-profile');
export const saveWorkProfile = (version: string, minRestMinutes: number): Promise<WorkProfile> =>
  request('/api/work-profile', { method: 'PUT', body: JSON.stringify({ version, minRestMinutes }) },
    { onConflict: () => new WorkProfileConflictError(), onError: (code) => new WorkProfileError(code) });
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
