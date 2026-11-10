import test from 'node:test';
import assert from 'node:assert/strict';
import {readdir,readFile} from 'node:fs/promises';
import {Pool} from 'pg';
import {config} from '../src/config.js';
import {buildApi} from '../src/app.js';
import {PostgresWorkProfileRepository} from '../src/profile/repository.js';
import {PostgresScheduleRepository} from '../src/scheduling/repository.js';
import {PostgresCalendarRepository} from '../src/database.js';

test('one canonical profile and planner: availability rollback, pay snapshots, monthly target, blocks and old history',{skip:!config.databaseUrl},async()=>{
 const schema='audit_unified_'+Date.now(),scope={userId:config.demoUserId,calendarId:config.demoCalendarId};
 const admin=new Pool({connectionString:config.databaseUrl,connectionTimeoutMillis:3000});
 const pool=new Pool({connectionString:config.databaseUrl,options:`-c search_path=${schema}`,connectionTimeoutMillis:3000});
 let app:ReturnType<typeof buildApi>|undefined;
 try{
  await admin.query(`create schema ${schema}`);
  for(const file of(await readdir(new URL('../../../database/migrations/',import.meta.url))).filter(file=>file.endsWith('.sql')).sort())await pool.query(await readFile(new URL('../../../database/migrations/'+file,import.meta.url),'utf8'));
  await pool.query(`insert into t_uzytkownicy(id_uzytkownika,imie,nazwisko,email) values($1,'Owner','Test','owner@example.test'),('other','Other','Test','other@example.test')`,[scope.userId]);
  await pool.query(`insert into t_kalendarze(id_kalendarza,id_uzytkownika,nazwa,typ) values($1,$2,'Test','Osobisty')`,[scope.calendarId,scope.userId]);
  await pool.query(`insert into t_kategorie(id_kategorii,nazwa,kolor_hex) values('work','Praca','#000000'),('class','Zajęcia','#000000')`);
  await pool.query(`insert into t_profile_pracy(id_profilu,id_uzytkownika) values('profile',$1)`,[scope.userId]);
  const profiles=new PostgresWorkProfileRepository(pool),schedules=new PostgresScheduleRepository(pool),calendar=new PostgresCalendarRepository(pool);
  app=buildApi(calendar,[],{workProfileRepository:profiles,scheduleRepository:schedules,userScope:()=>scope});
  const request=(method:string,url:string,payload?:any)=>app!.inject({method:method as any,url,payload});
  const initial=(await request('GET','/api/v1/work-profile')).json();
  const input={...initial,minimumHours:0,targetHours:20,maximumHours:30,commuteBufferMinutes:30,minimumRestMinutes:0,minimumShiftMinutes:120,maximumSlotMinutes:360,maxHoursPerDay:8,hourlyRatePln:30,rateKind:'gross',availability:[1,2,3].map(dayOfWeek=>({id:'day-'+dayOfWeek,dayOfWeek,startTime:'08:00',endTime:'18:00'}))};
  const saved=await request('PUT','/api/v1/work-profile',input);assert.equal(saved.statusCode,200,saved.body);assert.equal(saved.json().hourlyRatePln,30);
  const a=await profiles.listAvailability(scope);assert.deepEqual((await request('GET','/api/v1/work-profile/availability')).json(),a);
  await pool.query(`create function fail_insert() returns trigger language plpgsql as $$ begin if NEW.od_godzina='13:00' then raise exception 'forced insert failure'; end if; return NEW; end $$;create trigger test_failure before insert on t_dostepnosc for each row execute function fail_insert()`);
  await assert.rejects(profiles.replaceAvailability(scope,[{dayOfWeek:1,startTime:'08:00',endTime:'09:00'},{dayOfWeek:1,startTime:'13:00',endTime:'14:00'}],a.version),/forced insert failure/);
  assert.deepEqual(await profiles.listAvailability(scope),a);await pool.query('drop trigger test_failure on t_dostepnosc');
  const racing=await Promise.allSettled([profiles.replaceAvailability(scope,a.intervals,a.version),profiles.replaceAvailability(scope,a.intervals,a.version)]);assert.equal(racing.filter(result=>result.status==='fulfilled').length,1);
  const newer=await profiles.listAvailability(scope);assert.equal((await request('PUT','/api/v1/work-profile/availability',{version:a.version,intervals:[]})).statusCode,409);assert.equal((await request('PUT','/api/v1/work-profile/availability',{version:newer.version,intervals:[],extra:true})).statusCode,400);assert.equal((await request('PUT','/api/v1/work-profile/availability',{version:newer.version,intervals:[{dayOfWeek:1,startTime:'08:00',endTime:'10:00'},{dayOfWeek:1,startTime:'09:00',endTime:'11:00'}]})).statusCode,422);
  await assert.rejects(profiles.replaceAvailability({userId:'other',calendarId:scope.calendarId},[],1),/profile_not_found/);
  const generate=async(weekStart:string)=>{
   const current=(await request('GET','/api/v1/work-profile')).json();
   const result=await request('POST','/api/v1/schedules/generate',{weekStart,profileVersion:current.profileVersion,confirmNoClasses:true});assert.equal(result.statusCode,201,result.body);return result.json();
  };
  const proposal=await generate('2026-11-02');assert.equal(proposal.proposedMinutes,1200);assert.equal(proposal.estimatedPayPln,600);
  const approve=await request('POST','/api/v1/schedules/2026-11-02/approve',{expectedVersion:proposal.version});assert.equal(approve.statusCode,200,approve.body);
  const history=await schedules.getScheduleById(proposal.scheduleId);
  const current=(await request('GET','/api/v1/work-profile')).json();
  const month=await request('PUT','/api/v1/work-profile',{...current,targetPeriod:'month',targetHours:100,hourlyRatePln:99,rateKind:'net'});assert.equal(month.statusCode,200,month.body);assert.equal(month.json().weeklyTargetHours,23.08);
  assert.deepEqual(await schedules.getScheduleById(proposal.scheduleId),history);
  const preserve=await request('PUT','/api/v1/work-profile',{...month.json(),hourlyRatePln:41});assert.equal(preserve.statusCode,200,preserve.body);assert.equal(preserve.json().targetPeriod,'month');assert.equal(preserve.json().targetHours,100);
  const {hourlyRatePln:_rate,rateKind:_kind,...oldClient}=preserve.json();
  const oldSave=await request('PUT','/api/v1/work-profile',oldClient);assert.equal(oldSave.statusCode,200,oldSave.body);assert.equal(oldSave.json().hourlyRatePln,41);assert.equal(oldSave.json().rateKind,'net');
  const fresh=await generate('2026-11-16');const first=fresh.shifts[0];
  const block=await calendar.createBlock({title:'Synthetic session',startTime:first.start,endTime:first.end,type:'exam_session'},scope.userId);
  const failed=await request('POST','/api/v1/schedules/2026-11-16/approve',{expectedVersion:fresh.version});assert.equal(failed.statusCode,422,failed.body);
  assert.equal((await schedules.getScheduleById(fresh.scheduleId))!.isApproved,false);
  const other=await calendar.createBlock({title:'Foreign block',startTime:first.start,endTime:first.end,type:'day_off'},'other');assert.equal(await calendar.deleteBlock(other.id,scope.userId),false);
  assert.deepEqual((await calendar.listBlocks(scope.userId)).map(block=>block.id),[block.id]);assert.ok(!(await profiles.getProfile(scope))!.blockedPeriods.some(period=>period.id===block.id));
  await calendar.deleteBlock(block.id,scope.userId);
  const beforeCount=(await pool.query('select count(*)::int as n from t_wydarzenia')).rows[0].n;
  assert.equal((await request('POST','/api/v1/schedules/2026-11-16/reject',{expectedVersion:fresh.version})).statusCode,200);assert.equal((await pool.query('select count(*)::int as n from t_wydarzenia')).rows[0].n,beforeCount);
  // Legacy records are readable in the existing history, never recalculated or deleted.
  await pool.query(`insert into t_grafiki(id_grafiku,id_profilu,id_kalendarza,tydzien_od,tydzien_do,status,cel_godzin,plan_godzin,szac_placa_pln,czy_osiagalny,generator_version) values('old','profile',$1,'2026-09-07','2026-09-13','Accepted',1,1,30,true,'work-profile-v1')`,[scope.calendarId]);
  await pool.query(`insert into t_zmiany_pracy(id_zmiany,id_grafiku,rozpoczecie,zakonczenie,godziny,stawka_pln,wynagrodzenie_pln,rodzaj_stawki,status) values('old-shift','old','2026-09-07T08:00Z','2026-09-07T09:00Z',1,30,30,'gross','Accepted')`);
  const old=await request('GET','/api/v1/schedules/id/old');assert.equal(old.statusCode,200,old.body);assert.equal(old.json().isApproved,true);assert.equal(old.json().proposedMinutes,60);assert.equal(old.json().estimatedPayPln,30);assert.equal(old.json().shifts[0].hourlyRatePln,30);
  const list=await schedules.listSchedules({from:'2026-09-07',to:'2026-09-13',limit:20,offset:0});assert.equal(list.items[0]?.scheduleId,'old');assert.equal(list.items[0]?.isApproved,true);
  assert.equal((await request('POST','/api/v1/work-profile/schedules/generate',{week:'2026-11-02'})).statusCode,410);
  assert.equal((await request('PUT','/api/v1/work-profile/compensation',{})).statusCode,410);
  const updated=await profiles.listAvailability(scope);
  const night=await profiles.replaceAvailability(scope,[{dayOfWeek:7,startTime:'22:00',endTime:'02:00'}],updated.version);assert.deepEqual(night.intervals,[{dayOfWeek:1,startTime:'00:00',endTime:'02:00'},{dayOfWeek:7,startTime:'22:00',endTime:'24:00'}]);
  const empty=await profiles.replaceAvailability(scope,[],night.version);assert.deepEqual(empty.intervals,[]);
 }finally{await app?.close();await pool.end();await admin.query(`drop schema if exists ${schema} cascade`);await admin.end();}
});
