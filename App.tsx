import React, { useEffect, useState } from 'react';
import { Image, Pressable, SafeAreaView, ScrollView, StatusBar, Text, View, useWindowDimensions } from 'react-native';
import CalendarScreen from './src/screens/CalendarScreen';
import PlannerScreen from './src/screens/PlannerScreen';
import ImportScreen from './src/screens/ImportScreen';
import PublishScreen from './src/screens/PublishScreen';
import NotificationScreen from './src/screens/NotificationScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import { InMemoryDemoRepository } from './src/data/mockRepository';
import { INITIAL_WEEK } from './src/data/fixtures';
import type { CalendarEvent, DemoState } from './src/domain/model';
import { Button, ThemeProvider, ThemeToggle, useTheme, type ThemeMode } from './src/components/ui';
type Route = 'calendar' | 'planner' | 'imports' | 'publish' | 'notifications' | 'settings';
const routes: { id: Route; label: string; short: string }[] = [
  { id: 'calendar', label: 'Week', short: 'Week' }, { id: 'planner', label: 'Work planner', short: 'Plan' },
  { id: 'imports', label: 'Imports', short: 'Import' }, { id: 'publish', label: 'Publish', short: 'Publish' },
  { id: 'notifications', label: 'Notifications', short: 'Alerts' }, { id: 'settings', label: 'Profile', short: 'Profile' },
];
const repository = new InMemoryDemoRepository();
export default function App() {
  const [mode, setMode] = useState<ThemeMode>('light');
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem('kac-theme');
      if (saved === 'dark' || saved === 'light') setMode(saved);
    } catch {}
    setLoaded(true);
  }, []);
  useEffect(() => {
    if (!loaded) return;
    try { window.localStorage.setItem('kac-theme', mode); } catch {}
  }, [loaded, mode]);
  return <ThemeProvider mode={mode} toggleMode={() => setMode((current) => current === 'dark' ? 'light' : 'dark')}><DemoApp /></ThemeProvider>;
}

function DemoApp() {
  const { palette, mode } = useTheme();
  const compact = useWindowDimensions().width < 850;
  const [state, setState] = useState<DemoState>(() => repository.load());
  const [route, setRoute] = useState<Route>('calendar'); const [week, setWeek] = useState(INITIAL_WEEK); const [resetCount, setResetCount] = useState(0); const [banner, setBanner] = useState('');
  const replace = (part: Partial<DemoState>) => setState((current) => ({ ...current, ...part }));
  const setPreferences = (preferences: DemoState["preferences"]) => setState((current) => ({ ...current, preferences, accepted: false, events: current.accepted ? current.events.filter((event) => event.source !== 'planner') : current.events }));
  const setEvents = (value: CalendarEvent[] | ((current: CalendarEvent[]) => CalendarEvent[])) => setState((current) => ({ ...current, events: typeof value === 'function' ? value(current.events) : value, accepted: false }));
  const reset = () => { setState(repository.reset()); setWeek(INITIAL_WEEK); setRoute('calendar'); setResetCount((n) => n + 1); setBanner('Demo reset. All fixture data, planner and notification settings have been restored.'); };
  const screen = () => {
    if (route === 'calendar') return <CalendarScreen key={`calendar-${resetCount}`} events={state.events} setEvents={setEvents} week={week} setWeek={setWeek} onPlanner={() => setRoute('planner')} />;
    if (route === 'planner') return <PlannerScreen key={`planner-${resetCount}`} preferences={state.preferences} setPreferences={setPreferences} events={state.events} proposal={state.proposal} setProposal={(proposal) => replace({ proposal })} accepted={state.accepted} setAccepted={(accepted) => setState((current) => ({ ...current, accepted, events: [...current.events.filter((event) => event.source !== 'planner'), ...(accepted ? current.proposal.map((shift) => ({ ...shift, id: `plan-${shift.id}`, category: 'Work' as const, mandatory: false, repeatWeekly: false, source: 'planner' as const })) : [])] }))} week={week} />;
    if (route === 'imports') return <ImportScreen key={`imports-${resetCount}`} events={state.events} setEvents={setEvents} />;
    if (route === 'publish') return <PublishScreen key={`publish-${resetCount}`} shifts={state.proposal} accepted={state.accepted} published={state.published} setPublished={(published) => replace({ published })} />;
    if (route === 'notifications') return <NotificationScreen key={`notifications-${resetCount}`} preferences={state.notifications} setPreferences={(notifications) => replace({ notifications })} />;
    return <SettingsScreen key={`settings-${resetCount}`} profile={state.profile} setProfile={(profile) => replace({ profile })} preferences={state.preferences} setPreferences={setPreferences} />;
  };
  const navigation = <View accessibilityRole="tablist" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>{routes.map((item) => <Pressable key={item.id} accessibilityRole="tab" accessibilityState={{ selected: route === item.id }} onPress={() => { setRoute(item.id); setBanner(''); }} style={{ paddingHorizontal: compact ? 10 : 12, paddingVertical: 9, borderRadius: 10, backgroundColor: route === item.id ? palette.selected : 'transparent' }}><Text style={{ fontSize: 12, fontWeight: route === item.id ? '800' : '600', color: route === item.id ? palette.blue : palette.muted }}>{compact ? item.short : item.label}</Text></Pressable>)}</View>;
  return <SafeAreaView style={{ flex: 1, backgroundColor: palette.bg }}><StatusBar barStyle={mode === 'dark' ? 'light-content' : 'dark-content'} /><View style={{ flex: 1 }}>
    <View style={{ backgroundColor: palette.surface, borderBottomWidth: 1, borderColor: palette.line, paddingHorizontal: compact ? 12 : 28 }}><View style={{ width: '100%', maxWidth: 1440, alignSelf: 'center', minHeight: 70, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', paddingVertical: 9, gap: 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}><View style={{ width: 46, height: 46, borderRadius: 14, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.line, justifyContent: 'center', alignItems: 'center', overflow: 'hidden' }}><Image accessibilityLabel="Kernel Aura Calendar logo" source={require('./logo.png')} resizeMode="contain" style={{ width: 44, height: 44 }} /></View><View><Text style={{ color: palette.ink, fontSize: 18, fontWeight: '900', letterSpacing: -0.5 }}>kernel <Text style={{ color: palette.blue }}>aura</Text></Text><Text style={{ color: palette.muted, fontSize: 8, fontWeight: '800', letterSpacing: 1.2 }}>CALM BY DESIGN · DEMO</Text></View></View>
      {!compact && navigation}<View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><ThemeToggle /><Button title="Reset demo" onPress={reset} /></View>
    </View>{compact && <View style={{ paddingHorizontal: 12, paddingBottom: 8 }}>{navigation}</View>}</View>
    {!!banner && <View accessibilityLiveRegion="polite" style={{ backgroundColor: palette.greenSoft, paddingVertical: 9, paddingHorizontal: 16 }}><Text style={{ color: palette.green, textAlign: 'center', fontSize: 12, fontWeight: '700' }}>{banner}</Text></View>}
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ flexGrow: 1 }}>{screen()}</ScrollView>
    <View style={{ borderTopWidth: 1, borderColor: palette.line, backgroundColor: palette.surface, paddingHorizontal: 16, paddingVertical: 10 }}><Text style={{ color: palette.muted, fontSize: 10, textAlign: 'center' }}>MOCK DEMO · Integrations and saves are simulated · No backend, OAuth, calendar writes or notifications</Text></View>
  </View></SafeAreaView>;
}
