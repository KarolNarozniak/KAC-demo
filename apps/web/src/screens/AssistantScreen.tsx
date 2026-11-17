import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { Button, useTheme } from '../components/ui';
import ChatImportCard from '../components/ChatImportCard';
import { attachChatImport, listChatImports, type ChatImportDraft, type ChatImportHandoff } from '../services/chatImportApi';
import { pickPdf } from '../services/pickPdf';
import { takePhoto } from '../services/takePhoto';
import {
  cancelAssistantAction, confirmAssistantActions, createAssistantConversation, deleteAssistantConversation,
  getAssistantConfig, listAssistantConversations, listAssistantMessages, streamAssistantMessage,
  type AssistantConversation, type AssistantMessage, type PendingAssistantAction,
  AssistantApiError,
} from '../services/assistantApi';

type Props = { active: boolean; onCalendarChange: () => void; importHandoff?: ChatImportHandoff | null; onHandoffConsumed?: () => void };
const textOf = (message: AssistantMessage) => typeof message.content.text === 'string' ? message.content.text : '';
const eventDetails = (event: Record<string, unknown>) => [
  `Kategoria: ${{ Class: 'Zajęcia', Work: 'Praca', Personal: 'Osobiste' }[String(event.category)] ?? String(event.category)}`,
  `Miejsce: ${event.location || 'nie podano'}`,
  `Obowiązkowe: ${event.mandatory ? 'tak' : 'nie'}`,
  `Co tydzień: ${event.repeatWeekly ? 'tak' : 'nie'}`,
].join(' · ');
const actionSummary = (action: PendingAssistantAction) => {
  const value = action.payload.event as Record<string, unknown> | undefined;
  if (action.kind === 'calendar_event_delete') {
    const original = action.payload.original as Record<string, unknown> | undefined;
    return `Usunąć „${String(original?.title ?? 'wydarzenie')}”?`;
  }
  if (action.kind === 'calendar_event_update') return `Zaktualizować „${String(value?.title ?? 'wydarzenie')}” na ${String(value?.start ?? '')}?`;
  return `Dodać „${String(value?.title ?? 'wydarzenie')}” · ${String(value?.start ?? '')} – ${String(value?.end ?? '')}?`;
};

