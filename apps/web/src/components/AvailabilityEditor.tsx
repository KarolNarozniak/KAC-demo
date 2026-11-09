import type {BlockingEvent} from '../services/scheduleApi';
import React,{useEffect,useMemo,useState} from 'react';
import {View,Text,Pressable} from 'react-native';
import {Button,useTheme} from './ui';
import TimeField from './TimeField';
import {mergeAvailability,subtractMandatory,mandatoryWeeklyIntervals,type Interval} from '../domain/availability';
import type {AvailabilityWindow} from '../services/workProfileApi';
const days=['Poniedziałek','Wtorek','Środa','Czwartek','Piątek','Sobota','Niedziela'];
/** Controlled part of Karol's profile form: never sends a separate save request. */
export default function AvailabilityEditor({value,saved,targetHours,blockingEvents,messages={},disabled=false,onChange}:{value:AvailabilityWindow[];saved:AvailabilityWindow[];targetHours:number|null;blockingEvents?:BlockingEvent[];messages?:Record<string,string>;disabled?:boolean;onChange:(value:AvailabilityWindow[])=>void}){
 const {styles,palette}=useTheme();const [targets,setTargets]=useState<number[]>([]);const blocked=useMemo(()=>mandatoryWeeklyIntervals((blockingEvents??[]).map(event=>({category:event.category,mandatory:event.mandatory,repeatWeekly:event.repeatWeekly,start:event.startLocal,end:event.endLocal}))),[blockingEvents]);const [preview,setPreview]=useState<Interval[]|null>(null);const [error,setError]=useState('');
 useEffect(()=>setPreview(null),[blockingEvents]);
 const identified=(rows:Interval[])=>rows.map((row,index)=>({...row,id:value.find(old=>old.dayOfWeek===row.dayOfWeek&&old.startTime===row.startTime&&old.endTime===row.endTime)?.id??`availability-${Date.now()}-${index}`}));
 const change=(rows:AvailabilityWindow[])=>{setPreview(null);onChange(rows);};
 const update=(id:string,key:'startTime'|'endTime',time:string)=>change(value.map(row=>row.id===id?{...row,[key]:time}:row));
 const hours=(rows:Interval[])=>{try{return mergeAvailability(rows).reduce((sum,row)=>sum+(Number(row.endTime.slice(0,2))*60+Number(row.endTime.slice(3))-Number(row.startTime.slice(0,2))*60-Number(row.startTime.slice(3)))/60,0);}catch{return null;}};
 const available=hours(saved),draftHours=hours(value);
 function review(){try{const normalized=mergeAvailability(value);const clipped=subtractMandatory(normalized,blocked);if(JSON.stringify(normalized)!==JSON.stringify(clipped)){setPreview(clipped);setError('Zajęte części wymagają akceptacji wyłączenia albo poprawienia godzin.');}else{change(identified(normalized));setError('');}}catch(e){setError((e as Error).message);}}
 return <View style={[styles.card,{borderColor:value.length?palette.line:palette.amber}]}>
  <Text style={styles.heading}>Dostępne dni i godziny</Text>{!!messages.availability&&<Text style={styles.error}>{messages.availability}</Text>}
  <Text style={styles.muted}>Zmiany zapisujesz wspólnie z całym profilem. Nakładające przedziały zostaną scalone; zakres nocny przejdzie na kolejny dzień.</Text>
  <Text style={styles.body}>Zapisano: {(available??0).toFixed(2)} godz./tydzień · Szkic: {draftHours===null?'popraw godziny':draftHours.toFixed(2)+' godz.'}</Text>
  {!value.length&&<Text style={styles.error}>Brak dostępności — nie można wygenerować grafiku.</Text>}
  {targetHours!==null&&available!==null&&available<targetHours&&<Text style={styles.error}>Zapisana dostępność jest mniejsza od celu tygodniowego. Cel może być nieosiągalny.</Text>}
  {days.map((day,index)=><View key={day} style={{marginTop:12}}>
   <Text style={styles.heading}>{day}</Text>
   {value.filter(row=>row.dayOfWeek===index+1).map(row=><View key={row.id} style={[styles.row,{flexWrap:'wrap'}]}>
    <TimeField invalid={!!messages[`availability.${value.indexOf(row)}`]} label="Od" disabled={disabled} value={row.startTime} onChange={time=>update(row.id,'startTime',time)}/>
    <TimeField invalid={!!messages[`availability.${value.indexOf(row)}`]} label={row.endTime==='24:00'?'Do: koniec dnia 24:00':'Do'} disabled={disabled} value={row.endTime==='24:00'?'00:00':row.endTime} onChange={time=>update(row.id,'endTime',time)}/>
    {!!messages[`availability.${value.indexOf(row)}`]&&<Text style={styles.error}>{messages[`availability.${value.indexOf(row)}`]}</Text>}
    <Button title="24:00" disabled={disabled} onPress={()=>update(row.id,'endTime','24:00')}/><Button title="Usuń" danger disabled={disabled} onPress={()=>change(value.filter(item=>item.id!==row.id))}/>
   </View>)}
   <View style={[styles.row,{flexWrap:'wrap'}]}>
    <Button title="Dodaj okno" disabled={disabled} onPress={()=>change([...value,{id:`availability-${Date.now()}-${index}`,dayOfWeek:index+1,startTime:'08:00',endTime:'16:00'}])}/>
    <Pressable accessibilityRole="checkbox" accessibilityState={{checked:targets.includes(index+1)}} disabled={disabled} onPress={()=>setTargets(targets.includes(index+1)?targets.filter(day=>day!==index+1):[...targets,index+1])} style={styles.button}><Text style={styles.buttonText}>{targets.includes(index+1)?'☑':'☐'} Cel kopiowania</Text></Pressable>
    <Button title="Kopiuj na zaznaczone dni" disabled={disabled||!targets.length} onPress={()=>{const source=value.filter(row=>row.dayOfWeek===index+1);change([...value.filter(row=>row.dayOfWeek===index+1||!targets.includes(row.dayOfWeek)),...targets.filter(day=>day!==index+1).flatMap(day=>source.map((row,n)=>({...row,id:`copy-${Date.now()}-${day}-${n}`,dayOfWeek:day}))) ]);}}/>
   </View>
  </View>)}
  <Text style={styles.muted}>Kolizje z zajęciami są sprawdzane przez generator. Wyłączenie godzin zajęć z całego wzorca tygodniowego wymaga Twojej akceptacji.</Text>
  <Button title="Scal i uwzględnij zajęcia wybranego tygodnia" disabled={disabled} onPress={review}/>
  {preview&&<View><Text style={styles.error}>{blocked.map(row=>`${days[row.dayOfWeek-1]} ${row.startTime}–${row.endTime}`).join(', ')}</Text><Button title="Akceptuj wyłączenie zajętych części" disabled={disabled} onPress={()=>{change(identified(preview));setError('');}}/></View>}
  {!!error&&<Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
 </View>;
}
