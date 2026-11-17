import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, ScrollView } from 'react-native';
import { fetchBlocks, createBlock, deleteBlock, type Block, type BlockType } from '../services/blockApi';
import { Button, Field, useTheme } from '../components/ui';

export function BlocksScreen() {
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [type, setType] = useState<BlockType>('exam_session');
  const [error, setError] = useState<string | null>(null);

  const { palette, styles } = useTheme();

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
    try {
      await createBlock({ title: title.trim(), startTime: startTime.trim(), endTime: endTime.trim(), type });
      setTitle('');
      setStartTime('');
      setEndTime('');
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
    <ScrollView contentContainerStyle={{ width: '100%', maxWidth: 1120, alignSelf: 'center', padding: 16, paddingBottom: 40 }}>
      <Text style={[styles.title, { fontSize: 25 }]}>Blokady i Sesje Egzaminacyjne</Text>
      <Text style={[styles.subtitle, { marginTop: 0, marginBottom: 14 }]}>Okresy te zostaną wykluczone z automatycznego generowania grafiku pracy.</Text>

      {error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}

      <View style={styles.card}>
        <Text style={styles.heading}>Dodaj nową blokadę</Text>

        <Field
          label="TYTUŁ (NP. SESJA ZIMOWA, URLOP)"
          maxLength={200}
          value={title}
          onChangeText={setTitle}
          placeholder="np. Sesja zimowa"
        />

        <Field
          label="OD (NP. 2026-02-01T08:00)"
          maxLength={50}
          value={startTime}
          onChangeText={setStartTime}
          placeholder="2026-02-01T08:00"
        />

        <Field
          label="DO (NP. 2026-02-15T20:00)"
          maxLength={50}
          value={endTime}
          onChangeText={setEndTime}
          placeholder="2026-02-15T20:00"
        />

        <Text style={styles.label}>RODZAJ BLOKADY</Text>
        <View style={[styles.row, { flexWrap: 'wrap', marginBottom: 16, gap: 8 }]}>
          {(['exam_session', 'vacation', 'day_off'] as BlockType[]).map((t) => {
            const isSelected = type === t;
            return (
              <Pressable
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
                <Text style={[styles.body, { fontWeight: '700', color: isSelected ? palette.blue : palette.text }]}>
                  {typeLabels[t]}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <Button title="Dodaj blokadę" primary onPress={handleCreate} />
      </View>

      <Text style={[styles.heading, { marginTop: 16, marginBottom: 8 }]}>Aktywne blokady</Text>

      {loading ? (
        <Text accessibilityLiveRegion="polite" style={styles.muted}>Wczytywanie…</Text>
      ) : blocks.length === 0 ? (
        <Text style={styles.muted}>Brak zaplanowanych blokad.</Text>
      ) : (
        blocks.map((item) => (
          <View key={item.id} style={[styles.card, { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 12, marginBottom: 8 }]}>
            <View style={{ flex: 1 }}>
              <View style={{ alignSelf: 'flex-start', backgroundColor: palette.blueSoft, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 4, marginBottom: 4 }}>
                <Text style={{ fontSize: 11, color: palette.blue, fontWeight: '700' }}>{typeLabels[item.type] || item.type}</Text>
              </View>
              <Text style={[styles.body, { fontWeight: '700' }]}>{item.title}</Text>
              <Text style={styles.muted}>{item.startTime} do {item.endTime}</Text>
            </View>
            <Button title="Usuń" danger onPress={() => handleDelete(item.id)} />
          </View>
        ))
      )}
    </ScrollView>
  );
}