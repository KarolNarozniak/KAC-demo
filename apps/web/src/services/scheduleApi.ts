export type WorkMode = 'elastyczny' | 'zmianowy';
export type ShiftTemplate = { id: string; name: string; startTime: string; endTime: string; endsNextDay: boolean; daysOfWeek: number[]; active: boolean };
export type ScheduleSettings = {
  mode: WorkMode;
  minimumHours: number;
  targetHours: number;
  maximumHours: number;
  commuteBufferMinutes: number;
  minimumRestMinutes: number;
  minimumShiftMinutes: number;
  maximumSlotMinutes: number;
  shiftTemplates: ShiftTemplate[];
};
export type ScheduleShift = {
  candidateId: string;
  title: string;
  start: string;
  end: string;
  startLocal: string;
  endLocal: string;
  durationMinutes: number;
  workDate: string;
  mode: WorkMode;
  templateId?: string;
  optionalLectureIds: string[];
  softPenalty: number;
};
export type ScheduleViolation = { code: string; severity: 'warning' | 'error'; message: string };
export type WeeklySchedule = {
  scheduleId?: string;
  version?: number;
  isApproved: boolean;
  approvedAt?: string;
  maximumCapacityMinutes: number;
  weekStart: string;
  timeZone: string;
  mode: WorkMode;
  solutionStatus: 'target_met' | 'proven_infeasible' | 'not_found';
  minimumMinutes: number;
  targetMinutes: number;
  maximumMinutes: number;
  existingWorkMinutes: number;
  proposedMinutes: number;
  totalMinutes: number;
  shortfallMinutes: number;
  optionalLecturesSkipped: string[];
  parameters: { workaholic?: boolean };
  shifts: ScheduleShift[];
  violations: ScheduleViolation[];
};

const baseUrl = () => {
  const configured = process.env.EXPO_PUBLIC_API_URL?.trim();
  if (configured) return configured.replace(/\/$/, '');
  const host = globalThis.location?.hostname;
  if (host === 'localhost' || host === '127.0.0.1') return 'http://localhost:4000';
  throw new Error('Brak konfiguracji adresu API.');
};

async function request(path: string, options?: RequestInit): Promise<Response> {
  return fetch(`${baseUrl()}${path}`, { ...options, headers: { Accept: 'application/json', ...(options?.body ? { 'Content-Type': 'application/json' } : {}) }, signal: AbortSignal.timeout(20000) });
}

export async function loadSchedule(weekStart: string): Promise<WeeklySchedule | null> {
  const response = await request(`/api/schedules/${weekStart}`);
  if (response.status === 404) return null;
  if (!response.ok) throw new Error('Nie udało się wczytać grafiku.');
  return response.json();
}

export async function loadScheduleSettings(): Promise<ScheduleSettings> {
  const response = await request('/api/scheduling/settings');
  if (!response.ok) throw new Error('Nie udało się wczytać ustawień planu.');
  const result = await response.json();
  return { ...result.profile, shiftTemplates: result.shiftTemplates };
}

export async function saveScheduleSettings(settings: ScheduleSettings): Promise<ScheduleSettings> {
  const response = await request('/api/scheduling/settings', { method: 'PUT', body: JSON.stringify(settings) });
  if (!response.ok) throw new Error('Nie udało się zapisać ustawień planu. Sprawdź zakresy i szablony zmian.');
  const result = await response.json();
  return { ...result.profile, shiftTemplates: result.shiftTemplates };
}

export async function generateSchedule(weekStart: string, settings: ScheduleSettings, workaholic: boolean): Promise<WeeklySchedule> {
  const { shiftTemplates, ...overrides } = settings;
  const response = await request('/api/schedules/generate', { method: 'POST', body: JSON.stringify({ weekStart, overrides: { ...overrides, shiftTemplates, workaholic } }) });
  if (!response.ok) throw new Error('Nie udało się wygenerować grafiku. Sprawdź profil pracy i ustawienia tygodnia.');
  return response.json();
}

export async function approveSchedule(weekStart: string, expectedVersion: number): Promise<WeeklySchedule> {
  const response = await request(`/api/schedules/${weekStart}/approve`, { method: 'POST', body: JSON.stringify({ expectedVersion }) });
  if (response.status === 409) throw new Error('Grafik zmienił się w międzyczasie. Odśwież go przed zatwierdzeniem.');
  if (!response.ok) throw new Error('Nie udało się dodać zatwierdzonych zmian do kalendarza.');
  return response.json();
}

export async function saveSchedule(weekStart: string, expectedVersion: number, shifts: ScheduleShift[]): Promise<WeeklySchedule> {
  const response = await request(`/api/schedules/${weekStart}`, { method: 'PUT', body: JSON.stringify({ expectedVersion,
    shifts: shifts.map(({ candidateId, startLocal, endLocal }) => ({ id: candidateId, startLocal, endLocal })) }) });
  if (response.status === 409) throw new Error('Grafik został zmieniony w innym miejscu. Odśwież propozycję przed zapisem.');
  if (response.status === 422) {
    const data = await response.json();
    throw new Error(data.errors?.map((item: ScheduleViolation) => item.message).join(' ') || 'Zmiany naruszają ograniczenia grafiku.');
  }
  if (!response.ok) throw new Error('Nie udało się zapisać zmian w grafiku.');
  return response.json();
}
