import React, { useState } from 'react';
import { Modal, Text, View } from 'react-native';
import type { Shift } from '../domain/model';
import { Button, Card, MockNotice, Pill, palette, styles } from '../components/ui';

type Props = { shifts: Shift[]; accepted: boolean; setPublished: (value: Shift[]) => void; published: Shift[] };

export default function PublishScreen({ shifts, accepted, setPublished, published }: Props) {
  const [connected, setConnected] = useState(false);
  const [calendar, setCalendar] = useState('Work & study');
  const [fail, setFail] = useState(false);
  const [notice, setNotice] = useState('');
  const [previewOpen, setPreviewOpen] = useState(false);
  const authorize = () => { setConnected(true); setNotice('Simulated permission granted. No OAuth occurred.'); };
  const openPreview = () => {
    if (!accepted || !shifts.length) { setNotice('Accept a proposed work plan before opening a publish preview.'); return; }
    setNotice('');
    setPreviewOpen(true);
  };
  const publish = () => {
    if (!accepted || !shifts.length) { setNotice('No accepted shifts are available. Nothing was changed.'); return; }
    if (!connected) { setNotice('Mock access is not enabled. Allow access in this preview or cancel.'); return; }
    if (fail) { setNotice('Simulated publish failed. No Google events were written. Turn off the failure control and retry, or cancel.'); return; }
    setPublished(shifts.map((shift) => ({ ...shift, status: 'published' })));
    setNotice(`${shifts.length} sample shift(s) simulated as published to ${calendar}. No external calendar changed.`);
    setPreviewOpen(false);
  };
  const revise = (id: string) => { setPublished(published.map((shift) => shift.id === id ? { ...shift, status: 'published', title: `${shift.title} · updated` } : shift)); setNotice('Simulated published shift update. No Google event was changed.'); };
  const remove = (id: string) => { setPublished(published.filter((shift) => shift.id !== id)); setNotice('Simulated deletion from the demo publish list only. No Google event was deleted.'); };
  const data = published.length ? published : shifts;
  return <View style={styles.content}>
    <MockNotice>Google OAuth and Calendar write/update/delete APIs do not exist in this demo. Publish controls only update the local simulation.</MockNotice>
    <Pill>GOOGLE PUBLISH</Pill><Text style={[styles.title, { marginTop: 9 }]}>See the week before it leaves.</Text><Text style={styles.subtitle}>Review the accepted shifts, choose a sample calendar and simulate the result.</Text>
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 14, marginTop: 20 }}>
      <Card style={{ flex: 1, minWidth: 285 }}>
        <View style={[styles.row, { justifyContent: 'space-between' }]}><Text style={styles.heading}>Connection preview</Text><Pill color={connected ? palette.green : palette.muted}>{connected ? 'SIMULATED' : 'DISCONNECTED'}</Pill></View>
        <Text style={[styles.body, { marginTop: 10 }]}>Account: alex.demo@example.test</Text><Text style={styles.muted}>Demo identity only; no Google account is contacted.</Text>
        <View style={[styles.row, { flexWrap: 'wrap', marginTop: 14 }]}><Button title="Simulate allow access" primary onPress={authorize} /><Button title="Simulate deny access" onPress={() => { setConnected(false); setNotice('Access denied. The accepted schedule was not published.'); }} /></View>
        <Text style={[styles.label, { marginTop: 19 }]}>DESTINATION CALENDAR</Text><View style={[styles.row, { flexWrap: 'wrap' }]}>{['Work & study', 'Personal', 'Team calendar'].map((value) => <PressableCalendar key={value} value={value} selected={calendar === value} onPress={() => setCalendar(value)} />)}</View>
        <View style={[styles.row, { flexWrap: 'wrap', marginTop: 17 }]}><Button title="Review publish" primary onPress={openPreview} /></View>
      </Card>
      <Card style={{ flex: 1.2, minWidth: 300 }}>
        <View style={[styles.row, { justifyContent: 'space-between' }]}><Text style={styles.heading}>Schedule preview</Text><Pill color={accepted ? palette.green : palette.amber}>{accepted ? 'ACCEPTED' : 'NEEDS ACCEPTANCE'}</Pill></View><Text style={styles.muted}>Only accepted draft shifts are eligible.</Text>
        {!data.length && <Text style={[styles.body, { marginTop: 18 }]}>No shifts yet. Generate and accept a plan first.</Text>}
        {data.map((shift) => <View key={shift.id} style={{ paddingVertical: 12, borderBottomWidth: 1, borderColor: palette.line }}><Text style={{ fontWeight: '800', color: palette.ink }}>{new Date(shift.start).toLocaleDateString('en', { weekday: 'long', month: 'short', day: 'numeric' })} · {shift.title}</Text><Text style={styles.muted}>{shift.start.slice(11, 16)}–{shift.end.slice(11, 16)} · {published.length ? 'simulated publish' : 'draft preview'}</Text>{published.length > 0 && <View style={[styles.row, { marginTop: 9 }]}><Button title="Simulate update" onPress={() => revise(shift.id)} /><Button title="Simulate delete" danger onPress={() => remove(shift.id)} /></View>}</View>)}
        {!!notice && <View accessibilityRole="alert" style={{ marginTop: 14, padding: 12, borderRadius: 9, backgroundColor: notice.includes('failed') || notice.includes('denied') ? palette.redSoft : palette.blueSoft }}><Text style={styles.body}>{notice}</Text></View>}
      </Card>
    </View>
    <Card><Text style={styles.heading}>What this preview represents</Text><Text style={[styles.body, { marginTop: 8 }]}>The selected calendar name, access result, event count, publish errors and later updates/deletions are all mock state. The accepted proposal in the planner is not changed by a canceled or failed publish.</Text></Card>
    <Modal visible={previewOpen} transparent animationType="fade" onRequestClose={() => setPreviewOpen(false)}>
      <View style={{ flex: 1, backgroundColor: '#11182788', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
        <View style={{ backgroundColor: '#FFF', borderRadius: 18, width: '100%', maxWidth: 500, padding: 22 }}>
          <Pill>MOCK PUBLISH PREVIEW</Pill><Text style={[styles.heading, { marginTop: 12 }]}>Review before confirming</Text>
          <Text style={styles.subtitle}>{shifts.length} accepted shift(s) to {calendar}. Nothing changes until you confirm.</Text>
          <View style={{ maxHeight: 250, marginTop: 12 }}>
            {shifts.map((shift) => <Text key={shift.id} style={[styles.body, { paddingVertical: 8, borderBottomWidth: 1, borderColor: palette.line }]}>{new Date(shift.start).toLocaleDateString('en', { weekday: 'short', month: 'short', day: 'numeric' })} · {shift.start.slice(11, 16)}–{shift.end.slice(11, 16)} · {shift.title}</Text>)}
          </View>
          <Text style={[styles.muted, { marginTop: 12 }]}>{connected ? 'Mock access enabled.' : 'Mock access is not enabled yet.'} {fail ? 'Failure simulation is ON.' : 'Failure simulation is OFF.'}</Text>
          <View style={[styles.row, { flexWrap: 'wrap', marginTop: 10 }]}><Button title={connected ? 'Simulate deny access' : 'Simulate allow access'} onPress={() => { if (connected) { setConnected(false); setNotice('Access denied.'); } else authorize(); }} /><Button title={fail ? 'Turn failure off' : 'Turn failure on'} onPress={() => setFail(!fail)} /></View>
          {!!notice && <Text accessibilityRole="alert" style={styles.error}>{notice}</Text>}
          <View style={[styles.row, { justifyContent: 'flex-end', flexWrap: 'wrap', marginTop: 16 }]}><Button title="Cancel publish" onPress={() => { setPreviewOpen(false); setNotice('Publish preview canceled. No published state changed.'); }} /><Button title="Confirm simulated publish" primary onPress={publish} /></View>
        </View>
      </View>
    </Modal>
  </View>;
}
function PressableCalendar({ value, selected, onPress }: { value: string; selected: boolean; onPress: () => void }) {
  return <Text accessibilityRole="button" onPress={onPress} style={{ padding: 9, borderRadius: 8, color: selected ? palette.blue : palette.muted, backgroundColor: selected ? palette.blueSoft : '#F2F3F7', fontSize: 12, fontWeight: '700' }}>{value}</Text>;
}