export type Interval={dayOfWeek:number;startTime:string;endTime:string};
export type WorkProfile={version:number;hourlyRatePln:number|null;rateKind:'gross'|'net'|null;commuteMinutes:number|null;minRestMinutes:number;minHours:number|null;targetHours:number|null;maxHours:number|null};
export type Availability={version:number;intervals:Interval[]};
export const formatPln=(amount:number)=>new Intl.NumberFormat('pl-PL',{style:'currency',currency:'PLN'}).format(amount);
export async function workRequest(path:string,body?:unknown,method='PUT') {
  const base=process.env.EXPO_PUBLIC_API_URL?.trim().replace(/\/$/,'') || (['localhost','127.0.0.1'].includes(globalThis.location?.hostname) ? 'http://localhost:4000' : '');
  if(!base) throw new Error('Brak konfiguracji adresu API.');
  const r=await fetch(`${base}/api/${path}`,{method:body===undefined?'GET':method,headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
  const data=await r.json();
  if(!r.ok) throw new Error(data.error==='version_conflict'?'Profil zmieniono w innym oknie. Wczytaj ponownie przed zapisem.':`${data.error}${data.details ? ': '+JSON.stringify(data.details):''}`);
  return data;
}
export const getWorkProfile=():Promise<WorkProfile>=>workRequest('work-profile');
export const saveWorkProfile=(p:WorkProfile):Promise<WorkProfile>=>workRequest('work-profile',p);
export const getAvailability=():Promise<Availability>=>workRequest('work-profile/availability');
export const saveAvailability=(a:Availability):Promise<Availability>=>workRequest('work-profile/availability',a);
