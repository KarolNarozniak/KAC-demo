import type { FastifyInstance } from 'fastify';
import sharp from 'sharp';
import type { ApiDependencies } from '../../contracts.js';
import { documented,withExamples } from '../../examples.js';
import { AiFileValidationError,validateAiFile } from '../../../ai/file-validation.js';
import { classifyAiProviderFailure,isAiContentFilterFailure,safeAiProviderDiagnostics } from '../../../ai/provider-errors.js';
import { AiInvalidOutputError } from '../../../ai/service.js';
import { config } from '../../../config.js';
import { chatImportSchema,chatImportRowSchema,type ChatImportRow } from '../../../import/chat.js';
import { buildImportPreview } from '../../../import/preview.js';
import { resolveRow } from '../../../import/rules.js';
import { mapShiftsToRows } from '../../../import/work-schedule/mapping.js';
import { readClassImage } from '../../../import/classes/image-reader.js';
import { readClassPdf } from '../../../import/classes/reader.js';
import type { AcceptedRow } from '../../../import/session.js';
import { importView } from '../../../ai/chat-import.js';
const idParams={type:'object',required:['id'],additionalProperties:false,properties:{id:{type:'string',minLength:1,maxLength:100}}};
const errorSchema=documented({type:'object',required:['error'],additionalProperties:true,properties:{error:{type:'string'}}},'Import request failed without confirming calendar changes.',{invalid:{summary:'Synthetic import error',value:{error:'chat_import_not_found'}}});
const responses={400:errorSchema,404:errorSchema,409:errorSchema,410:errorSchema,413:errorSchema,422:errorSchema,429:errorSchema,502:errorSchema,503:errorSchema,504:errorSchema};
const draftResponse=documented(chatImportSchema,'Conversation-owned import draft, including its current revision and persisted image preview.',{draft:{summary:'Synthetic draft',value:{id:'synthetic-import',conversationId:'synthetic-chat',fileName:'plan.png',mimeType:'image/png',thumbnailDataUrl:null,reader:'ai',source:'classes',rows:[],revision:1,status:'pending',expiresAt:'2035-01-01T00:00:00Z',summary:null}}});
const previewResponse=documented({type:'object',additionalProperties:false,required:[...chatImportSchema.required,'preview','collisions'],properties:{...chatImportSchema.properties,
 preview:{type:'array',items:{type:'object',additionalProperties:true,required:['id','status','issues','overnight','duplicateOfEvents','duplicateOfRows'],properties:{id:{type:'string'},status:{type:'string',enum:['ok','error']},issues:{type:'array',items:{type:'string'}},start:{type:['string','null']},end:{type:['string','null']},overnight:{type:'boolean'},duplicateOfEvents:{type:'array',items:{type:'object',required:['id','title','start'],properties:{id:{type:'string'},title:{type:'string'},start:{type:'string'},repeatWeekly:{type:'boolean'}}}},duplicateOfRows:{type:'array',items:{type:'string'}}}}},
 collisions:{type:'object',additionalProperties:{type:'array',items:{type:'object',required:['id','title','category','mandatory','start','end'],properties:{id:{type:'string'},title:{type:'string'},category:{type:'string'},mandatory:{type:'boolean'},start:{type:'string'},end:{type:'string'}}}}}}},'Current draft and validation diagnostics.',{preview:{summary:'Synthetic preview',value:{...(draftResponse['x-examples'].draft!.value as Record<string,unknown>),preview:[],collisions:{}}}});
