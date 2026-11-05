export type TimedItem = {
    id: string;
    start: string;
    end: string;
    category: 'Work' | 'Class' | 'Personal';
    title?: string;
};
export type Window = {
    start: string;
    end: string;
};
export type CommuteViolation = {
    error: 'commute_gap_too_short';
    requiredMinutes: number;
    actualMinutes: number;
    leftId: string;
    rightId: string;
    leftTitle?: string;
    rightTitle?: string;
};
export function validateCommuteGaps(events: TimedItem[], commuteMinutes: number, minRestMinutes: number): CommuteViolation[] {
    const ordered = [...events].sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
    const errors: CommuteViolation[] = [];
    // Check each relevant pair: a nested personal event must not hide a Work overlap.
    for (let i = 0; i < ordered.length; i++)
        for (let j = i + 1; j < ordered.length; j++) {
            const a = ordered[i]!, b = ordered[j]!;
            if (a.category !== 'Work' && b.category !== 'Work')
                continue;
            const requiredMinutes = a.category === 'Work' && b.category === 'Work' ? Math.max(commuteMinutes, minRestMinutes) : commuteMinutes;
            const actualMinutes = (Date.parse(b.start) - Date.parse(a.end)) / 60000;
            if (actualMinutes < requiredMinutes)
                errors.push({ error: 'commute_gap_too_short', requiredMinutes, actualMinutes, leftId: a.id, rightId: b.id, leftTitle: a.title, rightTitle: b.title });
        }
    return errors;
}
export function validateAvailability(shifts: TimedItem[], windows: Window[], commuteMinutes: number) {
    return shifts.filter(s => !windows.some(w => Date.parse(s.start) - commuteMinutes * 60000 >= Date.parse(w.start) && Date.parse(s.end) + commuteMinutes * 60000 <= Date.parse(w.end)))
        .map(s => ({ error: 'commute_outside_availability', shiftId: s.id, requiredMinutes: commuteMinutes }));
}
export function generateShifts(windows: Window[], events: TimedItem[], targetMinutes: number, commute: number, rest: number, bounds?: Window): TimedItem[] {
    const shifts: TimedItem[] = [];
    let remaining = targetMinutes;
    for (const w of windows) {
        let free: [
            number,
            number
        ][] = [[Math.max(Date.parse(w.start) + commute * 60000, bounds ? Date.parse(bounds.start) : -Infinity), Math.min(Date.parse(w.end) - commute * 60000, bounds ? Date.parse(bounds.end) : Infinity)]];
        for (const e of [...events, ...shifts]) {
            const gap = e.category === 'Work' ? Math.max(commute, rest) : commute;
            const a = Date.parse(e.start) - gap * 60000, b = Date.parse(e.end) + gap * 60000;
            free = free.flatMap(([x, y]) => b <= x || a >= y ? [[x, y]] : ([[x, Math.min(y, a)], [Math.max(x, b), y]] as [
                number,
                number
            ][]).filter(([s, t]) => t > s));
        }
        for (const [a, b] of free) {
            const duration = Math.min(remaining, Math.floor((b - a) / 60000));
            if (duration <= 0)
                continue;
            shifts.push({ id: `proposal-${shifts.length + 1}`, start: new Date(a).toISOString(), end: new Date(a + duration * 60000).toISOString(), category: 'Work' });
            remaining -= duration;
        }
    }
    return shifts;
}
