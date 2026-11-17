// Symulowana publikacja zaakceptowanego grafiku w Google Calendar (S23KC2S1P2-30, G07 / S23KC2S1P2-291).
// Czyste funkcje bez React – testowane w tests/googlePublication.test.ts. Konto Google: prawdziwy zapis; konto demonstracyjne: symulacja (simulated).
import { apiErrorMessage, plural, type GoogleIntegrationStatus, type Notice, type SyncAttempt } from './googleIntegration.ts';

export type PublicationAction = 'create' | 'update' | 'unchanged';
export type PublicationItem = {
  shiftId: string; eventId: string; eventVersion: number; title: string; start: string; end: string; action: PublicationAction; publishedAt: string | null;
};
export type PublicationPreview = {
  simulated: boolean; weekStart: string; scheduleId: string; scheduleVersion: number;
  target: { id: string; name: string }; targets: { id: string; name: string; primary: boolean }[];
  items: PublicationItem[]; summary: { create: number; update: number; unchanged: number };
};
export type PublicationItemResult = 'published' | 'unchanged' | 'failed' | 'skipped';
export type PublicationResult = {
  simulated: boolean; attempt: SyncAttempt; items: (PublicationItem & { result: PublicationItemResult })[]; preview: PublicationPreview;
};
export type PublicationSimulation = 'network' | 'flaky' | 'auth' | 'server' | 'rate_limit' | 'partial' | 'permissions';

export const SIMULATION_BANNER = 'SYMULACJA – nic nie zostanie wysłane do Google. Wynik pokazuje, co stałoby się przy prawdziwej publikacji.';

export const PUBLICATION_SIMULATIONS: { id: PublicationSimulation | null; label: string }[] = [
  { id: null, label: 'Bez błędu' }, { id: 'network', label: 'Brak internetu' }, { id: 'flaky', label: 'Chwilowy błąd sieci' },
  { id: 'auth', label: 'Wygasłe logowanie' }, { id: 'permissions', label: 'Brak prawa zapisu' }, { id: 'rate_limit', label: 'Limit zapytań' },
  { id: 'server', label: 'Błąd serwera Google' }, { id: 'partial', label: 'Wynik częściowy' },
];

/** Wejście do publikacji: tylko zaakceptowany grafik z co najmniej jedną zmianą (w podglądzie historii – nigdy). */
export function publicationEntry(schedule: { isApproved: boolean; shifts: unknown[] } | null, readOnly: boolean): { enabled: boolean; reason: string | null } {
  if (!schedule || readOnly) return { enabled: false, reason: null };
  if (!schedule.isApproved) return { enabled: false, reason: 'Opublikować w Google można dopiero zaakceptowany grafik.' };
  if (schedule.shifts.length === 0) return { enabled: false, reason: 'Zaakceptowany grafik nie ma żadnej zmiany do opublikowania.' };
  return { enabled: true, reason: null };
}

const pad = (value: number) => String(value).padStart(2, '0');
const DAYS = ['nd', 'pn', 'wt', 'śr', 'cz', 'pt', 'sb'];
/** „pn 05.03, 09:00–14:00” w strefie urządzenia. */
export function itemTimeLabel(item: Pick<PublicationItem, 'start' | 'end'>): string {
  const start = new Date(item.start); const end = new Date(item.end);
  return `${DAYS[start.getDay()]} ${pad(start.getDate())}.${pad(start.getMonth() + 1)}, ${pad(start.getHours())}:${pad(start.getMinutes())}–${pad(end.getHours())}:${pad(end.getMinutes())}`;
}

const ACTION_LABELS: Record<PublicationAction, string> = { create: 'zostanie dodana', update: 'zostanie zaktualizowana', unchanged: 'bez zmian – pominięta' };
export const actionLabel = (action: PublicationAction) => ACTION_LABELS[action];
const RESULT_LABELS: Record<PublicationItemResult, string> = { published: 'opublikowano', unchanged: 'bez zmian', failed: 'błąd', skipped: 'nie wysłano' };
export const itemResultLabel = (result: PublicationItemResult, simulated = true) =>
  result === 'published' && simulated ? 'opublikowano (symulacja)' : RESULT_LABELS[result];
const capitalize = (text: string) => text.replace(/^./, (letter) => letter.toUpperCase());


/** Ile pozycji zmieni się po potwierdzeniu. 0 – nie ma czego publikować. */
export const pendingCount = (preview: Pick<PublicationPreview, 'summary'>) => preview.summary.create + preview.summary.update;

export function previewSummary(preview: PublicationPreview): string {
  const parts: string[] = [];
  if (preview.summary.create) parts.push(`do dodania: ${preview.summary.create}`);
  if (preview.summary.update) parts.push(`do aktualizacji: ${preview.summary.update}`);
  if (preview.summary.unchanged) parts.push(`bez zmian: ${preview.summary.unchanged}`);
  return pendingCount(preview) === 0
    ? `Wszystkie zmiany są już opublikowane w kalendarzu „${preview.target.name}”.`
    : `Kalendarz „${preview.target.name}” – ${parts.join(', ')}.`;
}

