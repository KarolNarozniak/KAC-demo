import SelectionMark from './src/components/SelectionMark';
import { configureAssistantPreferences, defaultAssistantPreferences, normalizeAssistantPreferences, type AssistantPreferences } from './src/domain/assistantPreferences';
import type { ChatImportHandoff } from './src/services/chatImportApi';
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Text, View, Pressable, Image, Modal, ScrollView, TextInput, Platform, useWindowDimensions } from 'react-native';
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
import NavigationIcon from './src/components/NavigationIcon';
import KeyboardFrame from './src/components/KeyboardFrame';
import { useKeyboardVisible } from './src/components/keyboardVisibility';
import ScreenTransition from './src/components/ScreenTransition';
import GoogleIntegrationPanel from './src/components/GoogleIntegrationPanel';
import AccountPanel from './src/components/AccountPanel';
import PremiumCrown from './src/components/PremiumCrown';
import PremiumPaywall from './src/components/PremiumPaywall';
import AuthScreen, { type SignInVia } from './src/screens/AuthScreen';
import RecoveryCodeScreen, { type RecoveryCodeReason } from './src/screens/RecoveryCodeScreen';
import { Button, ThemeProvider, ThemeToggle, useTheme, type ThemeMode } from './src/components/ui';
import { authErrorMessage, type AuthSession, type AuthUser } from './src/domain/auth';
import { AuthApiError, currentUser, logout } from './src/services/authApi';
import { forgetDailySummary } from './src/services/assistantApi';
import { onSessionExpired, setSessionToken } from './src/services/http';
import { clearSessionToken, loadSessionToken, saveSessionToken } from './src/services/sessionStore';

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

const tabs = ['Dziś', 'Tydzień', 'Asystent', 'Grafik', 'Blokady', 'Ustawienia'] as const;
const tabIcons = { 'Dziś': 0, 'Tydzień': 1, 'Grafik': 2, 'Blokady': 3, 'Ustawienia': 4, 'Asystent': 5 };

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
    return <SafeAreaProvider><ThemeProvider mode={mode} toggleMode={toggleMode}><StatusBar style={mode === 'dark' ? 'light' : 'dark'} /><KeyboardFrame><AuthGate /></KeyboardFrame></ThemeProvider></SafeAreaProvider>;
}

type AuthState =
    | { status: 'loading' }
    | { status: 'signed-out'; notice?: string }
    | { status: 'offline'; message: string }
    | { status: 'signed-in'; user: AuthUser }
    // Po rejestracji i po resecie hasła: kod odzyskiwania do zapisania, zanim użytkownik wejdzie do aplikacji (sesja jest już zapisana).
    | { status: 'recovery-code'; user: AuthUser; code: string; reason: RecoveryCodeReason };

/** Po wyjściu z konta to urządzenie nie dostaje już jego przypomnień Web Push ani nie pamięta ustawień asystenta. */
async function forgetAccountOnDevice(removeOnServer: boolean) {
    try {
        if (Platform.OS === 'web' && typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
            const registration = await navigator.serviceWorker.getRegistration('/');
            const subscription = await registration?.pushManager?.getSubscription();
            if (subscription) {
                if (removeOnServer) await removeWebPushSubscription(subscription.endpoint).catch(() => undefined);
                await subscription.unsubscribe().catch(() => false);
            }
        }
    } catch { /* przeglądarka bez Web Push */ }
    await AsyncStorage.removeItem('kac-assistant-preferences').catch(() => undefined);
    configureAssistantPreferences({ ...defaultAssistantPreferences });
    forgetDailySummary();
}

