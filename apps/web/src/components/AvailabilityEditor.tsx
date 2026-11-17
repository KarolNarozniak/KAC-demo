import Disclosure from './Disclosure';
import SelectionMark from './SelectionMark';
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
 const {styles,palette}=useTheme();const [selectedDay,setSelectedDay]=useState(1);const [targets,setTargets]=useState<number[]>([]);const [copySource,setCopySource]=useState<number|null>(null);const blocked=useMemo(()=>mandatoryWeeklyIntervals((blockingEvents??[]).map(event=>({category:event.category,mandatory:event.mandatory,repeatWeekly:event.repeatWeekly,start:event.startLocal,end:event.endLocal}))),[blockingEvents]);const [preview,setPreview]=useState<Interval[]|null>(null);const [error,setError]=useState('');
 useEffect(()=>setPreview(null),[blockingEvents]);
 const identified=(rows:Interval[])=>rows.map((row,index)=>({...row,id:value.find(old=>old.dayOfWeek===row.dayOfWeek&&old.startTime===row.startTime&&old.endTime===row.endTime)?.id??`availability-${Date.now()}-${index}`}));
 const change=(rows:AvailabilityWindow[])=>{setPreview(null);onChange(rows);};
 const update=(id:string,key:'startTime'|'endTime',time:string)=>change(value.map(row=>row.id===id?{...row,[key]:time}:row));
 const hours=(rows:Interval[])=>{try{return mergeAvailability(rows).reduce((sum,row)=>sum+(Number(row.endTime.slice(0,2))*60+Number(row.endTime.slice(3))-Number(row.startTime.slice(0,2))*60-Number(row.startTime.slice(3)))/60,0);}catch{return null;}};
 const available=hours(saved);
 function review(){try{const normalized=mergeAvailability(value);const clipped=subtractMandatory(normalized,blocked);if(JSON.stringify(normalized)!==JSON.stringify(clipped)){setPreview(clipped);setError('Zajęte części wymagają akceptacji wyłączenia albo poprawienia godzin.');}else{change(identified(normalized));setError('');}}catch(e){setError((e as Error).message);}}
 return <View style={{gap:12}}>
  {!!messages.availability&&<Text style={styles.error}>{messages.availability}</Text>}
  <Text style={styles.muted}>Zapisana dostępność: {(available??0).toLocaleString('pl-PL')} h / tydzień. Zmiany zapiszesz razem z profilem.</Text>
  {!value.length&&<Text style={styles.error}>Dodaj dostępność, aby wygenerować grafik.</Text>}
  {targetHours!==null&&available!==null&&available<targetHours&&<Text style={styles.error}>Zapisana dostępność jest mniejsza od celu tygodniowego.</Text>}
  <View style={[styles.row,{gap:4}]}>{days.map((day,index)=><Pressable key={day} accessibilityRole="button" accessibilityLabel={day} accessibilityState={{selected:selectedDay===index+1}} onPress={()=>{setSelectedDay(index+1);setCopySource(null);setTargets([]);}} style={[styles.button,{flex:1,paddingHorizontal:0,backgroundColor:selectedDay===index+1?palette.blueSoft:palette.surfaceAlt,borderColor:selectedDay===index+1?palette.blue:palette.line}]}><Text style={styles.buttonText}>{['Pn','Wt','Śr','Cz','Pt','So','Nd'][index]}</Text></Pressable>)}</View>
  {days.map((day,index)=>selectedDay===index+1&&<View key={day} style={{gap:12}}><Text style={styles.heading}>{day}</Text>
   {value.filter(row=>row.dayOfWeek===index+1).map(row=><View key={row.id} style={{gap:8,marginBottom:18}}>
    <View style={styles.row}>
      <TimeField invalid={!!messages[`availability.${value.indexOf(row)}`]} label="Od" disabled={disabled} value={row.startTime} onChange={time=>update(row.id,'startTime',time)}/>
      <TimeField invalid={!!messages[`availability.${value.indexOf(row)}`]} label={row.endTime==='24:00'?'Do (koniec dnia)':'Do'} disabled={disabled} value={row.endTime==='24:00'?'00:00':row.endTime} onChange={time=>update(row.id,'endTime',time)}/>
    </View>
    <View style={[styles.row,{justifyContent:'space-between',flexWrap:'wrap'}]}><Button title="Do północy" disabled={disabled} onPress={()=>update(row.id,'endTime','24:00')}/><Button title="Usuń przedział" danger disabled={disabled} onPress={()=>change(value.filter(item=>item.id!==row.id))}/></View>
    {!!messages[`availability.${value.indexOf(row)}`]&&<Text style={styles.error}>{messages[`availability.${value.indexOf(row)}`]}</Text>}
   </View>)}
   <View style={[styles.row,{flexWrap:'wrap'}]}><Button title="Dodaj przedział" disabled={disabled} onPress={()=>change([...value,{id:`availability-${Date.now()}-${index}`,dayOfWeek:index+1,startTime:'08:00',endTime:'16:00'}])}/><Button title="Kopiuj na inne dni" disabled={disabled||!value.some(row=>row.dayOfWeek===index+1)} onPress={()=>{setCopySource(copySource===index+1?null:index+1);setTargets([]);}}/></View>
   {copySource===index+1&&<View style={{gap:12,marginTop:16}}><Text style={styles.body}>Wybierz dni docelowe:</Text><View style={[styles.row,{flexWrap:'wrap'}]}>{days.map((targetDay,n)=>n!==index&&<Pressable key={targetDay} accessibilityRole="checkbox" accessibilityLabel={targetDay} accessibilityState={{checked:targets.includes(n+1)}} onPress={()=>setTargets(targets.includes(n+1)?targets.filter(day=>day!==n+1):[...targets,n+1])} style={[styles.button,styles.row]}><SelectionMark checked={targets.includes(n+1)}/><Text style={styles.buttonText}>{['Pn','Wt','Śr','Cz','Pt','So','Nd'][n]}</Text></Pressable>)}</View><Button title="Zastosuj kopiowanie" disabled={disabled||!targets.length} onPress={()=>{const source=value.filter(row=>row.dayOfWeek===index+1);change([...value.filter(row=>!targets.includes(row.dayOfWeek)),...targets.flatMap(day=>source.map((row,n)=>({...row,id:`copy-${Date.now()}-${day}-${n}`,dayOfWeek:day})))]);setCopySource(null);setTargets([]);}}/></View>}
  </View>)}
  <Disclosure title="Porządkowanie dostępności" summary="Scal przedziały i sprawdź kolizje z zajęciami">
    <Text style={styles.muted}>Wyłączenie zajętych godzin z wzorca tygodniowego wymaga Twojej akceptacji.</Text>
    <Button title="Scal i uwzględnij zajęcia" disabled={disabled} onPress={review}/>
    {preview&&<View><Text style={styles.error}>{blocked.map(row=>`${days[row.dayOfWeek-1]} ${row.startTime}–${row.endTime}`).join(', ')}</Text><Button title="Akceptuj wyłączenie zajętych części" disabled={disabled} onPress={()=>{change(identified(preview));setError('');}}/></View>}
    {!!error&&<Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
  </Disclosure>
 </View>;
}