/** Wynik próby. Błąd nigdy nie jest pokazany jako sukces; wynik częściowy mówi, że ponowienie opublikuje tylko resztę. */
export function publicationNotice(result: PublicationResult): Notice {
  const label = result.simulated ? 'Symulacja: ' : '';
  const published = result.items.filter((item) => item.result === 'published').length;
  if (result.attempt.status === 'success') {
    return { tone: 'success', text: capitalize(published
      ? `${label}opublikowano ${published} ${plural(published, 'zmianę', 'zmiany', 'zmian')} w kalendarzu „${result.preview.target.name}”.${result.simulated ? ' Nic nie trafiło do Google.' : ' Zmiany są widoczne w Google Calendar.'}`
      : `${label}wszystko było już opublikowane – nic nie zmieniono.`) };
  }
  const cause = result.attempt.message ?? 'Publikacja nie powiodła się.';
  if (result.attempt.status === 'partial') {
    return { tone: 'info', text: `${cause} „Spróbuj ponownie” opublikuje tylko brakujące zmiany – bez duplikatów. Grafik w KAC jest bez zmian.` };
  }
  return { tone: 'error', text: `${cause} Nic nie opublikowano, grafik w KAC jest bez zmian.` };
}

/** Ponowienie ma sens po błędzie przejściowym albo wyniku częściowym; przy wygasłym logowaniu trzeba najpierw połączyć konto. */
export const canRetry = (result: PublicationResult | null) =>
  Boolean(result && result.attempt.status !== 'success' && result.attempt.retryable && result.attempt.errorClass !== 'reconnect');

export function publicationErrorMessage(code: string): string {
  switch (code) {
    case 'not_connected': return 'Najpierw połącz konto Google w Ustawieniach → Google Calendar.';
    case 'reconnect_required': return 'Google nie przyjmuje zapisanego dostępu – połącz konto ponownie w Ustawieniach.';
    case 'schedule_not_found': return 'W tym tygodniu nie ma grafiku do opublikowania.';
    case 'schedule_not_accepted': return 'Opublikować w Google można dopiero zaakceptowany grafik.';
    case 'schedule_empty': return 'Zaakceptowany grafik nie ma żadnej zmiany do opublikowania.';
    case 'schedule_version_conflict': return 'Grafik zmienił się po otwarciu podglądu. Nic nie opublikowano – sprawdź nowy podgląd.';
    case 'no_publication_target': return 'Wybierz kalendarz, do którego trafi grafik.';
    case 'publication_in_progress': return 'Publikacja już trwa – poczekaj na jej wynik.';
    default: return apiErrorMessage(code);
  }
}

// --- Kroki historyjki 30 wokół podglądu: konto Google (3–4a) i widok kalendarza po publikacji (10) ---

/** Krok 3–4a: konto, do którego trafi publikacja, i zgoda na dodawanie wydarzeń. Bez zgody publikacja nie jest możliwa. */
export function publicationAccount(status: GoogleIntegrationStatus | null): { state: 'not_connected' | 'no_write' | 'ok'; text: string } {
  if (!status?.account || status.status === 'not_connected') {
    return { state: 'not_connected', text: 'Brak połączonego konta Google. Połącz konto w Ustawieniach, żeby opublikować grafik.' };
  }
  if (status.status === 'reconnect_required') {
    return { state: 'not_connected', text: `Google nie przyjmuje już dostępu do konta ${status.account.email}. Połącz konto ponownie w Ustawieniach.` };
  }
  if (!status.account.access.eventsWrite) {
    return { state: 'no_write', text: `Konto ${status.account.email} nie zezwala na dodawanie wydarzeń – bez tej zgody publikacja nie jest możliwa. Połącz konto ponownie i zaznacz dostęp do wydarzeń.` };
  }
  return { state: 'ok', text: `Konto Google: ${status.account.email} · dodawanie wydarzeń: zgoda udzielona` };
}

export type CalendarViewEvent = { id: string; title: string; start: string; end: string; published: boolean };
export type PublicationCalendarView = {
  simulated: boolean; calendar: { id: string; name: string }; weekStart: string; events: CalendarViewEvent[]; othersError: string | null;
};

/** Krok 10: zmiany robocze razem z pozostałymi wydarzeniami w (przykładowym) widoku kalendarza Google. */
export function calendarViewLines(view: PublicationCalendarView): { key: string; when: string; title: string; published: boolean }[] {
  return view.events.map((event) => ({ key: event.id, when: itemTimeLabel(event), title: event.title, published: event.published }));
}

export function calendarViewTitle(view: PublicationCalendarView): string {
  const published = view.events.filter((event) => event.published).length;
  return `Kalendarz Google „${view.calendar.name}” – tydzień od ${view.weekStart.slice(8, 10)}.${view.weekStart.slice(5, 7)}: opublikowane zmiany: ${published}, pozostałe wydarzenia: ${view.events.length - published}.`;
}
