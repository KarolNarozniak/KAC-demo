import React, { createContext, useContext } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

export type ThemeMode = 'light' | 'dark';
export type ThemePalette = {
  ink: string;
  muted: string;
  line: string;
  paper: string;
  surface: string;
  surfaceAlt: string;
  input: string;
  bg: string;
  blue: string;
  blueSoft: string;
  green: string;
  greenSoft: string;
  amber: string;
  amberSoft: string;
  red: string;
  redSoft: string;
  class: string;
  work: string;
  personal: string;
  grid: string;
  scrim: string;
  selected: string;
  placeholder: string;
};

const lightPalette: ThemePalette = {
  ink: '#18243A', muted: '#758198', line: '#E7EAF1', paper: '#FFFFFF', surface: '#FFFFFF', surfaceAlt: '#F2F4F8', input: '#FFFFFF', bg: '#F5F6FA',
  blue: '#5265E8', blueSoft: '#EEF0FF', green: '#14835D', greenSoft: '#E9F7F0', amber: '#A55B05', amberSoft: '#FFF4E6', red: '#B04444', redSoft: '#FFF0EF',
  class: '#2563EB', work: '#F97316', personal: '#16A34A', grid: '#EFF1F5', scrim: 'rgba(17, 24, 39, 0.55)', selected: '#EEF0FF', placeholder: '#929BAA',
};

const darkPalette: ThemePalette = {
  ink: '#F2F5FC', muted: '#A0AEC2', line: '#293449', paper: '#151D2B', surface: '#151D2B', surfaceAlt: '#202B3C', input: '#101724', bg: '#0B111B',
  blue: '#9BAAFF', blueSoft: '#263251', green: '#55D6A7', greenSoft: '#1B382F', amber: '#FFC477', amberSoft: '#3B3023', red: '#FF9298', redSoft: '#3D272E',
  class: '#6F9BFF', work: '#FFA064', personal: '#54CE7D', grid: '#253144', scrim: 'rgba(0, 0, 0, 0.72)', selected: '#202D49', placeholder: '#78869B',
};

const buildStyles = (palette: ThemePalette): Record<string, any> => ({
  page: { flex: 1, backgroundColor: palette.bg },
  content: { width: '100%', maxWidth: 1440, alignSelf: 'center', padding: 24, paddingBottom: 42 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  card: { backgroundColor: palette.surface, borderRadius: 18, borderWidth: 1, borderColor: palette.line, padding: 20, marginBottom: 14, shadowColor: palette.ink, shadowOpacity: 0.035, shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, elevation: 1 },
  title: { fontSize: 29, lineHeight: 35, fontWeight: '800', color: palette.ink, letterSpacing: -0.7 },
  subtitle: { fontSize: 14, color: palette.muted, marginTop: 5, lineHeight: 21 },
  heading: { fontSize: 17, fontWeight: '800', color: palette.ink },
  body: { fontSize: 14, lineHeight: 21, color: palette.ink },
  muted: { fontSize: 12, lineHeight: 18, color: palette.muted },
  label: { fontSize: 10, fontWeight: '800', letterSpacing: 1.1, color: palette.muted, marginBottom: 6 },
  input: { borderWidth: 1, borderColor: palette.line, backgroundColor: palette.input, borderRadius: 11, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: palette.ink, minWidth: 0 },
  button: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 11, borderWidth: 1, borderColor: palette.line, backgroundColor: palette.surfaceAlt, alignItems: 'center', justifyContent: 'center' },
  buttonText: { fontSize: 13, fontWeight: '700', color: palette.ink },
  primary: { backgroundColor: palette.blue, borderColor: palette.blue },
  primaryText: { color: '#FFFFFF' },
  danger: { backgroundColor: palette.redSoft, borderColor: palette.line },
  error: { color: palette.red, fontSize: 13, lineHeight: 19, marginTop: 8, marginBottom: 6 },
});

type ThemeContextValue = { mode: ThemeMode; palette: ThemePalette; styles: Record<string, any>; toggleMode: () => void };
const ThemeContext = createContext<ThemeContextValue>({ mode: 'light', palette: lightPalette, styles: buildStyles(lightPalette), toggleMode: () => {} });

export function ThemeProvider({ mode, toggleMode, children }: { mode: ThemeMode; toggleMode: () => void; children: React.ReactNode }) {
  const palette = mode === 'dark' ? darkPalette : lightPalette;
  const styles = buildStyles(palette);
  return <ThemeContext.Provider value={{ mode, palette, styles, toggleMode }}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}

export function ThemeToggle() {
  const { mode, palette, toggleMode } = useTheme();
  const dark = mode === 'dark';
  return <Pressable accessibilityRole="switch" accessibilityLabel="Tryb ciemny" accessibilityState={{ checked: dark }} onPress={toggleMode} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 11, paddingVertical: 8, borderRadius: 12, borderWidth: 1, borderColor: palette.line, backgroundColor: palette.surface }}>
    <Text style={{ fontSize: 11, color: palette.muted, fontWeight: '700' }}>{dark ? 'Ciemny' : 'Jasny'}</Text>
    <View style={{ width: 34, height: 20, borderRadius: 99, padding: 3, backgroundColor: dark ? palette.blue : palette.surfaceAlt, justifyContent: 'center', borderWidth: 1, borderColor: dark ? palette.blue : palette.line }}>
      <View style={{ width: 12, height: 12, borderRadius: 99, backgroundColor: '#FFFFFF', alignSelf: dark ? 'flex-end' : 'flex-start' }} />
    </View>
  </Pressable>;
}

export function Button({ title, onPress, primary = false, danger = false, disabled = false, accessibilityLabel }: { title: string; onPress: () => void; primary?: boolean; danger?: boolean; disabled?: boolean; accessibilityLabel?: string }) {
  const { styles } = useTheme();
  return <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel} disabled={disabled} onPress={onPress} style={[styles.button, primary && styles.primary, danger && styles.danger, disabled && { opacity: 0.5 }]}><Text style={[styles.buttonText, primary && styles.primaryText]}>{title}</Text></Pressable>;
}

export function Field({ label, value, onChangeText, placeholder, keyboardType, secureTextEntry = false, autoCapitalize }: { label: string; value: string; onChangeText: (text: string) => void; placeholder?: string; keyboardType?: any; secureTextEntry?: boolean; autoCapitalize?: any }) {
  const { palette, styles } = useTheme();
  return <View style={{ flex: 1, minWidth: 100, marginBottom: 12 }}><Text style={styles.label}>{label}</Text><TextInput accessibilityLabel={label} value={value} onChangeText={onChangeText} placeholder={placeholder} placeholderTextColor={palette.placeholder} keyboardType={keyboardType} secureTextEntry={secureTextEntry} autoCapitalize={autoCapitalize} style={styles.input} /></View>;
}
