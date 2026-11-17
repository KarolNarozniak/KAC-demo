import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
const out = process.argv[2] || 'artifacts/ui-review/latest';
await mkdir(out, {recursive:true});
const browser = await chromium.launch({executablePath: process.env.CHROMIUM_PATH || '/usr/lib/chromium/chromium', headless:true, args:['--no-sandbox','--lang=pl-PL','--disable-gpu'], timeout:15000});
const events = [
 ['1','Projektowanie aplikacji','2026-11-17T10:00:00','2026-11-17T11:30:00','Zajęcia','Sala 204'],
 ['2','Praca · Studio','2026-11-17T13:00:00','2026-11-17T17:00:00','Praca','Biuro'],
 ['3','Trening','2026-11-17T18:00:00','2026-11-17T19:00:00','Prywatne','Siłownia'],
 ['4','Analiza matematyczna','2026-11-18T09:00:00','2026-11-18T11:00:00','Zajęcia','Sala 112'],
 ['5','Praca · Studio','2026-11-19T12:00:00','2026-11-19T17:00:00','Praca','Biuro'],
].map(([id,title,start,end,category,location])=>({id,title,start,end,category,location,mandatory:category==='Zajęcia',repeatWeekly:false}));
const profile = {profileId:'synthetic',profileVersion:'1',timeZone:'Europe/Warsaw',mode:'elastyczny',targetPeriod:'week',minimumHours:12,targetHours:20,maximumHours:30,commuteBufferMinutes:30,minimumRestMinutes:660,minimumShiftMinutes:120,maximumSlotMinutes:480,maxHoursPerDay:8,hourlyRatePln:32,rateKind:'net',commuteConfigured:true,targetMinutes:1200,weeklyTargetHours:20,weeklyTargetMinutes:1200,availability:[1,2,3,4,5].map(dayOfWeek=>({id:String(dayOfWeek),dayOfWeek,startTime:'08:00',endTime:'20:00'})),preferredWorkWindows:[],blockedPeriods:[],shiftTemplates:[]};
const conv={id:'demo-chat',title:'Plan mojego tygodnia',createdAt:'2026-11-17T08:00:00Z',updatedAt:'2026-11-17T08:00:00Z',expiresAt:'2026-12-17T08:00:00Z'};
const errors=[];
const checks=[];
try {
for (const [device,viewport] of [['desktop',{width:1440,height:1000}],['mobile',{width:390,height:844}]]) {
 const context=await browser.newContext({viewport,deviceScaleFactor:1,locale:'pl-PL',timezoneId:'Europe/Warsaw',isMobile:device==='mobile',hasTouch:device==='mobile'});
 let scheduleFixtureEnabled=false;
 const sentMessages=[];
 const calendarEvents=structuredClone(events);
 const page=await context.newPage();
 page.on('pageerror',e=>{errors.push(`${device}: ${e.message}`);console.log('PAGE ERROR',e.message);});
 await page.clock.install({time:new Date('2026-11-17T08:15:00Z')});
 await page.route('**/api/v1/**', async route=>{
  const p=new URL(route.request().url()).pathname; let body={};let status=200;
  if(p.endsWith('/calendar/overview')) body={events:calendarEvents};
  else if(p.endsWith('/calendar/events')&&route.request().method()==='POST'){body={...route.request().postDataJSON(),id:'synthetic-new-event'};calendarEvents.push({...body,category:{Class:'Zajęcia',Work:'Praca',Personal:'Prywatne'}[body.category]});}
  else if(p.endsWith('/work-profile')) body=profile;
  else if(p.endsWith('/blocks')) body=[{id:'block1',userId:'synthetic',title:'Weekend poza miastem',type:'vacation',startTime:'2026-11-21T08:00:00Z',endTime:'2026-11-22T20:00:00Z'}];
  else if(p.endsWith('/notifications/settings')) body={enabled:false,workRemindersEnabled:true,classReminders:true,privateReminders:true,minutesBefore:30,pendingReminderCount:0};
  else if(p.endsWith('/notifications/push-config')) body={enabled:false};
  else if(p==='/api/v1/integrations/google') body={mode:'demo',ready:true,problem:null,status:'not_connected',account:null,requestedAccess:{calendarsRead:true,eventsWrite:true},demoAccounts:['student@example.invalid']};
  else if(p.startsWith('/api/v1/integrations/google/imported-events/')){status=404;body={error:'not_imported'};}
  else if(p.startsWith('/api/v1/integrations/google/publications/')) body={items:[]};
  else if(p.endsWith('/assistant/config')) body={enabled:true};
  else if(p.endsWith('/import/google/status')) body={configured:false,connected:false};
  else if(p.endsWith('/assistant/conversations')) body=route.request().method()==='POST'?conv:{conversations:[conv,...['Nauka przed kolokwium','Plan pracy na weekend','Wydarzenia na środę','Czas na odpoczynek','Przygotowanie do zajęć','Praca w piątek','Przerwa między zajęciami','Planowanie nauki','Wolne popołudnie','Dojazd do pracy','Podsumowanie dnia','Terminy zaliczeń'].map((title,i)=>({...conv,id:`demo-chat-${i+2}`,title}))]};
  else if(p.endsWith('/messages')&&new URL(route.request().url()).searchParams.get('stream')==='true') {
    const content=route.request().postDataJSON().content;sentMessages.push(content);
    const result={conversationId:conv.id,message:{role:'assistant',content:'Mogę przygotować propozycję nauki po zajęciach. Sprawdzisz ją przed zapisaniem.'},pendingActions:[],usage:{inputTokens:10,outputTokens:12}};
    await route.fulfill({status:200,contentType:'application/x-ndjson',body:JSON.stringify({type:'accepted',message:{id:'sent-message',role:'user',content:{text:content},createdAt:'2026-11-17T08:16:00Z'}})+'\n'+JSON.stringify({type:'done',result})+'\n'});return;
  }
  else if(p.endsWith('/messages')) body=route.request().method()==='POST'?{message:{content:'Dziś masz zajęcia o 10:00, pracę od 13:00 do 17:00 i trening o 18:00. Między zajęciami a pracą zostaje półtorej godziny na przerwę.'},pendingActions:[]}:{messages:[{id:'m1',role:'user',content:{text:'Pomóż mi zaplanować tydzień z czasem na naukę i pracę.'},createdAt:'2026-11-17T08:10:00Z'},{id:'m2',role:'assistant',content:{text:'Jasne! We wtorek masz zajęcia od 10:00 do 11:30 i pracę od 13:00 do 17:00. Na naukę proponuję środowe popołudnie. Czy przygotować wydarzenie w kalendarzu?'},createdAt:'2026-11-17T08:11:00Z'}],pendingActions:[]};
  else if(p.endsWith('/imports')) body={imports:[]};
  else if(p==='/api/v1/schedules') body={items:[],total:0,limit:20,offset:0};
  else if(p.startsWith('/api/v1/schedules/')) {
   if(scheduleFixtureEnabled) body={scheduleId:'synthetic-schedule',version:1,isApproved:false,workflowStatus:'proposed',maximumCapacityMinutes:2400,weekStart:'2026-11-16',timeZone:'Europe/Warsaw',mode:'elastyczny',solutionStatus:'target_met',minimumMinutes:720,targetMinutes:1200,maximumMinutes:1800,existingWorkMinutes:540,proposedMinutes:660,totalMinutes:1200,shortfallMinutes:0,optionalLecturesSkipped:[],parameters:{workaholic:false},violations:[],blockingEvents:events.filter(event=>event.category==='Zajęcia').map(event=>({eventId:event.id,title:event.title,category:'Class',mandatory:true,repeatWeekly:false,start:event.start,end:event.end,startLocal:event.start.slice(0,16),endLocal:event.end.slice(0,16),effect:'hard',bufferMinutes:30})),freeWindows:[],freeMinutes:1800,estimatedPayPln:352,shifts:[['2026-11-16','11:00','15:00',240],['2026-11-18','13:00','16:00',180],['2026-11-20','09:00','13:00',240]].map(([day,start,end,minutes],i)=>({candidateId:`shift-${i}`,title:'Praca',start:`${day}T${start}:00+01:00`,end:`${day}T${end}:00+01:00`,startLocal:`${day}T${start}`,endLocal:`${day}T${end}`,durationMinutes:minutes,workDate:day,mode:'elastyczny',optionalLectureIds:[],softPenalty:0,hourlyRatePln:32,rateKind:'net',estimatedPayPln:minutes/60*32}))};
   else {status=404;body={error:'not_found'};}
  }
  await route.fulfill({status,json:body});
 });
 await page.goto(process.env.UI_URL || 'http://localhost:8080');await page.waitForTimeout(1200);await page.screenshot({path:`${out}/${device}-startup.png`});
 const navigate=async tab=>{
   const target=page.getByRole('tab').filter({has:page.getByText(tab,{exact:true})});
   if(await target.count()) await target.click();
   else { await page.getByRole('button',{name:'Menu',exact:true}).click();await page.getByRole('menuitem',{name:tab,exact:true}).click(); }
   await page.waitForTimeout(300);
 };
 const shot=async name=>{const only=process.argv[3]||process.env.UI_CAPTURE_ONLY;if(only&&!only.split(',').includes(name))return;console.log(device,name);await page.waitForTimeout(450);if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)) throw new Error(`${device}/${name}: document overflows viewport`);await page.screenshot({path:`${out}/${device}-${name}.png`});};
 const routes=process.argv[4]==='chat'?[['Asystent','assistant']]:[['Dziś','today'],['Tydzień','week'],['Grafik','schedule'],['Blokady','blocks'],['Ustawienia','settings'],['Asystent','assistant']];
 for(const [tab,name] of routes){
  await navigate(tab);await shot(name);if(name==='blocks'){await page.getByRole('button',{name:'Dodaj blokadę',exact:true}).click();await shot('blocks-form');}
  if(name==='schedule'){
   await page.getByRole('button',{name:'Edytuj profil',exact:true}).click();await shot('work-profile');
   for(const [section,slug] of [['Stawka i tryb pracy','pay'],['Cel i limity godzin','hours'],['Dojazd i odpoczynek','rest'],['Dostępność w tygodniu','availability'],['Preferowane godziny pracy','preferences']]){
    const toggle=page.getByRole('button',{name:section,exact:true});await toggle.click();await page.waitForTimeout(400);await toggle.scrollIntoViewIfNeeded();await shot(`profile-${slug}`);if(slug==='rest'){const hours=page.getByLabel('Minimalny odpoczynek – godziny',{exact:true});await hours.fill('10');await page.getByRole('button',{name:'Anuluj zmiany',exact:true}).click();if(await hours.inputValue()!=='11')throw new Error('Duration editing/cancellation failed');checks.push(`${device}: hour/minute duration editing preserves profile cancellation`);}if(slug==='availability'){await page.getByRole('button',{name:'Wtorek',exact:true}).click();await page.mouse.move(viewport.width/2,viewport.height/2);await page.mouse.wheel(0,100);await shot('profile-availability-day');}await toggle.scrollIntoViewIfNeeded();await toggle.click();
   }
  }
  if(name==='week'&&device==='mobile'){await page.getByRole('button',{name:/środa, 18/}).click();await shot('week-selected-day');await page.mouse.move(viewport.width/2,viewport.height/2);await page.mouse.wheel(0,3);await shot('week-boundary-3px');await page.mouse.wheel(0,7);await shot('week-boundary-10px');}
  if(name==='schedule') await page.getByRole('button',{name:'Wróć do planu',exact:true}).click();
  if(['schedule','settings','blocks','week'].includes(name)){
   await page.mouse.move(viewport.width/2,viewport.height/2);await page.mouse.wheel(0,650);await shot(`${name}-lower`);await page.mouse.wheel(0,20000);await shot(`${name}-bottom`);await page.mouse.wheel(0,-30000);await page.waitForTimeout(400);

  }
 }
 if(device==='mobile'){await page.getByRole('button',{name:'Historia rozmów',exact:true}).click();await shot('assistant-history');const historyBefore=await page.getByRole('button',{name:'Nowa rozmowa',exact:true}).boundingBox();await page.getByTestId('conversation-history').evaluate(node=>{node.scrollTop=node.scrollHeight;});await page.waitForTimeout(200);const historyAfter=await page.getByRole('button',{name:'Nowa rozmowa',exact:true}).boundingBox();if(Math.abs(historyBefore.y-historyAfter.y)>1||Math.abs(historyBefore.height-historyAfter.height)>1)throw new Error('History layout moved at scroll end');await shot('assistant-history-bottom');checks.push('mobile: history layout stays fixed at scroll boundary');await page.getByRole('button',{name:'Zamknij historię',exact:true}).click();await page.waitForTimeout(300);}
 const composer=page.getByLabel('Wiadomość do asystenta',{exact:true});const cb=await composer.boundingBox();const sb=await page.getByRole('button',{name:'Wyślij wiadomość',exact:true}).boundingBox();const ab=await page.getByRole('button',{name:'Importuj zdjęcie lub plik',exact:true}).boundingBox();if(Math.max(cb.y,sb.y,ab.y)-Math.min(cb.y,sb.y,ab.y)>1||Math.max(cb.height,sb.height,ab.height)-Math.min(cb.height,sb.height,ab.height)>1)throw new Error('Composer controls are not aligned');const plus=await page.getByTestId('attachment-add-icon').boundingBox();if(Math.abs(ab.x+ab.width/2-plus.x-plus.width/2)>0.5||Math.abs(ab.y+ab.height/2-plus.y-plus.height/2)>0.5)throw new Error('Attachment plus is not centered');checks.push(`${device}: composer controls align and attachment plus is centered`);
 if(device==='mobile'){
   await composer.click();await page.waitForTimeout(100);
   await page.evaluate(()=>{Object.defineProperty(window.visualViewport,'height',{configurable:true,value:500});Object.defineProperty(window.visualViewport,'offsetTop',{configurable:true,value:40});window.visualViewport.dispatchEvent(new Event('resize'));});
   await page.waitForTimeout(200);
   let box=await composer.boundingBox();if(box.y<40||box.y+box.height>540||await page.getByRole('tab').count())throw new Error('Composer hidden by visual-only keyboard viewport');
   await shot('assistant-keyboard-visual');
   await page.evaluate(()=>{delete window.visualViewport.height;delete window.visualViewport.offsetTop;window.visualViewport.dispatchEvent(new Event('resize'));});
   await page.setViewportSize({width:viewport.width,height:500});await page.waitForTimeout(200);
   box=await composer.boundingBox();if(box.y+box.height>500||await page.getByRole('tab').count())throw new Error('Composer hidden by resized keyboard viewport');
   await shot('assistant-keyboard-resized');
   await page.setViewportSize(viewport);await page.waitForTimeout(200);if(await page.getByRole('tab').count()!==4)throw new Error('Navigation did not return after keyboard closed');
   const placeholder=await composer.evaluate(node=>getComputedStyle(node,'::placeholder').color);if(placeholder==='rgb(0, 0, 0)')throw new Error('Unreadable black composer placeholder');
   checks.push('mobile: composer remains visible with visual-only and resized keyboard viewports; navigation returns on close; placeholder has theme color');
 }
 await composer.fill('Zaplanuj naukę w środę.');await composer.press('Shift+Enter');await composer.type('Po zajęciach.');if(sentMessages.length) throw new Error('Shift+Enter submitted message');const sent=page.waitForResponse(r=>r.url().includes('stream=true'));await composer.press('Enter');await sent;await page.waitForTimeout(300);if(sentMessages.length!==1||!sentMessages[0].includes('\n')||await composer.inputValue()) throw new Error('Enter submission failed');checks.push(`${device}: Enter sends once, Shift+Enter inserts newline, composer clears`);
 if(process.argv[4]==='chat'){await context.close();continue;}
 await page.getByRole('button',{name:'Importuj zdjęcie lub plik',exact:true}).click();await shot('assistant-attachment');await page.getByRole('button',{name:'Anuluj',exact:true}).click();
 if(device==='mobile'){if((await page.getByRole('tab').allTextContents()).join('|')!=='Dziś|Tydzień|Asystent|Grafik')throw new Error('Expected four mobile tabs');await page.getByRole('button',{name:'Menu',exact:true}).click();await shot('menu');await page.getByRole('button',{name:'Zamknij menu',exact:true}).click();checks.push('mobile: four primary tabs, secondary pages in hamburger');}
 await navigate('Tydzień');if(device==='mobile'){const fab=page.getByRole('button',{name:'Dodaj wydarzenie',exact:true});const box=await fab.boundingBox();if((await fab.innerText()).trim()!=='+'||box.x<viewport.width-100||box.y<viewport.height-170)throw new Error('Mobile add action is not an unlabeled bottom-right plus');checks.push('mobile: add action is bottom-right plus');}await page.getByRole('button',{name:'Dodaj wydarzenie',exact:true}).click();await shot('event-form');
 await page.getByLabel('DATA',{exact:true}).fill('2026-11-18');await page.getByLabel('POCZĄTEK',{exact:true}).fill('14:30');
 if(!await page.getByText('18.11.2026',{exact:true}).count() || !await page.getByText('14:30',{exact:true}).count()) throw new Error('Polish picker display did not update');
 checks.push(`${device}: native date/time controls update visible localized values`);
 await page.getByRole('button',{name:'Anuluj',exact:true}).click();
 for(const [button,name] of [['Szybki import planu','import-classes'],['Szybki import grafiku pracy','import-work'],['Importuj z Google Calendar','import-google']]){
  await page.getByRole('button',{name:'Importuj',exact:true}).click();await shot('import-sources');await page.getByRole('button',{name:button,exact:true}).click();await shot(name);
  const close=page.getByRole('button',{name:/Anuluj|Zamknij/}).last();await close.click();
 }
 scheduleFixtureEnabled=true;
 await navigate('Grafik');await shot('schedule-proposal');
 await page.mouse.move(viewport.width/2,viewport.height/2);await page.mouse.wheel(0,650);await shot('schedule-proposal-shifts');await page.mouse.wheel(0,20000);await shot('schedule-proposal-bottom');
 await navigate('Dziś');
 await page.getByRole('button',{name:'Projektowanie aplikacji, 10:00–11:30',exact:true}).click();await shot('event-details');
 await page.getByRole('button',{name:'Usuń wydarzenie',exact:true}).click();await shot('event-delete-confirmation');await page.getByRole('button',{name:'Anuluj',exact:true}).click();await page.getByRole('button',{name:'Zamknij',exact:true}).click();
 checks.push(`${device}: event details and deletion cancellation reachable`);
 await page.getByRole('button',{name:'Dodaj wydarzenie',exact:true}).click();await page.getByLabel('TYTUŁ WYDARZENIA',{exact:true}).fill('Nauka w bibliotece');await page.getByLabel('POCZĄTEK',{exact:true}).fill('20:00');await page.getByLabel('KONIEC',{exact:true}).fill('20:30');await page.getByRole('button',{name:'Zapisz wydarzenie',exact:true}).click();await page.waitForTimeout(300);if(await page.getByText('Zapisano bez kolizji.',{exact:true}).count()||!await page.getByRole('button',{name:'Nauka w bibliotece, 20:00–20:30',exact:true}).count())throw new Error('Successful event creation did not update agenda cleanly');checks.push(`${device}: event creation updates agenda without redundant success banner`);
 await context.close();
}
await writeFile(`${out}/browser-errors.json`,JSON.stringify({errors,checks},null,2));
} finally { await browser.close(); }
if(errors.length) throw new Error(errors.join('\n'));
console.log(out);
