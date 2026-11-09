export type Interval = {
    dayOfWeek: number;
    startTime: string;
    endTime: string;
};
const minute = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
const clock = (n: number) => `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
export function mergeAvailability(input: Interval[]) {
    const split: Interval[] = [];
    for (const i of input) {
        if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(i.startTime) || !/^(([01]\d|2[0-3]):[0-5]\d|24:00)$/.test(i.endTime) || i.startTime === i.endTime)
            throw new Error(`Dzień ${i.dayOfWeek}: popraw godziny.`);
        if (i.endTime < i.startTime) {
            split.push({ ...i, endTime: '24:00' });
            if (i.endTime !== '00:00')
                split.push({ dayOfWeek: i.dayOfWeek % 7 + 1, startTime: '00:00', endTime: i.endTime });
        }
        else
            split.push({ ...i });
    }
    split.sort((a, b) => a.dayOfWeek - b.dayOfWeek || a.startTime.localeCompare(b.startTime));
    const result: Interval[] = [];
    for (const i of split) {
        const p = result.at(-1);
        if (p && p.dayOfWeek === i.dayOfWeek && i.startTime < p.endTime) {
            if (i.endTime > p.endTime)
                p.endTime = i.endTime;
        }
        else
            result.push(i);
    }
    return result;
}
export function subtractMandatory(intervals: Interval[], blocked: Interval[]) {
    let out = intervals.map(i => ({ ...i }));
    for (const b of blocked)
        out = out.flatMap(i => {
            if (i.dayOfWeek !== b.dayOfWeek || minute(i.endTime) <= minute(b.startTime) || minute(i.startTime) >= minute(b.endTime))
                return [i];
            return [{ ...i, endTime: clock(Math.max(minute(i.startTime), minute(b.startTime))) }, { ...i, startTime: clock(Math.min(minute(i.endTime), minute(b.endTime))) }].filter(r => r.startTime < r.endTime);
        });
    return out;
}
export function mandatoryWeeklyIntervals(events: {
    category: string;
    mandatory: boolean;
    repeatWeekly: boolean;
    start: string;
    end: string;
}[]) {
    const result: Interval[] = [];
    for (const e of events.filter(e => e.category === 'Class' && e.mandatory && e.repeatWeekly)) {
        let day = e.start.slice(0, 10);
        const last = e.end.slice(0, 10);
        while (day <= last) {
            const dayOfWeek = new Date(day + 'T12:00:00Z').getUTCDay() || 7;
            const startTime = day === e.start.slice(0, 10) ? e.start.slice(11, 16) : '00:00';
            const endTime = day === last ? e.end.slice(11, 16) : '24:00';
            if (startTime !== endTime)
                result.push({ dayOfWeek, startTime, endTime });
            day = new Date(Date.parse(day + 'T12:00:00Z') + 86400000).toISOString().slice(0, 10);
        }
    }
    return result;
}
