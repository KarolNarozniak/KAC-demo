import React,{useEffect,useState} from 'react';
import {Text,View} from 'react-native';
import {Button,useTheme} from './ui';
import {cancelImport} from '../services/importApi';
import {confirmChatImport,getChatImportPreview,type ChatImportDraft,type ChatImportPreview} from '../services/chatImportApi';
export default function ChatImportCard({draft,onChanged,onCalendarChange}:{draft:ChatImportDraft;onChanged:()=>void;onCalendarChange:()=>void}){
 const {styles,palette}=useTheme();const [preview,setPreview]=useState<ChatImportPreview|null>(null);const [busy,setBusy]=useState(false);const [error,setError]=useState('');const [expanded,setExpanded]=useState(false);const [retry,setRetry]=useState(0);
 useEffect(()=>{let alive=true;setPreview(null);setError('');if(draft.status==='pending')void getChatImportPreview(draft).then(result=>{if(alive)setPreview(result);}).catch(reason=>{if(alive)setError(reason.message);});return()=>{alive=false;};},[draft.id,draft.revision,draft.status,retry]);
 const selected=draft.rows.filter(row=>row.selected);
 const valid=preview&&selected.length>0&&selected.every(row=>!row.unresolvedFields?.length)&&preview.preview.length===selected.length&&preview.preview.every(row=>row.status==='ok'&&(!row.overnight||selected.find(item=>item.id===row.id)?.overnightConfirmed)&&(!(row.duplicateOfEvents.length||row.duplicateOfRows.length)||Boolean(selected.find(item=>item.id===row.id)?.duplicateDecision)));
 const commit=async()=>{setBusy(true);setError('');try{await confirmChatImport(draft);onCalendarChange();onChanged();}catch(reason){setError(reason instanceof Error?reason.message:'Nie udało się potwierdzić importu.');onChanged();}finally{setBusy(false);}};
 const cancel=async()=>{setBusy(true);setError('');try{await cancelImport(draft.id);onChanged();}catch(reason){setError(reason instanceof Error?reason.message:'Nie udało się anulować importu.');}finally{setBusy(false);}};
 return <View style={[styles.card,{borderColor:palette.amber}]}>
  <Text style={styles.heading}>Import: {draft.fileName}</Text>
  <Text style={styles.muted}>{draft.status==='pending'?`Podgląd ${draft.revision} · wybrano ${selected.length} z ${draft.rows.length}`:draft.status==='confirmed'?'Import zapisany':draft.status==='expired'?'Podgląd wygasł':'Import anulowany'}</Text>
  {(expanded?draft.rows:draft.status==='pending'?draft.rows.slice(0,5):[]).map((row,index)=><View key={row.id} style={{marginTop:8}}>
   <Text style={styles.body}>{row.selected?'☑':'☐'} {index+1}. {row.title||'Brak tytułu'} · {row.date||'brak daty'} · {row.startTime||'?'}–{row.endTime||'?'}{row.employee?` · ${row.employee}`:''}{row.location?` · ${row.location}`:''}</Text>
   {preview?.preview.find(item=>item.id===row.id)?.status==='error'&&<Text style={styles.error}>Sprawdź tytuł, datę i godziny tego wiersza — dane nie pozwalają jeszcze zapisać wydarzenia.</Text>}
   {!!row.unresolvedFields?.length&&<Text style={styles.error}>Do uzupełnienia: {row.unresolvedFields.join(', ')}</Text>}
   {!!preview?.preview.find(item=>item.id===row.id)?.overnight&&!row.overnightConfirmed&&<Text style={styles.muted}>Potwierdź w rozmowie, że zmiana kończy się następnego dnia.</Text>}
   {preview?.preview.find(item=>item.id===row.id)?.duplicateOfEvents.map(event=><Text key={event.id} style={styles.muted}>Duplikat: {event.title} · {new Date(event.start).toLocaleString('pl-PL')}</Text>)}
   {!!preview?.preview.find(item=>item.id===row.id)?.duplicateOfRows.length&&<Text style={styles.muted}>Duplikat innego wiersza zdjęcia — wybierz decyzję w rozmowie.</Text>}
  </View>)}
  {(draft.rows.length>5||draft.status!=='pending')&&<Button title={expanded?'Zwiń pozycje':`Pokaż pozycje (${draft.rows.length})`} onPress={()=>setExpanded(value=>!value)}/>}
  {draft.status==='pending'&&<><Text style={[styles.muted,{marginTop:10}]}>Popraw dane w rozmowie, np. „w drugim wierszu początek 09:00” lub „pomiń duplikaty”. Samo „tak” nie zapisuje importu.</Text>
   {!!Object.keys(preview?.collisions??{}).length&&<Text style={styles.error}>Część terminów koliduje z kalendarzem. Zatwierdzenie zapisze je mimo kolizji.</Text>}
   <View style={[styles.row,{marginTop:10,flexWrap:'wrap'}]}><Button title={busy?'Zapisywanie…':'Zatwierdź import'} primary disabled={busy||!valid} onPress={()=>void commit()}/><Button title="Anuluj import" disabled={busy} onPress={()=>void cancel()}/></View></>}
  {draft.summary&&<Text style={styles.body}>Dodano: {draft.summary.added} · zastąpiono: {draft.summary.replaced} · pominięto: {draft.summary.skipped}</Text>}
  {draft.status==='pending'&&!preview&&!error&&<Text accessibilityLiveRegion="polite" style={styles.muted}>Sprawdzam dane i duplikaty…</Text>}
  {!!error&&<><Text accessibilityRole="alert" style={styles.error}>{error}</Text>{draft.status==='pending'&&<Button title="Ponów sprawdzenie" disabled={busy} onPress={()=>setRetry(value=>value+1)}/>}</>}
 </View>;
}
