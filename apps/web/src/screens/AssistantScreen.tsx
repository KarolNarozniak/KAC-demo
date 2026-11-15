import React, { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { Button, useTheme } from '../components/ui';
import {
  cancelAssistantAction, confirmAssistantAction, createAssistantConversation, deleteAssistantConversation,
  getAssistantConfig, listAssistantConversations, listAssistantMessages, sendAssistantMessage,
  type AssistantConversation, type AssistantMessage, type PendingAssistantAction,
} from '../services/assistantApi';
import { createdMessage, eventPreview } from '../domain/assistantPreview';

type Props = { active: boolean; onCalendarChange: (dateKey?: string) => void; prefill?: { text: string; nonce: number } | null };
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

export default function AssistantScreen({ active, onCalendarChange, prefill }: Props) {
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
  // S23KC2S1P2-263: jedna decyzja naraz – ref blokuje podwójne kliknięcie, zanim React zdąży przerysować przyciski.
  const decisionInFlight = useRef(false);
  const [busyActionId, setBusyActionId] = useState('');
  const [lastCreated, setLastCreated] = useState<{ text: string; dateKey: string } | null>(null);
  // Pytanie przygotowane na karcie „Twój dzień w skrócie” – użytkownik może je zmienić przed wysłaniem.
  useEffect(() => { if (prefill) setInput(prefill.text); }, [prefill?.nonce]);

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
    setLastCreated(null);
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
    setInput(''); setSending(true); setError(''); setLastCreated(null);
    // Wysłana wiadomość pojawia się od razu; po odpowiedzi lista jest zastępowana historią z serwera.
    const pendingId = `pending-${Date.now()}`;
    setMessages((current) => [...current, { id: pendingId, role: 'user', content: { text: content }, createdAt: new Date().toISOString() }]);
    try {
      const result = await sendAssistantMessage(targetConversationId, content);
      const saved = await listAssistantMessages(targetConversationId);
      setMessages(saved.messages); setPendingActions(saved.pendingActions);
      if (!saved.messages.length) setMessages([{ id: `local-${Date.now()}`, role: 'assistant', content: { text: result.message.content }, createdAt: new Date().toISOString() }]);
      setConversations((current) => current.map((item) => item.id === targetConversationId ? { ...item, updatedAt: new Date().toISOString() } : item));
    } catch (reason) {
      setInput(content); setError(reason instanceof Error ? reason.message : 'Nie udało się wysłać wiadomości.');
      // Serwer mógł już zapisać wiadomość przed błędem modelu – pokazujemy stan z historii, a bez połączenia usuwamy tymczasowy dymek.
      await listAssistantMessages(targetConversationId)
        .then((saved) => { setMessages(saved.messages); setPendingActions(saved.pendingActions); })
        .catch(() => setMessages((current) => current.filter((message) => message.id !== pendingId)));
    }
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
    if (decisionInFlight.current) return;
    decisionInFlight.current = true; setBusyActionId(action.id);
    setSending(true); setError('');
    const preview = eventPreview(action);
    try {
      await confirmAssistantAction(action.id);
      setPendingActions((current) => current.filter((item) => item.id !== action.id));
      const text = preview ? createdMessage(preview) : 'Akcja została zatwierdzona i zapisana w kalendarzu.';
      setMessages((current) => [...current, { id: `confirmed-${Date.now()}`, role: 'assistant', content: { text }, createdAt: new Date().toISOString() }]);
      // Dodanie: zostajemy w rozmowie i dajemy przycisk do daty wydarzenia (scenariusz, krok 6). Edycja/usunięcie (S23KC2S1P2-255) bez zmian.
      if (preview) setLastCreated({ text, dateKey: preview.dateKey });
      else onCalendarChange();
    } catch (reason) {
      // Podgląd zostaje (5b) – po odświeżeniu widać aktualne kolizje i można ponowić tę samą akcję bez duplikatu.
      try { setPendingActions((await listAssistantMessages(conversationId)).pendingActions); } catch { /* keep the current action until refresh succeeds */ }
      setError(reason instanceof Error ? reason.message : 'Nie udało się zatwierdzić akcji.');
    }
    finally { setSending(false); setBusyActionId(''); decisionInFlight.current = false; }
  };

  const cancelAction = async (action: PendingAssistantAction) => {
    if (decisionInFlight.current) return;
    decisionInFlight.current = true; setBusyActionId(action.id);
    setSending(true); setError('');
    try {
      await cancelAssistantAction(action.id);
      setPendingActions((current) => current.filter((item) => item.id !== action.id));
      setMessages((current) => [...current, { id: `cancelled-${Date.now()}`, role: 'assistant', content: { text: 'Propozycja została anulowana. Kalendarz pozostał bez zmian.' }, createdAt: new Date().toISOString() }]);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Nie udało się anulować akcji.'); }
    finally { setSending(false); setBusyActionId(''); decisionInFlight.current = false; }
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
        {/* Wiadomości z samymi wywołaniami narzędzi nie mają tekstu – nie pokazujemy pustych dymków. */}
        {messages.filter((message) => message.role !== 'tool' && textOf(message).trim()).map((message) => <View key={message.id} style={{ alignSelf: message.role === 'user' ? 'flex-end' : 'flex-start', maxWidth: '90%', padding: 12, borderRadius: 12, backgroundColor: message.role === 'user' ? palette.blueSoft : palette.surface }}>
          <Text style={styles.body}>{String(message.content.text ?? '')}</Text>
          <Text style={[styles.muted, { marginTop: 4 }]}>{message.role === 'user' ? 'Ty' : 'Asystent'} · {new Date(message.createdAt).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' })}</Text>
        </View>)}
        {pendingActions.map((action) => {
          const preview = eventPreview(action);
          const expires = new Date(action.expiresAt).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });
          const busy = busyActionId === action.id;
          // S23KC2S1P2-263: pełny podgląd nowego wydarzenia; edycja i usuwanie (S23KC2S1P2-255) zostają przy krótkim opisie.
          if (preview) return <View key={action.id} accessibilityLabel="Podgląd nowego wydarzenia" style={[styles.card, { borderColor: preview.blocked ? palette.red : palette.amber }]}>
            <Text style={styles.heading}>Nowe wydarzenie – sprawdź przed dodaniem</Text>
            {[['Tytuł', preview.title], ['Data', preview.date], ['Godziny', preview.time],
              ['Kategoria', preview.mandatory ? `${preview.category} · ${preview.mandatory}` : preview.category], ['Miejsce', preview.location], ['Powtarzanie', preview.recurrence]]
              .map(([label, value]) => <View key={label} style={[styles.row, { gap: 8, marginTop: 4 }]}><Text style={[styles.muted, { width: 96 }]}>{label}</Text><Text style={[styles.body, { flex: 1 }]}>{value}</Text></View>)}
            {!!preview.collisions.length && <View accessibilityRole="alert" style={{ marginTop: 8 }}>
              <Text style={styles.error}>Koliduje z:</Text>
              {preview.collisions.map((item) => <Text key={item} style={styles.error}>• {item}</Text>)}
            </View>}
            {!!preview.blockReason && <Text style={[styles.muted, { marginTop: 6 }]}>{preview.blockReason}</Text>}
            <Text style={[styles.muted, { marginTop: 6 }]}>Ważna do {expires}. Kalendarz nie zmieni się bez Twojej decyzji.</Text>
            <View style={[styles.row, { flexWrap: 'wrap', marginTop: 8 }]}>
              <Button title={busy ? 'Dodawanie…' : 'Dodaj do kalendarza'} primary disabled={sending || preview.blocked} onPress={() => void confirmAction(action)} />
              <Button title="Anuluj" disabled={sending} onPress={() => void cancelAction(action)} />
            </View>
          </View>;
          return <View key={action.id} style={[styles.card, { borderColor: palette.amber }]}>
            <Text style={styles.heading}>Propozycja do potwierdzenia</Text><Text style={styles.body}>{actionSummary(action)}</Text>
            <Text style={styles.muted}>Ważna do: {expires}. Kalendarz nie zmieni się bez potwierdzenia.</Text>
            <View style={[styles.row, { flexWrap: 'wrap', marginTop: 8 }]}><Button title="Zatwierdź" primary disabled={sending} onPress={() => void confirmAction(action)} /><Button title="Odrzuć" danger disabled={sending} onPress={() => void cancelAction(action)} /></View>
          </View>;
        })}
        {!!lastCreated && <View style={[styles.row, { alignSelf: 'flex-start' }]}>
          <Button title="Pokaż w kalendarzu" accessibilityLabel="Przejdź do daty dodanego wydarzenia w kalendarzu" onPress={() => onCalendarChange(lastCreated.dateKey)} />
        </View>}
        {sending && <View style={{ alignSelf: 'flex-start', padding: 12, borderRadius: 12, backgroundColor: palette.surface }}>
          <Text accessibilityLiveRegion="polite" style={styles.muted}>Asystent pisze…</Text>
        </View>}
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
