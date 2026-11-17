import { Ajv } from 'ajv';
import type { CalendarRepository } from '../api/contracts.js';
import type { UserScope } from '../api/scope.js';
import { buildImportPreview } from '../import/preview.js';
import { importCollisions } from '../import/collisions-preview.js';
import { patchSchema, type ChatImport, type ChatImportPatch } from '../import/chat.js';
const validatePatches = new Ajv().compile({ type:'array',minItems:1,maxItems:300,items:patchSchema });
export async function importView(draft: ChatImport, calendar: CalendarRepository, scope: UserScope) {
  const [existing,overview]=await Promise.all([calendar.listEventsForImport?.(scope.calendarId,scope.userId)??[],calendar.getOverview(scope.userId,scope.calendarId)]);
  const selected=draft.rows.filter(row=>row.selected);
  return { ...draft, thumbnailDataUrl: null, preview:buildImportPreview(selected,existing,overview?.user.timezone),collisions:importCollisions(selected,overview?.events??[],overview?.user.timezone??'Europe/Warsaw') };
}
export async function executeChatImportTool(name:string,args:Record<string,unknown>,calendar:CalendarRepository,scope:UserScope,conversationId:string):Promise<Record<string,unknown>> {
  if(!calendar.listChatImports) return {error:'chat_import_unavailable'};
  if(typeof args.importId!=='string' || !args.importId || args.importId.length>100) return {error:'invalid_tool_arguments'};
  const allowed=name==='import_get_preview'?['importId']:['importId','revision','changes'];
  if(Object.keys(args).some(key=>!allowed.includes(key))) return {error:'invalid_tool_arguments'};
  let draft=(await calendar.listChatImports(scope,conversationId)).find(item=>item.id===args.importId);
  if(!draft) return {error:'chat_import_not_found'};
  if(name==='import_prepare_changes') {
    if(!calendar.updateChatImport || !Number.isInteger(args.revision) || Number(args.revision)<1 || !validatePatches(args.changes)) return {error:'invalid_tool_arguments'};
    try { draft=await calendar.updateChatImport(scope,draft.id,conversationId,Number(args.revision),args.changes as ChatImportPatch[]); }
    catch(error) {return {error:error instanceof Error&&['chat_import_not_found','chat_import_closed_or_expired','chat_import_revision_conflict','unknown_import_rows','too_many_import_rows'].includes(error.message)?error.message:'chat_import_update_failed'};}
  }
  return { status:'review_only', import:await importView(draft,calendar,scope) };
}

export function refreshChatImportHistory(messages: import('./repository.js').AiMessage[], drafts: ChatImport[]) {
  const current=new Map(drafts.map(draft=>[draft.id,draft]));
  return messages.map(message=>{
    const result=message.role==='tool'&&message.content.result&&typeof message.content.result==='object'?message.content.result as Record<string,unknown>:null;
    const previous=result?.import as {id?:string;revision?:number}|undefined;
    if(!previous?.id)return message;
    const draft=current.get(previous.id);
    return {...message,content:{...message.content,result:{...result,import:draft?{...draft,thumbnailDataUrl:null,requiresPreviewRefresh:true}:{id:previous.id,status:'unavailable'}}}};
  });
}
