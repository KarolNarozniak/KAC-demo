import { configureAssistantPreferences, defaultAssistantPreferences, normalizeAssistantPreferences, type AssistantPreferences } from './src/domain/assistantPreferences';
import type { ChatImportHandoff } from './src/services/chatImportApi';
import React, { useCallback, useEffect, useState } from 'react';
import { Text, View, Pressable, Image, Modal, ScrollView, TextInput, Platform } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import type { WeekLayout } from './src/components/WeekGrid';
import CalendarScreen from './src/screens/CalendarScreen';
import ScheduleScreen from './src/screens/ScheduleScreen';
import { BlocksScreen } from './src/screens/BlocksScreen';
import AssistantScreen from './src/screens/AssistantScreen';
import { acknowledgeNotification, claimDueNotifications, getNotificationSettings, getWebPushConfig, registerWebPushSubscription, removeWebPushSubscription, updateNotificationSettings, type DueNotification, type NotificationSettings } from './src/services/notificationsApi';
import type { WeeklySchedule } from './src/services/scheduleApi';
import ScreenTransition from './src/components/ScreenTransition';
import GoogleIntegrationPanel from './src/components/GoogleIntegrationPanel';
import { Button, ThemeProvider, ThemeToggle, useTheme, type ThemeMode } from './src/components/ui';

// Konfiguracja obsługi powiadomień w tle / na pierwszym planie dla Expo (Mobile) z uwzględnieniem właściwości typu NotificationBehavior
Notifications.setNotificationHandler({
    handleNotification: async () => ({
        shouldShowAlert: true,
        shouldPlaySound: true,
        shouldBadge: false,
        shouldShowBanner: true,
        shouldShowList: true,
        shouldSetBadge: true,
    }),
});

const tabs = ['Dziś', 'Tydzień', 'Grafik', 'Blokady', 'Ustawienia', 'Asystent'] as const;

export default function App() {
    const [mode, setMode] = useState<ThemeMode>('dark');
    useEffect(() => {
        AsyncStorage.getItem('kac-theme').then((value) => {
            if (value === 'dark' || value === 'light') setMode(value);
        }).catch(() => { });
    }, []);
    const toggleMode = () => {
        const next = mode === 'dark' ? 'light' : 'dark';
        setMode(next);
        void AsyncStorage.setItem('kac-theme', next).catch(() => { });
    };
    return <SafeAreaProvider><ThemeProvider mode={mode} toggleMode={toggleMode}><StatusBar style={mode === 'dark' ? 'light' : 'dark'} /><CalendarApp /></ThemeProvider></SafeAreaProvider>;
}

