export type Interval = {
    dayOfWeek: number;
    startTime: string;
    endTime: string;
};
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
export type Availability = {
    version: number;
    intervals: Interval[];
};
export const formatPln = (amount: number) => new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN' }).format(amount);
export async function workRequest(path: string, body?: unknown, method = 'PUT') {
    const base = process.env.EXPO_PUBLIC_API_URL?.trim().replace(/\/$/, '') || (['localhost', '127.0.0.1'].includes(globalThis.location?.hostname) ? 'http://localhost:4000' : '');
    if (!base)
        throw new Error('Brak konfiguracji adresu API.');
    const r = await fetch(`${base}/api/${path}`, { method: body === undefined ? 'GET' : method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15000) });
    const data = await r.json();
    if (!r.ok) {
        if (data.error === 'schedule_constraints')
            throw new Error(data.details.violations.map((v: any) => v.error === 'commute_outside_availability' ? 'Dojazd wykracza poza dostępność. Popraw godziny zmiany.' : `Za krótka przerwa między „${v.leftTitle || v.leftId}” i „${v.rightTitle || v.rightId}”: brakuje ${Math.ceil(v.requiredMinutes - v.actualMinutes)} min (wymagane ${v.requiredMinutes}, dostępne ${v.actualMinutes}).`).join(' '));
        const messages: Record<string, string> = { version_conflict: 'Profil zmieniono w innym oknie. Wczytaj ponownie przed zapisem.', invalid_hourly_rate: 'Stawka musi wynosić od 0 do 9 999 999 999,99 PLN i mieć najwyżej dwa miejsca po przecinku.', invalid_week: 'Wybierz poniedziałek rozpoczynający tydzień.', rate_kind_required: 'Wybierz brutto albo netto.', invalid_hour_limits: 'Zachowaj kolejność: minimum ≤ cel ≤ maksimum.', database_unavailable: 'Nie udało się zapisać lub odczytać danych. Spróbuj ponownie.', profile_not_found: 'Nie znaleziono profilu pracy. Sprawdź migracje i inicjalizację konta.', profile_incomplete: 'Przed planowaniem uzupełnij profil: stawkę, brutto/netto, dojazd (może wynosić 0) i cel godzinowy.', schedule_closed: 'Ta propozycja jest już zamknięta. Wczytaj ją ponownie.', invalid_shift: 'Koniec zmiany musi być późniejszy od początku. Użyj pełnych minut.', availability_overlap: 'Przedziały nakładają się.', max_hours_exceeded: 'Przekroczono maksymalną liczbę godzin pracy.' };
        throw new Error(messages[data.error] || 'Sprawdź dane formularza i spróbuj ponownie.');
    }
    return data;
}
export const getWorkProfile = (): Promise<WorkProfile> => workRequest('work-profile');
export const saveWorkProfile = (p: WorkProfile): Promise<WorkProfile> => workRequest('work-profile', p);
export const getAvailability = (): Promise<Availability> => workRequest('work-profile/availability');
export const saveAvailability = (a: Availability): Promise<Availability> => workRequest('work-profile/availability', a);
