// Automatyczny harmonogram synchronizacji z Google (D06 — dotąd nierozstrzygnięte w kodzie; ręczna synchronizacja
import type { Pool } from 'pg';
import type { GoogleIntegrationService } from './service.js';

export type AutoSyncOptions = { enabled: boolean; intervalMs: number; staggerMs: number };
export type AutoSyncAccount = { userId: string; calendarId: string; email: string };

export class GoogleAutoSyncScheduler {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;

  constructor(
    private readonly pool: Pool,
    private readonly google: GoogleIntegrationService,
    private readonly options: AutoSyncOptions,
    private readonly log: (message: string, error?: unknown) => void = console.warn,
  ) {}

  start() {
    if (!this.options.enabled || this.timer) return;
    this.scheduleNext(0);
  }

  stop() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private scheduleNext(delayMs: number) {
    if (this.stopped) return;
    this.timer = setTimeout(() => void this.runOnce().finally(() => this.scheduleNext(this.options.intervalMs)), delayMs);
  }

  private async listAccounts(): Promise<AutoSyncAccount[]> {
    const result = await this.pool.query<{ id_uzytkownika: string; adres_email: string; id_kalendarza: string | null }>(
      `select distinct on (k.id_uzytkownika) k.id_uzytkownika, k.adres_email, c.id_kalendarza
       from t_konta_google k
       left join t_kalendarze c on c.id_uzytkownika = k.id_uzytkownika and c.aktywny
       where k.status_polaczenia = 'Połączone' and k.zgoda_synchronizacja = true
       order by k.id_uzytkownika, c.id_kalendarza`,
    );
    return result.rows.filter((row) => row.id_kalendarza).map((row) => ({ userId: row.id_uzytkownika, calendarId: row.id_kalendarza as string, email: row.adres_email }));
  }

  async runOnce(): Promise<{ attempted: number; failed: number }> {
    const accounts = await this.listAccounts().catch((error) => { this.log('Auto-sync nie mógł pobrać listy kont', error); return []; });
    let failed = 0;
    for (const [index, account] of accounts.entries()) {
      if (index > 0 && this.options.staggerMs > 0) await new Promise((resolve) => setTimeout(resolve, this.options.staggerMs));
      try {
        await this.google.sync.runRead({ userId: account.userId, calendarId: account.calendarId });
      } catch (error) {
        failed += 1;
        this.log(`Auto-sync nieudany dla konta ${account.email}`, error);
      }
    }
    return { attempted: accounts.length, failed };
  }
}