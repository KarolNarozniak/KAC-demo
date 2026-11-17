// Korekta zaakceptowanej zmiany pracy (S23KC2S1P2-47, G09 / S23KC2S1P2-292) – wspólna operacja domeny grafiku.
//
// Wywoływana w tej samej transakcji co edycja albo usunięcie wydarzenia w kalendarzu (database.ts), więc grafik, wydarzenie
// i zlecenie synchronizacji (outbox W02) zapisują się razem albo wcale.
//
// Założenie D07 (do potwierdzenia w zespole):
//  - korekta dotyczy tylko bieżącego zaakceptowanego grafiku; wersje zastąpione i odrzucone zostają nietknięte (historia),
//  - zmiana zachowuje swoją stawkę z chwili zatwierdzenia (snapshot) – kwota jest przeliczana tą stawką, nie bieżącą stawką profilu,
//  - każda korekta zapisuje wiersz w t_korekty_grafiku (przed / po); usunięta zmiana zostaje w historii ze statusem „Usunięta”,
//    a sumy grafiku (godziny, kwota) liczą tylko zmiany aktywne,
//  - korekta nie tworzy nowej wersji grafiku; zastąpienie grafiku nową zatwierdzoną wersją działa jak dotąd (stare wydarzenia
//    są usuwane, a ich publikacje usuwane w Google przez tę samą synchronizację).
import type { PoolClient } from 'pg';

export type ShiftCorrection =
  | { kind: 'update'; eventId: string; start: Date; end: Date; reason?: string }
  | { kind: 'delete'; eventId: string; reason?: string };

/** null – wydarzenie nie jest zmianą bieżącego zaakceptowanego grafiku (zwykłe wydarzenie albo historia). */
export async function applyAcceptedShiftCorrection(client: PoolClient, correction: ShiftCorrection): Promise<{ shiftId: string; scheduleId: string } | null> {
  const found = await client.query(`select z.id_zmiany, z.id_grafiku, z.rozpoczecie, z.zakonczenie, z.stawka_pln, g.status
    from t_zmiany_pracy z join t_grafiki g on g.id_grafiku = z.id_grafiku
    where z.id_wydarzenia = $1 and z.status <> 'Usunięta' and g.status = 'accepted' and g.approved_at is not null
    for update of z, g`, [correction.eventId]);
  const shift = found.rows[0];
  if (!shift) return null;
  const before = { start: new Date(shift.rozpoczecie), end: new Date(shift.zakonczenie) };

  if (correction.kind === 'update') {
    const minutes = Math.round((correction.end.getTime() - correction.start.getTime()) / 60000);
    const hours = Math.round(minutes / 60 * 100) / 100;
    // Stawka z chwili zatwierdzenia (snapshot), nie bieżąca stawka profilu.
    const pay = Math.round(hours * Number(shift.stawka_pln) * 100) / 100;
    await client.query(`update t_zmiany_pracy set rozpoczecie = $2, zakonczenie = $3, godziny = $4, wynagrodzenie_pln = $5, status = 'Skorygowana'
      where id_zmiany = $1`, [shift.id_zmiany, correction.start, correction.end, hours, pay]);
    await client.query(`insert into t_korekty_grafiku (id_zmiany, od_przed, do_przed, od_po, do_po, powod, status)
      values ($1, $2, $3, $4, $5, $6, 'Zastosowana')`, [shift.id_zmiany, before.start, before.end, correction.start, correction.end, correction.reason ?? 'Edycja w kalendarzu']);
  } else {
    await client.query(`update t_zmiany_pracy set status = 'Usunięta' where id_zmiany = $1`, [shift.id_zmiany]);
    await client.query(`insert into t_korekty_grafiku (id_zmiany, od_przed, do_przed, od_po, do_po, powod, status)
      values ($1, $2, $3, $2, $3, $4, 'Usunięta')`, [shift.id_zmiany, before.start, before.end, correction.reason ?? 'Usunięcie w kalendarzu']);
  }
  await refreshScheduleTotals(client, String(shift.id_grafiku));
  return { shiftId: String(shift.id_zmiany), scheduleId: String(shift.id_grafiku) };
}

/** Sumy grafiku po korekcie: godziny i kwota ze zmian aktywnych (kwoty zmian to snapshoty – nie są przeliczane). */
async function refreshScheduleTotals(client: PoolClient, scheduleId: string) {
  await client.query(`with active as (
      select coalesce(sum(round(extract(epoch from (zakonczenie - rozpoczecie)) / 60)), 0)::integer as minutes,
        coalesce(sum(wynagrodzenie_pln), 0) as pay
      from t_zmiany_pracy where id_grafiku = $1 and status <> 'Usunięta')
    update t_grafiki g set
      total_minutes = greatest(0, coalesce(g.total_minutes, 0) - coalesce(g.proposed_minutes, 0) + active.minutes),
      proposed_minutes = active.minutes,
      shortfall_minutes = greatest(0, coalesce(g.target_minutes, 0) - greatest(0, coalesce(g.total_minutes, 0) - coalesce(g.proposed_minutes, 0) + active.minutes)),
      plan_godzin = round(active.minutes / 60.0, 2), szac_placa_pln = active.pay, updated_at = now()
    from active where g.id_grafiku = $1`, [scheduleId]);
}