export async function assistantImportRoutes(app:FastifyInstance,options:Pick<ApiDependencies,'repository'|'aiRepository'|'aiService'|'scope'|'scheduleReader'>) {
 const {repository:calendar,aiRepository:ai,aiService,scope,scheduleReader}=options;
 app.post<{Params:{id:string};Body:{fileName:string;dataBase64:string;source:'classes'|'work';reader:'ai'|'local';sessionId?:string;rows?:ChatImportRow[]}}>('/assistant/conversations/:id/attachments',{bodyLimit:7_600_000,schema:{tags:['Assistant'],operationId:'attachAssistantImport',summary:'Attach a timetable to a conversation',description:'Validates the image or PDF, stores a bounded derivative image preview, reads events through Azure or local OCR and binds an existing import session to this conversation. Optional sessionId and rows transfer corrections from Quick import. No calendar write is performed.',params:idParams,
 body:withExamples({type:'object',required:['fileName','dataBase64','source','reader'],additionalProperties:false,properties:{fileName:{type:'string',minLength:1,maxLength:255},dataBase64:{type:'string',maxLength:7_000_000},source:{type:'string',enum:['classes','work']},reader:{type:'string',enum:['ai','local']},sessionId:{type:'string',minLength:1,maxLength:100},rows:{type:'array',maxItems:300,items:chatImportRowSchema}}},{image:{summary:'Synthetic image request',value:{fileName:'plan.png',dataBase64:'U1lOVEhFVElD',source:'classes',reader:'ai'}}}),response:{201:draftResponse,...responses}}},async(request,reply)=>{
  if(!calendar?.bindChatImport||!calendar.createImportSession||!ai) return reply.code(503).send({error:'chat_import_unavailable'});
  const owner=scope(request); const controller=new AbortController(); request.raw.once('aborted',()=>controller.abort());
  reply.raw.once('close',()=>{if(!reply.raw.writableEnded)controller.abort();});
  try {
   if(!await ai.getConversation(owner,request.params.id)) return reply.code(404).send({error:'conversation_not_found_or_expired'});
   if(request.body.reader==='ai'&&!request.body.sessionId&&!aiService) return reply.code(503).send({error:'azure_ai_not_configured'});
   if(Boolean(request.body.sessionId)!==Boolean(request.body.rows)) return reply.code(400).send({error:'invalid_import_handoff'});
   const file=await validateAiFile(request.body.fileName,request.body.dataBase64,config.azureAi.maxPdfPages,config.azureAi.maxImagePixels);
   const thumbnailDataUrl=file.type==='PDF'?null:`data:image/jpeg;base64,${(await sharp(file.bytes).rotate().flatten({background:'#ffffff'}).resize({width:1600,height:1600,fit:'inside',withoutEnlargement:true}).jpeg({quality:70}).toBuffer()).toString('base64')}`;
   if(thumbnailDataUrl&&thumbnailDataUrl.length>700_000) return reply.code(413).send({error:'image-too-large'});
   if(controller.signal.aborted)return;
   await ai.appendMessage(owner,request.params.id,'user',{text:`Import: ${file.fileName}`,attachment:{fileName:file.fileName,mimeType:file.mimeType,thumbnailDataUrl,reader:request.body.reader}},config.azureAi.conversationRetentionDays);
   let rows:ChatImportRow[]; let sessionId=request.body.sessionId;
   if(sessionId) rows=request.body.rows!;
   else {
    const userName=await calendar.getImportUserName?.(owner.userId)??'';
    if(request.body.reader==='ai') {
     const extracted=await aiService!.extractSchedule(file,request.body.source,userName,controller.signal);
     if(request.body.source==='work') rows=mapShiftsToRows(extracted.rows.map(row=>({...row,confidence:row.confidence??0})),userName).rows.map(row=>({...row,selected:row.isOwn}));
     else rows=extracted.rows.map(row=>({...row,selected:true}));
    } else if(request.body.source==='classes') rows=(await(file.type==='PDF'?readClassPdf(file.bytes):readClassImage(file.bytes))).rows.map(row=>({...row,selected:true}));
    else rows=mapShiftsToRows(await scheduleReader.read({name:file.fileName,type:file.type,bytes:file.bytes},{userName}),userName).rows.map(row=>({...row,selected:row.isOwn}));
    const allowed=new Set(Object.keys(chatImportRowSchema.properties));
    rows=rows.map(row=>Object.fromEntries(Object.entries(row).filter(([key,value])=>allowed.has(key)&&value!==undefined)) as ChatImportRow);
    if(controller.signal.aborted)return;
    const existing=await calendar.listEventsForImport?.(owner.calendarId,owner.userId)??[];
    sessionId=(await calendar.createImportSession({source:request.body.source,format:file.type==='PDF'?'PDF':'Zdjęcie',rows,preview:buildImportPreview(rows,existing)},owner.userId)).id;
   }
   if(controller.signal.aborted)return;
   const draft=await calendar.bindChatImport(sessionId!,{conversationId:request.params.id,fileName:file.fileName,mimeType:file.mimeType,thumbnailDataUrl,reader:request.body.reader,source:request.body.source,rows},owner);
   await ai.appendMessage(owner,request.params.id,'assistant',{text:rows.length?`Odczytano ${rows.length} pozycji. Możesz poprawić je w rozmowie, np. „przesuń początki o godzinę” lub „wybierz tylko moje zmiany”. Sprawdź podgląd i kliknij Zatwierdź import, aby zapisać wydarzenia.`:'Automatyczny odczyt nie wykrył wydarzeń. Zdjęcie jest w rozmowie. Podaj brakujące informacje — przygotuję podgląd importu do zatwierdzenia.'},config.azureAi.conversationRetentionDays);
   return reply.code(201).send(draft);
  }catch(error){
   if(controller.signal.aborted)return;
   if(error instanceof AiFileValidationError)return reply.code(['file-too-large','image-too-large','ai-payload-too-large'].includes(error.code)?413:422).send({error:error.code});
   if(error instanceof Error&&['chat_import_not_found','unknown_import_rows'].includes(error.message))return reply.code(404).send({error:error.message});
   if(error instanceof AiInvalidOutputError)return reply.code(502).send({error:'invalid_ai_output'});
   request.log.error(safeAiProviderDiagnostics(error),'Chat attachment failed');
   if(isAiContentFilterFailure(error))return reply.code(422).send({error:'assistant_content_filtered'});
   const failure=classifyAiProviderFailure(error);return reply.code(failure.status).send({error:failure.code==='timed_out'?'assistant_timeout':failure.code==='rate_limited'?'assistant_rate_limited':'chat_import_failed'});
  }
 });
 app.get<{Params:{id:string}}>('/assistant/conversations/:id/imports',{schema:{tags:['Assistant'],operationId:'listAssistantImports',summary:'List chat import drafts',description:'Returns conversation-scoped drafts and the current session status. Original file bytes are not returned.',params:idParams,response:{200:documented({type:'object',required:['imports'],additionalProperties:false,properties:{imports:{type:'array',items:chatImportSchema}}},'Chat imports.',{empty:{summary:'No imports',value:{imports:[]}}}),...responses}}},async(request,reply)=>{
  if(!calendar?.listChatImports||!ai)return reply.code(503).send({error:'chat_import_unavailable'});
  const owner=scope(request);if(!await ai.getConversation(owner,request.params.id))return reply.code(404).send({error:'conversation_not_found_or_expired'});
  return {imports:await calendar.listChatImports(owner,request.params.id)};
 });
 app.post<{Params:{id:string};Body:{conversationId:string;revision:number}}>('/assistant/imports/:id/confirm',{schema:{tags:['Assistant'],operationId:'confirmAssistantImport',summary:'Confirm the reviewed chat import revision',description:'Validates the selected current draft, overnight acknowledgements and duplicate decisions, then uses the shared transactional import mechanism. Repeating a successful confirmation returns its saved receipt. The model has no confirmation tool.',params:idParams,body:withExamples({type:'object',required:['conversationId','revision'],additionalProperties:false,properties:{conversationId:{type:'string',minLength:1,maxLength:100},revision:{type:'integer',minimum:1}}},{confirm:{summary:'Confirm reviewed revision',value:{conversationId:'synthetic-chat',revision:1}}}),response:{200:documented({type:'object',required:['status','import'],additionalProperties:false,properties:{status:{const:'confirmed'},import:chatImportSchema}},'Confirmed import with receipt.',{confirmed:{summary:'Synthetic result',value:{status:'confirmed',import:{id:'synthetic-import',conversationId:'synthetic-chat',fileName:'plan.png',mimeType:'image/png',thumbnailDataUrl:null,reader:'ai',source:'classes',rows:[],revision:1,status:'confirmed',expiresAt:'2035-01-01T00:00:00Z',summary:{added:0,replaced:0,skipped:0,rejected:0}}}}}),...responses}}},async(request,reply)=>{
  if(!calendar?.listChatImports||!calendar.confirmImportSession)return reply.code(503).send({error:'chat_import_unavailable'});
  const owner=scope(request);const draft=(await calendar.listChatImports(owner,request.body.conversationId)).find(item=>item.id===request.params.id);
  if(!draft)return reply.code(404).send({error:'chat_import_not_found'});
  if(draft.revision!==request.body.revision)return reply.code(409).send({error:'chat_import_revision_conflict'});
  const overview=await calendar.getOverview(owner.userId,owner.calendarId);const zone=overview?.user.timezone??'Europe/Warsaw';
  const rows=draft.rows.filter(row=>row.selected);if(!rows.length)return reply.code(422).send({error:'no_selected_rows'});
  const accepted:AcceptedRow[]=[];
  for(const row of rows){const resolved=resolveRow(row,zone);if(!resolved.ok||row.unresolvedFields?.length||resolved.needsConfirmation&&!row.overnightConfirmed)return reply.code(422).send({error:'invalid_or_unreviewed_rows'});
   accepted.push({id:row.id,title:resolved.title,start:resolved.start,end:resolved.end,category:row.category??'Personal',location:row.location?.trim()||null,duplicateDecision:row.duplicateDecision,replacementId:row.replacementId});}
  const result=await calendar.confirmImportSession(draft.id,accepted,owner.userId,owner.calendarId,draft.revision);
  if(result.kind==='revision-conflict')return reply.code(409).send({error:'chat_import_revision_conflict'});
  if(result.kind==='expired')return reply.code(410).send({error:'chat_import_closed_or_expired'});
  if(result.kind!=='ok')return reply.code(result.kind==='needs-decision'?422:409).send({error:result.kind==='needs-decision'?'duplicate_decision_required':'chat_import_closed_or_expired'});
  const updated=(await calendar.listChatImports(owner,request.body.conversationId)).find(item=>item.id===draft.id)!;
  return {status:'confirmed',import:updated};
 });
 app.get<{Params:{id:string}}>('/assistant/imports/:id/preview',{schema:{tags:['Assistant'],operationId:'getAssistantImportPreview',summary:'Inspect a chat import preview',description:'Returns current validation, duplicates and collisions for the selected rows in a conversation-owned draft.',params:idParams,querystring:{type:'object',additionalProperties:false,required:['conversationId'],properties:{conversationId:{type:'string',minLength:1,maxLength:100}}},response:{200:previewResponse,...responses}}},async(request,reply)=>{
  if(!calendar?.listChatImports)return reply.code(503).send({error:'chat_import_unavailable'});
  const owner=scope(request);const draft=(await calendar.listChatImports(owner,(request.query as {conversationId:string}).conversationId)).find(item=>item.id===request.params.id);
  return draft?importView(draft,calendar,owner):reply.code(404).send({error:'chat_import_not_found'});
 });
}
