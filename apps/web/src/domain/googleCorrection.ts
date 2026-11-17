// Korekta i usunięcie opublikowanej zmiany – stan synchronizacji z Google Calendar (S23KC2S1P2-47, G09 / S23KC2S1P2-292).
// Czyste funkcje bez React – testowane w tests/googleCorrection.test.ts. To symulacja: nic nie trafia do Google.
import type { Notice, SyncErrorClass } from './googleIntegration.ts';

export type CorrectionState = 'synced' | 'pending' | 'error' | 'missing' | 'pending_delete' | 'deleted';
export type CorrectionItem = {
  eventId: string; calendar: { id: string; name: string }; state: CorrectionState; simulated: boolean;
  errorCode: string | null; errorClass: SyncErrorClass | null; message: string | null;
  tries: number; lastTryAt: string | null; publishedAt: string | null; snapshot: { title: string; start: string; end: string } | null;
};
export type CorrectionSyncResult = { eventId: string; result: 'nothing' | 'success' | 'error'; errorCode: string | null; items: CorrectionItem[] };
export type CorrectionSimulation = 'network' | 'server' | 'rate_limit' | 'auth' | 'permissions' | 'missing';

export const CORRECTION_SIMULATIONS: { id: CorrectionSimulation | null; label: string }[] = [
  { id: null, label: 'Bez błędu' }, { id: 'network', label: 'Brak internetu' }, { id: 'server', label: 'Błąd serwera Google' },
  { id: 'rate_limit', label: 'Limit zapytań' }, { id: 'permissions', label: 'Brak prawa zapisu' }, { id: 'missing', label: 'Brak wydarzenia w Google' },
];

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
  if (result.result === 'success') {
    return { tone: 'success', text: kind === 'delete'
      ? `${label}zmianę usunięto także z kalendarza „${item.calendar.name}” w Google.`
      : `${label}zaktualizowano powiązane wydarzenie w kalendarzu „${item.calendar.name}” w Google.` };
  }
  if (item.state === 'missing') return { tone: 'info', text: item.message ?? 'Powiązane wydarzenie nie istnieje już w Google Calendar. Lokalna zmiana została zachowana.' };
  const cause = item.message ? ` Przyczyna: ${item.message}` : '';
  return { tone: 'error', text: kind === 'delete'
    ? `Zmianę usunięto z KAC, ale wydarzenie może nadal być widoczne w Google Calendar.${cause}`
    : `Zmiana jest zapisana w KAC, ale nie udało się zaktualizować wydarzenia w Google Calendar.${cause}` };
}
