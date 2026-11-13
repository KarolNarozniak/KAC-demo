import React, { useCallback, useEffect, useState } from 'react';
import { Text, View, Pressable, Image, Modal, ScrollView } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { WeekLayout } from './src/components/WeekGrid';
import CalendarScreen from './src/screens/CalendarScreen';
import ScheduleScreen from './src/screens/ScheduleScreen';
import { BlocksScreen } from './src/screens/BlocksScreen';
import AssistantScreen from './src/screens/AssistantScreen';
import { claimDueNotifications, getNotificationSettings, updateNotificationSettings, type NotificationSettings } from './src/services/notificationsApi';
import type { WeeklySchedule } from './src/services/scheduleApi';
import ScreenTransition from './src/components/ScreenTransition';
import { Button, ThemeProvider, ThemeToggle, useTheme, type ThemeMode } from './src/components/ui';

const tabs = ['Dziś', 'Tydzień', 'Grafik', 'Blokady', 'Ustawienia', 'Asystent'] as const;

export default function App() {
  const [mode, setMode] = useState<ThemeMode>('dark');
  useEffect(() => {
    AsyncStorage.getItem('kac-theme').then((value) => {
      if (value === 'dark' || value === 'light') setMode(value);
    }).catch(() => {});
  }, []);
  const toggleMode = () => {
    const next = mode === 'dark' ? 'light' : 'dark';
    setMode(next);
    void AsyncStorage.setItem('kac-theme', next).catch(() => {});
  };
  return <SafeAreaProvider><ThemeProvider mode={mode} toggleMode={toggleMode}><StatusBar style={mode === 'dark' ? 'light' : 'dark'} /><CalendarApp /></ThemeProvider></SafeAreaProvider>;
}

function CalendarApp() {
  const { palette, styles } = useTheme();
  const [tab, setTab] = useState<typeof tabs[number]>('Dziś');
  const [week, setWeek] = useState(new Date());
  const [schedulePreview, setSchedulePreview] = useState<WeeklySchedule | null>(null);
  const [notificationSettings, setNotificationSettings] = useState<NotificationSettings | null>(null);
  const [notificationError, setNotificationError] = useState('');

  useEffect(() => {
    let alive = true;
    void getNotificationSettings().then((settings) => { if (alive) setNotificationSettings(settings); }).catch(() => {});
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!notificationSettings?.enabled || typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    let alive = true;
    const checkDue = async () => {
      try {
        const due = await claimDueNotifications();
        if (!alive) return;
        for (const item of due) new Notification(item.title || 'Przypomnienie KAC', { body: item.message, tag: item.id });
      } catch { /* Notification delivery must not interrupt calendar use. */ }
    };
    void checkDue();
    const timer = setInterval(() => void checkDue(), 30_000);
    return () => { alive = false; clearInterval(timer); };
  }, [notificationSettings]);

  const enableNotifications = async () => {
    if (typeof Notification === 'undefined') { setNotificationError('Ta przeglądarka nie obsługuje powiadomień systemowych.'); return; }
    try {
      const permission = Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission;
      const settings = await updateNotificationSettings({ enabled: permission === 'granted', workRemindersEnabled: true, minutesBefore: notificationSettings?.minutesBefore ?? 30 });
      setNotificationSettings(settings);
      setNotificationError(permission === 'granted' ? '' : 'Powiadomienia są zablokowane w ustawieniach przeglądarki.');
    } catch (error) { setNotificationError(error instanceof Error ? error.message : 'Nie udało się zapisać ustawień powiadomień.'); }
  };

  // S23KC2S1P2-15, 3a: wyjście z zakładki „Grafik” z niezapisanymi zmianami profilu wymaga decyzji.
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

  // W przeglądarce: ostrzeżenie przy zamykaniu karty albo odświeżaniu z niezapisanymi zmianami.
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
        route === 'Dziś' || route === 'Tydzień' ? <CalendarScreen active={active} now={now} weekLayout={weekLayout} todayOnly={route === 'Dziś'} week={week} setWeek={setWeek} draftSchedule={schedulePreview} /> :
        route === 'Grafik' ? <ScheduleScreen active={active} now={now} week={week} setWeek={setWeek} onPreview={setSchedulePreview} onApproved={() => setTab('Tydzień')} onUnsavedChange={onUnsavedChange} discardSignal={discardSignal} /> :
        route === 'Blokady' ? <BlocksScreen /> :
        route === 'Asystent' ? <AssistantScreen active={active} onCalendarChange={() => setTab('Tydzień')} /> :
        route === 'Ustawienia' ? <ScrollView style={{ flex: 1, minHeight: 0 }} contentContainerStyle={[styles.content, { padding: 16, paddingBottom: 32 }]} keyboardShouldPersistTaps="handled">
          <View style={[styles.row, { justifyContent: 'space-between', marginBottom: 20 }]}><Text style={styles.heading}>Motyw</Text><ThemeToggle /></View>
           <Text style={[styles.heading, { marginBottom: 12 }]}>Układ tygodnia</Text>
          <View accessibilityRole="radiogroup" style={{ gap: 8 }}>
            {([{ id: 'days-left', label: 'Dni po lewej · godziny u góry' }, { id: 'days-top', label: 'Dni u góry · godziny po lewej' }] as const).map((option) => <Pressable key={option.id} accessibilityRole="radio" accessibilityState={{ checked: weekLayout === option.id, disabled: !settingsLoaded }} disabled={!settingsLoaded} onPress={() => void changeWeekLayout(option.id)} style={{ padding: 14, borderRadius: 8, borderWidth: 1, borderColor: weekLayout === option.id ? palette.blue : palette.line, backgroundColor: weekLayout === option.id ? palette.blueSoft : palette.surface }}><Text style={styles.body}>{weekLayout === option.id ? '◉' : '○'} {option.label}</Text></Pressable>)}
           </View>
           <View style={[styles.card, { marginTop: 20 }]}>
             <Text style={styles.heading}>Przypomnienia o zmianie pracy</Text>
             <Text style={[styles.muted, { marginVertical: 8 }]}>Wymaga zgody na powiadomienia tej przeglądarki. Serwer planuje tylko zatwierdzone zmiany.</Text>
             <Button title={notificationSettings?.enabled ? 'Powiadomienia włączone' : 'Włącz powiadomienia'} primary={!notificationSettings?.enabled} disabled={!notificationSettings} onPress={() => void enableNotifications()} />
             {!!notificationError && <Text accessibilityRole="alert" style={styles.error}>{notificationError}</Text>}
           </View>
          {!!storageError && <Text accessibilityRole="alert" style={styles.error}>{storageError}</Text>}
         </ScrollView> : <View style={[styles.content,{padding:16}]}><Text style={styles.heading}>Niedostępna sekcja</Text></View>
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
