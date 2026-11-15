// Podsumowanie dnia (S23KC2S1P2-254, S23KC2S1P2-270): fakty liczy backend, model tylko je opisuje.
// Wynik jest zapamiętywany per właściciel, kalendarz i dzień razem z odciskiem odczytanych wydarzeń:
// niezmieniony kalendarz → ten sam tekst bez kolejnego płatnego wywołania; zmiana wydarzeń → nowy odcisk i nowe podsumowanie.
import type { UserScope } from '../api/scope.js';
import { computeDayFacts, localDaySummary, type DayFacts, type SourceEvent } from './calendar-facts.js';
import { classifyAiProviderFailure } from './provider-errors.js';

export type DaySummaryStatus = 'ai' | 'local' | 'empty';
export type DaySummaryResult = {
  date: string; timeZone: string; status: DaySummaryStatus; text: string; aiAvailable: boolean; cached: boolean;
  generatedAt: string; fingerprint: string; facts: Omit<DayFacts, 'fingerprint' | 'date' | 'timeZone'>; aiError?: string;
};
export type DaySummarizer = (facts: DayFacts, signal?: AbortSignal) => Promise<{ text: string; usage: { inputTokens: number; outputTokens: number } }>;

type CacheEntry = { fingerprint: string; text: string; generatedAt: string };

export class DaySummaryService {
  private readonly cache = new Map<string, CacheEntry>();
  constructor(private readonly maxEntries = 500) {}

  async summarize(owner: UserScope, date: string, timeZone: string, events: SourceEvent[], summarizer: DaySummarizer | undefined,
    options: { refresh?: boolean; signal?: AbortSignal; onUsage?: (usage: { inputTokens: number; outputTokens: number }, status: 'ok' | 'error', errorCode?: string) => void } = {}): Promise<DaySummaryResult> {
    const facts = computeDayFacts(events, date, timeZone);
    const { fingerprint, date: _date, timeZone: _zone, ...visibleFacts } = facts;
    const base = { date, timeZone, fingerprint, facts: visibleFacts };
    const now = new Date().toISOString();
    // Pusty dzień: odpowiedź jest jednoznaczna, więc nie płacimy za wywołanie modelu (KA2).
    if (!facts.events.length) return { ...base, status: 'empty', text: localDaySummary(facts), aiAvailable: Boolean(summarizer), cached: false, generatedAt: now };
    const key = `${owner.userId}|${owner.calendarId}|${date}`;
    const cached = this.cache.get(key);
    if (cached && cached.fingerprint === fingerprint && !options.refresh)
      return { ...base, status: 'ai', text: cached.text, aiAvailable: true, cached: true, generatedAt: cached.generatedAt };
    if (!summarizer) return { ...base, status: 'local', text: localDaySummary(facts), aiAvailable: false, cached: false, generatedAt: now, aiError: 'azure_ai_not_configured' };
    try {
      const result = await summarizer(facts, options.signal);
      options.onUsage?.(result.usage, 'ok');
      this.remember(key, { fingerprint, text: result.text, generatedAt: now });
      return { ...base, status: 'ai', text: result.text, aiAvailable: true, cached: false, generatedAt: now };
    } catch (error) {
      // Awaria AI nie blokuje ekranu „Dziś”: zwracamy podsumowanie wyliczone lokalnie (scenariusz 3b, KA6). Błąd nie trafia do cache.
      const failure = classifyAiProviderFailure(error);
      const code = failure.code === 'rate_limited' ? 'assistant_rate_limited' : failure.code === 'timed_out' ? 'assistant_timeout' : 'assistant_unavailable';
      options.onUsage?.({ inputTokens: 0, outputTokens: 0 }, 'error', code);
      return { ...base, status: 'local', text: localDaySummary(facts), aiAvailable: false, cached: false, generatedAt: now, aiError: code };
    }
  }

  private remember(key: string, entry: CacheEntry) {
    this.cache.delete(key);
    this.cache.set(key, entry);
    while (this.cache.size > this.maxEntries) this.cache.delete(this.cache.keys().next().value as string);
  }
}
