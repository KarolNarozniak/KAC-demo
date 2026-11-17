// Wybór kalendarzy Google w panelu Ustawienia → Google Calendar (S23KC2S1P2-41, G04 / S23KC2S1P2-288).
//
// 1–3  lista kalendarzy połączonego konta z rolą i oznaczeniem, które są wybrane
// 4    zaznaczenie kalendarzy uwzględnianych przy planowaniu i synchronizacji
// 5    wybór jednego kalendarza publikacji – tylko kalendarze z prawem zapisu (serwer sprawdza to ponownie)
// 6–7  podsumowanie zmian i zatwierdzenie; „Anuluj” zostawia poprzedni wybór
// Zmiana w innym oknie (konflikt wersji) wczytuje aktualny wybór bez zapisu. Kalendarz, do którego konto straciło dostęp,
// zostaje widoczny z oznaczeniem, aż użytkownik zmieni wybór.

import React, { useEffect, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Button, useTheme } from './ui';
import {
  accessRoleLabel, apiErrorMessage, draftFrom, draftProblem, selectionChanges, selectionConfirmation, selectionSummary, SOURCE_PERMISSION_TEXT, targetOptions,
  targetProblemText, toggleSource,
  type CalendarSelection, type Notice, type SelectionDraft,
} from '../domain/googleIntegration';
import { getGoogleCalendarSelection, GoogleIntegrationApiError, saveGoogleCalendarSelection } from '../services/googleIntegrationApi';

type Props = {
  /** Zmienia się po odświeżeniu listy kalendarzy z Google – wybór jest wtedy wczytywany ponownie. */
  reloadKey: string;
  /** Wybór zapisany – sekcja synchronizacji odświeża stan; po zmianie źródeł panel od razu pobiera zmiany (G05, krok 6 historyjki 23). */
  onSaved: (saved: CalendarSelection, sourcesChanged: boolean) => void;
};

const codeOf = (error: unknown) => (error instanceof GoogleIntegrationApiError ? error.code : 'network');

