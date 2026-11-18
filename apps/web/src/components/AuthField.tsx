// Pole formularzy konta (logowanie, rejestracja, zmiana hasła, usunięcie konta): etykieta, komunikat pod polem
// i podpowiedzi dla menedżerów haseł (autoComplete w przeglądarce i na Androidzie, textContentType na iOS).
import React from 'react';
import { Pressable, Text, TextInput, View, type TextInputProps } from 'react-native';
import SelectionMark from './SelectionMark';
import { useTheme } from './ui';

type Props = {
  label: string; value: string; onChangeText: (text: string) => void; error?: string; hint?: string; secure?: boolean; editable?: boolean;
  autoComplete?: TextInputProps['autoComplete']; textContentType?: TextInputProps['textContentType']; keyboardType?: TextInputProps['keyboardType'];
  autoCapitalize?: TextInputProps['autoCapitalize']; returnKeyType?: TextInputProps['returnKeyType']; onSubmitEditing?: () => void; maxLength?: number;
  inputRef?: React.Ref<React.ComponentRef<typeof TextInput>>;
};

export function AuthField({ label, value, onChangeText, error, hint, secure = false, editable = true, autoComplete, textContentType, keyboardType,
  autoCapitalize = 'none', returnKeyType, onSubmitEditing, maxLength, inputRef }: Props) {
  const { palette, styles } = useTheme();
  return <View style={{ marginBottom: 14 }}>
    <Text style={[styles.label, !!error && { color: palette.red }]}>{label}</Text>
    <TextInput ref={inputRef} value={value} onChangeText={onChangeText} secureTextEntry={secure} editable={editable} maxLength={maxLength}
      autoComplete={autoComplete} textContentType={textContentType} keyboardType={keyboardType} autoCapitalize={autoCapitalize} autoCorrect={false} spellCheck={false}
      returnKeyType={returnKeyType} onSubmitEditing={onSubmitEditing} accessibilityLabel={label} accessibilityHint={error} placeholderTextColor={palette.placeholder}
      style={[styles.input, !!error && { borderColor: palette.red, borderWidth: 2 }]} />
    {error ? <Text accessibilityLiveRegion="polite" style={[styles.error, { marginBottom: 0 }]}>{error}</Text>
      : hint ? <Text style={[styles.muted, { marginTop: 6 }]}>{hint}</Text> : null}
  </View>;
}

/** „Pokaż hasło” – wpisywanie długiej frazy na telefonie bez podglądu łatwo kończy się literówką. */
export function ShowPasswordToggle({ value, onChange }: { value: boolean; onChange: (value: boolean) => void }) {
  const { styles } = useTheme();
  return <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: value }} onPress={() => onChange(!value)} style={[styles.row, { minHeight: 44, marginBottom: 6 }]}>
    <SelectionMark checked={value} /><Text style={styles.body}>Pokaż hasło</Text>
  </Pressable>;
}
