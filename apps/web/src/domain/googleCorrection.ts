// Korekta i usunięcie opublikowanej zmiany – stan synchronizacji z Google Calendar (S23KC2S1P2-47, G09 / S23KC2S1P2-292).
// Czyste funkcje bez React – testowane w tests/googleCorrection.test.ts. Pozycje z konta demonstracyjnego są symulacją (simulated).
import type { Notice, SyncErrorClass } from './googleIntegration.ts';

export type CorrectionState = 'synced' | 'pending' | 'error' | 'missing' | 'pending_delete' | 'deleted';
export type CorrectionItem = {
  eventId: string; calendar: { id: string; name: string }; state: CorrectionState; simulated: boolean;
  errorCode: string | null; errorClass: SyncErrorClass | null; message: string | null;
  tries: number; lastTryAt: string | null; publishedAt: string | null; snapshot: { title: string; start: string; end: string } | null;
  lastOperation: 'Utworzenie' | 'Aktualizacja' | null;
};
export type CorrectionSyncResult = { eventId: string; result: 'nothing' | 'success' | 'error'; errorCode: string | null; items: CorrectionItem[] };
export type CorrectionSimulation = 'network' | 'server' | 'rate_limit' | 'auth' | 'permissions' | 'missing';

export const CORRECTION_SIMULATIONS: { id: CorrectionSimulation | null; label: string }[] = [
  { id: null, label: 'Bez błędu' }, { id: 'network', label: 'Brak internetu' }, { id: 'server', label: 'Błąd serwera Google' },
  { id: 'rate_limit', label: 'Limit zapytań' }, { id: 'permissions', label: 'Brak prawa zapisu' }, { id: 'missing', label: 'Brak wydarzenia w Google' },
];

// --- Dopuszczalne wartości z historyjki 47 ---

export type OperationKind = 'Aktualizacja' | 'Usunięcie';
export type OperationStatus = 'Oczekuje' | 'W trakcie' | 'Zakończona' | 'Błąd';
export type ErrorCause = 'Brak połączenia' | 'Wymagane ponowne logowanie' | 'Brak uprawnień' | 'Brak powiązanego wydarzenia' | 'Usługa niedostępna' | 'Inny błąd';

/** Rodzaj operacji: „Aktualizacja” albo „Usunięcie”; null – zmiana jest tylko opublikowana, bez korekty. */
export function operationKind(item: Pick<CorrectionItem, 'state' | 'lastOperation'>): OperationKind | null {
  if (item.state === 'pending_delete' || item.state === 'deleted') return 'Usunięcie';
  if (item.state === 'synced') return item.lastOperation === 'Aktualizacja' ? 'Aktualizacja' : null;
  return 'Aktualizacja';
}

/** Stan synchronizacji operacji: „Oczekuje”, „W trakcie”, „Zakończona”, „Błąd”. inProgress – trwa ponowienie w aplikacji. */
export function operationStatus(item: Pick<CorrectionItem, 'state' | 'errorCode'>, inProgress = false): OperationStatus {
  if (inProgress) return 'W trakcie';
  if (item.state === 'synced' || item.state === 'deleted') return 'Zakończona';
  if (item.state === 'error' || item.state === 'missing' || item.errorCode) return 'Błąd';
  return 'Oczekuje';
}

/** Przyczyna błędu synchronizacji z listy w historyjce. */
export function errorCause(item: Pick<CorrectionItem, 'errorCode' | 'errorClass' | 'state'>): ErrorCause | null {
  if (!item.errorCode && item.state !== 'missing') return null;
  if (item.errorCode === 'event_not_found' || item.state === 'missing') return 'Brak powiązanego wydarzenia';
  switch (item.errorClass) {
    case 'network': return 'Brak połączenia';
    case 'reconnect': return 'Wymagane ponowne logowanie';
    case 'permissions': return 'Brak uprawnień';
    case 'server':
    case 'rate_limit': return 'Usługa niedostępna';
    default: return 'Inny błąd';
  }
}

/** Wskazanie dalszego działania (historyjka 47, potrzeby informacyjne). */
export function nextStep(cause: ErrorCause | null): string | null {
  switch (cause) {
    case 'Brak połączenia': return 'Sprawdź połączenie z internetem i ponów synchronizację.';
    case 'Wymagane ponowne logowanie': return 'Połącz ponownie konto Google w Ustawieniach, a potem ponów synchronizację.';
    case 'Brak uprawnień': return 'Sprawdź w Google uprawnienia do kalendarza i połącz konto ponownie.';
    case 'Usługa niedostępna': return 'Ponów synchronizację za chwilę.';
    case 'Inny błąd': return 'Ponów synchronizację.';
    default: return null;
  }
}

