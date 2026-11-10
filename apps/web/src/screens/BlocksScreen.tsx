import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import { fetchBlocks, createBlock, deleteBlock, type Block, type BlockType } from '../services/blockApi';

export function BlocksScreen() {
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [type, setType] = useState<BlockType>('exam_session');
  const [error, setError] = useState<string | null>(null);

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
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.header}>Blokady i Sesje Egzaminacyjne</Text>
      <Text style={styles.subtitle}>Okresy te zostaną wykluczone z automatycznego generowania grafiku pracy.</Text>

      {error && <Text style={styles.errorText}>{error}</Text>}

      <View style={styles.formCard}>
        <Text style={styles.sectionTitle}>Dodaj nową blokadę</Text>

        <TextInput
          placeholder="Tytuł (np. Sesja zimowa, Urlop)"
          value={title}
          onChangeText={setTitle}
          style={styles.input}
        />

        <TextInput
          placeholder="Od (np. 2026-02-01T08:00)"
          value={startTime}
          onChangeText={setStartTime}
          style={styles.input}
        />

        <TextInput
          placeholder="Do (np. 2026-02-15T20:00)"
          value={endTime}
          onChangeText={setEndTime}
          style={styles.input}
        />

        <View style={styles.typeSelector}>
          {(['exam_session', 'vacation', 'day_off'] as BlockType[]).map((t) => (
            <TouchableOpacity
              key={t}
              style={[styles.typeButton, type === t && styles.typeButtonActive]}
              onPress={() => setType(t)}
            >
              <Text style={[styles.typeButtonText, type === t && styles.typeButtonTextActive]}>
                {typeLabels[t]}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <TouchableOpacity style={styles.submitButton} onPress={handleCreate}>
          <Text style={styles.submitButtonText}>Dodaj blokadę</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.sectionTitle}>Aktywne blokady</Text>

      {loading ? (
        <ActivityIndicator size="small" color="#000" style={{ marginTop: 20 }} />
      ) : blocks.length === 0 ? (
        <Text style={styles.emptyText}>Brak zaplanowanych blokad.</Text>
      ) : (
        blocks.map((item) => (
          <View key={item.id} style={styles.itemCard}>
            <View style={{ flex: 1 }}>
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{typeLabels[item.type] || item.type}</Text>
              </View>
              <Text style={styles.itemTitle}>{item.title}</Text>
              <Text style={styles.itemTime}>{item.startTime} do {item.endTime}</Text>
            </View>
            <TouchableOpacity onPress={() => handleDelete(item.id)} style={styles.deleteButton}>
              <Text style={styles.deleteButtonText}>Usuń</Text>
            </TouchableOpacity>
          </View>
        ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, maxWidth: 600, alignSelf: 'center', width: '100%', backgroundColor: '#0d131f' },
  header: { fontSize: 24, fontWeight: 'bold', marginBottom: 4, color: '#fff' },
  subtitle: { fontSize: 14, color: '#94a3b8', marginBottom: 20 },
  errorText: { color: '#fca5a5', marginBottom: 12, backgroundColor: '#451a03', padding: 8, borderRadius: 4 },
  formCard: { backgroundColor: '#151b22', padding: 16, borderRadius: 12, borderWidth: 1, borderColor: '#212d3d', marginBottom: 24 },
  sectionTitle: { fontSize: 18, fontWeight: '600', marginBottom: 12, color: '#fff' },
  input: { backgroundColor: '#1b2432', borderWidth: 1, borderColor: '#2d3b50', padding: 10, marginBottom: 10, borderRadius: 6, color: '#fff' },
  typeSelector: { flexDirection: 'row', gap: 8, marginBottom: 14, flexWrap: 'wrap' },
  typeButton: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 16, borderWidth: 1, borderColor: '#2d3b50', backgroundColor: '#1b2432' },
  typeButtonActive: { backgroundColor: '#3b82f6', borderColor: '#3b82f6' },
  typeButtonText: { fontSize: 13, color: '#cbd5e1' },
  typeButtonTextActive: { color: '#fff', fontWeight: '500' },
  submitButton: { backgroundColor: '#3b82f6', padding: 12, borderRadius: 6, alignItems: 'center' },
  submitButtonText: { color: '#fff', fontWeight: 'bold', fontSize: 15 },
  emptyText: { color: '#94a3b8', fontStyle: 'italic', marginTop: 10 },
  itemCard: { flexDirection: 'row', backgroundColor: '#151b22', padding: 12, borderRadius: 12, borderWidth: 1, borderColor: '#212d3d', alignItems: 'center', marginBottom: 8 },
  badge: { alignSelf: 'flex-start', backgroundColor: '#1e293b', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 4, marginBottom: 4 },
  badgeText: { fontSize: 11, color: '#93c5fd', fontWeight: '500' },
  itemTitle: { fontSize: 16, fontWeight: '600', color: '#fff' },
  itemTime: { fontSize: 13, color: '#94a3b8', marginTop: 2 },
  deleteButton: { padding: 8, justifyContent: 'center' },
  deleteButtonText: { color: '#f87171', fontWeight: '600' },
});
