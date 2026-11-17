// Pobrane z Google wydarzenie w szczegółach (S23KC2S1P2-23, G05; założenie D05).
// Pokazuje kalendarz źródłowy i stan: zgodne z Google, edytowane w KAC (Google nie nadpisuje – można przywrócić wersję z Google)
// albo usunięte w Google (lokalna kopia została). Wydarzenia spoza synchronizacji (404 not_imported) nie pokazują niczego.

import React, { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { Button, useTheme } from './ui';
import { apiErrorMessage, importedEventLines, type ImportedEvent } from '../domain/googleIntegration';
import { getImportedEvent, GoogleIntegrationApiError, restoreImportedEvent } from '../services/googleIntegrationApi';

export default function GoogleImportedEvent({ eventId, onRestored }: { eventId: string; onRestored: () => void }) {
  const { palette, styles } = useTheme();
  const [view, setView] = useState<ImportedEvent | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);
  useEffect(() => {
    setView(null); setError('');
    getImportedEvent(eventId).then((next) => { if (mounted.current) setView(next); }).catch(() => { if (mounted.current) setView(null); });
  }, [eventId]);

  if (!view) return null;
  const lines = importedEventLines(view);
  const restore = async () => {
    setBusy(true); setError('');
    try {
      await restoreImportedEvent(eventId);
      if (mounted.current) onRestored();
    } catch (reason) {
      if (mounted.current) setError(apiErrorMessage(reason instanceof GoogleIntegrationApiError ? reason.code : 'network'));
    } finally { if (mounted.current) setBusy(false); }
  };
  return <View accessibilityLabel="Wydarzenie z Google Calendar" style={{ marginTop: 12, padding: 10, borderRadius: 10, borderWidth: 1, borderColor: palette.line }}>
    <Text style={styles.label}>GOOGLE CALENDAR</Text>
    <Text style={[styles.body, { marginTop: 4 }]}>{lines.origin}</Text>
    <Text style={[styles.body, { marginTop: 4, color: view.state === 'synced' ? palette.green : palette.amber }]}>{lines.state}</Text>
    {!!lines.google && <Text style={[styles.muted, { marginTop: 4 }]}>{lines.google}</Text>}
    {!!error && <Text accessibilityRole="alert" style={[styles.error, { marginTop: 4 }]}>{error}</Text>}
    {lines.canRestore && <View style={{ marginTop: 8, alignSelf: 'flex-start' }}><Button title="Przywróć wersję z Google" disabled={busy} onPress={() => void restore()} /></View>}
  </View>;
}
