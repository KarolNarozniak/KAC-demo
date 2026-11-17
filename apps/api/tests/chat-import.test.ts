import assert from 'node:assert/strict';
import test from 'node:test';
import sharp from 'sharp';
import {buildApi} from '../src/app.js';
import {applyImportPatches,type ChatImport,type ChatImportPatch} from '../src/import/chat.js';
import {executeAssistantTool} from '../src/ai/tools.js';
const patch=(rowId:string,values:Partial<ChatImportPatch>={}):ChatImportPatch=>({rowId,title:null,date:null,startTime:null,endTime:null,location:null,employee:null,selected:null,overnightConfirmed:null,duplicateDecision:null,replacementId:null,...values});

test('photo stays in conversation and import can be corrected through tools then explicitly confirmed',async()=>{
 let draft:ChatImport|undefined;let writes=0;let modelCalls=0;const messages:any[]=[];
 const owner={userId:'synthetic-user',calendarId:'synthetic-calendar'};
 const app=buildApi({checkConnection:async()=>{},getOverview:async()=>({user:{timezone:'Europe/Warsaw'},events:[]} as never),getImportUserName:async()=> 'Osoba testowa',listEventsForImport:async()=>[],
  createImportSession:async()=>({id:'import-test',expiresAt:new Date(Date.now()+900000)}),
  bindChatImport:async(id,input,scope)=>{assert.deepEqual(scope,owner);draft={...input,id,revision:1,status:'pending',expiresAt:new Date(Date.now()+900000).toISOString(),summary:null};return draft;},
  listChatImports:async(scope,conversationId)=>{assert.deepEqual(scope,owner);return conversationId==='conversation'&&draft?[draft]:[];},
  updateChatImport:async(_scope,id,_conversationId,revision,changes)=>{assert.equal(id,draft!.id);if(revision!==draft!.revision)throw new Error('chat_import_revision_conflict');draft={...draft!,rows:applyImportPatches(draft!.rows,changes),revision:revision+1};return draft;},
  confirmImportSession:async(_id,_rows,_user,_calendar,revision)=>{if(revision!==draft?.revision)return {kind:'revision-conflict'};if(draft.status!=='confirmed'){writes++;draft={...draft,status:'confirmed',summary:{added:1,replaced:0,skipped:0,rejected:0}};}return {kind:'ok',saved:[],summary:draft.summary!};},
 },[],{userScope:()=>owner,aiRepository:{
  getConversation:async(_scope:any,id:string)=>id==='conversation'?{id}:null,
  appendMessage:async(_scope:any,_id:string,role:string,content:Record<string,unknown>)=>{const message={id:`m-${messages.length}`,role,content,createdAt:new Date().toISOString()};messages.push(message);return message;},
  listMessages:async()=>messages,listPendingActions:async()=>[],logUsage:async()=>{},
 } as never,aiService:{extractSchedule:async()=>({rows:[{id:'row-test',title:'Zajęcia testowe',date:'2035-02-14',startTime:'09:00',endTime:'',category:'Class',unresolvedFields:['endTime']}],usage:{inputTokens:1,outputTokens:1},responseId:'synthetic'}),
 sendAssistantMessage:async(input)=>{
  const index=modelCalls++;
  if(index===0){assert.ok(input.some((item:any)=>item.role==='user'&&Array.isArray(item.content)&&item.content.some((part:any)=>part.type==='input_image')));return {output_text:'',output:[{type:'function_call',id:'fc-get',call_id:'get',name:'import_get_preview',arguments:JSON.stringify({importId:draft!.id})}],usage:{input_tokens:1,output_tokens:1}} as never;}
  if(index===1)return {output_text:'',output:[{type:'function_call',id:'fc-update',call_id:'update',name:'import_prepare_changes',arguments:JSON.stringify({importId:draft!.id,revision:1,changes:[patch('row-test',{endTime:'10:00'})]})}],usage:{input_tokens:1,output_tokens:1}} as never;
  return {output_text:'Poprawiono koniec. Sprawdź podgląd i zatwierdź import.',output:[],usage:{input_tokens:1,output_tokens:1}} as never;
 }} });
 try{
  const image=(await sharp({create:{width:4,height:4,channels:3,background:'#ffffff'}}).png().toBuffer()).toString('base64');
  const upload=await app.inject({method:'POST',url:'/api/v1/assistant/conversations/conversation/attachments',payload:{fileName:'test.png',dataBase64:image,source:'classes',reader:'ai'}});
  assert.equal(upload.statusCode,201,upload.body);assert.equal(writes,0);assert.match(upload.json().thumbnailDataUrl,/^data:image\/jpeg;base64,/);
  assert.ok(messages[0].content.attachment);assert.equal(JSON.stringify(messages).includes(image),false);
  const confirm='/api/v1/assistant/imports/import-test/confirm';
  assert.equal((await app.inject({method:'POST',url:confirm,payload:{conversationId:'conversation',revision:1}})).statusCode,422);
  const sent=await app.inject({method:'POST',url:'/api/v1/assistant/conversations/conversation/messages',payload:{content:'Koniec o 10:00.'}});
  assert.equal(sent.statusCode,200,sent.body);assert.equal(draft!.revision,2);assert.equal(draft!.rows[0].endTime,'10:00');assert.deepEqual(draft!.rows[0].unresolvedFields,[]);assert.equal(writes,0);
  assert.equal((await app.inject({method:'POST',url:confirm,payload:{conversationId:'conversation',revision:1}})).statusCode,409);
  const accepted=await app.inject({method:'POST',url:confirm,payload:{conversationId:'conversation',revision:2}});assert.equal(accepted.statusCode,200,accepted.body);
  assert.equal((await app.inject({method:'POST',url:confirm,payload:{conversationId:'conversation',revision:2}})).statusCode,200);assert.equal(writes,1);
  assert.equal((await app.inject({method:'GET',url:'/api/v1/assistant/conversations/foreign/imports'})).statusCode,404);
 }finally{await app.close();}
});

