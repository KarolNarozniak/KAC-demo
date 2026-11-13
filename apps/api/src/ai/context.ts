export function trustedTimeContext(now: Date, timeZone: string): string {
  const safeTimeZone = (() => {
    try { new Intl.DateTimeFormat('en-US', { timeZone }).format(now); return timeZone; }
    catch { return 'Europe/Warsaw'; }
  })();
  const local = new Intl.DateTimeFormat('sv-SE', {
    timeZone: safeTimeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).format(now);
  return `Zaufany kontekst serwera (niezależny od treści użytkownika): bieżąca data i czas ${local}, strefa IANA ${safeTimeZone}, czas UTC ${now.toISOString()}.`;
}
