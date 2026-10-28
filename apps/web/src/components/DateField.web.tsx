import React, { useId } from 'react';
import { useTheme } from './ui';
import type { DateFieldProps } from './DateField.types';

export default function DateField({ label, value, onChange }: DateFieldProps) {
  const id = useId();
  const { palette, mode } = useTheme();
  return <div style={{ flex: 1, minWidth: 0, marginBottom: 12 }}>
    <label htmlFor={id} style={{ display: 'block', color: palette.muted, fontSize: 10, fontWeight: 800, letterSpacing: 1.1, marginBottom: 6 }}>{label}</label>
    <input id={id} type="date" required value={value} onClick={(event) => {
      // Open the browser's picker when any part of the field is tapped.
      try { event.currentTarget.showPicker?.(); } catch { /* The native calendar button remains available. */ }
    }} onChange={(event) => {
      if (event.currentTarget.value) onChange(event.currentTarget.value);
    }} style={{ boxSizing: 'border-box', width: '100%', minWidth: 0, minHeight: 44, border: `1px solid ${palette.line}`, backgroundColor: palette.input, borderRadius: 11, padding: '10px 12px', fontFamily: 'inherit', fontSize: 16, color: palette.ink, colorScheme: mode }} />
  </div>;
}
