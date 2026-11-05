export type Interval = { dayOfWeek: number; startTime: string; endTime: string };
export class ProfileError extends Error {
  constructor(public code: string, public status = 422, public details: unknown = undefined) { super(code); }
}
export const minutes = (time: string) => Number(time.slice(0,2)) * 60 + Number(time.slice(3));
export const clock = (value: number) => `${String(Math.floor(value / 60)).padStart(2,'0')}:${String(value % 60).padStart(2,'0')}`;
export function normalizeAvailability(input: Interval[], merge = false): Interval[] {
  const result: Interval[] = [];
  for (const i of input) {
    if (!Number.isInteger(i.dayOfWeek) || i.dayOfWeek < 1 || i.dayOfWeek > 7 || !/^([01]\d|2[0-3]):[0-5]\d$/.test(i.startTime) || !/^(([01]\d|2[0-3]):[0-5]\d|24:00)$/.test(i.endTime) || i.startTime === i.endTime)
      throw new ProfileError('invalid_availability',400,{dayOfWeek:i.dayOfWeek});
    if (minutes(i.endTime) < minutes(i.startTime)) {
      result.push({...i,endTime:'24:00'});
      if (i.endTime !== '00:00') result.push({dayOfWeek:i.dayOfWeek % 7 + 1,startTime:'00:00',endTime:i.endTime});
    } else result.push({...i});
  }
  result.sort((a,b) => a.dayOfWeek-b.dayOfWeek || a.startTime.localeCompare(b.startTime));
  const out: Interval[] = [];
  for (const i of result) {
    const prev = out.at(-1);
    if (prev && prev.dayOfWeek === i.dayOfWeek && i.startTime < prev.endTime) {
      if (!merge) throw new ProfileError('availability_overlap',422,{dayOfWeek:i.dayOfWeek});
      if (i.endTime > prev.endTime) prev.endTime = i.endTime;
    } else out.push(i);
  }
  return out;
}
