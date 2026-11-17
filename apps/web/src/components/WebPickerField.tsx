import React, { useId } from 'react';
import { useTheme } from './ui';

/** Preserve the native picker while displaying Polish dates and 24-hour times. */
export default function WebPickerField({ label, value, onChange, type, invalid = false, disabled = false }: { label: string; value: string; onChange: (value: string) => void; type: 'date' | 'time'; invalid?: boolean; disabled?: boolean }) {
  const id = useId();
  const { palette, mode } = useTheme();
  const display = type === 'date' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value.split('-').reverse().join('.') : value;
  return <div style={{ flex: 1, minWidth: 110, marginBottom: 12, fontFamily: 'system-ui, sans-serif' }}>
    <label htmlFor={id} style={{ display: 'block', color: invalid ? palette.red : palette.muted, fontSize: 11, fontWeight: 700, letterSpacing: 0.5, marginBottom: 8 }}>{label}</label>
    <div style={{ position: 'relative', borderRadius: 11, backgroundColor: palette.input, opacity: disabled ? 0.5 : 1 }}>
      <div aria-hidden="true" style={{ boxSizing: 'border-box', minHeight: 46, border: `${invalid ? 2 : 1}px solid ${invalid ? palette.red : palette.line}`, borderRadius: 11, padding: '11px 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, color: display ? palette.ink : palette.placeholder, fontSize: 16 }}>
        <span>{display || (type === 'date' ? 'Wybierz datę' : 'GG:MM')}</span>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={palette.muted} strokeWidth="1.6"><path d={type === 'date' ? 'M5 5h14v15H5ZM5 9h14M9 3v4M15 3v4' : 'M12 7v5l3 2M21 12a9 9 0 1 1-9-9 9 9 0 0 1 9 9Z'} /></svg>
      </div>
      <input id={id} lang="pl-PL" aria-invalid={invalid} type={type} disabled={disabled} required step={type === 'time' ? 60 : undefined} value={value} onClick={event => {
        try { event.currentTarget.showPicker?.(); } catch { /* Keyboard entry remains available. */ }
      }} onChange={event => { if (event.currentTarget.value) onChange(event.currentTarget.value); }}
        style={{ position: 'absolute', inset: 0, boxSizing: 'border-box', width: '100%', minWidth: 0, height: '100%', opacity: 0, cursor: disabled ? 'default' : 'pointer', colorScheme: mode }} />
      <style>{`div:has(> input[id="${id}"]:focus-visible) { outline: 2px solid ${palette.blue}; outline-offset: 3px; }`}</style>
    </div>
  </div>;
}
