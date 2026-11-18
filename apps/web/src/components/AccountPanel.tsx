// Ustawienia → Konto: kto jest zalogowany, wylogowanie, zmiana hasła (wylogowuje inne urządzenia), kod odzyskiwania
// (nowy po podaniu hasła – stary przestaje działać) i usunięcie konta z danymi.
import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { AuthField, ShowPasswordToggle } from './AuthField';
import { RecoveryCodeCard } from './RecoveryCodeCard';
import { Button, useTheme } from './ui';
import { displayName, hasErrors, PASSWORD_MIN_LENGTH, validatePasswordChange, type AuthUser, type PasswordChangeDraft } from '../domain/auth';
import { AuthApiError, changePassword, deleteAccount, newRecoveryCode } from '../services/authApi';

type Section = 'none' | 'password' | 'recovery' | 'delete';
const emptyChange: PasswordChangeDraft = { current: '', next: '', confirm: '' };

export default function AccountPanel({ user, onSignOut, onAccountDeleted, onUserUpdated }: {
  user: AuthUser; onSignOut: () => Promise<void>; onAccountDeleted: () => Promise<void>; onUserUpdated: (user: AuthUser) => void;
}) {
  const { palette, styles } = useTheme();
  const [section, setSection] = useState<Section>('none');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [formError, setFormError] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [change, setChange] = useState<PasswordChangeDraft>(emptyChange);
  const [changeErrors, setChangeErrors] = useState<Partial<Record<keyof PasswordChangeDraft, string>>>({});
  const [deletePassword, setDeletePassword] = useState('');
  const [deleteError, setDeleteError] = useState('');
  const [codePassword, setCodePassword] = useState('');
  const [codeError, setCodeError] = useState('');
  const [shownCode, setShownCode] = useState('');

  const open = (next: Section) => {
    setSection((current) => current === next ? 'none' : next);
    setNotice(''); setFormError(''); setShowPassword(false);
    setChange(emptyChange); setChangeErrors({}); setDeletePassword(''); setDeleteError('');
    setCodePassword(''); setCodeError(''); setShownCode('');
  };
  const message = (error: unknown) => error instanceof Error ? error.message : 'Nie udało się wykonać operacji na koncie. Spróbuj ponownie.';

  const signOut = async () => {
    setBusy(true);
    try { await onSignOut(); } finally { setBusy(false); }
  };

  const savePassword = async () => {
    if (busy) return;
    const found = validatePasswordChange(change, user.email);
    setChangeErrors(found); setFormError('');
    if (hasErrors(found)) return;
    setBusy(true);
    try {
      const { otherSessionsRevoked } = await changePassword(change.current, change.next);
      setSection('none'); setChange(emptyChange);
      setNotice(otherSessionsRevoked > 0 ? `Hasło zmienione. Wylogowano inne urządzenia (${otherSessionsRevoked}) – zaloguj się na nich nowym hasłem.` : 'Hasło zmienione.');
    } catch (error) {
      const code = error instanceof AuthApiError ? error.code : '';
      if (code === 'invalid_password') setChangeErrors({ current: 'Obecne hasło jest nieprawidłowe.' });
      else if (code.startsWith('password_')) setChangeErrors({ next: message(error) });
      else setFormError(message(error));
    } finally {
      setBusy(false);
    }
  };

  const createRecoveryCode = async () => {
    if (busy) return;
    if (!codePassword) { setCodeError('Podaj hasło, żeby utworzyć nowy kod.'); return; }
    setBusy(true); setCodeError(''); setFormError('');
    try {
      const { recoveryCode } = await newRecoveryCode(codePassword);
      setCodePassword(''); setShowPassword(false); setShownCode(recoveryCode);
      onUserUpdated({ ...user, hasRecoveryCode: true });
    } catch (error) {
      if (error instanceof AuthApiError && error.code === 'invalid_password') setCodeError('Hasło jest nieprawidłowe – kod nie został zmieniony.');
      else setFormError(message(error));
    } finally {
      setBusy(false);
    }
  };

  const removeAccount = async () => {
    if (busy) return;
    if (!deletePassword) { setDeleteError('Podaj hasło, żeby potwierdzić usunięcie konta.'); return; }
    setBusy(true); setDeleteError(''); setFormError('');
    try {
      await deleteAccount(deletePassword);
      await onAccountDeleted();
    } catch (error) {
      setBusy(false);
      if (error instanceof AuthApiError && error.code === 'invalid_password') setDeleteError('Hasło jest nieprawidłowe – konto nie zostało usunięte.');
      else setFormError(message(error));
    }
  };

  const name = displayName(user);
  return <View style={[styles.card, { marginBottom: 20 }]}>
    <Text style={styles.heading}>Konto</Text>
    <Text style={[styles.body, { marginTop: 8 }]}>Zalogowano jako <Text style={{ fontWeight: '700' }}>{name || user.email}</Text></Text>
    {!!name && <Text style={styles.muted}>{user.email}</Text>}
    {user.hasRecoveryCode
      ? <Text style={[styles.muted, { marginTop: 8 }]}>Kod odzyskiwania jest ustawiony – gdy zapomnisz hasła, ustawisz nowe na ekranie logowania.</Text>
      : <View style={{ marginTop: 10, padding: 12, borderRadius: 11, backgroundColor: palette.amberSoft }}>
        <Text style={styles.body}>Nie masz kodu odzyskiwania. Jeśli zapomnisz hasła, nowe ustawi tylko administrator – utwórz kod i zapisz go.</Text>
      </View>}
    {/* Pokazany nowy kod znika po zmianie sekcji, a drugi raz go nie zobaczymy – do „Gotowe” pozostałe przyciski czekają. */}
    <View style={[styles.row, { flexWrap: 'wrap', marginTop: 14 }]}>
      <Button title="Wyloguj" disabled={busy || !!shownCode} onPress={() => void signOut()} />
      <Button title="Zmień hasło" disabled={busy || !!shownCode} onPress={() => open('password')} />
      <Button title={user.hasRecoveryCode ? 'Nowy kod odzyskiwania' : 'Utwórz kod odzyskiwania'} primary={!user.hasRecoveryCode} disabled={busy || !!shownCode}
        onPress={() => open('recovery')} />
      <Button title="Usuń konto" danger disabled={busy || !!shownCode} onPress={() => open('delete')} />
    </View>
    {!!notice && <Text accessibilityLiveRegion="polite" style={[styles.muted, { marginTop: 10 }]}>{notice}</Text>}

    {section === 'password' && <View style={{ marginTop: 16, paddingTop: 16, borderTopWidth: 1, borderColor: palette.line }}>
      <Text style={[styles.heading, { fontSize: 15, marginBottom: 10 }]}>Zmiana hasła</Text>
      <AuthField label="OBECNE HASŁO" value={change.current} onChangeText={(current) => { setChange((draft) => ({ ...draft, current })); setChangeErrors((errors) => ({ ...errors, current: undefined })); }}
        error={changeErrors.current} secure={!showPassword} editable={!busy} maxLength={128} autoComplete="current-password" textContentType="password" />
      <AuthField label="NOWE HASŁO" value={change.next} onChangeText={(next) => { setChange((draft) => ({ ...draft, next })); setChangeErrors((errors) => ({ ...errors, next: undefined })); }}
        error={changeErrors.next} hint={`Co najmniej ${PASSWORD_MIN_LENGTH} znaków.`} secure={!showPassword} editable={!busy} maxLength={128} autoComplete="new-password" textContentType="newPassword" />
      <AuthField label="POWTÓRZ NOWE HASŁO" value={change.confirm} onChangeText={(confirm) => { setChange((draft) => ({ ...draft, confirm })); setChangeErrors((errors) => ({ ...errors, confirm: undefined })); }}
        error={changeErrors.confirm} secure={!showPassword} editable={!busy} maxLength={128} autoComplete="new-password" textContentType="newPassword"
        returnKeyType="go" onSubmitEditing={() => void savePassword()} />
      <ShowPasswordToggle value={showPassword} onChange={setShowPassword} />
      <Text style={[styles.muted, { marginBottom: 10 }]}>Po zmianie hasła pozostałe urządzenia zostaną wylogowane. To urządzenie zostaje zalogowane.</Text>
      {!!formError && <Text accessibilityRole="alert" style={styles.error}>{formError}</Text>}
      <View style={[styles.row, { flexWrap: 'wrap' }]}>
        <Button title={busy ? 'Zapisywanie…' : 'Zapisz nowe hasło'} primary disabled={busy} onPress={() => void savePassword()} />
        <Button title="Anuluj" disabled={busy} onPress={() => open('password')} />
      </View>
    </View>}

    {section === 'recovery' && <View style={{ marginTop: 16, paddingTop: 16, borderTopWidth: 1, borderColor: palette.line }}>
      {shownCode ? <>
        <Text style={[styles.heading, { fontSize: 15, marginBottom: 10 }]}>Nowy kod odzyskiwania</Text>
        <RecoveryCodeCard code={shownCode} />
        <Text style={[styles.muted, { marginTop: 10, marginBottom: 12 }]}>Poprzedni kod już nie działa. Zapisz ten w menedżerze haseł albo na kartce – nie pojawi się ponownie i nie wysyłaj go nikomu.</Text>
        <Button title="Gotowe, zapisałem" primary onPress={() => open('recovery')} />
      </> : <>
        <Text style={[styles.heading, { fontSize: 15 }]}>Kod odzyskiwania</Text>
        <Text style={[styles.body, { marginTop: 8, marginBottom: 12 }]}>
          {user.hasRecoveryCode
            ? 'Nowy kod zastąpi obecny – stary przestanie działać. Przydaje się, gdy zgubisz zapisany kod albo ktoś mógł go zobaczyć.'
            : 'Kod pozwala samodzielnie ustawić nowe hasło, gdy zapomnisz obecnego (ekran logowania → „Nie pamiętasz hasła?”).'}
        </Text>
        <AuthField label="HASŁO DO KONTA" value={codePassword} onChangeText={(value) => { setCodePassword(value); setCodeError(''); }} error={codeError}
          secure={!showPassword} editable={!busy} maxLength={128} autoComplete="current-password" textContentType="password" returnKeyType="go" onSubmitEditing={() => void createRecoveryCode()} />
        <ShowPasswordToggle value={showPassword} onChange={setShowPassword} />
        {!!formError && <Text accessibilityRole="alert" style={styles.error}>{formError}</Text>}
        <View style={[styles.row, { flexWrap: 'wrap' }]}>
          <Button title={busy ? 'Tworzenie kodu…' : 'Pokaż nowy kod'} primary disabled={busy || !codePassword} onPress={() => void createRecoveryCode()} />
          <Button title="Anuluj" disabled={busy} onPress={() => open('recovery')} />
        </View>
      </>}
    </View>}

    {section === 'delete' && <View style={{ marginTop: 16, paddingTop: 16, borderTopWidth: 1, borderColor: palette.line }}>
      <Text style={[styles.heading, { fontSize: 15 }]}>Usunięcie konta</Text>
      <Text style={[styles.body, { marginTop: 8 }]}>Tej operacji nie można cofnąć. Usuniemy konto {user.email} i wszystkie jego dane w KAC: wydarzenia, plan zajęć, grafiki i profil pracy, blokady, rozmowy z asystentem, powiadomienia i połączenie z Google.</Text>
      <Text style={[styles.muted, { marginTop: 6, marginBottom: 12 }]}>KAC cofnie swój dostęp do konta Google. Wydarzenia opublikowane wcześniej w Google Calendar zostają w Google.</Text>
      <AuthField label="HASŁO DO KONTA" value={deletePassword} onChangeText={(value) => { setDeletePassword(value); setDeleteError(''); }} error={deleteError}
        secure={!showPassword} editable={!busy} maxLength={128} autoComplete="current-password" textContentType="password" returnKeyType="go" onSubmitEditing={() => void removeAccount()} />
      <ShowPasswordToggle value={showPassword} onChange={setShowPassword} />
      {!!formError && <Text accessibilityRole="alert" style={styles.error}>{formError}</Text>}
      <View style={[styles.row, { flexWrap: 'wrap' }]}>
        <Button title={busy ? 'Usuwanie…' : 'Usuń konto na zawsze'} danger disabled={busy || !deletePassword} onPress={() => void removeAccount()} />
        <Button title="Anuluj" disabled={busy} onPress={() => open('delete')} />
      </View>
    </View>}
  </View>;
}
