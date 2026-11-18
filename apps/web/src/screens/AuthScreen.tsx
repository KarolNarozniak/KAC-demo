// Logowanie, zakładanie konta KAC (e-mail i hasło) i nowe hasło z kodem odzyskiwania („Nie pamiętasz hasła?”).
// Google służy wyłącznie do połączenia kalendarza – po zalogowaniu, w Ustawieniach.
// Tryb rejestracji podaje serwer (GET /auth/config): open, invite (z kodem od zespołu) albo closed (konto zakłada administrator).
import React, { useEffect, useRef, useState } from 'react';
import { Image, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AuthField, ShowPasswordToggle } from '../components/AuthField';
import { Button, useTheme } from '../components/ui';
import {
  authErrorMessage, deviceTimeZone, hasErrors, PASSWORD_MIN_LENGTH, recoveryField, registrationField, validateLogin, validateRecovery, validateRegistration,
  type AuthConfig, type AuthSession, type LoginDraft, type RecoveryDraft, type RegisterDraft,
} from '../domain/auth';
import { AuthApiError, getAuthConfig, login, recoverAccount, register } from '../services/authApi';

type Mode = 'login' | 'register' | 'recover';
export type SignInVia = Mode;
type InputHandle = React.ComponentRef<typeof TextInput>;
const emptyRegistration: RegisterDraft = { email: '', password: '', confirm: '', firstName: '', lastName: '', inviteCode: '' };
const emptyRecovery: RecoveryDraft = { email: '', code: '', password: '', confirm: '' };
const TITLES: Record<Mode, string> = { login: 'Zaloguj się', register: 'Załóż konto', recover: 'Nowe hasło' };
const SUBTITLES: Record<Mode, string> = {
  login: 'Użyj adresu e-mail i hasła konta KAC.',
  register: 'Konto KAC jest niezależne od Google – kalendarz Google połączysz później w Ustawieniach.',
  recover: 'Podaj kod odzyskiwania zapisany przy zakładaniu konta. Po zmianie hasła wszystkie urządzenia zostaną wylogowane.',
};
const BUTTONS: Record<Mode, [idle: string, busy: string]> = {
  login: ['Zaloguj się', 'Logowanie…'], register: ['Załóż konto', 'Zakładanie konta…'], recover: ['Ustaw nowe hasło', 'Ustawianie hasła…'],
};

