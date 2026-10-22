import React, { useEffect, useState } from 'react';
import { SafeAreaView, Text, View, Pressable, Image } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { WeekLayout } from './src/components/WeekGrid';
import CalendarScreen from './src/screens/CalendarScreen';
import ScreenTransition from './src/components/ScreenTransition';
import { ThemeProvider, ThemeToggle, useTheme, type ThemeMode } from './src/components/ui';
const tabs = ['Dziś', 'Tydzień', 'Ustawienia', 'Asystent'] as const;
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
  return <ThemeProvider mode={mode} toggleMode={toggleMode}><CalendarApp /></ThemeProvider>;
}
function CalendarApp() {
  const { palette, styles } = useTheme();
  const [tab, setTab] = useState<typeof tabs[number]>('Dziś');
  const [week, setWeek] = useState(new Date());
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
      return (route === 'Dziś' || route === 'Tydzień' ? <CalendarScreen active={active} now={now} weekLayout={weekLayout} todayOnly={route === 'Dziś'} week={week} setWeek={setWeek} /> : route === 'Ustawienia' ? <View style={[styles.content, { padding: 16 }]}>
        <View style={[styles.row, { justifyContent: 'space-between', marginBottom: 20 }]}><Text style={styles.heading}>Motyw</Text><ThemeToggle /></View>
        <Text style={[styles.heading, { marginBottom: 12 }]}>Układ tygodnia</Text>
        <View accessibilityRole="radiogroup" style={{ gap: 8 }}>
          {([{ id: 'days-left', label: 'Dni po lewej · godziny u góry' }, { id: 'days-top', label: 'Dni u góry · godziny po lewej' }] as const).map((option) => <Pressable key={option.id} accessibilityRole="radio" accessibilityState={{ checked: weekLayout === option.id, disabled: !settingsLoaded }} disabled={!settingsLoaded} onPress={() => void changeWeekLayout(option.id)} style={{ padding: 14, borderRadius: 8, borderWidth: 1, borderColor: weekLayout === option.id ? palette.blue : palette.line, backgroundColor: weekLayout === option.id ? palette.blueSoft : palette.surface }}><Text style={styles.body}>{weekLayout === option.id ? '◉' : '○'} {option.label}</Text></Pressable>)}
        </View>
        {!!storageError && <Text accessibilityRole="alert" style={styles.error}>{storageError}</Text>}
      </View> : <View style={[styles.content, { padding: 16 }]}><Text style={styles.heading}>Asystent</Text><Text style={styles.subtitle}>Wkrótce</Text></View>);
    }} />
    <View accessibilityRole="tablist" style={{ flexDirection: 'row', backgroundColor: palette.surface, borderTopWidth: 1, borderColor: palette.line, paddingTop: 4, paddingBottom: 4 }}>
      {tabs.map((item, i) => <Pressable key={item} accessibilityRole="tab" accessibilityState={{ selected: tab === item }} onPress={() => setTab(item)} style={{ flex: 1, minWidth: 0, minHeight: 48, justifyContent: 'center', alignItems: 'center', gap: 4 }}><View style={{ width: 28, height: 24, alignItems: 'center', justifyContent: 'center' }}><Text style={{ fontSize: 20, lineHeight: 24, includeFontPadding: false, textAlign: 'center', color: tab === item ? palette.blue : palette.muted }}>{['◷', '▦', '⚙︎', '✧'][i]}</Text></View><Text style={{ width: '100%', height: 16, lineHeight: 16, includeFontPadding: false, textAlign: 'center', fontSize: 12, fontWeight: '700', color: tab === item ? palette.blue : palette.muted }}>{item}</Text></Pressable>)}
    </View>
  </SafeAreaView>;
}
