import {test} from 'node:test';
import assert from 'node:assert/strict';
import {normalizeAvailability} from '../src/profile/availability.js';
import {calculatePay,rateGrosz} from '../src/scheduling/pay.js';
import {buildApi} from '../src/app.js';
test('availability splits Sunday night without losing midnight; touching allowed',()=>{
 assert.deepEqual(normalizeAvailability([{dayOfWeek:7,startTime:'22:00',endTime:'02:00'}]),[{dayOfWeek:1,startTime:'00:00',endTime:'02:00'},{dayOfWeek:7,startTime:'22:00',endTime:'24:00'}]);
 assert.equal(normalizeAvailability([{dayOfWeek:1,startTime:'08:00',endTime:'09:00'},{dayOfWeek:1,startTime:'09:00',endTime:'10:00'}]).length,2);
 assert.deepEqual(normalizeAvailability([]),[]);
});
test('overlap rejected at repository boundary, editor may merge',()=>{
 const rows=[{dayOfWeek:1,startTime:'08:00',endTime:'10:00'},{dayOfWeek:1,startTime:'09:00',endTime:'11:00'}];
 assert.throws(()=>normalizeAvailability(rows),/availability_overlap/);assert.equal(normalizeAvailability(rows,true)[0]?.endTime,'11:00');
 for(const startTime of ['24:00','25:00','08:60','8:00'])assert.throws(()=>normalizeAvailability([{dayOfWeek:1,startTime,endTime:'12:00'}]));
});
test('pay integer half-up, partial hours, zero, null, precision and DST',()=>{
 const pay=(rate:number|null,minutes:number)=>calculatePay(rate,'2026-01-01T00:00:00Z',new Date(Date.parse('2026-01-01T00:00:00Z')+minutes*60000).toISOString()).payGrosz;
 assert.equal(pay(30,1200),60000);assert.equal(pay(30,30),1500);assert.equal(pay(30,45),2250);assert.equal(pay(30,61),3050);assert.equal(pay(.01,30),1);assert.equal(pay(.01,30)*2,2);assert.equal(pay(0,61),0);
 assert.throws(()=>rateGrosz(1.001),/invalid_hourly_rate/);assert.throws(()=>rateGrosz(-1));assert.throws(()=>rateGrosz(10000000000));assert.throws(()=>pay(null,30),/profile_incomplete/);
 assert.equal(calculatePay(30,'2026-03-29T01:00:00+01:00','2026-03-29T04:00:00+02:00').durationMinutes,120);
 assert.equal(calculatePay(30,'2026-10-25T01:00:00+02:00','2026-10-25T04:00:00+01:00').durationMinutes,240);
});
test('routes validate availability, conflict and profile precision',async()=>{
 let version=1;let intervals:any[]=[];
 const repo={getProfile:async()=>({version}),listAvailability:async()=>({version,intervals}),replaceAvailability:async(_u:string,rows:any[],v:number)=>{if(v!==version){const {ProfileError}=await import('../src/profile/availability.js');throw new ProfileError('version_conflict',409);} intervals=normalizeAvailability(rows);return {version:++version,intervals};},saveProfile:async(_u:string,p:any)=>p};
 const app=buildApi(null,[],{workProfile:repo as any});
 try {
 assert.equal((await app.inject({method:'GET',url:'/api/work-profile/availability'})).statusCode,200);
 const put=(payload:any)=>app.inject({method:'PUT',url:'/api/work-profile/availability',payload});
 assert.equal((await put({version:1,intervals:[]})).statusCode,200);
 assert.equal((await put({version:1,intervals:[]})).statusCode,409);
 assert.equal((await put({version:2,intervals:[{dayOfWeek:0,startTime:'08:00',endTime:'09:00'}]})).statusCode,400);
 assert.equal((await put({version:2,intervals:[{dayOfWeek:1,startTime:'08:00',endTime:'10:00'},{dayOfWeek:1,startTime:'09:00',endTime:'11:00'}]})).statusCode,422);
 assert.equal((await app.inject({method:'PUT',url:'/api/work-profile',payload:{version:1,hourlyRatePln:1.001,rateKind:'gross',commuteMinutes:0,minRestMinutes:0,minHours:null,targetHours:null,maxHours:null}})).statusCode,422);
 }finally{await app.close();}
});
