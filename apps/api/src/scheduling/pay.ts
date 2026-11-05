import { ProfileError } from '../profile/availability.js';
export function rateGrosz(rate: number | null): number {
    if (rate === null)
        throw new ProfileError('profile_incomplete', 422, { fields: ['hourlyRatePln'] });
    if (!Number.isFinite(rate) || rate < 0 || rate > 9999999999.99 || Number(rate.toFixed(2)) !== rate)
        throw new ProfileError('invalid_hourly_rate');
    return Math.round(rate * 100);
}
/** Integer arithmetic, half up per shift, elapsed instants (including DST). */
export function calculatePay(rate: number | null, start: string, end: string) {
    const cents = rateGrosz(rate);
    for (const value of [start, end]) {
        const date = value.slice(0, 10);
        const parsed = new Date(date + 'T12:00:00Z');
        if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date)
            throw new ProfileError('invalid_shift');
    }
    const elapsed = Date.parse(end) - Date.parse(start);
    if (!Number.isSafeInteger(elapsed) || elapsed <= 0 || elapsed % 60000 !== 0)
        throw new ProfileError('invalid_shift');
    const durationMinutes = elapsed / 60000;
    const pay = (BigInt(cents) * BigInt(durationMinutes) + 30n) / 60n;
    if (pay > 999999999999n)
        throw new ProfileError('pay_overflow');
    return { durationMinutes, payGrosz: Number(pay), estimatedPayPln: Number(pay) / 100 };
}
