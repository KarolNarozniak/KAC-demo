import { isDuplicate, type DuplicateDecision, type ExistingEvent } from './rules.js';

export type PlannedRow = { id: string; title: string; start: Date; duplicateDecision?: DuplicateDecision; replacementId?: string };
export type PlanAction =
  | { kind: 'insert'; rowId: string }
  | { kind: 'replace'; rowId: string; eventId: string }
  | { kind: 'skip'; rowId: string };
export type ImportPlan =
  | { ok: true; actions: PlanAction[] }
  | { ok: false; missingDecisions: string[]; invalidDecisions: string[] };

/** Evaluate against the effective batch, so skipped rows cannot cause phantom duplicates. */
export function planImport(rows: PlannedRow[], existing: ExistingEvent[]): ImportPlan {
  const effective = existing.map(event => ({ ...event, batch: false }));
  const actions: PlanAction[] = [];
  const missingDecisions: string[] = [];
  const invalidDecisions: string[] = [];
  for (const row of rows) {
    const matches = effective.filter(event => isDuplicate(row, event));
    if (!matches.length) {
      actions.push({ kind: 'insert', rowId: row.id });
      effective.push({ ...row, id: `row:${row.id}`, batch: true });
      continue;
    }
    if (!row.duplicateDecision) { missingDecisions.push(row.id); continue; }
    if (row.duplicateDecision === 'skip') { actions.push({ kind: 'skip', rowId: row.id }); continue; }
    if (row.duplicateDecision === 'keepBoth') {
      actions.push({ kind: 'insert', rowId: row.id });
      effective.push({ ...row, id: `row:${row.id}`, batch: true });
      continue;
    }
    const target = row.replacementId
      ? matches.find(event => event.id === row.replacementId)
      : matches.length === 1 ? matches[0] : undefined;
    if (!target) { invalidDecisions.push(row.id); continue; }
    if (target.batch) {
      const prior = actions.find(action => action.rowId === target.id.slice(4));
      if (!prior) { invalidDecisions.push(row.id); continue; }
      // Replacing an earlier replacement retains its original database target.
      actions.push(prior.kind === 'replace'
        ? { kind: 'replace', rowId: row.id, eventId: prior.eventId }
        : { kind: 'insert', rowId: row.id });
      actions[actions.indexOf(prior)] = { kind: 'skip', rowId: prior.rowId };
    } else {
      actions.push({ kind: 'replace', rowId: row.id, eventId: target.id });
    }
    effective.splice(effective.indexOf(target), 1, { ...row, id: `row:${row.id}`, batch: true });
  }
  return missingDecisions.length || invalidDecisions.length
    ? { ok: false, missingDecisions, invalidDecisions }
    : { ok: true, actions };
}
