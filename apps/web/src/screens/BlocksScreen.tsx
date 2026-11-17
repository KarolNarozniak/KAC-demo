import Disclosure from '../components/Disclosure';
import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, ScrollView, useWindowDimensions } from 'react-native';
import { fetchBlocks, createBlock, deleteBlock, type Block, type BlockType } from '../services/blockApi';
import { Button, Field, useTheme } from '../components/ui';
import DateField from '../components/DateField';
import TimeField from '../components/TimeField';
import { localDateKey } from '../domain/calendar';

export function BlocksScreen() {
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState('');
  const [startTime, setStartTime] = useState(`${localDateKey(new Date())}T08:00`);
  const [endTime, setEndTime] = useState(`${localDateKey(new Date())}T18:00`);
  const [type, setType] = useState<BlockType>('exam_session');
  const [error, setError] = useState<string | null>(null);

  const { palette, styles } = useTheme();
  const compact = useWindowDimensions().width < 760;
  const stamp = (value: string) => new Date(value).toLocaleString('pl-PL', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

  const loadBlocks = async () => {
    try {
      setLoading(true);
      const data = await fetchBlocks();
      setBlocks(data);
      setError(null);
    } catch (err: any) {
      setError(err.message || 'Błąd pobierania blokad');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadBlocks();
  }, []);

  const handleCreate = async () => {
    if (!title.trim() || !startTime.trim() || !endTime.trim()) {
      setError('Wypełnij wszystkie pola');
      return;
    }
    if (!Number.isFinite(Date.parse(startTime)) || !Number.isFinite(Date.parse(endTime)) || Date.parse(endTime) <= Date.parse(startTime)) {
      setError('Koniec blokady musi być późniejszy niż początek.'); return;
    }
    try {
      await createBlock({ title: title.trim(), startTime: startTime.trim(), endTime: endTime.trim(), type });
      setTitle('');
      setStartTime(`${localDateKey(new Date())}T08:00`);
      setEndTime(`${localDateKey(new Date())}T18:00`);
      setError(null);
      loadBlocks();
    } catch (err: any) {
      setError(err.message || 'Błąd tworzenia blokady');
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteBlock(id);
      loadBlocks();
    } catch (err: any) {
      setError(err.message || 'Błąd usuwania');
    }
  };

  const typeLabels: Record<BlockType, string> = {
    exam_session: 'Sesja egzaminacyjna',
    vacation: 'Urlop',
    day_off: 'Dzień wolny',
  };

  return (
    <ScrollView contentContainerStyle={{ width: '100%', maxWidth: 880, alignSelf: 'center', padding: 16, paddingBottom: 40 }}>
      <Text style={[styles.title, { fontSize: 25 }]}>Blokady czasu</Text>
      <Text style={[styles.subtitle, { marginTop: 0, marginBottom: 14 }]}>Okresy te zostaną wykluczone z automatycznego generowania grafiku pracy.</Text>

      {error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}

      <Text style={[styles.heading, { marginTop: 16, marginBottom: 8 }]}>Aktywne blokady</Text>

      {loading ? (
        <Text accessibilityLiveRegion="polite" style={styles.muted}>Wczytywanie…</Text>
      ) : blocks.length === 0 ? (
        <Text style={styles.muted}>Brak zaplanowanych blokad.</Text>
      ) : (
        blocks.map((item) => (
          <View key={item.id} style={[styles.card, { flexDirection: compact ? 'column' : 'row', alignItems: compact ? 'stretch' : 'center', gap: 12, justifyContent: 'space-between', padding: 18, marginBottom: 8 }]}>
            <View style={{ flex: 1 }}>
              <View style={{ alignSelf: 'flex-start', backgroundColor: palette.blueSoft, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 4, marginBottom: 4 }}>
                <Text style={{ fontSize: 11, color: palette.blue, fontWeight: '700' }}>{typeLabels[item.type] || item.type}</Text>
              </View>
              <Text style={[styles.body, { fontWeight: '700' }]}>{item.title}</Text>
              <Text style={styles.muted}>{stamp(item.startTime)} – {stamp(item.endTime)}</Text>
            </View>
            <View style={{ alignSelf: 'flex-start' }}><Button title="Usuń" danger onPress={() => handleDelete(item.id)} /></View>
          </View>
        ))
      )}
<Disclosure title="Dodaj blokadę" summary="Urlop, sesja egzaminacyjna lub dzień wolny">

        <Field
          label="TYTUŁ (NP. SESJA ZIMOWA, URLOP)"
          maxLength={200}
          value={title}
          onChangeText={setTitle}
          placeholder="np. Sesja zimowa"
        />

        <Text style={styles.label}>POCZĄTEK BLOKADY</Text>
        <View style={[styles.row, { alignItems: 'flex-start', flexWrap: 'wrap' }]}>
          <DateField label="Data od" value={startTime.split('T')[0]} onChange={date => setStartTime(`${date}T${startTime.split('T')[1]}`)} />
          <TimeField label="Godzina od" value={startTime.split('T')[1]} onChange={time => setStartTime(`${startTime.split('T')[0]}T${time}`)} />
        </View>
        <Text style={styles.label}>KONIEC BLOKADY</Text>
        <View style={[styles.row, { alignItems: 'flex-start', flexWrap: 'wrap' }]}>
          <DateField label="Data do" value={endTime.split('T')[0]} onChange={date => setEndTime(`${date}T${endTime.split('T')[1]}`)} />
          <TimeField label="Godzina do" value={endTime.split('T')[1]} onChange={time => setEndTime(`${endTime.split('T')[0]}T${time}`)} />
        </View>

        <Text style={styles.label}>RODZAJ BLOKADY</Text>
        <View style={[styles.row, { flexWrap: 'wrap', marginBottom: 16, gap: 8 }]}>
          {(['exam_session', 'vacation', 'day_off'] as BlockType[]).map((t) => {
            const isSelected = type === t;
            return (
              <Pressable
                accessibilityRole="radio" accessibilityState={{ checked: isSelected }}
                key={t}
                onPress={() => setType(t)}
                style={{
                  paddingHorizontal: 14,
                  paddingVertical: 10,
                  borderRadius: 10,
                  borderWidth: 1,
                  borderColor: isSelected ? palette.blue : palette.line,
                  backgroundColor: isSelected ? palette.blueSoft : palette.surfaceAlt,
                }}
              >
                <Text style={[styles.body, { fontWeight: '700', ...(isSelected ? { color: palette.blue } : {}) }]}>
					{typeLabels[t]}
				</Text>
              </Pressable>
            );
          })}
        </View>

        <Button title="Dodaj blokadę" primary onPress={handleCreate} />
      </Disclosure>

    </ScrollView>
  );
}