/** „Usunięcie – stan synchronizacji: Błąd (Brak połączenia)” – wartości z historyjki w jednym wierszu. */
export function operationLine(item: CorrectionItem, inProgress = false): string {
  const kind = operationKind(item);
  const status = operationStatus(item, inProgress);
  const cause = status === 'Błąd' ? errorCause(item) : null;
  return `${kind ? `${kind} – ` : ''}stan synchronizacji: ${status}${cause ? ` (${cause})` : ''}`;
}

const STATE_LABELS: Record<CorrectionState, string> = {
  synced: 'zgodne z Google', pending: 'czeka na synchronizację', error: 'błąd synchronizacji', missing: 'brak wydarzenia w Google',
  pending_delete: 'usunięte w KAC, czeka na usunięcie w Google', deleted: 'usunięte w obu kalendarzach',
};
export const correctionStateLabel = (state: CorrectionState) => STATE_LABELS[state];

/** Ponowienie ma sens, dopóki coś czeka albo się nie udało. Przy braku wydarzenia w Google nie tworzymy go na nowo. */
export const canRetryCorrection = (item: Pick<CorrectionItem, 'state'>) => item.state === 'error' || item.state === 'pending' || item.state === 'pending_delete';

const pad = (value: number) => String(value).padStart(2, '0');
/** „05.03, 09:00–14:00” – dla rozbieżności po usunięciu, kiedy wydarzenia nie ma już w KAC. */
export function snapshotLabel(item: Pick<CorrectionItem, 'snapshot'>): string {
  if (!item.snapshot) return 'Zmiana pracy';
  const start = new Date(item.snapshot.start); const end = new Date(item.snapshot.end);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return item.snapshot.title;
  return `${item.snapshot.title} · ${pad(start.getDate())}.${pad(start.getMonth() + 1)}, ${pad(start.getHours())}:${pad(start.getMinutes())}–${pad(end.getHours())}:${pad(end.getMinutes())}`;
}

/**
 * Komunikat po zapisie albo usunięciu (krok 6, 3a, 6b, 3a.1, 6c). null – wydarzenie nie było publikowane albo wszystko już było zgodne.
 * Błąd nigdy nie wygląda na sukces, a zmiana lokalna jest zawsze opisana jako zachowana.
 */
export function correctionNotice(result: CorrectionSyncResult, kind: 'update' | 'delete'): Notice | null {
  const item = result.items.find((entry) => entry.state !== 'synced' && entry.state !== 'deleted') ?? result.items[0];
  if (!item || result.result === 'nothing') return null;
  const label = item.simulated ? 'Symulacja: ' : '';
  const line = `${kind === 'delete' ? 'Usunięcie' : 'Aktualizacja'} – stan synchronizacji: ${operationStatus(item)}`;
  if (result.result === 'success') {
    const sentence = kind === 'delete'
      ? `${label}zmianę usunięto z kalendarza aplikacji i z kalendarza „${item.calendar.name}” w Google.`
      : `${label}zaktualizowano powiązane wydarzenie w kalendarzu „${item.calendar.name}” w Google.`;
    return { tone: 'success', text: `${line}. ${sentence.replace(/^./, (letter) => letter.toUpperCase())}` };
  }
  const cause = errorCause(item);
  const step = nextStep(cause);
  // 6c: brak powiązanego wydarzenia – zmiana lokalna zostaje, nowe wydarzenie nie powstaje.
  if (item.state === 'missing') {
    return { tone: 'info', text: `${line} (${cause}). Powiązane wydarzenie nie istnieje już w Google Calendar, więc nie można go zaktualizować. Zmiana w kalendarzu aplikacji została zachowana, nowe wydarzenie nie zostało utworzone.` };
  }
  // 6b i 3a.1: w którym kalendarzu operacja się udała, a w którym dane mogą być nieaktualne.
  return { tone: 'error', text: kind === 'delete'
    ? `${line} (${cause}). Zmianę usunięto z kalendarza aplikacji, ale wydarzenie może nadal być widoczne w Google Calendar.${step ? ` ${step}` : ''}`
    : `${line} (${cause}). Zmiana jest zapisana w kalendarzu aplikacji, ale wydarzenie w Google Calendar może być nieaktualne.${step ? ` ${step}` : ''}` };
}
