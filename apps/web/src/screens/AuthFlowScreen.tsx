import React, { useState } from 'react';
import { Image, Pressable, SafeAreaView, ScrollView, StatusBar, Text, View, useWindowDimensions } from 'react-native';
import type { DemoProfile } from '../domain/model';
import { Button, Card, Field, MockNotice, Pill, ThemeToggle, useTheme } from '../components/ui';

type Step = 'welcome' | 'login' | 'register' | 'reset' | 'profile' | 'calendar' | 'study';

const sampleProfile: DemoProfile = {
  name: 'Andrzej Stasiak',
  email: 'u123456@student.wat.edu.pl',
  studyProgram: 'Kryptologia i Cyberbezpieczeństwo',
  timezone: 'Europe/Warsaw',
  studentId: 'u123456',
  academicYear: '2023/2024',
};

const addressIsValid = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

export default function AuthFlowScreen({ onComplete, existingProfile }: { onComplete: (profile: DemoProfile) => void; existingProfile: DemoProfile | null }) {
  const { palette, styles, mode } = useTheme();
  const compact = useWindowDimensions().width < 820;
  const [step, setStep] = useState<Step>('welcome');
  const [profile, setProfile] = useState<DemoProfile>({ name: '', email: '', studyProgram: '', timezone: 'Europe/Warsaw' });
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [studentId, setStudentId] = useState('');
  const [academicYear, setAcademicYear] = useState('');
  const [googleCalendarConnected, setGoogleCalendarConnected] = useState(false);
  const [selectedCalendars, setSelectedCalendars] = useState<string[]>(['Uczelniany']);
  const [studyPlanLoaded, setStudyPlanLoaded] = useState(false);
  const [studyPlanSource, setStudyPlanSource] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const go = (next: Step) => { setStep(next); setNotice(''); setError(''); };
  const signInWithDemoAccount = (accountEmail: string, google = false) => {
    const knownProfile = existingProfile?.email.toLowerCase() === accountEmail.toLowerCase()
      ? existingProfile
      : accountEmail.toLowerCase() === sampleProfile.email ? sampleProfile : null;
    setProfile(knownProfile ? { ...knownProfile } : { name: '', email: accountEmail, studyProgram: '', timezone: 'Europe/Warsaw' });
    const initial = knownProfile ? knownProfile.name.split(' ') : ['', ''];
    setFirstName(initial[0] ?? '');
    setLastName(initial.slice(1).join(' '));
    setStudentId(knownProfile?.studentId ?? '');
    setAcademicYear(knownProfile?.academicYear ?? '');
    setPassword('');
    setConfirmPassword('');
    go('profile');
    setNotice(google ? 'Symulacja: wybrano przykładowe konto Google. Nie uruchomiono prawdziwego OAuth.' : 'Symulacja: dane logowania nie zostały wysłane do serwera ani zapisane.');
  };

  const submitLogin = () => {
    if (!addressIsValid(email) || !password) { setError('Wpisz poprawny adres e-mail i hasło.'); return; }
    signInWithDemoAccount(email);
  };

  const submitRegistration = () => {
    if (!firstName.trim() || !lastName.trim() || !addressIsValid(email)) { setError('Wpisz imię, nazwisko i poprawny adres e-mail.'); return; }
    if (password.length < 8) { setError('Hasło demonstracyjne musi mieć co najmniej 8 znaków.'); return; }
    if (password !== confirmPassword) { setError('Podane hasła nie są identyczne.'); return; }
    setProfile({ name: `${firstName.trim()} ${lastName.trim()}`, email: email.trim(), studyProgram: '', timezone: 'Europe/Warsaw' });
    setPassword('');
    setConfirmPassword('');
    go('profile');
    setNotice('Konto utworzono w pamięci tej sesji. Hasło nie jest przechowywane.');
  };

  const submitProfile = () => {
    const name = `${firstName.trim()} ${lastName.trim()}`.trim();
    if (!firstName.trim() || !lastName.trim() || !profile.studyProgram.trim()) { setError('Uzupełnij imię, nazwisko i kierunek studiów.'); return; }
    setProfile({ ...profile, name, email: profile.email || email.trim(), studentId: studentId.trim() || undefined, academicYear: academicYear.trim() || undefined });
    go('calendar');
  };

  const toggleCalendar = (calendar: string) => setSelectedCalendars((current) => current.includes(calendar) ? current.filter((item) => item !== calendar) : [...current, calendar]);
  const stepIndex = step === 'profile' ? 1 : step === 'calendar' ? 2 : step === 'study' ? 3 : 0;
  const formTitle: Record<Step, string> = {
    welcome: 'Zorganizuj studia, pracę i czas dla siebie.',
    login: 'Witaj ponownie',
    register: 'Utwórz konto',
    reset: 'Odzyskaj dostęp',
    profile: 'Uzupełnij swój profil',
    calendar: 'Połącz Kalendarz Google',
    study: 'Dodaj plan studiów',
  };

  const field = (label: string, value: string, onChangeText: (value: string) => void, placeholder: string, secureTextEntry = false, keyboardType?: string) => <Field label={label} value={value} onChangeText={onChangeText} placeholder={placeholder} secureTextEntry={secureTextEntry} keyboardType={keyboardType} autoCapitalize={keyboardType === 'email-address' ? 'none' : undefined} />;

  const renderAuthCard = () => {
    if (step === 'welcome') return <>
      <Text style={styles.heading}>Zacznij od swojego planu</Text>
      <Text style={[styles.subtitle, { marginBottom: 18 }]}>Zaloguj się lub utwórz konto, aby przygotować osobisty kalendarz akademicki.</Text>
      <Button title="Zaloguj się" primary onPress={() => go('login')} />
      <View style={{ height: 10 }} />
      <Button title="Utwórz konto" onPress={() => go('register')} />
      <View style={{ height: 14 }} />
      <Text style={[styles.muted, { textAlign: 'center', marginBottom: 10 }]}>albo</Text>
      <Button title="G   Kontynuuj z Google" onPress={() => signInWithDemoAccount(sampleProfile.email, true)} />
      <Text style={[styles.muted, { marginTop: 12, textAlign: 'center' }]}>Logowanie Google jest obecnie symulowane. Wymaga konfiguracji projektu OAuth.</Text>
    </>;

    if (step === 'login') return <>
      <Text style={styles.heading}>Zaloguj się do KAC</Text>
      <Text style={[styles.subtitle, { marginBottom: 16 }]}>Wróć do swojego planu i kontynuuj organizację tygodnia.</Text>
      {field('ADRES E-MAIL', email, setEmail, 'imie@wat.edu.pl', false, 'email-address')}
      {field('HASŁO', password, setPassword, 'Wpisz hasło', true)}
      <Pressable accessibilityRole="button" onPress={() => go('reset')} style={{ alignSelf: 'flex-end', paddingVertical: 7 }}><Text style={{ color: palette.blue, fontWeight: '700', fontSize: 12 }}>Nie pamiętasz hasła?</Text></Pressable>
      {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
      <Button title="Zaloguj się" primary onPress={submitLogin} />
      <View style={{ height: 11 }} /><Button title="Kontynuuj z Google" onPress={() => signInWithDemoAccount(sampleProfile.email, true)} />
      <Text style={[styles.muted, { marginTop: 12, textAlign: 'center' }]}>Tryb makiety: logowanie jest lokalną symulacją.</Text>
      <Pressable accessibilityRole="button" onPress={() => go('register')} style={{ paddingTop: 17 }}><Text style={{ color: palette.muted, textAlign: 'center' }}>Nie masz konta? <Text style={{ color: palette.blue, fontWeight: '800' }}>Zarejestruj się</Text></Text></Pressable>
    </>;

    if (step === 'register') return <>
      <Text style={styles.heading}>Załóż konto KAC</Text>
      <Text style={[styles.subtitle, { marginBottom: 16 }]}>Utwórz profil studenta WAT i skonfiguruj swój kalendarz.</Text>
      <View style={styles.row}>{field('IMIĘ', firstName, setFirstName, 'Andrzej')}{field('NAZWISKO', lastName, setLastName, 'Stasiak')}</View>
      {field('ADRES E-MAIL', email, setEmail, 'u123456@student.wat.edu.pl', false, 'email-address')}
      {field('HASŁO', password, setPassword, 'Minimum 8 znaków', true)}
      {field('POWTÓRZ HASŁO', confirmPassword, setConfirmPassword, 'Wpisz hasło ponownie', true)}
      {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
      <Button title="Utwórz konto" primary onPress={submitRegistration} />
      <View style={{ height: 11 }} /><Button title="Zarejestruj się z Google" onPress={() => signInWithDemoAccount(sampleProfile.email, true)} />
      <Text style={[styles.muted, { marginTop: 12 }]}>Makieta nie zapisuje hasła ani danych konta. Prawdziwą rejestrację włączymy po konfiguracji dostawcy uwierzytelniania.</Text>
      <Pressable accessibilityRole="button" onPress={() => go('login')} style={{ paddingTop: 17 }}><Text style={{ color: palette.muted, textAlign: 'center' }}>Masz już konto? <Text style={{ color: palette.blue, fontWeight: '800' }}>Zaloguj się</Text></Text></Pressable>
    </>;

    if (step === 'reset') return <>
      <Text style={styles.heading}>Odzyskiwanie hasła</Text>
      <Text style={[styles.subtitle, { marginBottom: 16 }]}>Podaj e-mail. W prawdziwym środowisku wyślemy na niego bezpieczny link resetujący.</Text>
      {field('ADRES E-MAIL', email, setEmail, 'imie@wat.edu.pl', false, 'email-address')}
      {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
      <Button title="Wyślij link resetujący" primary onPress={() => { if (!addressIsValid(email)) { setError('Wpisz poprawny adres e-mail.'); return; } setError(''); setNotice('Symulacja: jeśli konto istnieje, wysłalibyśmy wiadomość z linkiem do resetu hasła. Nie wysłano e-maila.'); }} />
      {!!notice && <Text accessibilityLiveRegion="polite" style={[styles.body, { marginTop: 12 }]}>{notice}</Text>}
      <Pressable accessibilityRole="button" onPress={() => go('login')} style={{ paddingTop: 17 }}><Text style={{ color: palette.blue, fontWeight: '700' }}>Wróć do logowania</Text></Pressable>
    </>;

    if (step === 'profile') return <>
      <Pill>ETAP 1 Z 3 · PROFIL</Pill><Text style={[styles.heading, { marginTop: 10 }]}>{formTitle.profile}</Text>
      <Text style={[styles.subtitle, { marginBottom: 16 }]}>Konto: {profile.email || email}. Uzupełnij dane potrzebne do przygotowania planu.</Text>
      <View style={styles.row}>{field('IMIĘ', firstName, setFirstName, 'Imię')}{field('NAZWISKO', lastName, setLastName, 'Nazwisko')}</View>
      {field('NUMER ALBUMU (OPCJONALNIE)', studentId, setStudentId, 'np. u123456')}
      {field('KIERUNEK STUDIÓW', profile.studyProgram, (value) => setProfile({ ...profile, studyProgram: value }), 'Kryptologia i Cyberbezpieczeństwo')}
      {field('ROK AKADEMICKI / KURS (OPCJONALNIE)', academicYear, setAcademicYear, 'np. 2023/2024')}
      {!!notice && <Text accessibilityLiveRegion="polite" style={[styles.body, { marginBottom: 10 }]}>{notice}</Text>}
      {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
      <Button title="Zapisz profil i dalej" primary onPress={submitProfile} />
    </>;

    if (step === 'calendar') return <>
      <Pill>ETAP 2 Z 3 · KALENDARZ</Pill><Text style={[styles.heading, { marginTop: 10 }]}>{formTitle.calendar}</Text>
      <Text style={[styles.subtitle, { marginBottom: 16 }]}>Logowanie Google i dostęp do wydarzeń to osobne zgody. Tutaj wybierz kalendarze do importu.</Text>
      <MockNotice>Połączenie Kalendarza Google jest symulowane. Makieta nie uzyskuje tokenu OAuth ani nie odczytuje wydarzeń.</MockNotice>
      <Card style={{ backgroundColor: palette.surfaceAlt }}><Text style={styles.heading}>Konto Google</Text><Text style={[styles.body, { marginTop: 5 }]}>{googleCalendarConnected ? profile.email : 'Nie połączono'}</Text><View style={{ marginTop: 12 }}><Button title={googleCalendarConnected ? 'Połączono (symulacja)' : 'Połącz Kalendarz Google'} primary={!googleCalendarConnected} onPress={() => { setGoogleCalendarConnected(true); setNotice('Symulacja: konto połączone. Nie wysłano żądania do Google.'); }} /></View></Card>
      {googleCalendarConnected && <View style={{ marginTop: 14 }}><Text style={styles.label}>WYBIERZ KALENDARZE</Text>{['Uczelniany', 'Prywatny'].map((calendar) => <Pressable key={calendar} accessibilityRole="checkbox" accessibilityState={{ checked: selectedCalendars.includes(calendar) }} onPress={() => toggleCalendar(calendar)} style={[styles.row, { padding: 12, borderWidth: 1, borderColor: palette.line, borderRadius: 11, marginBottom: 8, backgroundColor: palette.surface }]}><Text style={{ color: palette.blue, fontWeight: '900', fontSize: 16 }}>{selectedCalendars.includes(calendar) ? '✓' : '○'}</Text><Text style={styles.body}>{calendar}</Text></Pressable>)}</View>}
      {!!notice && <Text accessibilityLiveRegion="polite" style={[styles.body, { marginTop: 10 }]}>{notice}</Text>}
      {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
      <View style={[styles.row, { justifyContent: 'space-between', flexWrap: 'wrap', marginTop: 14 }]}><Button title="Pomiń na razie" onPress={() => go('study')} /><Button title="Dalej: plan studiów" primary onPress={() => { if (!googleCalendarConnected || !selectedCalendars.length) { setError('Połącz przykładowe konto i wybierz co najmniej jeden kalendarz albo pomiń ten etap.'); return; } go('study'); }} /></View>
    </>;

    return <>
      <Pill>ETAP 3 Z 3 · PLAN STUDIÓW</Pill><Text style={[styles.heading, { marginTop: 10 }]}>{formTitle.study}</Text>
      <Text style={[styles.subtitle, { marginBottom: 16 }]}>Dodaj harmonogram zajęć, aby uwzględniać je przy planowaniu pracy.</Text>
      <MockNotice>Wczytanie pliku jest symulowane. Przykładowy plan WAT zostanie użyty w kalendarzu tej sesji.</MockNotice>
      <Card style={{ backgroundColor: palette.surfaceAlt }}><Text style={styles.heading}>Plan WAT · semestr letni 2026</Text><Text style={[styles.body, { marginTop: 6 }]}>25 form zajęć · terminy od 23 lutego do 20 lipca · prowadzący i sumy godzin</Text><Text style={[styles.muted, { marginTop: 5 }]}>Ćwiczenia i laboratoria będą oznaczone jako obowiązkowe.</Text><View style={[styles.row, { flexWrap: 'wrap', marginTop: 14 }]}><Button title={studyPlanSource === 'WAT' ? 'Plan WAT dodany' : 'Wczytaj przykładowy plan WAT'} primary={!studyPlanLoaded} onPress={() => { setStudyPlanLoaded(true); setStudyPlanSource('WAT'); setNotice('Przykładowy plan WAT dodany do kalendarza tej sesji.'); }} /><Button title="Symuluj wybór pliku CSV / ICS" onPress={() => { setStudyPlanLoaded(true); setStudyPlanSource('plik przykładowy'); setNotice('Wybrano przykładowy plik. Odczyt i import są symulowane.'); }} /></View>{studyPlanLoaded && <Text style={[styles.muted, { marginTop: 9 }]}>Źródło: {studyPlanSource}</Text>}</Card>
      {!!notice && <Text accessibilityLiveRegion="polite" style={[styles.body, { marginTop: 10 }]}>{notice}</Text>}
      {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
      <View style={[styles.row, { justifyContent: 'space-between', flexWrap: 'wrap', marginTop: 14 }]}><Button title="Wróć" onPress={() => go('calendar')} /><Button title="Pomiń import na razie" onPress={() => onComplete(profile)} /><Button title="Przejdź do kalendarza" primary disabled={!studyPlanLoaded} onPress={() => onComplete(profile)} /></View>
    </>;
  };

  return <SafeAreaView style={styles.page}><StatusBar barStyle={mode === 'dark' ? 'light-content' : 'dark-content'} /><ScrollView contentContainerStyle={{ flexGrow: 1 }}><View style={[styles.content, { maxWidth: 1320, flexGrow: 1 }]}>
    <View style={[styles.row, { justifyContent: 'space-between', marginBottom: 26 }]}><View style={styles.row}><Image accessibilityLabel="Logo Kernel 'Aura Kalendar'" source={require('../../logo.png')} resizeMode="contain" style={{ width: 46, height: 46, borderRadius: 13 }} /><View><Text style={{ color: palette.ink, fontSize: 17, fontWeight: '900' }}>Kernel <Text style={{ color: palette.blue }}>'Aura Kalendar'</Text></Text><Text style={{ color: palette.muted, fontSize: 9, fontWeight: '800', letterSpacing: 1 }}>KALENDARZ DLA STUDENTÓW WAT</Text></View></View><ThemeToggle /></View>
    <View style={{ flexDirection: compact ? 'column' : 'row', gap: 18, alignItems: 'stretch', flex: 1 }}>
      <View style={{ flex: 1, minWidth: compact ? undefined : 320, justifyContent: 'center' }}><Pill>STUDIA · PRACA · ŻYCIE</Pill><Text style={[styles.title, { marginTop: 12, fontSize: compact ? 32 : 44, lineHeight: compact ? 39 : 52 }]}>Zaplanuj tydzień, który naprawdę działa.</Text><Text style={[styles.subtitle, { marginTop: 13, fontSize: 16, lineHeight: 25 }]}>Zajęcia na WAT, praca i sprawy prywatne w jednym czytelnym kalendarzu.</Text>
        <View style={{ marginTop: 26, gap: 12 }}>{[['01', 'Jeden widok', 'Zobacz plan zajęć, pracę i czas dla siebie.'], ['02', 'Mniej kolizji', 'Uwzględniaj obowiązkowe zajęcia i bufory.'], ['03', 'Tydzień pod kontrolą', 'Przeglądaj, importuj i dostosowuj swój plan.']].map(([number, title, body]) => <View key={number} style={[styles.row, { alignItems: 'flex-start' }]}><View style={{ width: 30, height: 30, borderRadius: 10, backgroundColor: palette.blueSoft, alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: palette.blue, fontSize: 11, fontWeight: '900' }}>{number}</Text></View><View style={{ flex: 1 }}><Text style={{ color: palette.ink, fontWeight: '800', fontSize: 13 }}>{title}</Text><Text style={styles.muted}>{body}</Text></View></View>)}</View>
      </View>
      <Card style={{ width: compact ? '100%' : 440, alignSelf: compact ? 'stretch' : 'center', padding: compact ? 19 : 27 }}>
        {renderAuthCard()}
      </Card>
    </View>
    <View style={{ marginTop: 20 }}><MockNotice>Wersja demonstracyjna: e-mail, hasło, Google i importy są symulowane. Dane konta istnieją tylko w pamięci bieżącej sesji; nie zapisujemy haseł ani nie wydajemy tokenów.</MockNotice></View>
    <Text style={{ color: palette.muted, textAlign: 'center', fontSize: 10, paddingVertical: 8 }}>Wojskowa Akademia Techniczna · KAC</Text>
  </View></ScrollView></SafeAreaView>;
}
