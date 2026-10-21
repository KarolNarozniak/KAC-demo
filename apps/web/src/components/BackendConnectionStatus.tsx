import React, { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { Button, Card, Pill, useTheme } from './ui';
import { getDemoConnection, type DemoConnection } from '../services/demoApi';

type Status = 'checking' | 'connected' | 'api-only' | 'unavailable' | 'not-configured';

export default function BackendConnectionStatus() {
  const { palette, styles } = useTheme();
  const [status, setStatus] = useState<Status>('checking');
  const [connection, setConnection] = useState<DemoConnection | null>(null);
  const [message, setMessage] = useState('Sprawdzanie połączenia demonstracyjnego.');

  const refresh = async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    setStatus('checking');
    setMessage('Sprawdzanie połączenia demonstracyjnego.');
    try {
      const result = await getDemoConnection(controller.signal);
      setConnection(result);
      setStatus(result.database === 'connected' ? 'connected' : 'api-only');
      setMessage(result.database === 'connected'
        ? 'API odczytało przykładowe rekordy z PostgreSQL. Kalendarz makiety działa niezależnie.'
        : result.database === 'not-configured'
          ? 'API działa, ale nie ma skonfigurowanego połączenia z bazą PostgreSQL. Kalendarz makiety pozostaje dostępny.'
          : 'API działa, ale baza PostgreSQL jest niedostępna. Kalendarz makiety pozostaje dostępny.');
    } catch (error) {
      const text = error instanceof Error ? error.message : 'Nieznany błąd połączenia.';
      setStatus(text.includes('nie jest skonfigurowany') ? 'not-configured' : 'unavailable');
      setConnection(null);
      setMessage(`${text} Lokalna makieta kalendarza pozostaje dostępna.`);
    } finally {
      clearTimeout(timeout);
    }
  };

  useEffect(() => { void refresh(); }, []);

  const statusLabel = status === 'connected' ? 'API + BAZA POŁĄCZONE' : status === 'api-only' ? 'API DZIAŁA' : status === 'checking' ? 'SPRAWDZANIE' : status === 'not-configured' ? 'API NIE SKONFIGUROWANE' : 'API NIEDOSTĘPNE';
  const statusColor = status === 'connected' ? palette.green : status === 'checking' ? palette.blue : palette.amber;

  return <Card style={{ padding: 15 }}>
    <View style={[styles.row, { justifyContent: 'space-between', flexWrap: 'wrap' }]}>
      <View style={{ flex: 1, minWidth: 190 }}>
        <Text style={styles.heading}>Połączenie środowisk</Text>
        <Text style={[styles.muted, { marginTop: 3 }]}>Frontend → API → PostgreSQL</Text>
      </View>
      <Pill color={statusColor}>{statusLabel}</Pill>
    </View>
    <Text accessibilityLiveRegion="polite" style={[styles.body, { marginTop: 9 }]}>{message}</Text>
    {connection?.overview && <View style={[styles.row, { flexWrap: 'wrap', marginTop: 8 }]}>
      <Pill color={palette.blue}>{connection.overview.calendar.name}</Pill>
      <Pill color={palette.green}>{connection.overview.counts.events} wydarzenia z bazy</Pill>
      <Pill color={palette.muted}>{connection.overview.counts.categories} kategorie</Pill>
    </View>}
    <View style={{ alignSelf: 'flex-start', marginTop: 10 }}><Button title="Sprawdź ponownie" onPress={() => void refresh()} disabled={status === 'checking'} /></View>
  </Card>;
}
