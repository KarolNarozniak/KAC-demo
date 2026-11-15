// Karta „Twój dzień w skrócie” (S23KC2S1P2-254, S23KC2S1P2-271).
import type { Occurrence } from './model';
import type { DaySummary } from '../services/assistantApi';

/**
 * Klucz wydarzeń dnia: zmienia się tylko po zmianie kalendarza.
 * Karta pobiera podsumowanie, gdy zmieni się data albo ten klucz – nie przy każdym renderze.
 */
export function dayEventsKey(date: string, occurrences: Occurrence[]): string {
  const items = occurrences.filter((item) => !item.preview)
    .map((item) => [item.id, item.title, item.category, item.location ?? '', item.mandatory, item.occurrenceStart.toISOString(), item.occurrenceEnd.toISOString()].join('|'))
    .sort();
  return `${date}#${items.join(';')}`;
}

export type DaySummaryView = { tone: 'muted' | 'body'; text: string; note: string };

/** Co pokazać na karcie dla wyniku z API. */
export function daySummaryView(summary: DaySummary): DaySummaryView {
  if (summary.status === 'empty') return { tone: 'muted', text: summary.text, note: '' };
  if (summary.status === 'local') return { tone: 'body', text: summary.text,
    note: summary.aiError === 'azure_ai_not_configured'
      ? 'Asystent AI nie jest skonfigurowany – podsumowanie przygotowano bez AI na podstawie kalendarza.'
      : 'Asystent AI jest chwilowo niedostępny – podsumowanie przygotowano bez AI. Możesz spróbować odświeżyć później.' };
  return { tone: 'body', text: summary.text, note: '' };
}