function CalendarApp() {
    const { palette, styles } = useTheme();
    const [tab, setTab] = useState<typeof tabs[number]>('Dziś');
    const [week, setWeek] = useState(new Date());
    const [agentPreferences, setAgentPreferences] = useState<AssistantPreferences>({ ...defaultAssistantPreferences });
    const [agentPreferencesLoaded, setAgentPreferencesLoaded] = useState(false);
    const [agentPreferencesSaving, setAgentPreferencesSaving] = useState(false);
    const [agentPreferencesNotice, setAgentPreferencesNotice] = useState('');
    useEffect(() => {
      void AsyncStorage.getItem('kac-assistant-preferences').then((saved) => {
        const value = normalizeAssistantPreferences(saved ? JSON.parse(saved) : defaultAssistantPreferences);
        setAgentPreferences(value); configureAssistantPreferences(value);
      }).catch(() => setAgentPreferencesNotice('Nie udało się wczytać personalizacji agenta.'))
        .finally(() => setAgentPreferencesLoaded(true));
    }, []);
    const saveAgentPreferences = async () => {
      setAgentPreferencesSaving(true); setAgentPreferencesNotice('');
      try {
        const value = normalizeAssistantPreferences(agentPreferences);
        await AsyncStorage.setItem('kac-assistant-preferences', JSON.stringify(value));
        configureAssistantPreferences(value); setAgentPreferences(value);
        setAgentPreferencesNotice('Personalizacja zapisana. Zastosuje się do kolejnych odpowiedzi.');
      } catch { setAgentPreferencesNotice('Nie udało się zapisać personalizacji. Spróbuj ponownie.'); }
      finally { setAgentPreferencesSaving(false); }
    };
    const [importHandoff, setImportHandoff] = useState<ChatImportHandoff|null>(null);
    const [calendarRevision, setCalendarRevision] = useState(0);
    const [schedulePreview, setSchedulePreview] = useState<WeeklySchedule | null>(null);
    const [notificationSettings, setNotificationSettings] = useState<NotificationSettings | null>(null);
    const [notificationError, setNotificationError] = useState('');
    const [notificationMinutes, setNotificationMinutes] = useState('30');
    const [remindersEnabledDraft, setRemindersEnabledDraft] = useState(false);
    const [classRemindersDraft, setClassRemindersDraft] = useState(true);
    const [workRemindersDraft, setWorkRemindersDraft] = useState(true);
    const [privateRemindersDraft, setPrivateRemindersDraft] = useState(true);
    const [savingNotificationSettings, setSavingNotificationSettings] = useState(false);
    const [notificationTarget, setNotificationTarget] = useState<DueNotification | null>(null);
    const [webPushAvailable, setWebPushAvailable] = useState(false);
    const [webPushNotice, setWebPushNotice] = useState('');

    useEffect(() => {
        let alive = true;
        void getNotificationSettings().then((settings) => {
            if (alive) {
                setNotificationSettings(settings);
                setNotificationMinutes(String(settings.minutesBefore));
                setRemindersEnabledDraft(settings.enabled);
                setClassRemindersDraft(settings.classReminders ?? true);
                setWorkRemindersDraft(settings.workRemindersEnabled ?? settings.enabled);
                setPrivateRemindersDraft(settings.privateReminders ?? true);
            }
        }).catch(() => { });
        void getWebPushConfig().then((push) => { if (alive) setWebPushAvailable(push.enabled); }).catch(() => { });
        return () => { alive = false; };
    }, []);

    useEffect(() => {
        if (typeof window === 'undefined' || !window.location?.href) return;
        const url = new URL(window.location.href);
        const eventId = url.searchParams.get('notificationEventId');
        const eventStart = url.searchParams.get('notificationEventStart');
        const eventEnd = url.searchParams.get('notificationEventEnd');
        if (!eventId || !eventStart || !eventEnd) return;
        const [year, month, day] = eventStart.slice(0, 10).split('-').map(Number);
        setWeek(new Date(year, month - 1, day, 12));
        setTab('Tydzień');
        setNotificationTarget({
            id: url.searchParams.get('notificationId') ?? 'push-notification', eventId, type: 'Przypomnienie pracy',
            message: url.searchParams.get('notificationBody') ?? 'Przypomnienie o zmianie', scheduledAt: new Date().toISOString(), eventStart, eventEnd,
            title: url.searchParams.get('notificationTitle') ?? 'Zmiana'
        });
        for (const key of ['notificationId', 'notificationEventId', 'notificationEventStart', 'notificationEventEnd', 'notificationTitle', 'notificationBody']) url.searchParams.delete(key);
        window.history?.replaceState?.(null, '', `${url.pathname}${url.search}${url.hash}`);
    }, []);

    // Obsługa kliknięcia w powiadomienie natywne na urządzeniach mobilnych (Expo)
    useEffect(() => {
        const subscription = Notifications.addNotificationResponseReceivedListener(response => {
            const data = response.notification.request.content.data as { eventStart?: string; notificationItem?: DueNotification };
            if (data?.eventStart) {
                const [year, month, day] = String(data.eventStart).slice(0, 10).split('-').map(Number);
                setWeek(new Date(year, month - 1, day, 12));
                if (data.notificationItem) setNotificationTarget(data.notificationItem);
                setTab('Tydzień');
            }
        });
        return () => subscription.remove();
    }, []);

    // Cykliczne sprawdzanie i wywoływanie powiadomień (obsługuje zarówno Expo Mobile, jak i Web)
    useEffect(() => {
        if (!notificationSettings?.enabled) return;
        let alive = true;
        const checkDue = async () => {
            try {
                const due = await claimDueNotifications();
                if (!alive) return;
                for (const item of due) {
                    try {
                        await Notifications.scheduleNotificationAsync({
                            content: {
                                title: item.title || 'Przypomnienie KAC',
                                body: item.message,
                                data: { eventStart: item.eventStart, notificationItem: item },
                            },
                            trigger: null,
                        });
                    } catch {
                        if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
                            const notification = new Notification(item.title || 'Przypomnienie KAC', { body: item.message, tag: item.id });
                            notification.onclick = () => {
                                const [year, month, day] = item.eventStart.slice(0, 10).split('-').map(Number);
                                setWeek(new Date(year, month - 1, day, 12));
                                setNotificationTarget(item);
                                setTab('Tydzień');
                                globalThis.window?.focus();
                            };
                        }
                    }
                    await acknowledgeNotification(item.id);
                }
            } catch { /* Błędy dostarczenia nie przerywają działania kalendarza. */ }
        };
        void checkDue();
        const timer = setInterval(() => void checkDue(), 30_000);
        return () => { alive = false; clearInterval(timer); };
    }, [notificationSettings]);

    const updateReminderSettings = async (enabled: boolean, minutesBefore: number, classReminders: boolean, workReminders: boolean, privateReminders: boolean) => {
        setSavingNotificationSettings(true); setNotificationError('');
        try {
            const settings = await updateNotificationSettings({
                enabled,
                workRemindersEnabled: workReminders,
                classReminders,
                privateReminders,
                minutesBefore
            });
            setNotificationSettings(settings);
            setNotificationMinutes(String(settings.minutesBefore));
            setRemindersEnabledDraft(settings.enabled);
            setClassRemindersDraft(settings.classReminders ?? classReminders);
            setWorkRemindersDraft(settings.workRemindersEnabled ?? workReminders);
            setPrivateRemindersDraft(settings.privateReminders ?? privateReminders);
            return true;
        } catch (error) {
            setNotificationError(error instanceof Error ? error.message : 'Nie udało się zapisać ustawień powiadomień.');
        } finally {
            setSavingNotificationSettings(false);
        }
        return false;
    };

    const syncWebPushSubscription = async (enabled: boolean) => {
        setWebPushNotice('');
        try {
            if (typeof navigator === 'undefined' || !('serviceWorker' in navigator) || typeof window === 'undefined' || !('PushManager' in window)) {
                if (enabled) setWebPushNotice('Ta przeglądarka nie obsługuje Web Push. Przypomnienia będą dostępne w aktywnej aplikacji.');
                return;
            }
            const registration = await navigator.serviceWorker.getRegistration('/') ?? (enabled ? await navigator.serviceWorker.register('/service-worker.js', { scope: '/' }) : undefined);
            const existing = await registration?.pushManager.getSubscription();
            if (!enabled) {
                if (existing) { await removeWebPushSubscription(existing.endpoint); await existing.unsubscribe(); }
                return;
            }
            const pushConfig = await getWebPushConfig();
            setWebPushAvailable(pushConfig.enabled);
            if (!pushConfig.enabled || !pushConfig.applicationServerKey) {
                setWebPushNotice('Web Push nie jest skonfigurowany na serwerze. Przypomnienia będą dostępne w aktywnej aplikacji.');
                return;
            }
            if (!registration) await navigator.serviceWorker.register('/service-worker.js', { scope: '/' });
            const registrationReady = await navigator.serviceWorker.ready;
            const subscription = existing ?? await registrationReady.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: decodeVapidKey(pushConfig.applicationServerKey) });
            const data = subscription.toJSON();
            if (!data.endpoint || !data.keys?.p256dh || !data.keys.auth) throw new Error('Przeglądarka nie zwróciła kluczy subskrypcji Web Push.');
            await registerWebPushSubscription({ endpoint: data.endpoint, keys: { p256dh: data.keys.p256dh, auth: data.keys.auth }, expirationTime: data.expirationTime });
            setWebPushNotice('Dostawa push po zamknięciu aplikacji jest aktywna dla tej przeglądarki.');
        } catch (error) {
            setWebPushNotice(error instanceof Error ? `Nie udało się skonfigurować Web Push. Przypomnienia lokalne nadal działają. ${error.message}`
                : 'Nie udało się skonfigurować Web Push. Przypomnienia lokalne nadal działają.');
        }
    };

    const decodeVapidKey = (value: string) => {
        const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
        const raw = atob(padded);
        const bytes = new Uint8Array(raw.length);
        for (let index = 0; index < raw.length; index++) bytes[index] = raw.charCodeAt(index);
        return bytes;
    };

    const saveReminderSettings = async () => {
        const value = Number(notificationMinutes);
        if (!Number.isInteger(value) || value < 1 || value > 1440) {
            setNotificationError('Podaj całkowitą liczbę minut od 1 do 1440.');
            return;
        }
        if (remindersEnabledDraft) {
            if (!classRemindersDraft && !workRemindersDraft && !privateRemindersDraft) {
                setNotificationError('Wybierz co najmniej jeden rodzaj wydarzeń (Zajęcia, Praca lub Prywatne).');
                return;
            }
            try {
                const { status: existingStatus } = await Notifications.getPermissionsAsync().catch(() => ({ status: 'denied' }));
                let finalStatus = existingStatus;
                if (existingStatus !== 'granted') {
                    const { status } = await Notifications.requestPermissionsAsync().catch(() => ({ status: 'denied' }));
                    finalStatus = status;
                }
                if (finalStatus !== 'granted') {
                    if (typeof Notification !== 'undefined') {
                        const permission = Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission;
                        if (permission !== 'granted') {
                            setNotificationError('Powiadomienia są zablokowane w ustawieniach urządzenia lub przeglądarki.');
                            return;
                        }
                    } else {
                        setNotificationError('Powiadomienia są zablokowane w ustawieniach urządzenia.');
                        return;
                    }
                }
            } catch (error) {
                setNotificationError(error instanceof Error ? error.message : 'Nie udało się uzyskać zgody na powiadomienia.');
                return;
            }
        }
        const saved = await updateReminderSettings(remindersEnabledDraft, value, classRemindersDraft, workRemindersDraft, privateRemindersDraft);
        if (saved) await syncWebPushSubscription(remindersEnabledDraft);
    };

    const cancelReminderEdit = () => {
        setNotificationMinutes(String(notificationSettings?.minutesBefore ?? 30));
        setRemindersEnabledDraft(Boolean(notificationSettings?.enabled));
        setClassRemindersDraft(notificationSettings?.classReminders ?? true);
        setWorkRemindersDraft(notificationSettings?.workRemindersEnabled ?? true);
        setPrivateRemindersDraft(notificationSettings?.privateReminders ?? true);
        setNotificationError('');
    };

    const [unsavedProfile, setUnsavedProfile] = useState(false);
    const [pendingTab, setPendingTab] = useState<typeof tabs[number] | null>(null);
    const [discardSignal, setDiscardSignal] = useState(0);
    const onUnsavedChange = useCallback((unsaved: boolean) => setUnsavedProfile(unsaved), []);
    const openTab = (item: typeof tabs[number]) => {
        if (unsavedProfile && tab === 'Grafik' && item !== 'Grafik') setPendingTab(item);
        else setTab(item);
    };
    const discardAndLeave = () => {
        setDiscardSignal((value) => value + 1);
        setUnsavedProfile(false);
        if (pendingTab) setTab(pendingTab);
        setPendingTab(null);
    };

    useEffect(() => {
        const target = globalThis as unknown as { addEventListener?: (type: string, listener: (event: { preventDefault: () => void; returnValue: string }) => void) => void; removeEventListener?: (type: string, listener: (event: { preventDefault: () => void; returnValue: string }) => void) => void };
        if (!unsavedProfile || typeof target.addEventListener !== 'function') return;
        const warn = (event: { preventDefault: () => void; returnValue: string }) => { event.preventDefault(); event.returnValue = ''; };
        target.addEventListener('beforeunload', warn);
        return () => target.removeEventListener?.('beforeunload', warn);
    }, [unsavedProfile]);

    const [now, setNow] = useState(() => new Date());
    useEffect(() => {
        const timer = setInterval(() => setNow(new Date()), 1000);
        return () => clearInterval(timer);
    }, []);

    const [weekLayout, setWeekLayout] = useState<WeekLayout>('days-left');
    const [settingsLoaded, setSettingsLoaded] = useState(false);
    const [storageError, setStorageError] = useState('');
    useEffect(() => {
        AsyncStorage.getItem('kac-week-layout').then((value) => {
            if (value === 'days-left' || value === 'days-top') setWeekLayout(value);
        }).catch(() => setStorageError('Nie udało się wczytać ustawień.')).finally(() => setSettingsLoaded(true));
    }, []);

    const changeWeekLayout = async (layout: WeekLayout) => {
        setWeekLayout(layout); setStorageError('');
        try { await AsyncStorage.setItem('kac-week-layout', layout); }
        catch { setStorageError('Nie udało się zapisać ustawienia na urządzeniu.'); }
    };

    return <SafeAreaView style={{ flex: 1, backgroundColor: palette.bg }}>
        <View style={{ paddingHorizontal: 12, paddingVertical: 6, backgroundColor: palette.surface, borderBottomWidth: 1, borderColor: palette.line, flexDirection: 'row', alignItems: 'center' }}>
            <Image accessibilityLabel="Logo Aura Kalendar" source={require('./logo.png')} resizeMode="contain" style={{ width: 36, height: 36 }} />
            <Text numberOfLines={1} style={[styles.heading, { flex: 1, textAlign: 'center', fontSize: 15 }]}>{now.toLocaleDateString('pl-PL', { weekday: 'long', day: 'numeric', month: 'long' })}</Text>
            <View style={{ width: 36 }} />
        </View>

        <ScreenTransition screenIndex={tabs.indexOf(tab)} renderScreen={(index, active) => {
            const route = tabs[index];
            return (
                route === 'Dziś' || route === 'Tydzień' ? <CalendarScreen onContinueInChat={(handoff)=>{setImportHandoff(handoff);setTab('Asystent');}} refreshVersion={calendarRevision} active={active} now={now} weekLayout={weekLayout} todayOnly={route === 'Dziś'} week={week} setWeek={setWeek} draftSchedule={schedulePreview}
                    notificationTarget={route === 'Tydzień' ? notificationTarget : null} onNotificationResolved={() => setNotificationTarget(null)} /> :
                    route === 'Grafik' ? <ScheduleScreen active={active} now={now} week={week} setWeek={setWeek} onPreview={setSchedulePreview} onApproved={() => setTab('Tydzień')} onUnsavedChange={onUnsavedChange} discardSignal={discardSignal} onOpenSettings={() => setTab('Ustawienia')}/> :
                        route === 'Blokady' ? <BlocksScreen /> :
                            route === 'Asystent' ? <AssistantScreen importHandoff={importHandoff} onHandoffConsumed={()=>setImportHandoff(null)} active={active} onCalendarChange={() => setCalendarRevision((value) => value + 1)} /> :
                                route === 'Ustawienia' ? <ScrollView style={{ flex: 1, minHeight: 0 }} contentContainerStyle={[styles.content, { padding: 16, paddingBottom: 32 }]} keyboardShouldPersistTaps="handled">
                                    <View style={[styles.row, { justifyContent: 'space-between', marginBottom: 20 }]}><Text style={styles.heading}>Motyw</Text><ThemeToggle /></View>
                                    <Text style={[styles.heading, { marginBottom: 12 }]}>Układ tygodnia</Text>
                                    <View accessibilityRole="radiogroup" style={{ gap: 8 }}>
                                        {([{ id: 'days-left', label: 'Dni po lewej · godziny u góry' }, { id: 'days-top', label: 'Dni u góry · godziny po lewej' }] as const).map((option) => <Pressable key={option.id} accessibilityRole="radio" accessibilityState={{ checked: weekLayout === option.id, disabled: !settingsLoaded }} disabled={!settingsLoaded} onPress={() => void changeWeekLayout(option.id)} style={{ padding: 14, borderRadius: 8, borderWidth: 1, borderColor: weekLayout === option.id ? palette.blue : palette.line, backgroundColor: weekLayout === option.id ? palette.blueSoft : palette.surface }}><Text style={styles.body}>{weekLayout === option.id ? '◉' : '○'} {option.label}</Text></Pressable>)}
                                    </View>

                                    <View style={[styles.card, { marginTop: 20 }]}>
                                      <Text style={styles.heading}>Personalizacja agenta</Text>
                                      <Text style={[styles.label, { marginTop: 12 }]}>Jak mam się do Ciebie zwracać?</Text>
                                      <TextInput accessibilityLabel="Forma zwracania się przez agenta" value={agentPreferences.addressAs} placeholder="np. Aniu, Panie Adamie" maxLength={60} editable={agentPreferencesLoaded && !agentPreferencesSaving}
                                        onChangeText={(addressAs) => { setAgentPreferencesNotice(''); setAgentPreferences((current) => ({ ...current, addressAs })); }} style={styles.input} />
                                      <Text style={[styles.label, { marginTop: 12 }]}>Ton wypowiedzi</Text>
                                      <View accessibilityRole="radiogroup" style={[styles.row, { flexWrap: 'wrap' }]}>
                                        {([{ tone: 'neutral', label: 'Rzeczowy' }, { tone: 'friendly', label: 'Przyjazny' }, { tone: 'formal', label: 'Formalny' }] as const).map(({ tone, label }) =>
                                          <Pressable key={tone} accessibilityRole="radio" accessibilityState={{ checked: agentPreferences.tone === tone }} disabled={!agentPreferencesLoaded || agentPreferencesSaving}
                                            onPress={() => { setAgentPreferencesNotice(''); setAgentPreferences((current) => ({ ...current, tone })); }} style={{ padding: 10, borderRadius: 8, backgroundColor: agentPreferences.tone === tone ? palette.blueSoft : palette.surfaceAlt }}>
                                            <Text style={styles.body}>{agentPreferences.tone === tone ? '◉' : '○'} {label}</Text>
                                          </Pressable>)}
                                      </View>
                                      <Button title={agentPreferencesSaving ? 'Zapisywanie…' : 'Zapisz personalizację'} primary disabled={!agentPreferencesLoaded || agentPreferencesSaving} onPress={() => void saveAgentPreferences()} />
                                      {!!agentPreferencesNotice && <Text accessibilityLiveRegion="polite" style={styles.muted}>{agentPreferencesNotice}</Text>}
                                    </View>
                                    <View style={[styles.card, { marginTop: 20 }]}>
                                        <Text style={styles.heading}>Przypomnienia i powiadomienia</Text>
                                        <Text style={[styles.muted, { marginVertical: 8 }]}>
                                            Przypomnienia dotyczą zatwierdzonych zmian oraz zaplanowanych wydarzeń. Powiadomienia systemowe wymagają zgody urządzenia.
                                        </Text>
                                        <Text style={styles.muted}>
                                            Uprawnienia: {typeof Notification === 'undefined' ? 'systemowe (Expo)' : Notification.permission === 'granted' ? 'przyznane (Web)' : 'odmówione/nieustalone'}
                                        </Text>
                                        {notificationSettings?.enabled && (
                                            <Text style={styles.muted}>
                                                {notificationSettings.pendingReminderCount > 0
                                                    ? `Zaplanowano przypomnienia dla ${notificationSettings.pendingReminderCount} nadchodzących zdarzeń.`
                                                    : 'Brak nadchodzących zdarzeń wymagających przypomnienia.'}
                                            </Text>
                                        )}
                                        {webPushNotice ? <Text style={styles.muted}>{webPushNotice}</Text> : !webPushAvailable && <Text style={styles.muted}>Web Push nie jest skonfigurowany; przypomnienia działają w aktywnej karcie.</Text>}

                                        <Pressable
                                            accessibilityRole="checkbox"
                                            accessibilityState={{ checked: remindersEnabledDraft }}
                                            onPress={() => setRemindersEnabledDraft(current => !current)}
                                            style={[styles.row, { marginVertical: 12, gap: 10 }]}
                                        >
                                            <Text style={{ fontSize: 18, color: palette.blue }}>{remindersEnabledDraft ? '☑' : '☐'}</Text>
                                            <Text style={styles.body}>Włącz powiadomienia o zmianach i wydarzeniach</Text>
                                        </Pressable>

                                        {remindersEnabledDraft && (
                                            <View style={{ marginLeft: 20, marginBottom: 16, gap: 8 }}>
                                                <Text style={[styles.label, { marginBottom: 4 }]}>RODZAJE WYDARZEŃ OBJĘTE POWIADOMIENIAMI</Text>
                                                <Pressable
                                                    accessibilityRole="checkbox"
                                                    accessibilityState={{ checked: classRemindersDraft }}
                                                    onPress={() => setClassRemindersDraft(current => !current)}
                                                    style={[styles.row, { gap: 10 }]}
                                                >
                                                    <Text style={{ fontSize: 16, color: palette.blue }}>{classRemindersDraft ? '☑' : '☐'}</Text>
                                                    <Text style={styles.body}>Zajęcia</Text>
                                                </Pressable>
                                                <Pressable
                                                    accessibilityRole="checkbox"
                                                    accessibilityState={{ checked: workRemindersDraft }}
                                                    onPress={() => setWorkRemindersDraft(current => !current)}
                                                    style={[styles.row, { gap: 10 }]}
                                                >
                                                    <Text style={{ fontSize: 16, color: palette.blue }}>{workRemindersDraft ? '☑' : '☐'}</Text>
                                                    <Text style={styles.body}>Praca</Text>
                                                </Pressable>
                                                <Pressable
                                                    accessibilityRole="checkbox"
                                                    accessibilityState={{ checked: privateRemindersDraft }}
                                                    onPress={() => setPrivateRemindersDraft(current => !current)}
                                                    style={[styles.row, { gap: 10 }]}
                                                >
                                                    <Text style={{ fontSize: 16, color: palette.blue }}>{privateRemindersDraft ? '☑' : '☐'}</Text>
                                                    <Text style={styles.body}>Prywatne</Text>
                                                </Pressable>
                                            </View>
                                        )}

                                        <View style={[styles.row, { flexWrap: 'wrap', alignItems: 'flex-end', gap: 8 }]}>
                                            <View style={{ width: 180, marginBottom: 8 }}>
                                                <Text style={styles.label}>MINUT PRZED ZDARZENIEM</Text>
                                                <TextInput
                                                    accessibilityLabel="Minut przed zdarzeniem"
                                                    value={notificationMinutes}
                                                    onChangeText={setNotificationMinutes}
                                                    keyboardType="number-pad"
                                                    maxLength={4}
                                                    style={styles.input}
                                                />
                                            </View>
                                            <Button title="Zapisz ustawienia" primary disabled={!notificationSettings || savingNotificationSettings} onPress={() => void saveReminderSettings()} />
                                            <Button title="Anuluj" disabled={!notificationSettings || savingNotificationSettings} onPress={cancelReminderEdit} />
                                        </View>
                                        {!!notificationError && <Text accessibilityRole="alert" style={styles.error}>{notificationError}</Text>}
                                    </View>
                                        <GoogleIntegrationPanel active={active} onShowPlan={() => setTab('Tydzień')} />
                                    {!!storageError && <Text accessibilityRole="alert" style={styles.error}>{storageError}</Text>}
                                </ScrollView> : <View style={[styles.content, { padding: 16 }]}><Text style={styles.heading}>Niedostępna sekcja</Text></View>
            );
        }} />

        <View accessibilityRole="tablist" style={{ flexDirection: 'row', backgroundColor: palette.surface, borderTopWidth: 1, borderColor: palette.line, paddingTop: 4, paddingBottom: 4 }}>
            {tabs.map((item, i) => <Pressable key={item} accessibilityRole="tab" accessibilityState={{ selected: tab === item }} onPress={() => openTab(item)} style={{ flex: 1, minWidth: 0, minHeight: 48, justifyContent: 'center', alignItems: 'center', gap: 4 }}><View style={{ width: 28, height: 24, alignItems: 'center', justifyContent: 'center' }}><Text style={{ fontSize: 20, lineHeight: 24, includeFontPadding: false, textAlign: 'center', color: tab === item ? palette.blue : palette.muted }}>{['◷', '▦', '◫', '⊞', '⚙︎', '✧'][i]}</Text></View><Text style={{ width: '100%', height: 16, lineHeight: 16, includeFontPadding: false, textAlign: 'center', fontSize: 12, fontWeight: '700', color: tab === item ? palette.blue : palette.muted }}>{item}</Text></Pressable>)}
        </View>

        <Modal visible={pendingTab !== null} transparent animationType="fade" onRequestClose={() => setPendingTab(null)}>
            <View style={{ flex: 1, backgroundColor: palette.scrim, alignItems: 'center', justifyContent: 'center', padding: 16 }}>
                <View accessibilityRole="alert" style={[styles.card, { width: '100%', maxWidth: 440 }]}>
                    <Text style={styles.heading}>Niezapisane zmiany w profilu pracy</Text>
                    <Text style={[styles.body, { marginTop: 8 }]}>Jeśli wyjdziesz teraz, zmiany w profilu nie zostaną zapisane i nie wpłyną na planowanie.</Text>
                    <View style={[styles.row, { flexWrap: 'wrap', marginTop: 14 }]}>
                        <Button title="Wróć do edycji" primary onPress={() => setPendingTab(null)} />
                        <Button title="Odrzuć zmiany" danger onPress={discardAndLeave} />
                    </View>
                </View>
            </View>
        </Modal>
    </SafeAreaView>;
}
