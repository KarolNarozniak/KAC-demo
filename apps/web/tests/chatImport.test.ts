import assert from 'node:assert/strict';
import test from 'node:test';
import {attachChatImport,confirmChatImport,type ChatImportDraft} from '../src/services/chatImportApi.ts';
test('quick import handoff preserves original file, corrected rows and selected flags; confirmation sends only the reviewed revision',async()=>{
 const originalFetch=globalThis.fetch,originalUrl=process.env.EXPO_PUBLIC_API_URL;
 process.env.EXPO_PUBLIC_API_URL='http://localhost:4000';
 const rows=[{id:'row',title:'Poprawiony tytuł testowy',category:'Class' as const,date:'2035-01-01',startTime:'11:00',endTime:'12:00',selected:false}];
 const draft:ChatImportDraft={id:'session',conversationId:'chat',fileName:'test.png',mimeType:'image/png',thumbnailDataUrl:null,reader:'ai',source:'classes',rows,revision:3,status:'pending',expiresAt:'2035-01-01T00:00:00Z',summary:null};
 let calls=0;
 globalThis.fetch=async(url,init)=>{
  const body=JSON.parse(String(init?.body));calls++;
  if(String(url).endsWith('/attachments')){assert.deepEqual(body,{fileName:'test.png',dataBase64:'c3ludGhldGlj',source:'classes',reader:'ai',sessionId:'session',rows});return new Response(JSON.stringify(draft),{status:201});}
  assert.match(String(url),/assistant\/imports\/session\/confirm$/);assert.deepEqual(body,{conversationId:'chat',revision:3});
  return new Response(JSON.stringify({status:'confirmed',import:{...draft,status:'confirmed'}}));
 };
 try{
  const attached=await attachChatImport('chat',{file:{name:'test.png',base64:'c3ludGhldGlj',size:9},source:'classes',reader:'ai',sessionId:'session',rows});
  assert.equal(attached.rows[0].startTime,'11:00');assert.equal(attached.rows[0].selected,false);
  assert.equal((await confirmChatImport(attached)).status,'confirmed');assert.equal(calls,2);
 }finally{globalThis.fetch=originalFetch;if(originalUrl===undefined)delete process.env.EXPO_PUBLIC_API_URL;else process.env.EXPO_PUBLIC_API_URL=originalUrl;}
});