test('draft patches preserve source data and reset duplicate decisions on time changes',()=>{
 const rows=[{id:'r',title:'Test',date:'2035-02-14',startTime:'09:00',endTime:'10:00',selected:true,unresolvedFields:['startTime','employee'],duplicateDecision:'replace' as const,replacementId:'existing',overnightConfirmed:true}];
 const result=applyImportPatches(rows,[patch('r',{startTime:'11:00'})]);
 assert.equal(result[0].duplicateDecision,undefined);assert.equal(result[0].replacementId,undefined);assert.equal(result[0].overnightConfirmed,false);assert.deepEqual(result[0].unresolvedFields,['employee']);assert.equal(rows[0].startTime,'09:00');
 assert.throws(()=>applyImportPatches(rows,[patch('foreign',{selected:true})]),/unknown_import_rows/);
});

test('chat import tools reject foreign draft identifiers and cannot confirm calendar writes',async()=>{
 const result=await executeAssistantTool('import_prepare_changes',JSON.stringify({importId:'foreign',revision:1,changes:[patch('r',{selected:true})]}),{scope:{userId:'u',calendarId:'c'},conversationId:'chat',calendar:{checkConnection:async()=>{},getOverview:async()=>null,listChatImports:async()=>[]},ai:{createAction:async()=>{throw new Error('must not create calendar action');}},actionTtlMinutes:15});
 assert.equal(result.error,'chat_import_not_found');
});

test('draft can include a missing row with a server-assigned identifier',()=>{
 const result=applyImportPatches([{id:'original',title:'Test',date:'2035-02-14',startTime:'09:00',endTime:'10:00',selected:true,category:'Class'}],[{...patch('unused',{title:'Dodatkowy wpis',date:'2035-02-15',startTime:'11:00',endTime:'12:00'}),rowId:null}]);
 assert.equal(result.length,2);assert.notEqual(result[1].id,'original');assert.equal(result[1].selected,true);assert.deepEqual(result[1].unresolvedFields,[]);
});

