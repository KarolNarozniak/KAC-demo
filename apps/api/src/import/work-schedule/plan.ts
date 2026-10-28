// Plan zapisu zmian pracy z uwzględnieniem duplikatów (S23KC2S1P2-44, scenariusz 6b i SUB-10).
// Czysta funkcja: na podstawie wierszy, decyzji użytkownika i wydarzeń w kalendarzu ustala,
// co dodać, co zastąpić i co pominąć. Baza wykonuje potem ten plan w jednej transakcji.

import { findDuplicates, type DuplicateDecision, type ExistingEvent } from '../rules.js';

export type PlannedRow = { id: string; title: string; start: Date; duplicateDecision?: DuplicateDecision };

export type PlanAction =
  | { kind: 'insert'; rowId: string }
  | { kind: 'replace'; rowId: string; eventId: string }
  | { kind: 'skip'; rowId: string };

export type ImportPlan =
  | { ok: true; actions: PlanAction[] }
  | { ok: false; missingDecisions: string[]; invalidDecisions: string[] };

export function planWorkImport(rows: PlannedRow[], existing: ExistingEvent[]): ImportPlan {
  const duplicates = new Map(findDuplicates(rows, existing).map((info) => [info.rowId, info]));
  const missingDecisions: string[] = [];
  const invalidDecisions: string[] = [];
  const actions: PlanAction[] = [];

  for (const row of rows) {
    const info = duplicates.get(row.id);
    if (!info) {
      actions.push({ kind: 'insert', rowId: row.id });
      continue;
    }
    const decision = row.duplicateDecision;
    const replaceTarget = info.existingIds[0];
    if (!decision) missingDecisions.push(row.id);
    // „Zastąp” ma sens tylko wtedy, gdy w kalendarzu jest wydarzenie do zastąpienia.
    else if (decision === 'replace' && !replaceTarget) invalidDecisions.push(row.id);
    else if (decision === 'skip') actions.push({ kind: 'skip', rowId: row.id });
    else if (decision === 'replace' && replaceTarget) actions.push({ kind: 'replace', rowId: row.id, eventId: replaceTarget });
    else actions.push({ kind: 'insert', rowId: row.id });
  }

  if (missingDecisions.length > 0 || invalidDecisions.length > 0) return { ok: false, missingDecisions, invalidDecisions };
  return { ok: true, actions };
}
