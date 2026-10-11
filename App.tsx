import React, { useMemo, useState } from 'react';
import { SafeAreaView, ScrollView, View, Text, Pressable, TextInput, Modal, Switch, useWindowDimensions, StatusBar } from 'react-native';

type Category = 'Zajęcia' | 'Praca' | 'Prywatne';
type EventItem = { id: string; title: string; start: string; end: string; category: Category; mandatory: boolean; repeatWeekly: boolean };
type Occurrence = EventItem & { occurrenceStart: Date; occurrenceEnd: Date };
const colors: Record<Category, string> = { Zajęcia: '#2563EB', Praca: '#F97316', Prywatne: '#16A34A' };
const initial: EventItem[] = [
  { id:'E001', title:'Kryptografia — wykład', start:'2026-10-12T08:00', end:'2026-10-12T10:00', category:'Zajęcia', mandatory:true, repeatWeekly:true },
  { id:'E002', title:'Zmiana w pracy', start:'2026-10-12T11:00', end:'2026-10-12T15:00', category:'Praca', mandatory:false, repeatWeekly:true },
  { id:'E003', title:'Siłownia', start:'2026-10-12T17:00', end:'2026-10-12T18:30', category:'Prywatne', mandatory:false, repeatWeekly:false },
  { id:'E004', title:'Bezpieczeństwo sieci — laboratorium', start:'2026-10-13T10:00', end:'2026-10-13T12:00', category:'Zajęcia', mandatory:true, repeatWeekly:true },
  { id:'E005', title:'Spotkanie projektowe', start:'2026-10-13T11:30', end:'2026-10-13T13:00', category:'Prywatne', mandatory:false, repeatWeekly:false },
  { id:'E006', title:'Zmiana w pracy', start:'2026-10-14T08:00', end:'2026-10-14T12:00', category:'Praca', mandatory:false, repeatWeekly:true },
  { id:'E007', title:'Projekt zespołowy', start:'2026-10-15T14:00', end:'2026-10-15T16:00', category:'Zajęcia', mandatory:false, repeatWeekly:false },
  { id:'E008', title:'Obiad z przyjaciółmi', start:'2026-10-17T12:00', end:'2026-10-17T14:00', category:'Prywatne', mandatory:false, repeatWeekly:false },
];
const pad=(n:number)=>String(n).padStart(2,'0');
const dateKey=(d:Date)=>`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const at=(d:Date,h:number)=>new Date(d.getFullYear(),d.getMonth(),d.getDate(),h);
const monday=(d:Date)=>{const x=new Date(d.getFullYear(),d.getMonth(),d.getDate());x.setDate(x.getDate()-((x.getDay()+6)%7));return x;};
const addDays=(d:Date,n:number)=>{const x=new Date(d);x.setDate(x.getDate()+n);return x;};
const fmt=(d:Date)=>`${d.getDate()} ${['sty','lut','mar','kwi','maj','cze','lip','sie','wrz','paź','lis','gru'][d.getMonth()]}`;
const rangeLabel=(m:Date)=>`${fmt(m)} – ${fmt(addDays(m,6))} ${addDays(m,6).getFullYear()}`;
const time=(s:string)=>s.slice(11,16);

function App(){
  const {width}=useWindowDimensions();
  const compact=width<700;
  const [events,setEvents]=useState(initial);
  const [week,setWeek]=useState(()=>new Date(2026,9,12));
  const [modal,setModal]=useState<'form'|'details'|'collision'|null>(null);
  const [selected,setSelected]=useState<Occurrence|null>(null);
  const [collisions,setCollisions]=useState<string[]>([]);
  const [title,setTitle]=useState(''); const [date,setDate]=useState('2026-10-12'); const [start,setStart]=useState('09:00'); const [end,setEnd]=useState('10:00');
  const [category,setCategory]=useState<Category>('Zajęcia'); const [mandatory,setMandatory]=useState(false); const [repeat,setRepeat]=useState(false); const [error,setError]=useState('');
  const weekDays=useMemo(()=>Array.from({length:7},(_,i)=>addDays(week,i)),[week]);
  const occurrences=useMemo(()=>{
    const result:Occurrence[]=[];
    events.forEach(e=>{
      const original=new Date(e.start); const originalEnd=new Date(e.end);
      if(e.repeatWeekly){
        const diff=(monday(week).getTime()-monday(original).getTime())/86400000;
        const occurrenceStart=new Date(original); occurrenceStart.setDate(original.getDate()+Math.floor(diff/7)*7);
        if(occurrenceStart<original) occurrenceStart.setDate(occurrenceStart.getDate()+7);
        if(occurrenceStart<addDays(week,7)){const occurrenceEnd=new Date(occurrenceStart);occurrenceEnd.setTime(occurrenceStart.getTime()+(originalEnd.getTime()-original.getTime()));result.push({...e,occurrenceStart,occurrenceEnd});}
      } else if(original<addDays(week,7)&&originalEnd>week){result.push({...e,occurrenceStart:original,occurrenceEnd:originalEnd});}
    });
    return result;
  },[events,week]);
  const days=compact?weekDays.slice(0,5):weekDays;
  const openNew=()=>{setSelected(null);setTitle('');setDate(dateKey(week));setStart('09:00');setEnd('10:00');setCategory('Zajęcia');setMandatory(false);setRepeat(false);setError('');setModal('form');};
  const saveNew=()=>{
    if(!title.trim()){setError('Wpisz tytuł wydarzenia.');return;}
    const begin=new Date(`${date}T${start}`);const finish=new Date(`${date}T${end}`);
    if(Number.isNaN(begin.getTime())||Number.isNaN(finish.getTime())){setError('Podaj poprawną datę i godzinę.');return;}
    if(finish<=begin){setError('Godzina zakończenia musi być późniejsza niż rozpoczęcia.');return;}
    const found=events.filter(e=>{
      const base=new Date(e.start),baseEnd=new Date(e.end);const duration=baseEnd.getTime()-base.getTime();
      const candidates=[base];if(e.repeatWeekly){for(let i=-2;i<=2;i++){const d=new Date(base);d.setDate(d.getDate()+7*i);candidates.push(d);}}
      return candidates.some(s=>begin.getTime()<s.getTime()+duration&&s<finish);
    }).map(e=>e.title);
    const item:EventItem={id:`E${Date.now()}`,title:title.trim(),start:`${date}T${start}`,end:`${date}T${end}`,category,mandatory:category==='Zajęcia'&&mandatory,repeatWeekly:repeat};
    setEvents(v=>[...v,item]);setModal(found.length?'collision':null);setCollisions(found);
  };
  const openDetails=(o:Occurrence)=>{setSelected(o);setStart(time(o.start));setEnd(time(o.end));setError('');setModal('details');};
  const saveEdit=()=>{if(!selected)return;const s=new Date(`${dateKey(selected.occurrenceStart)}T${start}`),e=new Date(`${dateKey(selected.occurrenceStart)}T${end}`);if(e<=s){setError('Godzina zakończenia musi być późniejsza niż rozpoczęcia.');return;}setEvents(v=>v.map(x=>x.id===selected.id?{...x,start:`${dateKey(selected.occurrenceStart)}T${start}`,end:`${dateKey(selected.occurrenceStart)}T${end}`}:x));setModal(null);};
  const hours=Array.from({length:17},(_,i)=>i+6);
  const card=(o:Occurrence,day:Date)=>{
    const top=(o.occurrenceStart.getHours()-6)*58+o.occurrenceStart.getMinutes()*58/60;
    const height=Math.max(46,(o.occurrenceEnd.getTime()-o.occurrenceStart.getTime())/60000*58/60);
    return <Pressable key={`${o.id}-${dateKey(day)}`} onPress={()=>openDetails(o)} style={{position:'absolute',top,left:4,right:4,height,backgroundColor:`${colors[o.category]}15`,borderLeftWidth:o.mandatory?4:3,borderLeftColor:colors[o.category],borderRadius:9,padding:7,overflow:'hidden',borderWidth:o.mandatory?1:0,borderColor:o.mandatory?colors[o.category]:'transparent'}}>
      <Text numberOfLines={2} style={{fontSize:compact?11:12,fontWeight:'700',color:'#1e293b'}}>{o.title}</Text><Text style={{fontSize:10,color:'#526078',marginTop:4}}>{time(o.start)}–{time(o.end)}</Text>{o.mandatory&&<Text style={{fontSize:9,color:colors[o.category],fontWeight:'700'}}>✦ OBOWIĄZKOWE</Text>}
    </Pressable>;
  };
  const field=(label:string,value:string,onChange:(s:string)=>void,placeholder='')=><View style={{marginBottom:14}}><Text style={styles.label}>{label}</Text><TextInput value={value} onChangeText={onChange} placeholder={placeholder} placeholderTextColor="#94a3b8" style={styles.input}/></View>;
  const btn=(label:string,onPress:()=>void,primary=false)=><Pressable onPress={onPress} style={[styles.button,primary&&styles.primaryButton]}><Text style={[styles.buttonText,primary&&{color:'#fff'}]}>{label}</Text></Pressable>;
  return <SafeAreaView style={styles.safe}><StatusBar barStyle="dark-content"/><View style={[styles.page,{paddingHorizontal:compact?14:36}]}>
    <View style={styles.header}><View style={styles.brand}><View style={styles.logo}><Text style={{color:'#fff',fontSize:19,fontWeight:'800'}}>k</Text></View><View><Text style={styles.brandTitle}>kernel <Text style={{color:'#5265e8'}}>aura</Text></Text><Text style={styles.brandSub}>YOUR WEEK, IN HARMONY</Text></View></View><Pressable onPress={()=>{setEvents(initial);setWeek(new Date(2026,9,12));}} style={styles.reset}><Text style={styles.resetText}>↻  Reset demo</Text></Pressable></View>
    <View style={styles.titleRow}><View><Text style={styles.eyebrow}>TWÓJ KALENDARZ</Text><Text style={[styles.heading,{fontSize:compact?27:34}]}>Dobry plan. Spokojna głowa.</Text><Text style={styles.subtitle}>Zobacz, co przyniesie ten tydzień.</Text></View><Pressable onPress={openNew} style={styles.addButton}><Text style={styles.addPlus}>＋</Text>{!compact&&<Text style={styles.addLabel}>Dodaj wydarzenie</Text>}</Pressable></View>
    <View style={styles.calendar}><View style={styles.calendarTop}><View><Text style={styles.month}>{rangeLabel(week)}</Text><Text style={styles.monthSub}>Tydzień {weekDays[0].getDate()}–{weekDays[6].getDate()} października</Text></View><View style={styles.nav}><Pressable style={styles.navBtn} onPress={()=>setWeek(addDays(week,-7))}><Text style={styles.navText}>‹</Text></Pressable><Pressable style={styles.today} onPress={()=>setWeek(new Date(2026,9,12))}><Text style={styles.todayText}>Demo</Text></Pressable><Pressable style={styles.navBtn} onPress={()=>setWeek(addDays(week,7))}><Text style={styles.navText}>›</Text></Pressable></View></View>
      {compact&&<ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.daySelector}>{weekDays.map(d=><Pressable key={dateKey(d)} onPress={()=>{}} style={styles.dayPill}><Text style={styles.dayPillText}>{['PN','WT','ŚR','CZ','PT','SO','ND'][((d.getDay()+6)%7)]} {d.getDate()}</Text></Pressable>)}</ScrollView>}
      <ScrollView horizontal={!compact} showsHorizontalScrollIndicator={false}><View style={{minWidth:compact?undefined:800,width:compact?'100%':undefined,flexDirection:'row'}}><View style={styles.timeColumn}><View style={{height:55}}/>{hours.map(h=><View key={h} style={styles.hourLabel}><Text style={styles.hourText}>{pad(h)}:00</Text></View>)}</View>{days.map(d=>{const todays=occurrences.filter(o=>dateKey(o.occurrenceStart)===dateKey(d));return <View key={dateKey(d)} style={[styles.dayColumn,{flex:1,minWidth:compact?0:90}]}><View style={styles.dayHead}><Text style={styles.dayName}>{['PON','WT','ŚR','CZW','PT','SOB','ND'][((d.getDay()+6)%7)]}</Text><Text style={styles.dayNumber}>{d.getDate()}</Text></View><View style={styles.dayGrid}>{hours.map(h=><View key={h} style={styles.gridLine}/ >)}{todays.map(o=>card(o,d))}</View></View>;})}</View></ScrollView>
      {occurrences.length===0&&<View style={styles.empty}><Text style={styles.emptyIcon}>☼</Text><Text style={styles.emptyTitle}>Tydzień pełen możliwości</Text><Text style={styles.emptyText}>Brak zaplanowanych wydarzeń w tym tygodniu</Text></View>}
    </View>
    <View style={styles.legend}><Text style={styles.legendTitle}>KATEGORIE</Text>{(['Zajęcia','Praca','Prywatne'] as Category[]).map(c=><View key={c} style={styles.legendItem}><View style={[styles.dot,{backgroundColor:colors[c]}]}/><Text style={styles.legendText}>{c}</Text></View>)}<Text style={styles.legendHint}>✦  obowiązkowe</Text></View>
    <Text style={styles.footer}>Małe kroki, wielkie rzeczy. ✦</Text>
  </View>
  <Modal visible={modal!==null} transparent animationType="fade" onRequestClose={()=>setModal(null)}><View style={styles.overlay}><View style={[styles.modal,{width:compact?'92%':460}]}>
    {modal==='collision'?<><View style={[styles.modalIcon,{backgroundColor:'#fff7ed'}]}><Text style={{fontSize:24}}>⚠</Text></View><Text style={styles.modalTitle}>Mała kolizja w planie</Text><Text style={styles.modalDesc}>To wydarzenie nakłada się na inne: {collisions.join(', ')}. Oba wydarzenia zostały dodane do kalendarza.</Text>{btn('OK',()=>setModal(null),true)}</>:modal==='form'?<><Text style={styles.modalTitle}>Nowe wydarzenie</Text><Text style={styles.modalDesc}>Dodaj coś ważnego do swojego tygodnia.</Text>{field('NAZWA WYDARZENIA',title,setTitle,'np. Spotkanie projektowe')}
      <View style={{flexDirection:compact?'column':'row',gap:12}}><View style={{flex:1}}>{field('DATA (RRRR-MM-DD)',date,setDate)}</View><View style={{flex:1}}>{field('KATEGORIA','',()=>{})}<View style={{flexDirection:'row',gap:6,marginTop:-12,marginBottom:14}}>{(['Zajęcia','Praca','Prywatne'] as Category[]).map(c=><Pressable key={c} onPress={()=>{setCategory(c);if(c!=='Zajęcia')setMandatory(false);}} style={[styles.categoryChip,{borderColor:colors[c],backgroundColor:category===c?`${colors[c]}15`:'#fff'}]}><Text style={{color:colors[c],fontSize:11,fontWeight:'700'}}>{c}</Text></Pressable>)}</View></View></View>
      <View style={{flexDirection:'row',gap:12}}><View style={{flex:1}}>{field('OD',start,setStart)}</View><View style={{flex:1}}>{field('DO',end,setEnd)}</View></View>
      <View style={styles.switchRow}><Text style={styles.switchLabel}>Powtarzaj co tydzień</Text><Switch value={repeat} onValueChange={setRepeat} trackColor={{true:'#5967e8'}}/></View>{category==='Zajęcia'&&<View style={styles.switchRow}><Text style={styles.switchLabel}>Zajęcia obowiązkowe</Text><Switch value={mandatory} onValueChange={setMandatory} trackColor={{true:'#5967e8'}}/></View>}{!!error&&<Text style={styles.error}>{error}</Text>}<View style={styles.actions}>{btn('Anuluj',()=>setModal(null))}{btn('Zapisz wydarzenie',saveNew,true)}</View></>:<><Text style={styles.modalTitle}>{selected?.title}</Text><Text style={styles.modalDesc}>{selected?.category} · {selected&&fmt(selected.occurrenceStart)}{selected?.mandatory?' · ✦ Obowiązkowe':''}{selected?.repeatWeekly?' · Co tydzień':''}</Text>{field('GODZINA ROZPOCZĘCIA',start,setStart)}{field('GODZINA ZAKOŃCZENIA',end,setEnd)}{!!error&&<Text style={styles.error}>{error}</Text>}<View style={styles.actions}>{btn('Anuluj',()=>setModal(null))}{btn('Zapisz zmiany',saveEdit,true)}</View></>}
  </View></View></Modal></SafeAreaView>;
}

const styles:any={safe:{flex:1,backgroundColor:'#f7f8fc'},page:{flex:1,width:'100%',maxWidth:1440,alignSelf:'center',paddingTop:compactPad(),paddingBottom:24},header:{height:58,flexDirection:'row',alignItems:'center',justifyContent:'space-between',marginBottom:24},brand:{flexDirection:'row',alignItems:'center',gap:11},logo:{width:38,height:38,borderRadius:13,backgroundColor:'#5967e8',alignItems:'center',justifyContent:'center'},brandTitle:{fontSize:19,fontWeight:'800',color:'#18233a',letterSpacing:-.5},brandSub:{fontSize:9,color:'#8791a5',letterSpacing:1.5,fontWeight:'700',marginTop:2},reset:{paddingVertical:9,paddingHorizontal:14,borderRadius:10,backgroundColor:'#fff',borderWidth:1,borderColor:'#e8eaf1'},resetText:{fontSize:12,color:'#596579',fontWeight:'600'},titleRow:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',marginBottom:23},eyebrow:{fontSize:10,fontWeight:'800',letterSpacing:2,color:'#727de6',marginBottom:7},heading:{fontWeight:'800',color:'#19243b',letterSpacing:-1},subtitle:{fontSize:14,color:'#788398',marginTop:6},addButton:{backgroundColor:'#5967e8',height:48,paddingHorizontal:16,borderRadius:14,alignItems:'center',justifyContent:'center',flexDirection:'row',gap:7,shadowColor:'#5967e8',shadowOpacity:.2,shadowRadius:12,elevation:3},addPlus:{fontSize:23,color:'#fff',lineHeight:25},addLabel:{color:'#fff',fontSize:13,fontWeight:'700'},calendar:{backgroundColor:'#fff',borderRadius:20,padding:compactPadSmall(),borderWidth:1,borderColor:'#eaecf2',shadowColor:'#1e293b',shadowOpacity:.03,shadowRadius:14,elevation:1},calendarTop:{height:61,flexDirection:'row',justifyContent:'space-between',alignItems:'flex-start'},month:{fontSize:17,fontWeight:'800',color:'#202a40'},monthSub:{fontSize:11,color:'#929bad',marginTop:4},nav:{flexDirection:'row',gap:7,alignItems:'center'},navBtn:{width:31,height:31,borderRadius:9,backgroundColor:'#f5f6fb',alignItems:'center',justifyContent:'center'},navText:{fontSize:23,color:'#4c5870',lineHeight:27},today:{paddingHorizontal:12,height:31,borderRadius:9,backgroundColor:'#f0f1ff',alignItems:'center',justifyContent:'center'},todayText:{fontSize:11,fontWeight:'700',color:'#5967e8'},daySelector:{marginBottom:8,flexGrow:0},dayPill:{padding:8,marginRight:5,backgroundColor:'#f6f7fb',borderRadius:8},dayPillText:{fontSize:10,color:'#566178'},timeColumn:{width:48},hourLabel:{height:58,alignItems:'flex-start',justifyContent:'flex-start',paddingTop:0},hourText:{fontSize:9,color:'#9ba4b5'},dayColumn:{},dayHead:{height:55,alignItems:'center',justifyContent:'flex-start',borderBottomWidth:1,borderColor:'#edf0f5'},dayName:{fontSize:9,fontWeight:'700',color:'#99a2b3',letterSpacing:.6,marginTop:2},dayNumber:{fontSize:13,fontWeight:'700',color:'#27334a',marginTop:4},dayGrid:{height:986,position:'relative'},gridLine:{height:58,borderTopWidth:1,borderColor:'#f0f2f6'},empty:{alignItems:'center',paddingVertical:28},emptyIcon:{fontSize:27,color:'#9ca5ef'},emptyTitle:{fontSize:14,fontWeight:'700',color:'#344056',marginTop:6},emptyText:{fontSize:12,color:'#8993a5',marginTop:5},legend:{flexDirection:'row',alignItems:'center',gap:19,marginTop:18,flexWrap:'wrap'},legendTitle:{fontSize:9,color:'#9aa3b4',fontWeight:'800',letterSpacing:1.4},legendItem:{flexDirection:'row',alignItems:'center',gap:7},dot:{width:8,height:8,borderRadius:4},legendText:{fontSize:11,color:'#5c667b'},legendHint:{fontSize:10,color:'#8a94a7',marginLeft:'auto'},footer:{textAlign:'center',color:'#a5adbb',fontSize:10,marginTop:'auto',paddingTop:22},overlay:{flex:1,backgroundColor:'rgba(24,34,55,.38)',alignItems:'center',justifyContent:'center',padding:16},modal:{backgroundColor:'#fff',padding:24,borderRadius:22,maxHeight:'92%',shadowColor:'#000',shadowOpacity:.14,shadowRadius:24,elevation:10},modalIcon:{width:48,height:48,borderRadius:15,alignItems:'center',justifyContent:'center',marginBottom:14},modalTitle:{fontSize:21,fontWeight:'800',color:'#202a40',marginBottom:5},modalDesc:{fontSize:13,color:'#778297',lineHeight:20,marginBottom:20},label:{fontSize:9,fontWeight:'800',letterSpacing:1,color:'#8791a4',marginBottom:7},input:{borderWidth:1,borderColor:'#e6e9f0',backgroundColor:'#fbfcfe',borderRadius:10,paddingHorizontal:12,paddingVertical:10,fontSize:14,color:'#27334a'},categoryChip:{paddingVertical:7,paddingHorizontal:9,borderWidth:1,borderRadius:8},switchRow:{flexDirection:'row',justifyContent:'space-between',alignItems:'center',paddingVertical:7},switchLabel:{fontSize:13,color:'#354157'},actions:{flexDirection:'row',justifyContent:'flex-end',gap:9,marginTop:18},button:{minHeight:42,paddingHorizontal:15,borderRadius:10,alignItems:'center',justifyContent:'center',backgroundColor:'#f3f5f9'},primaryButton:{backgroundColor:'#5967e8'},buttonText:{fontSize:12,fontWeight:'700',color:'#5d687c'},error:{fontSize:12,color:'#dc4551',marginTop:2}};
function compactPad(){return 18} function compactPadSmall(){return 15}
export default App;
