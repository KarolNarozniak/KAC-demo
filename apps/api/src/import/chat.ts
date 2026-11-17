import {randomUUID} from 'node:crypto';
import type { ImportRow } from './rules.js';
import type { ImportSummary } from './session.js';
export type ChatImportRow = ImportRow & { selected: boolean };
export type ChatImport = {
  id: string; conversationId: string; fileName: string; mimeType: string; thumbnailDataUrl: string | null;
  reader: 'ai' | 'local'; source: 'classes' | 'work'; rows: ChatImportRow[]; revision: number;
  status: 'pending' | 'confirmed' | 'cancelled' | 'expired'; expiresAt: string; summary: ImportSummary | null;
};
export type ChatImportBinding = Pick<ChatImport, 'conversationId' | 'fileName' | 'mimeType' | 'thumbnailDataUrl' | 'reader' | 'source' | 'rows'>;
export type ChatImportPatch = { rowId: string | null; title: string | null; date: string | null; startTime: string | null; endTime: string | null; location: string | null; employee: string | null;
  selected: boolean | null; overnightConfirmed: boolean | null; duplicateDecision: 'skip' | 'replace' | 'keepBoth' | null; replacementId: string | null };
export const chatImportRowSchema = { type: 'object', additionalProperties: false, required: ['id', 'title', 'date', 'startTime', 'endTime', 'selected'], properties: {
  id: { type: 'string', minLength: 1, maxLength: 64 }, title: { type: 'string', maxLength: 200 }, date: { type: 'string', maxLength: 10 }, startTime: { type: 'string', maxLength: 5 }, endTime: { type: 'string', maxLength: 5 },
  endDate: { type: 'string', maxLength: 10 }, category: { type: 'string', enum: ['Class', 'Work', 'Personal'] }, location: { type: 'string', maxLength: 200 }, employee: { type: 'string', maxLength: 200 },
  confidence: { type: 'number', minimum: 0, maximum: 1 }, sourcePage: { type: 'integer', minimum: 1 }, sourceSnippet: { type: 'string', maxLength: 160 }, unresolvedFields: { type: 'array', maxItems: 20, items: { type: 'string', maxLength: 80 } },
  selected: { type: 'boolean' }, overnightConfirmed: { type: 'boolean' }, duplicateDecision: { type: 'string', enum: ['skip', 'replace', 'keepBoth'] }, replacementId: { type: 'string', maxLength: 200 },
} } as const;
export const chatImportSchema = { type: 'object', additionalProperties: false, required: ['id', 'conversationId', 'fileName', 'mimeType', 'thumbnailDataUrl', 'reader', 'source', 'rows', 'revision', 'status', 'expiresAt', 'summary'], properties: {
  id: { type: 'string' }, conversationId: { type: 'string' }, fileName: { type: 'string' }, mimeType: { type: 'string' }, thumbnailDataUrl: { type: ['string', 'null'] }, reader: { type: 'string', enum: ['ai', 'local'] }, source: { type: 'string', enum: ['classes', 'work'] },
  rows: { type: 'array', maxItems: 300, items: chatImportRowSchema }, revision: { type: 'integer', minimum: 1 }, status: { type: 'string', enum: ['pending', 'confirmed', 'cancelled', 'expired'] }, expiresAt: { type: 'string', format: 'date-time' },
  summary: { anyOf: [{ type: 'null' }, { type: 'object', additionalProperties: false, required: ['added', 'replaced', 'skipped', 'rejected'], properties: { added: { type: 'integer' }, replaced: { type: 'integer' }, skipped: { type: 'integer' }, rejected: { type: 'integer' } } }] },
} } as const;
export const patchSchema = { type: 'object', additionalProperties: false, required: ['rowId', 'title', 'date', 'startTime', 'endTime', 'location', 'employee', 'selected', 'overnightConfirmed', 'duplicateDecision', 'replacementId'], properties: {
  rowId: { type: ['string','null'], minLength: 1, maxLength: 64 }, title: { type: ['string', 'null'], maxLength: 200 }, date: { type: ['string', 'null'], maxLength: 10 }, startTime: { type: ['string', 'null'], maxLength: 5 }, endTime: { type: ['string', 'null'], maxLength: 5 }, location: { type: ['string', 'null'], maxLength: 200 }, employee: { type: ['string', 'null'], maxLength: 200 },
  selected: { type: ['boolean', 'null'] }, overnightConfirmed: { type: ['boolean', 'null'] }, duplicateDecision: { type: ['string', 'null'], enum: ['skip', 'replace', 'keepBoth', null] }, replacementId: { type: ['string', 'null'], maxLength: 200 },
} } as const;
export function applyImportPatches(rows: ChatImportRow[], patches: ChatImportPatch[], fallbackCategory: 'Class'|'Work'|'Personal' = 'Class'): ChatImportRow[] {
  const known = new Set(rows.map((row) => row.id));
  const existingIds=patches.flatMap(patch=>patch.rowId===null?[]:[patch.rowId]);
  if(existingIds.some(id=>!known.has(id))||new Set(existingIds).size!==existingIds.length)throw new Error('unknown_import_rows');
  const additions=patches.filter(patch=>patch.rowId===null);
  if(rows.length+additions.length>300)throw new Error('too_many_import_rows');
  const apply=(row:ChatImportRow,patch:ChatImportPatch)=>{
    const values=Object.fromEntries(Object.entries(patch).filter(([key,value])=>key!=='rowId'&&value!==null));
    const timingChanged=['title','date','startTime','endTime','location'].some(key=>key in values&&values[key]!==row[key as keyof ChatImportRow]);
    return {...row,...(timingChanged?{duplicateDecision:undefined,replacementId:undefined,overnightConfirmed:false}:{}),...values,
      unresolvedFields:(row.unresolvedFields??[]).filter(key=>!(key in values))} as ChatImportRow;
  };
  return [...rows.map(row=>{const patch=patches.find(item=>item.rowId===row.id);return patch?apply(row,patch):row;}),
    ...additions.map(patch=>apply({id:randomUUID(),title:'',date:'',startTime:'',endTime:'',category:rows[0]?.category??fallbackCategory,selected:true,unresolvedFields:['title','date','startTime','endTime',...((rows[0]?.category??fallbackCategory)==='Work'?['employee']:[])]},patch))];
}
