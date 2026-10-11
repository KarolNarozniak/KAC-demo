import React, { useState } from 'react';
import { Modal, Text, View } from 'react-native';
import type { Shift } from '../domain/model';
import { Button, Card, MockNotice, Pill, useTheme } from '../components/ui';

type Props = { shifts: Shift[]; accepted: boolean; setPublished: (value: Shift[]) => void; published: Shift[] };

export default function PublishScreen({ shifts, accepted, setPublished, published }: Props) {
  const { palette, styles } = useTheme();
  const [connected, setConnected] = useState(false);
  const [calendar, setCalendar] = useState('Praca i nauka');
  const [fail, setFail] = useState(false);
  const [notice, setNotice] = useState('');
  const [previewOpen, setPreviewOpen] = useState(false);
  const authorize = () => { setConnected(true); setNotice('Przyznano przykładowe uprawnienie. Nie użyto OAuth.'); };
  const openPreview = () => {
    if (!accepted || !shifts.length) { setNotice('Zaakceptuj propozycję grafiku przed otwarciem podglądu publikacji.'); return; }
    setNotice('');
    setPreviewOpen(true);
  };
  const publish = () => {
    if (!accepted || !shifts.length) { setNotice('Brak zaakceptowanych zmian. Nie wprowadzono żadnych zmian.'); return; }
    if (!connected) { setNotice('Dostęp demonstracyjny nie jest włączony. Zezwól na dostęp w tym podglądzie lub anuluj.'); return; }
    if (fail) { setNotice('Symulacja publikacji nie powiodła się. Nie dodano wydarzeń do Google. Wyłącz symulację błędu i spróbuj ponownie albo anuluj.'); return; }
    setPublished(shifts.map((shift) => ({ ...shift, status: 'published' })));
    setNotice(`Zasymulowano publikację zmian (${shifts.length}) do kalendarza „${calendar}”. Żaden zewnętrzny kalendarz nie został zmieniony.`);
    setPreviewOpen(false);
  };
  const revise = (id: string) => { setPublished(published.map((shift) => shift.id === id ? { ...shift, status: 'published', title: `${shift.title} · zaktualizowano` } : shift)); setNotice('Zasymulowano aktualizację opublikowanej zmiany. Nie zmieniono wydarzenia w Google.'); };
  const remove = (id: string) => { setPublished(published.filter((shift) => shift.id !== id)); setNotice('Zasymulowano usunięcie z listy demo. Nie usunięto wydarzenia z Google.'); };
  const data = published.length ? published : shifts;
  return <View style={styles.content}>
    <MockNotice>W demo nie ma OAuth Google ani interfejsu do zapisu, aktualizacji lub usuwania wydarzeń w Kalendarzu Google. Publikacja zmienia tylko lokalną symulację.</MockNotice>
    <Pill>KALENDARZ GOOGLE</Pill><Text style={[styles.title, { marginTop: 9 }]}>Najpierw sprawdź swój plan.</Text><Text style={styles.subtitle}>Przejrzyj zaakceptowane zmiany, wybierz przykładowy kalendarz i zasymuluj publikację.</Text>
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 14, marginTop: 20 }}>
      <Card style={{ flex: 1, minWidth: 285 }}>
        <View style={[styles.row, { justifyContent: 'space-between' }]}><Text style={styles.heading}>Podgląd połączenia</Text><Pill color={connected ? palette.green : palette.muted}>{connected ? 'SYMULACJA WŁĄCZONA' : 'ROZŁĄCZONO'}</Pill></View>
        <Text style={[styles.body, { marginTop: 10 }]}>Konto: alex.demo@example.test</Text><Text style={styles.muted}>Tożsamość demonstracyjna; nie łączymy się z kontem Google.</Text>
        <View style={[styles.row, { flexWrap: 'wrap', marginTop: 14 }]}><Button title="Symuluj zgodę na dostęp" primary onPress={authorize} /><Button title="Symuluj odmowę dostępu" onPress={() => { setConnected(false); setNotice('Odmowa dostępu. Zaakceptowany grafik nie został opublikowany.'); }} /></View>
        <Text style={[styles.label, { marginTop: 19 }]}>KALENDARZ DOCELOWY</Text><View style={[styles.row, { flexWrap: 'wrap' }]}>{['Praca i nauka', 'Prywatny', 'Zespołowy'].map((value) => <PressableCalendar key={value} value={value} selected={calendar === value} onPress={() => setCalendar(value)} />)}</View>
        <View style={[styles.row, { flexWrap: 'wrap', marginTop: 17 }]}><Button title="Przejrzyj publikację" primary onPress={openPreview} /></View>
      </Card>
      <Card style={{ flex: 1.2, minWidth: 300 }}>
        <View style={[styles.row, { justifyContent: 'space-between' }]}><Text style={styles.heading}>Podgląd grafiku</Text><Pill color={accepted ? palette.green : palette.amber}>{accepted ? 'ZAAKCEPTOWANY' : 'WYMAGA AKCEPTACJI'}</Pill></View><Text style={styles.muted}>Można opublikować wyłącznie zaakceptowane zmiany.</Text>
        {!data.length && <Text style={[styles.body, { marginTop: 18 }]}>Nie ma jeszcze zmian. Najpierw utwórz i zaakceptuj plan.</Text>}
        {data.map((shift) => <View key={shift.id} style={{ paddingVertical: 12, borderBottomWidth: 1, borderColor: palette.line }}><Text style={{ fontWeight: '800', color: palette.ink }}>{new Date(shift.start).toLocaleDateString('pl-PL', { weekday: 'long', month: 'short', day: 'numeric' })} · {shift.title}</Text><Text style={styles.muted}>{shift.start.slice(11, 16)}–{shift.end.slice(11, 16)} · {published.length ? 'symulacja publikacji' : 'podgląd propozycji'}</Text>{published.length > 0 && <View style={[styles.row, { marginTop: 9 }]}><Button title="Symuluj aktualizację" onPress={() => revise(shift.id)} /><Button title="Symuluj usunięcie" danger onPress={() => remove(shift.id)} /></View>}</View>)}
        {!!notice && <View accessibilityRole="alert" style={{ marginTop: 14, padding: 12, borderRadius: 9, backgroundColor: /nie powiod|odmow/i.test(notice) ? palette.redSoft : palette.blueSoft }}><Text style={styles.body}>{notice}</Text></View>}
      </Card>
    </View>
    <Card><Text style={styles.heading}>Co pokazuje ten podgląd</Text><Text style={[styles.body, { marginTop: 8 }]}>Nazwa kalendarza, wynik autoryzacji, liczba wydarzeń, błędy publikacji oraz późniejsze aktualizacje i usunięcia są symulowane. Anulowanie lub niepowodzenie nie zmienia zaakceptowanej propozycji w planerze.</Text></Card>
    <Modal visible={previewOpen} transparent animationType="fade" onRequestClose={() => setPreviewOpen(false)}>
      <View style={{ flex: 1, backgroundColor: palette.scrim, alignItems: 'center', justifyContent: 'center', padding: 16 }}>
        <View style={{ backgroundColor: palette.surface, borderRadius: 18, width: '100%', maxWidth: 500, padding: 22 }}>
          <Pill>PODGLĄD PUBLIKACJI · DEMO</Pill><Text style={[styles.heading, { marginTop: 12 }]}>Sprawdź przed potwierdzeniem</Text>
          <Text style={styles.subtitle}>
            {shifts.length} zaakceptowanych zmian do kalendarza „{calendar}”. Nic się nie zmieni, dopóki nie potwierdzisz.
          </Text>
          <View style={{ maxHeight: 250, marginTop: 12 }}>
            {shifts.map((shift) => <Text key={shift.id} style={[styles.body, { paddingVertical: 8, borderBottomWidth: 1, borderColor: palette.line }]}>{new Date(shift.start).toLocaleDateString('pl-PL', { weekday: 'short', month: 'short', day: 'numeric' })} · {shift.start.slice(11, 16)}–{shift.end.slice(11, 16)} · {shift.title}</Text>)}
          </View>
          <Text style={[styles.muted, { marginTop: 12 }]}>{connected ? 'Dostęp demonstracyjny włączony.' : 'Dostęp demonstracyjny nie jest jeszcze włączony.'} {fail ? 'Symulacja błędu jest włączona.' : 'Symulacja błędu jest wyłączona.'}</Text>
          <View style={[styles.row, { flexWrap: 'wrap', marginTop: 10 }]}><Button title={connected ? 'Symuluj odmowę dostępu' : 'Symuluj zgodę na dostęp'} onPress={() => { if (connected) { setConnected(false); setNotice('Odmowa dostępu.'); } else authorize(); }} /><Button title={fail ? 'Wyłącz symulację błędu' : 'Włącz symulację błędu'} onPress={() => setFail(!fail)} /></View>
          {!!notice && <Text accessibilityRole="alert" style={styles.error}>{notice}</Text>}
          <View style={[styles.row, { justifyContent: 'flex-end', flexWrap: 'wrap', marginTop: 16 }]}><Button title="Anuluj publikację" onPress={() => { setPreviewOpen(false); setNotice('Anulowano podgląd publikacji. Nie zmieniono opublikowanego stanu.'); }} /><Button title="Potwierdź symulację publikacji" primary onPress={publish} /></View>
        </View>
      </View>
    </Modal>
  </View>;
}
function PressableCalendar({ value, selected, onPress }: { value: string; selected: boolean; onPress: () => void }) {
  const { palette } = useTheme();
  return <Text accessibilityRole="button" onPress={onPress} style={{ padding: 9, borderRadius: 8, color: selected ? palette.blue : palette.muted, backgroundColor: selected ? palette.blueSoft : palette.surfaceAlt, fontSize: 12, fontWeight: '700' }}>{value}</Text>;
}