export default function AssistantScreen({ active, onCalendarChange, importHandoff, onHandoffConsumed }: Props) {
  const { palette, styles } = useTheme();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [conversations, setConversations] = useState<AssistantConversation[]>([]);
  const [conversationId, setConversationId] = useState('');
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [pendingActions, setPendingActions] = useState<PendingAssistantAction[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [replying, setReplying] = useState(false);
  const [streamText, setStreamText] = useState('');
  const [attachmentMenuOpen, setAttachmentMenuOpen] = useState(false);
  const [attachmentSource, setAttachmentSource] = useState<'classes'|'work'>('classes');
  const [attachmentReader, setAttachmentReader] = useState<'ai'|'local'>('ai');
  const [imports, setImports] = useState<ChatImportDraft[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadRetry, setUploadRetry] = useState<ChatImportHandoff|null>(null);
  const consumedHandoff = useRef<ChatImportHandoff|null>(null);
  const [imagePreview, setImagePreview] = useState<string|null>(null);
  const scrollRef = useRef<React.ComponentRef<typeof ScrollView>>(null);
  const followReply = useRef(true);
  const requestRef = useRef<AbortController | null>(null);
  useEffect(() => () => requestRef.current?.abort(), []);
  const [collision, setCollision] = useState<{ actionId: string; error: AssistantApiError } | null>(null);

  useEffect(() => {
    setCollision(null);
    if (!active) return;
    let alive = true;
    setLoading(true); setError('');
    void Promise.all([getAssistantConfig(), listAssistantConversations()]).then(([config, result]) => {
      if (!alive) return;
      setEnabled(config.enabled); setConversations(result.conversations);
      setConversationId((current) => requestRef.current ? current : result.conversations.some((item) => item.id === current) ? current : result.conversations[0]?.id ?? '');
    }).catch((reason) => { if (alive) setError(reason instanceof Error ? reason.message : 'Nie udało się połączyć z asystentem.'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [active]);

  useEffect(() => {
    if (!conversationId) { setMessages([]); setPendingActions([]); return; }
    if (!active || requestRef.current) return;
    let alive = true;
    setStreamText('');
    setLoading(true); setError('');
    void Promise.all([listAssistantMessages(conversationId),listChatImports(conversationId)]).then(([result,drafts]) => {
      if (alive) { setMessages(result.messages); setPendingActions(result.pendingActions); setImports(drafts.imports); }
    }).catch((reason) => { if (alive) setError(reason instanceof Error ? reason.message : 'Nie udało się wczytać rozmowy.'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [active, conversationId]);

  const send = async (targetConversationId = conversationId) => {
    const content = input.trim();
    if (!content || !targetConversationId || sending || !enabled) return;
    if (requestRef.current || loading) return;
    const controller = new AbortController(); requestRef.current = controller;
    const localId = `local-user-${Date.now()}`;
    const createdAt = new Date().toISOString();
    followReply.current = true;
    setMessages((current) => [...current, { id: localId, role: 'user', content: { text: content, delivery: 'sending' }, createdAt }]);
    setInput(''); setSending(true); setReplying(true); setStreamText(''); setError('');
    try {
      const result = await streamAssistantMessage(targetConversationId, content, (event) => {
        if (event.type === 'accepted') setMessages((current) => current.map((message) => message.id === localId ? event.message : message));
        if (event.type === 'delta') setStreamText((current) => current + event.text);
        if (event.type === 'reset') setStreamText('');
      }, controller.signal);
      setMessages((current) => [...current, { id: `local-assistant-${Date.now()}`, role: 'assistant', content: { text: result.message.content }, createdAt: new Date().toISOString() }]);
      setPendingActions(result.pendingActions); setStreamText('');
      try { setImports((await listChatImports(targetConversationId)).imports); } catch { /* keep the current draft until reload succeeds */ }
      setConversations((current) => current.map((item) => item.id === targetConversationId ? { ...item, updatedAt: new Date().toISOString() } : item));
    } catch (reason) {
      if (!controller.signal.aborted) {
        if (reason instanceof AssistantApiError && reason.pendingActions) setPendingActions(reason.pendingActions);
        if (reason instanceof AssistantApiError && ['assistant_content_filtered', 'assistant_refused'].includes(reason.code)) setStreamText('');
        setMessages((current) => current.map((message) => message.id === localId ? { ...message, content: { ...message.content, delivery: 'unconfirmed' } } : message));
        setError(reason instanceof AssistantApiError ? reason.message : 'Połączenie zostało przerwane. Otwórz ponownie rozmowę, aby sprawdzić zapisane wiadomości.');
        try { setImports((await listChatImports(targetConversationId,AbortSignal.timeout(5000))).imports); } catch { /* keep the last known preview if the connection is unavailable */ }
      }
    } finally { requestRef.current = null; setSending(false); setReplying(false); }
  };

  const refreshImports = async () => {
    try { setImports((await listChatImports(conversationId)).imports); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Nie udało się odświeżyć podglądu.'); }
  };
  const uploadAttachment = async (handoff: ChatImportHandoff) => {
    if (requestRef.current || sending) return;
    const controller = new AbortController(); requestRef.current = controller;
    setAttachmentMenuOpen(false); setSending(true); setUploading(true); setError(''); setUploadRetry(null);
    const thumbnailDataUrl = /\.(png|jpe?g)$/i.test(handoff.file.name) ? `data:${/\.png$/i.test(handoff.file.name) ? 'image/png' : 'image/jpeg'};base64,${handoff.file.base64}` : null;
    followReply.current = true;
    setMessages((current) => [...current,{id:`upload-${Date.now()}`,role:'user',content:{text:`Import: ${handoff.file.name}`,attachment:{fileName:handoff.file.name,thumbnailDataUrl,reader:handoff.reader}},createdAt:new Date().toISOString()}]);
    try {
      let target = conversationId;
      if (!target) { const created = await createAssistantConversation(); target=created.id; setConversationId(target); setConversations((current)=>[created,...current]); }
      await attachChatImport(target,handoff,controller.signal);
      const [history,drafts] = await Promise.all([listAssistantMessages(target),listChatImports(target)]);
      setMessages(history.messages); setPendingActions(history.pendingActions); setImports(drafts.imports);
    } catch(reason) { if(!controller.signal.aborted) { setError(reason instanceof Error?reason.message:'Nie udało się odczytać zdjęcia.'); setUploadRetry(handoff); } }
    finally { requestRef.current=null; setSending(false); setUploading(false); }
  };
  const chooseAttachment = async (camera=false) => {
    try { const file=await(camera?takePhoto():pickPdf()); if(file) await uploadAttachment({file,source:attachmentSource,reader:attachmentReader}); }
    catch(reason) {setError(reason instanceof Error?reason.message:'Nie udało się wybrać zdjęcia.');}
  };
  useEffect(()=>{
    if(!active || !importHandoff || consumedHandoff.current===importHandoff || requestRef.current) return;
    consumedHandoff.current=importHandoff;
    void uploadAttachment(importHandoff);
    onHandoffConsumed?.();
  },[active,importHandoff,sending]);

  const newConversation = async () => {
    if (!enabled || sending) return;
    setLoading(true); setError('');
    try {
      const created = await createAssistantConversation();
      setConversations((current) => [created, ...current]); setConversationId(created.id); setMessages([]); setPendingActions([]); setImports([]);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Nie udało się rozpocząć rozmowy.'); }
    finally { setLoading(false); }
  };

  const confirmActions = async (actions: PendingAssistantAction[], collisionToken?: string) => {
    if (sending) return;
    setSending(true); setError('');
    let confirmed = 0;
    try {
      await confirmAssistantActions(actions.map((action) => action.id), (id) => {
        confirmed++;
        setCollision(null);
        setPendingActions((current) => current.filter((item) => item.id !== id));
      }, collisionToken);
    } catch (reason) {
      const action = actions[confirmed];
      if (action && reason instanceof AssistantApiError && reason.code === 'event_collision') setCollision({ actionId: action.id, error: reason });
      setError(reason instanceof Error ? reason.message : 'Nie udało się zatwierdzić akcji. Ponów zatwierdzenie tej samej propozycji.');
    } finally {
      if (confirmed) {
        setMessages((current) => [...current, { id: `confirmed-${Date.now()}`, role: 'assistant',
          content: { text: confirmed === 1 ? 'Akcja została zatwierdzona i zapisana w kalendarzu.' : `Zatwierdzono i zapisano w kalendarzu: ${confirmed}.` }, createdAt: new Date().toISOString() }]);
        onCalendarChange();
      }
      setSending(false);
    }
  };
  const confirmAction = (action: PendingAssistantAction, collisionToken?: string) => confirmActions([action], collisionToken);

  const cancelAction = async (action: PendingAssistantAction) => {
    setSending(true); setError('');
    try {
      await cancelAssistantAction(action.id);
      setCollision(null);
      setPendingActions((current) => current.filter((item) => item.id !== action.id));
      setMessages((current) => [...current, { id: `cancelled-${Date.now()}`, role: 'assistant', content: { text: 'Propozycja została anulowana. Kalendarz pozostał bez zmian.' }, createdAt: new Date().toISOString() }]);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Nie udało się anulować akcji.'); }
    finally { setSending(false); }
  };

  const removeConversation = async () => {
    if (!conversationId || sending) return;
    setSending(true); setError('');
    try {
      await deleteAssistantConversation(conversationId);
      const remaining = conversations.filter((item) => item.id !== conversationId);
      setConversations(remaining); setConversationId(remaining[0]?.id ?? ''); setMessages([]); setPendingActions([]); setImports([]);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Nie udało się usunąć rozmowy.'); }
    finally { setSending(false); }
  };

  return <View style={{ flex: 1, flexDirection: 'row', backgroundColor: palette.bg }}>
    <View style={{ width: 230, maxWidth: '36%', borderRightWidth: 1, borderColor: palette.line, padding: 10, gap: 8 }}>
      <Button title="Nowa rozmowa" primary disabled={!enabled || loading || sending} onPress={() => void newConversation()} />
      <ScrollView contentContainerStyle={{ gap: 6 }}>
        {conversations.map((conversation) => <Pressable key={conversation.id} disabled={sending} accessibilityRole="button" accessibilityState={{ selected: conversationId === conversation.id }} onPress={() => { setCollision(null); setConversationId(conversation.id); }} style={{ padding: 10, borderRadius: 9, backgroundColor: conversationId === conversation.id ? palette.blueSoft : palette.surface }}>
          <Text numberOfLines={2} style={[styles.body, { fontWeight: conversationId === conversation.id ? '800' : '500' }]}>{conversation.title || 'Rozmowa'}</Text>
          <Text style={styles.muted}>{new Date(conversation.updatedAt).toLocaleDateString('pl-PL')}</Text>
        </Pressable>)}
      </ScrollView>
      {!!conversationId && <Button title="Usuń rozmowę" danger disabled={sending} onPress={() => void removeConversation()} />}
    </View>

    <View style={{ flex: 1, minWidth: 0, padding: 14 }}>
      <View style={[styles.row, { justifyContent: 'space-between', flexWrap: 'wrap' }]}><View><Text style={styles.heading}>Asystent KAC</Text><Text style={styles.muted}>Kalendarz i planowanie pracy · zmiany wymagają zatwierdzenia</Text></View></View>
      {enabled === false && <View style={[styles.card, { borderColor: palette.amber, marginTop: 12 }]}><Text style={styles.heading}>Azure AI Foundry nie jest skonfigurowane</Text><Text style={styles.body}>Ustaw endpoint projektu i nazwę deploymentu modelu w konfiguracji API, a lokalnie zaloguj się przez `az login`. Żadna wiadomość nie została wysłana.</Text></View>}
      {!!error && <Text accessibilityRole="alert" style={[styles.error, { marginTop: 8 }]}>{error}</Text>}
      <ScrollView ref={scrollRef} onContentSizeChange={() => { if (followReply.current) scrollRef.current?.scrollToEnd({ animated: false }); }}
        onScroll={({ nativeEvent }) => { followReply.current = nativeEvent.contentOffset.y + nativeEvent.layoutMeasurement.height >= nativeEvent.contentSize.height - 80; }} scrollEventThrottle={100} style={{ flex: 1, marginVertical: 10 }} contentContainerStyle={{ gap: 10, paddingBottom: 16 }}>
        {messages.filter((message) => message.role !== 'tool' && textOf(message)).map((message) => <View key={message.id} style={{ alignSelf: message.role === 'user' ? 'flex-end' : 'flex-start', maxWidth: '90%', padding: 12, borderRadius: 12, backgroundColor: message.role === 'user' ? palette.blueSoft : palette.surface }}>
          {!!(message.content.attachment as {thumbnailDataUrl?:string}|undefined)?.thumbnailDataUrl && <Pressable accessibilityRole="button" accessibilityLabel="Powiększ zdjęcie" onPress={()=>setImagePreview(String((message.content.attachment as {thumbnailDataUrl:string}).thumbnailDataUrl))}>
            <Image source={{uri:String((message.content.attachment as {thumbnailDataUrl:string}).thumbnailDataUrl)}} style={{width:260,maxWidth:'100%',height:180,borderRadius:8,marginBottom:8}} resizeMode="contain" accessibilityLabel="Zdjęcie do importu" />
          </Pressable>}
          <Text style={styles.body}>{String(message.content.text ?? '')}</Text>
          <Text style={[styles.muted, { marginTop: 4 }]}>{message.role === 'user' ? message.content.delivery === 'sending' ? 'Wysyłanie…' : message.content.delivery === 'unconfirmed' ? 'Nie potwierdzono wysłania' : 'Ty' : 'Asystent'} · {new Date(message.createdAt).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' })}</Text>
        </View>)}
        {uploading && <View style={styles.row}><ActivityIndicator size="small" color={palette.blue}/><Text accessibilityLiveRegion="polite" style={styles.muted}>Odczytuję zdjęcie i przygotowuję podgląd…</Text></View>}
        {uploadRetry && <Button title="Ponów odczyt zdjęcia" disabled={sending} onPress={()=>void uploadAttachment({...uploadRetry,sessionId:undefined,rows:undefined})}/>}
        {imports.map(draft=><ChatImportCard key={draft.id} draft={draft} onChanged={()=>void refreshImports()} onCalendarChange={onCalendarChange}/>)}
        {(replying || streamText) && <View style={{ alignSelf: 'flex-start', maxWidth: '90%', padding: 12, borderRadius: 12, backgroundColor: palette.surface }}>
          {!!streamText && <Text style={styles.body}>{streamText}</Text>}
          <View accessibilityLiveRegion="polite" style={[styles.row, { marginTop: streamText ? 6 : 0 }]}>
            {replying && <ActivityIndicator size="small" color={palette.blue} />}
            <Text style={styles.muted}>{replying ? 'Asystent odpowiada…' : 'Odpowiedź przerwana'}</Text>
          </View>
        </View>}
        {pendingActions.length > 0 && <Text style={styles.heading}>Gotowe propozycje do zatwierdzenia: {pendingActions.length}</Text>}
        {pendingActions.map((action) => <View key={action.id} style={[styles.card, { borderColor: palette.amber }]}>
          <Text style={styles.heading}>Propozycja do potwierdzenia</Text><Text style={styles.body}>{actionSummary(action)}</Text>
          {!!action.payload.event && <Text style={styles.body}>{eventDetails(action.payload.event as Record<string, unknown>)}</Text>}
          {collision?.actionId === action.id && <View accessibilityRole="alert">
            <Text style={styles.body}>W tym terminie masz już:</Text>
            {collision.error.conflicts.map((item) => <Text key={item.id} style={styles.body}>• {item.title} · {new Date(item.start).toLocaleString('pl-PL')} – {new Date(item.end).toLocaleString('pl-PL')}</Text>)}
            <Text style={styles.muted}>Możesz zapisać mimo kolizji lub odrzucić propozycję i poprosić o inny termin.</Text>
            {!!collision.error.collisionToken && <Button title="Zapisz mimo kolizji" disabled={sending} onPress={() => void confirmAction(action, collision.error.collisionToken)} />}
          </View>}
          <Text style={styles.muted}>Ważna do: {new Date(action.expiresAt).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' })}. Kalendarz nie zmieni się bez potwierdzenia.</Text>
          <View style={[styles.row, { flexWrap: 'wrap', marginTop: 8 }]}><Button title="Zatwierdź" primary disabled={sending} onPress={() => void confirmAction(action)} /><Button title="Odrzuć" danger disabled={sending} onPress={() => void cancelAction(action)} /></View>
        </View>)}
        {pendingActions.length > 1 && <Button title="Zatwierdź wszystko" primary disabled={sending} onPress={() => void confirmActions(pendingActions)} />}
        {loading && <Text accessibilityLiveRegion="polite" style={styles.muted}>Wczytywanie…</Text>}
      </ScrollView>
      <View style={[styles.row, { alignItems: 'flex-end' }]}>
        <Pressable accessibilityRole="button" accessibilityLabel="Importuj zdjęcie lub plik" accessibilityHint="Wybierz plan zajęć albo grafik pracy i sprawdź dane przed zapisem."
          accessibilityState={{ disabled: sending || loading }} disabled={sending || loading} onPress={() => setAttachmentMenuOpen(true)}
          style={[styles.button, { minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center' }, (sending || loading) && { opacity: 0.5 }]}>
          <Text style={{ fontSize: 22 }}>📷</Text>
        </Pressable>
        <TextInput value={input} onChangeText={setInput} placeholder={enabled ? 'Zapytaj o kalendarz lub plan pracy…' : 'Skonfiguruj Azure AI, aby rozpocząć'} multiline editable={Boolean(enabled) && !sending}
          accessibilityLabel="Wiadomość do asystenta" onSubmitEditing={() => void send()} style={[styles.input, { flex: 1, minHeight: 48, maxHeight: 120 }]} />
        <Button title={sending ? '…' : 'Wyślij'} primary disabled={!enabled || sending || loading || !conversationId || !input.trim()} onPress={() => void send()} />
      </View>
      <Text style={[styles.muted, { marginTop: 6 }]}>Załączniki i tekst traktowane są jako niezaufane dane. Asystent nie zapisuje zmian bez Twojej akceptacji.</Text>
    </View>
    <Modal visible={attachmentMenuOpen} transparent animationType="fade" onRequestClose={() => setAttachmentMenuOpen(false)}>
      <View style={{ flex: 1, backgroundColor: palette.scrim, alignItems: 'center', justifyContent: 'center', padding: 16 }}>
        <View style={[styles.card, { width: '100%', maxWidth: 440, gap: 12 }]}>
          <Text style={styles.heading}>Dodaj zdjęcie lub plik</Text>
          <Text style={styles.body}>Co chcesz odczytać?</Text>
          <View style={styles.row}><Button title="Plan zajęć" primary={attachmentSource==='classes'} onPress={()=>setAttachmentSource('classes')}/><Button title="Grafik pracy" primary={attachmentSource==='work'} onPress={()=>setAttachmentSource('work')}/></View>
          <View style={styles.row}><Button title="Azure AI" primary={attachmentReader==='ai'} onPress={()=>setAttachmentReader('ai')}/><Button title="Lokalny OCR" primary={attachmentReader==='local'} onPress={()=>setAttachmentReader('local')}/></View>
          <Text style={styles.muted}>{attachmentReader==='ai'?'Zdjęcie zostanie przekazane do Azure AI. Miniatura i odczytane dane pozostaną w rozmowie.':'OCR odczyta zdjęcie na serwerze. Odczytane dane omówisz z AI; obraz pozostanie poza kontekstem modelu.'}</Text>
          <Button title="Wybierz zdjęcie lub plik" primary onPress={()=>void chooseAttachment()}/>
          <Button title="Zrób zdjęcie" onPress={()=>void chooseAttachment(true)}/>
          <Button title="Anuluj" onPress={() => setAttachmentMenuOpen(false)} />
        </View>
      </View>
    </Modal>
    <Modal visible={Boolean(imagePreview)} transparent onRequestClose={()=>setImagePreview(null)}>
      <View style={{flex:1,backgroundColor:palette.scrim,padding:20,gap:12}}><Button title="Zamknij zdjęcie" onPress={()=>setImagePreview(null)}/>{imagePreview&&<Image source={{uri:imagePreview}} resizeMode="contain" style={{flex:1}} accessibilityLabel="Podgląd załączonego zdjęcia"/>}</View>
    </Modal>
  </View>;
}