/** Logowanie przed kalendarzem: zapisana sesja → /auth/me; wygasła sesja (401) w dowolnym zapytaniu wraca do ekranu logowania. */
function AuthGate() {
    const { palette, styles } = useTheme();
    const [state, setState] = useState<AuthState>({ status: 'loading' });

    const restore = useCallback(async () => {
        setState({ status: 'loading' });
        const token = await loadSessionToken();
        if (!token) { setState({ status: 'signed-out' }); return; }
        setSessionToken(token);
        try {
            setState({ status: 'signed-in', user: await currentUser() });
        } catch (error) {
            // 401 obsługuje onSessionExpired poniżej; brak sieci nie wylogowuje – sesja może być nadal ważna.
            if (error instanceof AuthApiError && error.status === 401) return;
            setState({ status: 'offline', message: error instanceof Error ? error.message : authErrorMessage('network') });
        }
    }, []);

    useEffect(() => onSessionExpired(() => {
        void clearSessionToken();
        void forgetAccountOnDevice(false);
        setState({ status: 'signed-out', notice: authErrorMessage('unauthorized') });
    }), []);
    useEffect(() => { void restore(); }, [restore]);

    const signedIn = (session: AuthSession, via: SignInVia) => {
        setSessionToken(session.token);
        void saveSessionToken(session.token);
        setState(session.recoveryCode
            ? { status: 'recovery-code', user: session.user, code: session.recoveryCode, reason: via === 'recover' ? 'recovered' : 'registered' }
            : { status: 'signed-in', user: session.user });
    };
    // Np. nowy kod odzyskiwania w Ustawieniach – zmienia dane konta bez ponownego logowania.
    const userUpdated = (user: AuthUser) => setState((current) => current.status === 'signed-in' && current.user.id === user.id ? { status: 'signed-in', user } : current);
    const leave = async (notice: string) => {
        setSessionToken(null);
        await clearSessionToken();
        setState({ status: 'signed-out', notice });
    };
    const signOut = async () => {
        await forgetAccountOnDevice(true);
        await logout().catch(() => undefined);
        await leave('Wylogowano. Do zobaczenia!');
    };
    const accountDeleted = async () => {
        await forgetAccountOnDevice(false);
        await leave('Konto i jego dane zostały usunięte.');
    };

    if (state.status === 'signed-in') return <CalendarApp key={state.user.id} user={state.user} onSignOut={signOut} onAccountDeleted={accountDeleted} onUserUpdated={userUpdated} />;
    if (state.status === 'recovery-code') {
        const { user } = state;
        return <RecoveryCodeScreen code={state.code} reason={state.reason} onContinue={() => setState({ status: 'signed-in', user })} />;
    }
    if (state.status === 'signed-out') return <AuthScreen notice={state.notice} onSignedIn={signedIn} />;
    return <SafeAreaView style={{ flex: 1, backgroundColor: palette.bg, alignItems: 'center', justifyContent: 'center', padding: 16 }}>
        <Image accessibilityLabel="Logo Aura Kalendar" source={require('./logo.png')} resizeMode="contain" style={{ width: 56, height: 56, marginBottom: 16 }} />
        {state.status === 'loading' ? <ActivityIndicator accessibilityLabel="Wczytywanie" color={palette.blue} /> :
            <View accessibilityRole="alert" style={[styles.card, { width: '100%', maxWidth: 440 }]}>
                <Text style={styles.heading}>Nie można połączyć się z KAC</Text>
                <Text style={[styles.body, { marginTop: 8 }]}>{state.message}</Text>
                <View style={[styles.row, { flexWrap: 'wrap', marginTop: 14 }]}>
                    <Button title="Spróbuj ponownie" primary onPress={() => void restore()} />
                    <Button title="Wyloguj na tym urządzeniu" onPress={() => void forgetAccountOnDevice(false).then(() => leave('Wylogowano na tym urządzeniu.'))} />
                </View>
            </View>}
    </SafeAreaView>;
}