export default function GoogleCalendarSelection({ reloadKey, onSaved }: Props) {
  const { palette, styles } = useTheme();
  const [selection, setSelection] = useState<CalendarSelection | null>(null);
  const [draft, setDraft] = useState<SelectionDraft | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState(false);
  const mounted = useRef(true);

  const load = async () => {
    try {
      const next = await getGoogleCalendarSelection();
      if (mounted.current) setSelection(next);
      return next;
    } catch (error) {
      if (mounted.current) setNotice({ tone: 'error', text: apiErrorMessage(codeOf(error)) });
      return null;
    }
  };

  useEffect(() => {
    mounted.current = true;
    void load();
    return () => { mounted.current = false; };
  }, [reloadKey]);

  const cancel = () => { setDraft(null); setConfirming(false); setNotice(null); };

  const save = async () => {
    if (!selection || !draft || busy) return;
    setBusy(true); setNotice(null);
    try {
      const saved = await saveGoogleCalendarSelection(selection.version, draft.sources, draft.target);
      if (!mounted.current) return;
      const before = [...selection.sourceCalendarIds].sort().join('|');
      const sourcesChanged = before !== [...saved.sourceCalendarIds].sort().join('|');
      setSelection(saved); setDraft(null); setConfirming(false);
      setNotice({ tone: 'success', text: sourcesChanged && saved.sourceCalendarIds.length ? 'Zapisano wybór kalendarzy – pobieram zmiany z Google.' : 'Zapisano wybór kalendarzy.' });
      onSaved(saved, sourcesChanged);
    } catch (error) {
      if (!mounted.current) return;
      const code = codeOf(error);
      setConfirming(false);
      // Konflikt: ktoś zapisał wybór w innym oknie – pokazujemy aktualny stan od nowa, bez zapisu.
      if (code === 'selection_conflict') {
        const fresh = await load();
        if (fresh && mounted.current) setDraft(draftFrom(fresh));
      }
      if (mounted.current) setNotice({ tone: 'error', text: apiErrorMessage(code) });
    } finally {
      if (mounted.current) setBusy(false);
    }
  };

  if (!selection) return notice ? <Text accessibilityRole="alert" style={[styles.error, { marginTop: 8 }]}>{notice.text}</Text> : null;

  const tone = { success: palette.green, info: palette.ink, error: palette.red };
  const editing = draft !== null;
  const problem = targetProblemText(selection.targetProblem);
  const changes = draft ? selectionChanges(selection, draft) : [];
  const blocker = draft ? draftProblem(selection, draft) : null;
  const targets = targetOptions(selection);
  const badge = (text: string, color: string) => <Text style={{ fontSize: 11, fontWeight: '800', color, marginLeft: 6 }}>{text}</Text>;

  return (
    <View style={{ marginTop: 4 }}>
      {!editing && <Text style={[styles.body, { marginBottom: 6 }]}>{selectionSummary(selection)}</Text>}
      {!!problem && !editing && <Text style={[styles.body, { color: palette.amber, marginBottom: 6 }]}>{problem}</Text>}
      {editing && <Text style={[styles.muted, { marginBottom: 2 }]}>Zaznacz kalendarze uwzględniane przy planowaniu i synchronizacji.</Text>}
      {editing && <Text style={[styles.muted, { marginBottom: 6 }]}>{SOURCE_PERMISSION_TEXT}</Text>}

      <View accessibilityRole={editing ? 'list' : undefined}>
        {selection.calendars.map((calendar) => {
          const checked = editing ? draft!.sources.includes(calendar.id) : calendar.source;
          const role = calendar.accessRole ? accessRoleLabel(calendar.accessRole) : 'brak dostępu';
          const canToggle = editing && (checked || calendar.available) && !busy;
          return <Pressable key={calendar.id} accessibilityRole="checkbox" accessibilityLabel={`${calendar.name} – do planowania`}
            accessibilityState={{ checked, disabled: !canToggle }} disabled={!canToggle}
            onPress={() => setDraft((current) => (current ? toggleSource(selection, current, calendar.id) : current))}
            style={[styles.row, { paddingVertical: 9, borderTopWidth: 1, borderColor: palette.line }]}>
            <Text style={{ width: 22, fontWeight: '800', color: checked ? palette.blue : palette.muted }}>{checked ? '☑' : '☐'}</Text>
            {/* Historyjka 41: nazwy kalendarzy i ich identyfikatory. */}
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text numberOfLines={1} style={[styles.body, !calendar.available && { color: palette.muted }]}>{calendar.name}{calendar.primary ? '  · główny' : ''}</Text>
              <Text numberOfLines={1} style={{ fontSize: 11, color: palette.muted }}>{calendar.id}</Text>
            </View>
            {!editing && calendar.publicationTarget && badge('PUBLIKACJA', calendar.available && calendar.writable ? palette.green : palette.amber)}
            <Text style={[styles.muted, { marginLeft: 8 }, calendar.writable && { color: palette.green, fontWeight: '700' }, !calendar.available && { color: palette.amber }]}>{role}</Text>
          </Pressable>;
        })}
      </View>

      {editing && <View style={{ marginTop: 12 }}>
        <Text style={styles.label}>KALENDARZ PUBLIKACJI GRAFIKU</Text>
        {!selection.canPublish && <Text style={[styles.muted, { marginTop: 4 }]}>Zgoda Google nie obejmuje dodawania wydarzeń – połącz konto ponownie, żeby wybrać kalendarz publikacji.</Text>}
        <View accessibilityRole="radiogroup" accessibilityLabel="Kalendarz publikacji grafiku" style={{ marginTop: 6 }}>
          {[{ id: null as string | null, name: 'Bez publikacji' }, ...(selection.canPublish ? targets : [])].map((option) => {
            const selected = draft!.target === option.id;
            return <Pressable key={option.id ?? '-'} accessibilityRole="radio" accessibilityLabel={option.name} accessibilityState={{ checked: selected, disabled: busy }} disabled={busy}
              onPress={() => setDraft((current) => (current ? { ...current, target: option.id } : current))}
              style={[styles.row, { paddingVertical: 7 }]}>
              <Text style={{ width: 22, fontWeight: '800', color: selected ? palette.blue : palette.muted }}>{selected ? '◉' : '○'}</Text>
              <Text style={[styles.body, { flex: 1 }]}>{option.name}</Text>
            </Pressable>;
          })}
        </View>
        <Text style={[styles.muted, { marginTop: 4 }]}>Lista pokazuje tylko kalendarze, do których możesz dodawać wydarzenia.</Text>
      </View>}

      {!!notice && <Text accessibilityRole={notice.tone === 'error' ? 'alert' : undefined} accessibilityLiveRegion="polite"
        style={[styles.body, { color: tone[notice.tone], marginTop: 8 }]}>{notice.text}</Text>}
      {!!blocker && <Text style={[styles.body, { color: palette.amber, marginTop: 8 }]}>{blocker}</Text>}

      {confirming && <View style={{ marginTop: 10, padding: 12, borderRadius: 10, borderWidth: 1, borderColor: palette.blue }}>
        <Text style={[styles.body, { fontWeight: '800' }]}>Zatwierdzić zmiany?</Text>
        {selectionConfirmation(selection, draft!).map((line) => <Text key={line} style={[styles.body, { marginTop: 4 }]}>• {line}</Text>)}
        <View style={[styles.row, { marginTop: 10, flexWrap: 'wrap' }]}>
          <Button title="Zatwierdź" primary disabled={busy} onPress={() => void save()} />
          <Button title="Wróć" disabled={busy} onPress={() => setConfirming(false)} />
        </View>
      </View>}

      <View style={[styles.row, { marginTop: 10, flexWrap: 'wrap' }]}>
        {!editing && <Button title="Zmień wybór kalendarzy" disabled={busy} onPress={() => { setNotice(null); setDraft(draftFrom(selection)); }} />}
        {editing && !confirming && <Button title="Dalej" primary disabled={busy || changes.length === 0 || !!blocker} onPress={() => setConfirming(true)} />}
        {editing && <Button title="Anuluj" disabled={busy} onPress={cancel} />}
      </View>
      {editing && !confirming && changes.length === 0 && <Text style={styles.muted}>Brak zmian do zapisania.</Text>}
    </View>
  );
}