export default function AuthScreen({ notice, onSignedIn }: { notice?: string; onSignedIn: (session: AuthSession, via: SignInVia) => void }) {
  const { palette, styles } = useTheme();
  const [mode, setMode] = useState<Mode>('login');
  const [config, setConfig] = useState<AuthConfig | null>(null);
  const [serverProblem, setServerProblem] = useState('');
  const [credentials, setCredentials] = useState<LoginDraft>({ email: '', password: '' });
  const [draft, setDraft] = useState<RegisterDraft>(emptyRegistration);
  const [recovery, setRecovery] = useState<RecoveryDraft>(emptyRecovery);
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const loginPassword = useRef<InputHandle>(null);
  const lastName = useRef<InputHandle>(null);
  const email = useRef<InputHandle>(null);
  const password = useRef<InputHandle>(null);
  const confirm = useRef<InputHandle>(null);
  const invite = useRef<InputHandle>(null);
  const recoveryCode = useRef<InputHandle>(null);
  const recoveryPassword = useRef<InputHandle>(null);
  const recoveryConfirm = useRef<InputHandle>(null);

  useEffect(() => {
    let alive = true;
    // Brak sieci pokaże samo logowanie; tu zgłaszamy tylko problem serwera (np. API bez bazy danych).
    getAuthConfig().then((value) => { if (alive) setConfig(value); })
      .catch((error) => { if (alive && error instanceof AuthApiError && error.code !== 'network') setServerProblem(error.message); });
    return () => { alive = false; };
  }, []);

  const registration = config?.registration ?? 'open';
  const switchMode = (next: Mode) => {
    // Wpisany adres przechodzi do następnego formularza, żeby nie wpisywać go drugi raz.
    const typed = (mode === 'login' ? credentials.email : mode === 'register' ? draft.email : recovery.email);
    setMode(next); setErrors({}); setFormError(''); setShowPassword(false);
    if (next === 'register') setDraft((current) => ({ ...current, email: current.email || typed }));
    else if (next === 'recover') setRecovery((current) => ({ ...current, email: current.email || typed }));
    else setCredentials((current) => ({ ...current, email: current.email || typed }));
  };
  const changeLogin = (patch: Partial<LoginDraft>) => { setCredentials((current) => ({ ...current, ...patch })); setFormError(''); };
  const clearErrors = (keys: string[]) => {
    setErrors((current) => ({ ...current, ...Object.fromEntries(keys.map((key) => [key, undefined])) }));
    setFormError('');
  };
  const changeDraft = (patch: Partial<RegisterDraft>) => { setDraft((current) => ({ ...current, ...patch })); clearErrors(Object.keys(patch)); };
  const changeRecovery = (patch: Partial<RecoveryDraft>) => { setRecovery((current) => ({ ...current, ...patch })); clearErrors(Object.keys(patch)); };

  const submitLogin = async () => {
    if (busy) return;
    const found = validateLogin(credentials);
    setErrors(found); setFormError('');
    if (hasErrors(found)) return;
    setBusy(true);
    try {
      onSignedIn(await login(credentials.email, credentials.password, Platform.OS), 'login');
    } catch (error) {
      setBusy(false);
      setFormError(error instanceof Error ? error.message : authErrorMessage('network'));
    }
  };

  const submitRegister = async () => {
    if (busy) return;
    const found = validateRegistration(draft, registration);
    setErrors(found); setFormError('');
    if (hasErrors(found)) return;
    setBusy(true);
    try {
      onSignedIn(await register({ ...draft, timeZone: deviceTimeZone(), client: Platform.OS, inviteCode: registration === 'invite' ? draft.inviteCode : undefined }), 'register');
    } catch (error) {
      setBusy(false);
      const message = error instanceof Error ? error.message : authErrorMessage('network');
      const field = error instanceof AuthApiError ? registrationField(error.code) : null;
      if (field) setErrors({ [field]: message }); else setFormError(message);
      if (error instanceof AuthApiError && error.code === 'registration_closed') setConfig((current) => current && { ...current, registration: 'closed' });
    }
  };

  const submitRecovery = async () => {
    if (busy) return;
    const found = validateRecovery(recovery);
    setErrors(found); setFormError('');
    if (hasErrors(found)) return;
    setBusy(true);
    try {
      onSignedIn(await recoverAccount({ email: recovery.email, code: recovery.code, newPassword: recovery.password, client: Platform.OS }), 'recover');
    } catch (error) {
      setBusy(false);
      const message = error instanceof Error ? error.message : authErrorMessage('network');
      const field = error instanceof AuthApiError ? recoveryField(error.code) : null;
      if (error instanceof AuthApiError && error.code === 'password_unchanged')
        setErrors({ password: 'To jest Twoje obecne hasło – możesz się nim po prostu zalogować. Kod odzyskiwania nie został zużyty.' });
      else if (field) setErrors({ [field]: message }); else setFormError(message);
    }
  };
  const submit = () => void (mode === 'login' ? submitLogin() : mode === 'register' ? submitRegister() : submitRecovery());

  const link = (title: string, onPress: () => void) => <Pressable accessibilityRole="button" onPress={onPress} disabled={busy} style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: 4 }}>
    <Text style={[styles.body, { color: palette.blue, fontWeight: '700' }]}>{title}</Text>
  </Pressable>;

  return <SafeAreaView style={{ flex: 1, backgroundColor: palette.bg }}>
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', paddingHorizontal: 16, paddingVertical: 28 }} keyboardShouldPersistTaps="handled">
      <View style={{ width: '100%', maxWidth: 440, alignSelf: 'center' }}>
        <View style={{ alignItems: 'center', marginBottom: 20 }}>
          <Image accessibilityLabel="Logo Aura Kalendar" source={require('../../logo.png')} resizeMode="contain" style={{ width: 60, height: 60 }} />
          <Text style={[styles.heading, { fontSize: 22, marginTop: 10 }]}>Aura<Text style={{ color: palette.blue }}> Kalendar</Text></Text>
          <Text style={[styles.muted, { textAlign: 'center', marginTop: 4 }]}>Zajęcia, praca i sprawy prywatne w jednym kalendarzu.</Text>
        </View>

        {!!notice && <View accessibilityLiveRegion="polite" style={{ padding: 12, borderRadius: 11, backgroundColor: palette.blueSoft, marginBottom: 14 }}>
          <Text style={styles.body}>{notice}</Text>
        </View>}
        {!!serverProblem && <View accessibilityRole="alert" style={{ padding: 12, borderRadius: 11, backgroundColor: palette.redSoft, marginBottom: 14 }}>
          <Text style={styles.body}>{serverProblem}</Text>
        </View>}

        <View style={styles.card}>
          <Text accessibilityRole="header" style={[styles.title, { fontSize: 24, lineHeight: 30 }]}>{TITLES[mode]}</Text>
          <Text style={[styles.subtitle, { marginBottom: 18 }]}>{SUBTITLES[mode]}</Text>

          {mode === 'recover' ? <>
            <AuthField label="E-MAIL" value={recovery.email} onChangeText={(value) => changeRecovery({ email: value })} error={errors.email} editable={!busy} maxLength={254}
              keyboardType="email-address" autoComplete="email" textContentType="emailAddress" returnKeyType="next" onSubmitEditing={() => recoveryCode.current?.focus()} />
            <AuthField label="KOD ODZYSKIWANIA" value={recovery.code} onChangeText={(value) => changeRecovery({ code: value })} error={errors.code} editable={!busy} maxLength={64}
              hint="Np. 7F3Q-9XWM-2HDA-K8PR. Wielkość liter, spacje i myślniki nie mają znaczenia." autoCapitalize="characters" autoComplete="off" textContentType="none"
              returnKeyType="next" onSubmitEditing={() => recoveryPassword.current?.focus()} inputRef={recoveryCode} />
            <AuthField label="NOWE HASŁO" value={recovery.password} onChangeText={(value) => changeRecovery({ password: value })} error={errors.password} editable={!busy} maxLength={128}
              hint={`Co najmniej ${PASSWORD_MIN_LENGTH} znaków.`} secure={!showPassword} autoComplete="new-password" textContentType="newPassword" returnKeyType="next"
              onSubmitEditing={() => recoveryConfirm.current?.focus()} inputRef={recoveryPassword} />
            <AuthField label="POWTÓRZ NOWE HASŁO" value={recovery.confirm} onChangeText={(value) => changeRecovery({ confirm: value })} error={errors.confirm} editable={!busy} maxLength={128}
              secure={!showPassword} autoComplete="new-password" textContentType="newPassword" returnKeyType="go" onSubmitEditing={() => void submitRecovery()} inputRef={recoveryConfirm} />
          </> : mode === 'login' ? <>
            <AuthField label="E-MAIL" value={credentials.email} onChangeText={(value) => changeLogin({ email: value })} error={errors.email} editable={!busy} maxLength={254}
              keyboardType="email-address" autoComplete="email" textContentType="emailAddress" returnKeyType="next" onSubmitEditing={() => loginPassword.current?.focus()} />
            <AuthField label="HASŁO" value={credentials.password} onChangeText={(value) => changeLogin({ password: value })} error={errors.password} editable={!busy} maxLength={128}
              secure={!showPassword} autoComplete="current-password" textContentType="password" returnKeyType="go" onSubmitEditing={() => void submitLogin()} inputRef={loginPassword} />
          </> : <>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: 12 }}>
              <View style={{ flexGrow: 1, flexBasis: 160 }}>
                <AuthField label="IMIĘ" value={draft.firstName} onChangeText={(value) => changeDraft({ firstName: value })} error={errors.firstName} editable={!busy} maxLength={60}
                  autoCapitalize="words" autoComplete="given-name" textContentType="givenName" returnKeyType="next" onSubmitEditing={() => lastName.current?.focus()} />
              </View>
              <View style={{ flexGrow: 1, flexBasis: 160 }}>
                <AuthField label="NAZWISKO (OPCJONALNIE)" value={draft.lastName} onChangeText={(value) => changeDraft({ lastName: value })} error={errors.lastName} editable={!busy} maxLength={80}
                  autoCapitalize="words" autoComplete="family-name" textContentType="familyName" returnKeyType="next" onSubmitEditing={() => email.current?.focus()} inputRef={lastName} />
              </View>
            </View>
            <AuthField label="E-MAIL" value={draft.email} onChangeText={(value) => changeDraft({ email: value })} error={errors.email} editable={!busy} maxLength={254}
              keyboardType="email-address" autoComplete="email" textContentType="emailAddress" returnKeyType="next" onSubmitEditing={() => password.current?.focus()} inputRef={email} />
            <AuthField label="HASŁO" value={draft.password} onChangeText={(value) => changeDraft({ password: value })} error={errors.password} editable={!busy} maxLength={128}
              hint={`Co najmniej ${PASSWORD_MIN_LENGTH} znaków – najłatwiej zapamiętać kilka niepowiązanych słów. Bez wymogu cyfr i znaków specjalnych.`}
              secure={!showPassword} autoComplete="new-password" textContentType="newPassword" returnKeyType="next" onSubmitEditing={() => confirm.current?.focus()} inputRef={password} />
            <AuthField label="POWTÓRZ HASŁO" value={draft.confirm} onChangeText={(value) => changeDraft({ confirm: value })} error={errors.confirm} editable={!busy} maxLength={128}
              secure={!showPassword} autoComplete="new-password" textContentType="newPassword" returnKeyType={registration === 'invite' ? 'next' : 'go'}
              onSubmitEditing={() => registration === 'invite' ? invite.current?.focus() : void submitRegister()} inputRef={confirm} />
            {registration === 'invite' && <AuthField label="KOD ZAPROSZENIA" value={draft.inviteCode} onChangeText={(value) => changeDraft({ inviteCode: value })} error={errors.inviteCode}
              hint="Kod podaje zespół KAC." editable={!busy} maxLength={200} returnKeyType="go" onSubmitEditing={() => void submitRegister()} inputRef={invite} />}
          </>}

          <ShowPasswordToggle value={showPassword} onChange={setShowPassword} />
          {!!formError && <Text accessibilityRole="alert" style={styles.error}>{formError}</Text>}
          <View style={{ marginTop: 6 }}>
            <Button title={BUTTONS[mode][busy ? 1 : 0]} primary disabled={busy} onPress={submit} />
          </View>
          {mode === 'login' && <View style={{ alignItems: 'flex-start', marginTop: 8 }}>{link('Nie pamiętasz hasła?', () => switchMode('recover'))}</View>}
          {mode === 'recover' && <Text style={[styles.muted, { marginTop: 12 }]}>Nie masz kodu? Nowe hasło ustawi administrator KAC.</Text>}
        </View>

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', alignItems: 'center', marginTop: 4 }}>
          {mode === 'login'
            ? registration === 'closed'
              ? <Text style={[styles.muted, { textAlign: 'center' }]}>Zakładanie kont jest wyłączone – konto założy administrator KAC.</Text>
              : <><Text style={styles.body}>Nie masz konta?</Text>{link('Załóż konto', () => switchMode('register'))}</>
            : <><Text style={styles.body}>{mode === 'recover' ? 'Pamiętasz hasło?' : 'Masz już konto?'}</Text>{link('Zaloguj się', () => switchMode('login'))}</>}
        </View>
      </View>
    </ScrollView>
  </SafeAreaView>;
}
