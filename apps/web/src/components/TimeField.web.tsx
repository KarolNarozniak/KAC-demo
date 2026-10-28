import React, { useId } from 'react';
import { useTheme } from './ui';
import type { TimeFieldProps } from './TimeField.types';

export default function TimeField({ label, value, onChange, invalid = false }: TimeFieldProps) {
  const id = useId();
  const { palette, mode } = useTheme();
  return <div style={{ flex: 1, minWidth: 0, marginBottom: 12 }}>
    <label htmlFor={id} style={{ display: 'block', color: invalid ? palette.red : palette.muted, fontSize: 10, fontWeight: 800, letterSpacing: 1.1, marginBottom: 6 }}>{label}</label>
    <input id={id} aria-invalid={invalid} type="time" required step={60} value={value} onClick={(event) => {
      try { event.currentTarget.showPicker?.(); } catch { /* The browser's time control remains available. */ }
    }} onChange={(event) => {
      if (event.currentTarget.value) onChange(event.currentTarget.value);
    }} style={{ boxSizing: 'border-box', width: '100%', minWidth: 0, minHeight: 44, border: invalid ? `2px solid ${palette.red}` : `1px solid ${palette.line}`, backgroundColor: palette.input, borderRadius: 11, padding: '10px 12px', fontFamily: 'inherit', fontSize: 16, color: palette.ink, colorScheme: mode }} />
  </div>;
}
