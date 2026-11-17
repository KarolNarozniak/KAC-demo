// Prawdziwy zapis do Google Calendar: publikacja grafiku (S23KC2S1P2-30, G07) i korekty opublikowanych zmian (S23KC2S1P2-47, G09).
// Adaptery zastępują symulację dla kont połączonych przez Google. Konta demonstracyjne dalej używają symulacji.
// Zasady:
//  - identyfikator wydarzenia nadaje KAC (z konta, kalendarza i zmiany), więc ponowienie po zerwanym połączeniu nie tworzy duplikatu,
//  - wydarzenie ma znacznik kacEventId – synchronizacja z Google (G05) pomija własne wydarzenia KAC,
//  - publikacja przywraca wydarzenie usunięte ręcznie w Google (użytkownik świadomie publikuje grafik),
//  - korekta wydarzenia usuniętego w Google kończy się „Brak w Google” i nie tworzy nowego (historyjka 47, 6c),
//  - usunięcie wydarzenia, którego w Google już nie ma, jest sukcesem,
//  - każde wywołanie idzie przez callGoogle: wygasły token jest odświeżany, a ponowne 401 oznacza konto do ponownego połączenia.
import { createHash } from 'node:crypto';
import type { FetchLike } from '../../import/google/oauth.js';
import type { CorrectionAdapter } from './corrections.js';
import { deleteIntegrationEvent, GoogleIntegrationError, insertIntegrationEvent, patchIntegrationEvent, type GoogleEventWrite } from './oauth-client.js';
import type { PublicationAdapter, PublicationItem } from './publication.js';
import type { GoogleAccountRecord } from './repository.js';

export type GoogleCall = <T>(account: GoogleAccountRecord, work: (token: string) => Promise<T>) => Promise<T>;

const DESCRIPTION = 'Zmiana pracy z grafiku KAC. Zmieniaj ją w aplikacji KAC – zmiany wprowadzone tutaj zostaną nadpisane przy kolejnej korekcie.';

/** Identyfikator wydarzenia w Google: znaki base32hex (0–9, a–v), stały dla tej samej zmiany w tym samym kalendarzu i koncie. */
export function publicationEventId(accountId: string, calendarId: string, shiftId: string): string {
  return `kac${createHash('sha256').update(`${accountId}|${calendarId}|${shiftId}`).digest('hex').slice(0, 40)}`;
}

export function eventBody(input: { eventId: string; shiftId?: string; title: string; start: string; end: string }): GoogleEventWrite {
  return {
    summary: input.title, description: DESCRIPTION,
    start: { dateTime: new Date(input.start).toISOString() }, end: { dateTime: new Date(input.end).toISOString() },
    extendedProperties: { private: { kacEventId: input.eventId, ...(input.shiftId ? { kacShiftId: input.shiftId } : {}) } },
  };
}

export class GooglePublicationWriter implements PublicationAdapter {
  readonly mode = 'google' as const;
  constructor(private readonly call: GoogleCall, private readonly fetchImpl: FetchLike) {}

  async publish({ account, calendarId, item, previousExternalId }: { account: GoogleAccountRecord; calendarId: string; item: PublicationItem; previousExternalId?: string | null }): Promise<{ externalId: string }> {
    const body = eventBody({ eventId: item.eventId, shiftId: item.shiftId, title: item.title, start: item.start, end: item.end });
    // Aktualizacja wcześniej opublikowanego wydarzenia. Gdy w Google już go nie ma, publikujemy je od nowa.
    if (previousExternalId) {
      try {
        await this.call(account, (token) => patchIntegrationEvent(token, this.fetchImpl, calendarId, previousExternalId, { ...body, status: 'confirmed' }));
        return { externalId: previousExternalId };
      } catch (error) {
        if (!(error instanceof GoogleIntegrationError) || error.code !== 'event_not_found') throw error;
      }
    }
    const externalId = publicationEventId(account.accountId, calendarId, item.shiftId);
    const created = await this.call(account, (token) => insertIntegrationEvent(token, this.fetchImpl, calendarId, externalId, body));
    // „exists”: wydarzenie powstało przy wcześniejszej, przerwanej próbie albo zostało usunięte w Google – ustawiamy aktualny stan.
    if (created === 'exists') await this.call(account, (token) => patchIntegrationEvent(token, this.fetchImpl, calendarId, externalId, { ...body, status: 'confirmed' }));
    return { externalId };
  }
}

export class GoogleCorrectionWriter implements CorrectionAdapter {
  readonly mode = 'google' as const;
  constructor(private readonly call: GoogleCall, private readonly fetchImpl: FetchLike, private readonly account: GoogleAccountRecord) {}

  async update({ calendarId, externalId, event }: { calendarId: string; externalId: string | null; event: { title: string; start: string; end: string } }) {
    // Bez zewnętrznego ID nie wiadomo, które wydarzenie zmienić – nie tworzymy nowego.
    if (!externalId) throw new GoogleIntegrationError('event_not_found');
    const changes = { summary: event.title, start: { dateTime: new Date(event.start).toISOString() }, end: { dateTime: new Date(event.end).toISOString() } };
    await this.call(this.account, (token) => patchIntegrationEvent(token, this.fetchImpl, calendarId, externalId, changes));
  }

  async delete({ calendarId, externalId }: { calendarId: string; externalId: string | null }) {
    if (!externalId) return;
    await this.call(this.account, (token) => deleteIntegrationEvent(token, this.fetchImpl, calendarId, externalId));
  }
}
