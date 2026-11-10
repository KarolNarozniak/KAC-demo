import test from 'node:test';
import assert from 'node:assert/strict';
import { buildApi } from '../src/app.js';

test('blocks use v1 JSON schemas, explicit instants and server-selected ownership',async()=>{
  const owners:string[]=[];
  const block={id:'00000000-0000-4000-8000-000000000001',userId:'owner-test',title:'Synthetic break',startTime:'2026-11-09T08:00:00.000Z',endTime:'2026-11-09T12:00:00.000Z',type:'day_off' as const};
  const app=buildApi({checkConnection:async()=>{},getOverview:async()=>null,listBlocks:async user=>{owners.push(user!);return [block];},createBlock:async(input,user)=>{owners.push(user!);return {...block,...input};},deleteBlock:async(_id,user)=>{owners.push(user!);return user==='owner-test';}},[],{userScope:()=>({userId:'owner-test',calendarId:'calendar-test'})});
  try {
    const list=await app.inject({method:'GET',url:'/api/v1/blocks'});
    assert.equal(list.statusCode,200);assert.deepEqual(list.json(),[block]);
    const {id,userId,...input}=block;
    const create=await app.inject({method:'POST',url:'/api/v1/blocks',payload:input});
    assert.equal(create.statusCode,201);assert.equal(create.json().startTime,block.startTime);
    assert.equal((await app.inject({method:'POST',url:'/api/v1/blocks',payload:{...input,endTime:input.startTime}})).statusCode,422);
    assert.equal((await app.inject({method:'POST',url:'/api/v1/blocks',payload:{...input,startTime:'not-a-date'}})).statusCode,400);
    assert.equal((await app.inject({method:'DELETE',url:'/api/v1/blocks/'+id})).statusCode,204);
    assert.deepEqual(owners,['owner-test','owner-test','owner-test']);
    assert.equal((await app.inject({method:'GET',url:'/api/blocks'})).statusCode,404);
  } finally {await app.close();}
});
