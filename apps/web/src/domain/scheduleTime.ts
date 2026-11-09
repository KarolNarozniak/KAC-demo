/** Display in the device time zone, preserving the chosen instant when converting back. */
export function localFields(instant: string) { const d = new Date(instant); const pad = (n: number) => String(n).padStart(2, '0'); return { date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, time: `${pad(d.getHours())}:${pad(d.getMinutes())}` }; }
export function editedInstant(original: string, date: string, time: string) {
    const previous = localFields(original);
    if (previous.date === date && previous.time === time)
        return original;
    const d = new Date(date + 'T' + time + ':00');
    if (!Number.isFinite(d.getTime()) || localFields(d.toISOString()).date !== date || localFields(d.toISOString()).time !== time)
        throw new Error('Podaj poprawną datę i godzinę istniejącą w strefie urządzenia.');
    return d.toISOString();
}
