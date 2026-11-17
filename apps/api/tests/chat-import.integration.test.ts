import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import {pool,PostgresCalendarRepository} from '../src/database.js';
import {config} from '../src/config.js';
import {AiRepository} from '../src/ai/repository.js';
import {buildApi} from '../src/app.js';
import {buildImportPreview} from '../src/import/preview.js';
import type {ChatImportPatch,ChatImportRow} from '../src/import/chat.js';
const patch=(id:string|null,values:Partial<ChatImportPatch>):ChatImportPatch=>({rowId:id,title:null,date:null,startTime:null,endTime:null,location:null,employee:null,selected:null,overnightConfirmed:null,duplicateDecision:null,replacementId:null,...values});
test('chat import persists photo metadata and corrections, scopes drafts, rejects stale confirmation and saves idempotently',{skip:!config.databaseUrl},async()=>{
 assert.ok(pool);const suffix=randomUUID();const scope={userId:`chat-import-user-${suffix}`,calendarId:`chat-import-cal-${suffix}`};
 await pool.query(`insert into t_uzytkownicy(id_uzytkownika,imie,nazwisko,email)values($1,'Osoba','Testowa',$2)`,[scope.userId,`${suffix}@example.test`]);
 await pool.query(`insert into t_kalendarze(id_kalendarza,id_uzytkownika,nazwa,typ)values($1,$2,'Test importu','Osobisty')`,[scope.calendarId,scope.userId]);
 const calendar=new PostgresCalendarRepository(pool);const ai=new AiRepository(pool);const conversation=await ai.createConversation(scope,'synthetic',30);
 const row:ChatImportRow={id:'source-row',title:'Zajęcia syntetyczne',date:'2035-04-14',startTime:'09:00',endTime:'',category:'Class',selected:true,unresolvedFields:['endTime']};
 const make=async()=>{
  const session=await calendar.createImportSession({source:'classes',format:'Zdjęcie',rows:[row],preview:buildImportPreview([row])},scope.userId);
  return calendar.bindChatImport(session.id,{conversationId:conversation.id,fileName:'synthetic.png',mimeType:'image/png',thumbnailDataUrl:'data:image/jpeg;base64,c3ludGhldGlj',reader:'ai',source:'classes',rows:[row]},scope);
 };
 const app=buildApi(calendar,[],{userScope:()=>scope,aiRepository:ai});
 try{
  const draft=await make();assert.equal((await calendar.listChatImports(scope,conversation.id))[0].fileName,'synthetic.png');
  assert.deepEqual(await calendar.listChatImports({...scope,userId:'foreign'},conversation.id),[]);
  await assert.rejects(calendar.updateChatImport(scope,draft.id,'foreign',1,[patch(row.id,{endTime:'10:00'})]),/chat_import_not_found/);
  const results=await Promise.allSettled([calendar.updateChatImport(scope,draft.id,conversation.id,1,[patch(row.id,{endTime:'10:00'})]),calendar.updateChatImport(scope,draft.id,conversation.id,1,[patch(row.id,{endTime:'11:00'})])]);
  assert.equal(results.filter(result=>result.status==='fulfilled').length,1);
  const updated=(await calendar.listChatImports(scope,conversation.id)).find(item=>item.id===draft.id)!;assert.equal(updated.revision,2);assert.deepEqual(updated.rows[0].unresolvedFields,[]);
  const url=`/api/v1/assistant/imports/${draft.id}/confirm`;
  assert.equal((await app.inject({method:'POST',url,payload:{conversationId:conversation.id,revision:1}})).statusCode,409);
  assert.equal((await calendar.confirmImportSession(draft.id,[],scope.userId,scope.calendarId)).kind,'revision-conflict');
  const confirmations=await Promise.all([app.inject({method:'POST',url,payload:{conversationId:conversation.id,revision:2}}),app.inject({method:'POST',url,payload:{conversationId:conversation.id,revision:2}})]);
  for(const result of confirmations)assert.equal(result.statusCode,200,result.body);
  assert.equal((await calendar.getOverview(scope.userId,scope.calendarId))!.events.length,1);
  assert.deepEqual(confirmations[0].json().import.summary,{added:1,replaced:0,skipped:0,rejected:0});
  await assert.rejects(calendar.updateChatImport(scope,draft.id,conversation.id,2,[patch(row.id,{title:'Inne'})]),/closed_or_expired/);
  const extra=await make();
  const withAdded=await calendar.updateChatImport(scope,extra.id,conversation.id,1,[patch(row.id,{selected:false}),patch(null,{title:'Dodatkowe zajęcia testowe',date:'2035-04-15',startTime:'12:00',endTime:'13:00',selected:true})]);
  assert.equal(withAdded.rows.length,2);assert.notEqual(withAdded.rows[1].id,row.id);
  const added=await app.inject({method:'POST',url:`/api/v1/assistant/imports/${extra.id}/confirm`,payload:{conversationId:conversation.id,revision:2}});
  assert.equal(added.statusCode,200,added.body);assert.equal((await calendar.getOverview(scope.userId,scope.calendarId))!.events.length,2);
  const expired=await make();await pool.query(`update t_importy set data_importu=now()-interval '16 minutes' where id_importu=$1`,[expired.id]);
  assert.equal((await calendar.listChatImports(scope,conversation.id)).find(item=>item.id===expired.id)!.status,'expired');
  await assert.rejects(calendar.updateChatImport(scope,expired.id,conversation.id,1,[patch(row.id,{endTime:'10:00'})]),/closed_or_expired/);
  const cancelled=await make();await calendar.cancelImportSession(cancelled.id,scope.userId);
  assert.equal((await calendar.listChatImports(scope,conversation.id)).find(item=>item.id===cancelled.id)!.status,'cancelled');
 }finally{await app.close();await pool.query('delete from t_uzytkownicy where id_uzytkownika=$1',[scope.userId]);await pool.end();}
});