function CalendarApp({ user, onSignOut, onAccountDeleted, onUserUpdated }: {
    user: AuthUser; onSignOut: () => Promise<void>; onAccountDeleted: () => Promise<void>; onUserUpdated: (user: AuthUser) => void;
}) {
    const { palette, styles } = useTheme();
    const desktop = useWindowDimensions().width >= 1000;
    const keyboardVisible = useKeyboardVisible();
    const [menuOpen, setMenuOpen] = useState(false);
    const [premiumPaywallOpen, setPremiumPaywallOpen] = useState(false);
    const [premiumReturnTo, setPremiumReturnTo] = useState<'classes' | 'work' | null>(null);
    const [resumePremiumImport, setResumePremiumImport] = useState<'classes' | 'work' | null>(null);
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
    const openPremiumPaywall = (returnTo?: 'classes' | 'work') => { setPremiumReturnTo(returnTo ?? null); setPremiumPaywallOpen(true); };
    const closePremiumPaywall = (redeemed = false) => {
        setPremiumPaywallOpen(false);
        setResumePremiumImport(redeemed ? premiumReturnTo : null);
        setPremiumReturnTo(null);
    };

    useEffect(() => {
        let alive = true;
        const settingsLoad = getNotificationSettings();
        const pushConfigLoad = getWebPushConfig();
        void settingsLoad.then((settings) => {
            if (alive) {
                setNotificationSettings(settings);
                setNotificationMinutes(String(settings.minutesBefore));
                setRemindersEnabledDraft(settings.enabled);
                setClassRemindersDraft(settings.classReminders ?? true);
                setWorkRemindersDraft(settings.workRemindersEnabled ?? settings.enabled);
                setPrivateRemindersDraft(settings.privateReminders ?? true);
            }
        }).catch(() => { });
        void pushConfigLoad.then((push) => { if (alive) setWebPushAvailable(push.enabled); }).catch(() => { });
        // Wylogowanie wyłącza Web Push tej przeglądarki (forgetAccountOnDevice) – po zalogowaniu przywracamy go dla bieżącego konta.
        void Promise.all([settingsLoad, pushConfigLoad]).then(([settings, push]) => {
            const granted = Platform.OS === 'web' && typeof Notification !== 'undefined' && Notification.permission === 'granted';
            if (alive && settings.enabled && push.enabled && granted) void syncWebPushSubscription(true);
        }).catch(() => { });
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

    // Rejestracja Service Workera od razu przy uruchomieniu aplikacji webowej (wymagane przez Chrome na Androidzie)
    useEffect(() => {
        if (Platform.OS === 'web' && typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
            void navigator.serviceWorker.register('/service-worker.js', { scope: '/' }).catch(() => undefined);
        }
    }, []);

    // Cykliczne sprawdzanie i wywoływanie powiadomień (obsługuje zarówno Expo Mobile, jak i Web/Android)
    useEffect(() => {
        if (!notificationSettings?.enabled) return;
        let alive = true;
        const checkDue = async () => {
            try {
                const due = await claimDueNotifications();
                if (!alive) return;
                for (const item of due) {
                    if (Platform.OS === 'web') {
                        if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
                            const title = item.title || 'Przypomnienie KAC';
                            const options = {
                                body: item.message,
                                tag: item.id,
                                data: {
                                    notificationId: item.id,
                                    eventId: item.eventId,
                                    eventStart: item.eventStart,
                                    eventEnd: item.eventEnd,
                                    title,
                                    body: item.message,
                                },
                            };
                            const registration = 'serviceWorker' in navigator
                                ? (await navigator.serviceWorker.getRegistration('/')) ?? (await navigator.serviceWorker.register('/service-worker.js', { scope: '/' }).catch(() => undefined))
                                : undefined;
                            if (registration) {
								const activeRegistration = registration.active ? registration : await navigator.serviceWorker.ready;
								await activeRegistration.showNotification(title, options);
							} else {
                                const notification = new Notification(title, options);
                                notification.onclick = () => {
                                    const [year, month, day] = item.eventStart.slice(0, 10).split('-').map(Number);
                                    setWeek(new Date(year, month - 1, day, 12));
                                    setNotificationTarget(item);
                                    setTab('Tydzień');
                                    globalThis.window?.focus();
                                };
                            }
                        }
                    } else {
                        await Notifications.scheduleNotificationAsync({
                            content: {
                                title: item.title || 'Przypomnienie KAC',
                                body: item.message,
                                data: { eventStart: item.eventStart, notificationItem: item },
                            },
                            trigger: null,
                        });
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

    const [weekLayout, setWeekLayout] = useState<WeekLayout>('days-top');
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
        <View style={{ paddingHorizontal: desktop ? 28 : 16, paddingVertical: 12, backgroundColor: palette.surface, borderBottomWidth: 1, borderColor: palette.line, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Image accessibilityLabel="Logo Aura Kalendar" source={require('./logo.png')} resizeMode="contain" style={{ width: 36, height: 36 }} />
            {desktop && <Text style={[styles.heading, { fontSize: 20, marginRight: 26 }]}>Aura<Text style={{ color: palette.blue }}> Kalendar</Text></Text>}
            {desktop && <View accessibilityRole="tablist" style={{ flexDirection: 'row', flex: 1, gap: 4 }}>{tabs.map(item => <Pressable key={item} accessibilityRole="tab" accessibilityState={{ selected: tab === item }} onPress={() => openTab(item)} style={{ minHeight: 44, paddingHorizontal: 16, justifyContent: 'center', borderRadius: 10, backgroundColor: tab === item ? palette.blueSoft : 'transparent' }}><View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}><Text style={[styles.body, { fontWeight: '700', color: tab === item ? palette.blue : palette.muted }]}>{item}</Text>{item === 'Asystent' && <PremiumCrown size={12} />}</View></Pressable>)}</View>}
            <Text numberOfLines={1} style={[styles.muted, { flex: desktop ? undefined : 1, textAlign: desktop ? 'right' : 'center', fontWeight: '600' }]}>{now.toLocaleDateString('pl-PL', { weekday: 'long', day: 'numeric', month: 'long' })}</Text>
            {!desktop && <Pressable accessibilityRole="button" accessibilityLabel="Menu" accessibilityState={{ expanded: menuOpen }} onPress={() => setMenuOpen(value => !value)} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center', gap: 5, borderRadius: 10, backgroundColor: menuOpen ? palette.blueSoft : 'transparent' }}>
                {[0, 1, 2].map(line => <View key={line} style={{ width: 20, height: 2, borderRadius: 1, backgroundColor: palette.ink }} />)}
            </Pressable>}
        </View>

        <ScreenTransition screenIndex={tabs.indexOf(tab)} renderScreen={(index, active) => {
            const route = tabs[index];
            return (
                route === 'Dziś' || route === 'Tydzień' ? <CalendarScreen isPremium={user.isPremium} onOpenPremium={openPremiumPaywall} resumePremiumImport={resumePremiumImport} onPremiumResumeConsumed={() => setResumePremiumImport(null)} onContinueInChat={(handoff)=>{setImportHandoff(handoff);setTab('Asystent');}} refreshVersion={calendarRevision} active={active} now={now} weekLayout={weekLayout} todayOnly={route === 'Dziś'} week={week} setWeek={setWeek} draftSchedule={schedulePreview}
                    notificationTarget={route === 'Tydzień' ? notificationTarget : null} onNotificationResolved={() => setNotificationTarget(null)} /> :
                    route === 'Grafik' ? <ScheduleScreen active={active} now={now} week={week} setWeek={setWeek} onPreview={setSchedulePreview} onApproved={() => setTab('Tydzień')} onUnsavedChange={onUnsavedChange} discardSignal={discardSignal} onOpenSettings={() => setTab('Ustawienia')}/> :
                        route === 'Blokady' ? <BlocksScreen /> :
                            route === 'Asystent' ? <AssistantScreen isPremium={user.isPremium} onOpenPremium={openPremiumPaywall} importHandoff={importHandoff} onHandoffConsumed={()=>setImportHandoff(null)} active={active} onCalendarChange={() => setCalendarRevision((value) => value + 1)} /> :
                                route === 'Ustawienia' ? <ScrollView style={{ flex: 1, minHeight: 0 }} contentContainerStyle={[styles.content, { maxWidth: 860, padding: desktop ? 32 : 16, paddingBottom: 40 }]} keyboardShouldPersistTaps="handled">
                                    <Text accessibilityRole="header" style={styles.title}>Ustawienia</Text><Text style={[styles.subtitle, { marginBottom: 24 }]}>Dostosuj kalendarz do swojego dnia.</Text>
                                    <AccountPanel user={user} onSignOut={onSignOut} onAccountDeleted={onAccountDeleted} onUserUpdated={onUserUpdated} onOpenPremium={openPremiumPaywall} />
                                    <View style={[styles.row, { justifyContent: 'space-between', marginBottom: 20 }]}><Text style={styles.heading}>Motyw</Text><ThemeToggle /></View>
                                    <Text style={[styles.heading, { marginBottom: 8 }]}>Układ tygodnia na komputerze</Text><Text style={[styles.muted, { marginBottom: 12 }]}>Motyw i układ zapisują się automatycznie. Na telefonie tydzień wyświetla się jako lista.</Text>
                                    <View accessibilityRole="radiogroup" style={{ gap: 8 }}>
                                        {([{ id: 'days-left', label: 'Dni po lewej · godziny u góry' }, { id: 'days-top', label: 'Dni u góry · godziny po lewej' }] as const).map((option) => <Pressable key={option.id} accessibilityRole="radio" accessibilityState={{ checked: weekLayout === option.id, disabled: !settingsLoaded }} disabled={!settingsLoaded} onPress={() => void changeWeekLayout(option.id)} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, borderRadius: 8, borderWidth: 1, borderColor: weekLayout === option.id ? palette.blue : palette.line, backgroundColor: weekLayout === option.id ? palette.blueSoft : palette.surface }}><SelectionMark radio checked={weekLayout === option.id} /><Text style={[styles.body, { flex: 1 }]}>{option.label}</Text></Pressable>)}
                                    </View>

                                    <View style={[styles.card, { marginTop: 20 }]}>
                                      <Text style={styles.heading}>Personalizacja agenta</Text>
                                      <Text style={[styles.label, { marginTop: 12 }]}>Jak mam się do Ciebie zwracać?</Text>
                                      <TextInput accessibilityLabel="Forma zwracania się przez agenta" value={agentPreferences.addressAs} placeholder="np. Aniu, Panie Adamie" maxLength={60} editable={agentPreferencesLoaded && !agentPreferencesSaving}
                                        onChangeText={(addressAs) => { setAgentPreferencesNotice(''); setAgentPreferences((current) => ({ ...current, addressAs })); }} style={styles.input} />
                                      <Text style={[styles.label, { marginTop: 12 }]}>Ton wypowiedzi</Text>
                                      <View accessibilityRole="radiogroup" style={[styles.row, { flexWrap: 'wrap', marginBottom: 14 }]}>
                                        {([{ tone: 'neutral', label: 'Rzeczowy' }, { tone: 'friendly', label: 'Przyjazny' }, { tone: 'formal', label: 'Formalny' }] as const).map(({ tone, label }) =>
                                          <Pressable key={tone} accessibilityRole="radio" accessibilityState={{ checked: agentPreferences.tone === tone }} disabled={!agentPreferencesLoaded || agentPreferencesSaving}
                                            onPress={() => { setAgentPreferencesNotice(''); setAgentPreferences((current) => ({ ...current, tone })); }} style={{ padding: 10, borderRadius: 8, backgroundColor: agentPreferences.tone === tone ? palette.blueSoft : palette.surfaceAlt }}>
                                            <View style={styles.row}><SelectionMark radio checked={agentPreferences.tone === tone} /><Text style={styles.body}>{label}</Text></View>
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
                                            Uprawnienia: {typeof Notification === 'undefined' ? 'systemowe (Expo)' : Notification.permission === 'granted' ? 'przyznane' : Notification.permission === 'denied' ? 'wyłączone w przeglądarce' : 'jeszcze nieprzyznane'}
                                        </Text>
                                        {notificationSettings?.enabled && (
                                            <Text style={styles.muted}>
                                                {notificationSettings.pendingReminderCount > 0
                                                    ? `Zaplanowano przypomnienia dla ${notificationSettings.pendingReminderCount} nadchodzących zdarzeń.`
                                                    : 'Brak nadchodzących zdarzeń wymagających przypomnienia.'}
                                            </Text>
                                        )}
                                        {webPushNotice ? <Text style={styles.muted}>{webPushNotice}</Text> : !webPushAvailable && <Text style={styles.muted}>Przypomnienia są dostępne podczas korzystania z aplikacji.</Text>}

                                        <Pressable
                                            accessibilityRole="checkbox"
                                            accessibilityState={{ checked: remindersEnabledDraft }}
                                            onPress={() => setRemindersEnabledDraft(current => !current)}
                                            style={[styles.row, { marginVertical: 12, gap: 10 }]}
                                        >
                                            <SelectionMark checked={remindersEnabledDraft} />
                                            <Text style={[styles.body, { flex: 1 }]}>Włącz powiadomienia o zmianach i wydarzeniach</Text>
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
                                                    <SelectionMark checked={classRemindersDraft} />
                                                    <Text style={styles.body}>Zajęcia</Text>
                                                </Pressable>
                                                <Pressable
                                                    accessibilityRole="checkbox"
                                                    accessibilityState={{ checked: workRemindersDraft }}
                                                    onPress={() => setWorkRemindersDraft(current => !current)}
                                                    style={[styles.row, { gap: 10 }]}
                                                >
                                                    <SelectionMark checked={workRemindersDraft} />
                                                    <Text style={styles.body}>Praca</Text>
                                                </Pressable>
                                                <Pressable
                                                    accessibilityRole="checkbox"
                                                    accessibilityState={{ checked: privateRemindersDraft }}
                                                    onPress={() => setPrivateRemindersDraft(current => !current)}
                                                    style={[styles.row, { gap: 10 }]}
                                                >
                                                    <SelectionMark checked={privateRemindersDraft} />
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

        {!desktop && !keyboardVisible && <View accessibilityRole="tablist" style={{ flexDirection: 'row', backgroundColor: palette.surface, borderTopWidth: 1, borderColor: palette.line, paddingTop: 6, paddingBottom: 6 }}>
            {tabs.filter(item => item !== 'Blokady' && item !== 'Ustawienia').map(item => <Pressable key={item} accessibilityRole="tab" accessibilityState={{ selected: tab === item }} onPress={() => openTab(item)} style={{ flex: 1, minWidth: 0, minHeight: 48, justifyContent: 'center', alignItems: 'center', gap: 4 }}><View style={{ width: 28, height: 24, alignItems: 'center', justifyContent: 'center' }}><NavigationIcon index={tabIcons[item]} color={tab === item ? palette.blue : palette.muted} />{item === 'Asystent' && <View style={{ position: 'absolute', top: -5, right: -6 }}><PremiumCrown size={10} /></View>}</View><Text style={{ width: '100%', height: 16, lineHeight: 16, includeFontPadding: false, textAlign: 'center', fontSize: 12, fontWeight: '700', color: tab === item ? palette.blue : palette.muted }}>{item}</Text></Pressable>)}
        </View>}

        <Modal visible={menuOpen} transparent animationType="fade" onRequestClose={() => setMenuOpen(false)}>
            <Pressable accessibilityRole="button" accessibilityLabel="Zamknij menu" onPress={() => setMenuOpen(false)} style={{ flex: 1, backgroundColor: palette.scrim, alignItems: 'flex-end', padding: 16, paddingTop: 76 }}>
                <View accessibilityRole="menu" style={[styles.card, { width: 260, padding: 12, gap: 8 }]}>
                    {(['Blokady', 'Ustawienia'] as const).map(item => <Pressable key={item} accessibilityRole="menuitem" onPress={() => { setMenuOpen(false); openTab(item); }} style={{ padding: 14, minHeight: 48, borderRadius: 10, backgroundColor: tab === item ? palette.blueSoft : palette.surfaceAlt }}><Text style={[styles.body, { fontWeight: '700' }]}>{item}</Text></Pressable>)}
                </View>
            </Pressable>
        </Modal>

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
        <PremiumPaywall visible={premiumPaywallOpen} user={user} onClose={closePremiumPaywall} onUserUpdated={onUserUpdated} />
    </SafeAreaView>;
}