test('quick import transfers corrected rows without extracting the image again',async()=>{
 const rows=[{id:'quick-row',title:'Poprawiony tytuł',date:'2035-02-14',startTime:'11:00',endTime:'12:00',selected:false,category:'Class' as const}];
 let bound=false;
 const app=buildApi({checkConnection:async()=>{},getOverview:async()=>null,createImportSession:async()=>{throw new Error('must reuse session');},
 bindChatImport:async(id,input)=>{assert.equal(id,'quick-session');assert.deepEqual(input.rows,rows);bound=true;return {...input,id,revision:1,status:'pending',summary:null,expiresAt:'2035-01-01T00:00:00Z'};}
 },[],{userScope:()=>({userId:'u',calendarId:'c'}),aiRepository:{getConversation:async()=>({id:'chat'}),appendMessage:async()=>({id:'message'})}as never});
 try{
 const image=(await sharp({create:{width:4,height:4,channels:3,background:'#ffffff'}}).png().toBuffer()).toString('base64');
 const result=await app.inject({method:'POST',url:'/api/v1/assistant/conversations/chat/attachments',payload:{fileName:'synthetic.png',dataBase64:image,source:'classes',reader:'ai',sessionId:'quick-session',rows}});
 assert.equal(result.statusCode,201,result.body);assert.equal(bound,true);
 }finally{await app.close();}
});

test('empty recognition retains the image and an editable empty draft without calendar events',async()=>{
 const messages:any[]=[];let sessions=0;
 const app=buildApi({checkConnection:async()=>{},getOverview:async()=>null,getImportUserName:async()=>'',createImportSession:async()=>{sessions++;return {id:'empty-session',expiresAt:new Date(Date.now()+900000)};},bindChatImport:async(id,input)=>({...input,id,revision:1,status:'pending',expiresAt:new Date(Date.now()+900000).toISOString(),summary:null})},[],{
  aiRepository:{getConversation:async()=>({id:'chat'}),appendMessage:async(_scope:any,_id:string,role:string,content:unknown)=>{messages.push({role,content});return {id:'image-message'};}}as never,
  aiService:{extractSchedule:async()=>({rows:[],usage:{inputTokens:1,outputTokens:1},responseId:'synthetic'}),sendAssistantMessage:async()=>{throw new Error('unused');}},
 });
 try{
 const image=(await sharp({create:{width:4,height:4,channels:3,background:'#ffffff'}}).png().toBuffer()).toString('base64');
 const result=await app.inject({method:'POST',url:'/api/v1/assistant/conversations/chat/attachments',payload:{fileName:'synthetic.png',dataBase64:image,source:'classes',reader:'ai'}});
 assert.equal(result.statusCode,201,result.body);assert.equal(sessions,1);assert.equal(messages.length,2);assert.ok(messages[0].content.attachment.thumbnailDataUrl);assert.deepEqual(result.json().rows,[]);
 }finally{await app.close();}
});

test('local OCR image pixels are not included in follow-up model context',async()=>{
 const messages:any[]=[{id:'local-image',role:'user',content:{text:'Import: local.png',attachment:{fileName:'local.png',mimeType:'image/png',thumbnailDataUrl:'data:image/jpeg;base64,c3ludGhldGlj',reader:'local'}},createdAt:new Date().toISOString()}];
 const app=buildApi({checkConnection:async()=>{},getOverview:async()=>null},[],{aiRepository:{getConversation:async()=>({id:'chat'}),listMessages:async()=>messages,listPendingActions:async()=>[],logUsage:async()=>{},appendMessage:async(_scope:any,_id:string,role:string,content:unknown)=>{const message={id:'m',role,content,createdAt:new Date().toISOString()};messages.push(message);return message;}}as never,
 aiService:{extractSchedule:async()=>{throw new Error('unused');},sendAssistantMessage:async(input)=>{assert.ok(input.every((item:any)=>!Array.isArray(item.content)||item.content.every((part:any)=>part.type!=='input_image')));return {output:[],output_text:'Omówmy odczytane dane.'}as never;}}});
 try{const result=await app.inject({method:'POST',url:'/api/v1/assistant/conversations/chat/messages',payload:{content:'Omów odczytane dane.'}});assert.equal(result.statusCode,200,result.body);}finally{await app.close();}
});
