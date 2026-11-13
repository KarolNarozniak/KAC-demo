import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { Button, useTheme } from '../components/ui';
import {
  cancelAssistantAction, confirmAssistantAction, createAssistantConversation, deleteAssistantConversation,
  getAssistantConfig, listAssistantConversations, listAssistantMessages, sendAssistantMessage,
  type AssistantConversation, type AssistantMessage, type PendingAssistantAction,
} from '../services/assistantApi';

type Props = { active: boolean; onCalendarChange: () => void };
const textOf = (message: AssistantMessage) => typeof message.content.text === 'string' ? message.content.text : '';
const actionSummary = (action: PendingAssistantAction) => {
  const value = action.payload.event as Record<string, unknown> | undefined;
  if (action.kind === 'calendar_event_delete') {
    const original = action.payload.original as Record<string, unknown> | undefined;
    return `Usunąć „${String(original?.title ?? 'wydarzenie')}”?`;
  }
  if (action.kind === 'calendar_event_update') return `Zaktualizować „${String(value?.title ?? 'wydarzenie')}” na ${String(value?.start ?? '')}?`;
  return `Dodać „${String(value?.title ?? 'wydarzenie')}” · ${String(value?.start ?? '')} – ${String(value?.end ?? '')}?`;
};

export default function AssistantScreen({ active, onCalendarChange }: Props) {
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

  useEffect(() => {
    if (!active) return;
    let alive = true;
    setLoading(true); setError('');
    void Promise.all([getAssistantConfig(), listAssistantConversations()]).then(([config, result]) => {
      if (!alive) return;
      setEnabled(config.enabled); setConversations(result.conversations);
      if (result.conversations[0]) setConversationId(result.conversations[0].id);
    }).catch((reason) => { if (alive) setError(reason instanceof Error ? reason.message : 'Nie udało się połączyć z asystentem.'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [active]);

  useEffect(() => {
    if (!active || !conversationId) { setMessages([]); setPendingActions([]); return; }
    let alive = true;
    setLoading(true); setError('');
    void listAssistantMessages(conversationId).then((result) => {
      if (alive) { setMessages(result.messages); setPendingActions(result.pendingActions); }
    }).catch((reason) => { if (alive) setError(reason instanceof Error ? reason.message : 'Nie udało się wczytać rozmowy.'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [active, conversationId]);

  const send = async (targetConversationId = conversationId) => {
    const content = input.trim();
    if (!content || !targetConversationId || sending || !enabled) return;
    setInput(''); setSending(true); setError('');
    try {
      const result = await sendAssistantMessage(targetConversationId, content);
      const saved = await listAssistantMessages(targetConversationId);
      setMessages(saved.messages); setPendingActions(saved.pendingActions);
      if (!saved.messages.length) setMessages([{ id: `local-${Date.now()}`, role: 'assistant', content: { text: result.message.content }, createdAt: new Date().toISOString() }]);
      setConversations((current) => current.map((item) => item.id === targetConversationId ? { ...item, updatedAt: new Date().toISOString() } : item));
    } catch (reason) { setInput(content); setError(reason instanceof Error ? reason.message : 'Nie udało się wysłać wiadomości.'); }
    finally { setSending(false); }
  };

  const newConversation = async () => {
    if (!enabled || sending) return;
    setLoading(true); setError('');
    try {
      const created = await createAssistantConversation();
      setConversations((current) => [created, ...current]); setConversationId(created.id); setMessages([]); setPendingActions([]);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Nie udało się rozpocząć rozmowy.'); }
    finally { setLoading(false); }
  };

  const confirmAction = async (action: PendingAssistantAction) => {
    setSending(true); setError('');
    try {
      await confirmAssistantAction(action.id);
      setPendingActions((current) => current.filter((item) => item.id !== action.id));
      setMessages((current) => [...current, { id: `confirmed-${Date.now()}`, role: 'assistant',
        content: { text: 'Akcja została zatwierdzona i zapisana w kalendarzu.' }, createdAt: new Date().toISOString() }]);
      onCalendarChange();
    } catch (reason) {
      try { setPendingActions((await listAssistantMessages(conversationId)).pendingActions); } catch { /* keep the current action until refresh succeeds */ }
      setError(reason instanceof Error ? reason.message : 'Nie udało się zatwierdzić akcji.');
    }
    finally { setSending(false); }
  };

  const cancelAction = async (action: PendingAssistantAction) => {
    setSending(true); setError('');
    try {
      await cancelAssistantAction(action.id);
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
      setConversations(remaining); setConversationId(remaining[0]?.id ?? ''); setMessages([]); setPendingActions([]);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Nie udało się usunąć rozmowy.'); }
    finally { setSending(false); }
  };

  return <View style={{ flex: 1, flexDirection: 'row', backgroundColor: palette.bg }}>
    <View style={{ width: 230, maxWidth: '36%', borderRightWidth: 1, borderColor: palette.line, padding: 10, gap: 8 }}>
      <Button title="Nowa rozmowa" primary disabled={!enabled || loading || sending} onPress={() => void newConversation()} />
      <ScrollView contentContainerStyle={{ gap: 6 }}>
        {conversations.map((conversation) => <Pressable key={conversation.id} accessibilityRole="button" accessibilityState={{ selected: conversationId === conversation.id }} onPress={() => setConversationId(conversation.id)} style={{ padding: 10, borderRadius: 9, backgroundColor: conversationId === conversation.id ? palette.blueSoft : palette.surface }}>
          <Text numberOfLines={2} style={[styles.body, { fontWeight: conversationId === conversation.id ? '800' : '500' }]}>{conversation.title || 'Rozmowa'}</Text>
          <Text style={styles.muted}>{new Date(conversation.updatedAt).toLocaleDateString('pl-PL')}</Text>
        </Pressable>)}
      </ScrollView>
      {!!conversationId && <Button title="Usuń rozmowę" danger disabled={sending} onPress={() => void removeConversation()} />}
    </View>

    <View style={{ flex: 1, minWidth: 0, padding: 14 }}>
      <View style={[styles.row, { justifyContent: 'space-between', flexWrap: 'wrap' }]}><View><Text style={styles.heading}>Asystent KAC</Text><Text style={styles.muted}>Kalendarz i planowanie pracy · zmiany wymagają zatwierdzenia</Text></View></View>
      {enabled === false && <View style={[styles.card, { borderColor: palette.amber, marginTop: 12 }]}><Text style={styles.heading}>Azure AI Foundry nie jest skonfigurowane</Text><Text style={styles.body}>Ustaw endpoint projektu i nazwę agenta w konfiguracji API, a lokalnie zaloguj się przez `az login`. Żadna wiadomość nie została wysłana.</Text></View>}
      {!!error && <Text accessibilityRole="alert" style={[styles.error, { marginTop: 8 }]}>{error}</Text>}
      <ScrollView style={{ flex: 1, marginVertical: 10 }} contentContainerStyle={{ gap: 10, paddingBottom: 16 }}>
        {messages.filter((message) => message.role !== 'tool').map((message) => <View key={message.id} style={{ alignSelf: message.role === 'user' ? 'flex-end' : 'flex-start', maxWidth: '90%', padding: 12, borderRadius: 12, backgroundColor: message.role === 'user' ? palette.blueSoft : palette.surface }}>
          <Text style={styles.body}>{String(message.content.text ?? '')}</Text>
          <Text style={[styles.muted, { marginTop: 4 }]}>{message.role === 'user' ? 'Ty' : 'Asystent'} · {new Date(message.createdAt).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' })}</Text>
        </View>)}
        {pendingActions.map((action) => <View key={action.id} style={[styles.card, { borderColor: palette.amber }]}>
          <Text style={styles.heading}>Propozycja do potwierdzenia</Text><Text style={styles.body}>{actionSummary(action)}</Text>
          <Text style={styles.muted}>Ważna do: {new Date(action.expiresAt).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' })}. Kalendarz nie zmieni się bez potwierdzenia.</Text>
          <View style={[styles.row, { flexWrap: 'wrap', marginTop: 8 }]}><Button title="Zatwierdź" primary disabled={sending} onPress={() => void confirmAction(action)} /><Button title="Odrzuć" danger disabled={sending} onPress={() => void cancelAction(action)} /></View>
        </View>)}
        {loading && <Text accessibilityLiveRegion="polite" style={styles.muted}>Wczytywanie…</Text>}
      </ScrollView>
      <View style={[styles.row, { alignItems: 'flex-end' }]}>
        <TextInput value={input} onChangeText={setInput} placeholder={enabled ? 'Zapytaj o kalendarz lub plan pracy…' : 'Skonfiguruj Azure AI, aby rozpocząć'} multiline editable={Boolean(enabled) && !sending}
          accessibilityLabel="Wiadomość do asystenta" onSubmitEditing={() => void send()} style={[styles.input, { flex: 1, minHeight: 48, maxHeight: 120 }]} />
        <Button title={sending ? '…' : 'Wyślij'} primary disabled={!enabled || sending || !input.trim()} onPress={() => void send()} />
      </View>
      <Text style={[styles.muted, { marginTop: 6 }]}>Załączniki i tekst traktowane są jako niezaufane dane. Asystent nie zapisuje zmian bez Twojej akceptacji.</Text>
    </View>
  </View>;
}
