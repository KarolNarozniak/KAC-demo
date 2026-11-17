// Publikacja zaakceptowanego grafiku w Google Calendar (S23KC2S1P2-30, G07 / S23KC2S1P2-291).
//
// 1–2  „Opublikuj w Google Calendar” – tylko przy zaakceptowanym grafiku z co najmniej jedną zmianą
// 3–4a konto Google i zgoda na dodawanie wydarzeń; bez konta albo bez zgody – informacja, że publikacja nie jest możliwa
// 5–7  lista kalendarzy, do których można dodawać wydarzenia, wybór kalendarza i podgląd zmian roboczych
// 8–8a „Opublikuj” albo „Anuluj” – anulowanie niczego nie zmienia ani w KAC, ani w Google
// 9–10 potwierdzenie z liczbą dodanych wydarzeń i widok kalendarza Google: zmiany razem z pozostałymi wydarzeniami;
//      9a – błąd nigdy nie wygląda na sukces, ponowienie publikuje tylko brakujące pozycje.
// Konto połączone przez Google: wydarzenia powstają naprawdę. Konto demonstracyjne: symulacja – baner, przyciski wymuszonego wyniku i oznaczenia.

import React, { useEffect, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Button, useTheme } from './ui';
import { targetOptions, type GoogleIntegrationStatus, type Notice } from '../domain/googleIntegration';
import {
  actionLabel, calendarViewLines, calendarViewTitle, canRetry, itemResultLabel, itemTimeLabel, pendingCount, previewSummary, PUBLICATION_SIMULATIONS,
  publicationAccount, publicationEntry, publicationErrorMessage, publicationNotice, SIMULATION_BANNER,
  type PublicationCalendarView, type PublicationItemResult, type PublicationPreview, type PublicationResult, type PublicationSimulation,
} from '../domain/googlePublication';
import {
  getGoogleCalendarSelection, getGoogleIntegration, getPublicationCalendarView, GoogleIntegrationApiError, previewGooglePublication, publishGoogleSchedule,
} from '../services/googleIntegrationApi';

type Props = {
  weekStart: string; schedule: { isApproved: boolean; shifts: unknown[]; version?: number } | null; readOnly: boolean;
  /** Krok 3–4a: połączenie konta albo zgoda na zapis są w Ustawieniach → Google Calendar. */
  onOpenSettings?: () => void;
};
const codeOf = (error: unknown) => (error instanceof GoogleIntegrationApiError ? error.code : 'network');

export default function GooglePublication({ weekStart, schedule, readOnly, onOpenSettings }: Props) {
  const { palette, styles } = useTheme();
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<PublicationPreview | null>(null);
  // Brak domyślnego kalendarza publikacji (G04): użytkownik wybiera go tutaj spośród kalendarzy z prawem zapisu.
  const [choices, setChoices] = useState<{ id: string; name: string }[] | null>(null);
  const [result, setResult] = useState<PublicationResult | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [simulate, setSimulate] = useState<PublicationSimulation | null>(null);
  const [account, setAccount] = useState<GoogleIntegrationStatus | null>(null);
  const [view, setView] = useState<PublicationCalendarView | null>(null);
  const [busy, setBusy] = useState(false);
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);
  // Inny tydzień albo nowa wersja grafiku – zamykamy podgląd, żeby nie potwierdzić nieaktualnego.
  useEffect(() => { setOpen(false); setPreview(null); setResult(null); setNotice(null); setChoices(null); setView(null); }, [weekStart, schedule?.version, schedule?.isApproved]);

  const entry = publicationEntry(schedule, readOnly);
  if (readOnly || !schedule) return null;

  const loadPreview = async (calendarId?: string) => {
    setBusy(true); setNotice(null);
    try {
      const next = await previewGooglePublication(weekStart, calendarId);
      if (!mounted.current) return;
      setPreview(next); setChoices(null);
    } catch (error) {
      if (!mounted.current) return;
      const code = codeOf(error);
      setPreview(null);
      if (code === 'no_publication_target') {
        try {
          const selection = await getGoogleCalendarSelection();
          if (mounted.current) setChoices(targetOptions(selection).map(({ id, name }) => ({ id, name })));
        } catch { /* komunikat poniżej wystarczy */ }
      }
      if (mounted.current) setNotice({ tone: code === 'no_publication_target' ? 'info' : 'error', text: publicationErrorMessage(code) });
    } finally {
      if (mounted.current) setBusy(false);
    }
  };

  const start = async () => {
    setOpen(true); setResult(null); setView(null); setAccount(null);
    // Krok 3–4: konto Google i zgoda na dodawanie wydarzeń. Bez nich podglądu nie ma (4a).
    let status: GoogleIntegrationStatus | null = null;
    try { status = await getGoogleIntegration(); } catch { /* brak serwera – komunikat da podgląd */ }
    if (!mounted.current) return;
    setAccount(status);
    if (status && publicationAccount(status).state !== 'ok') return;
    void loadPreview();
  };
  const cancel = () => { setOpen(false); setPreview(null); setChoices(null); setNotice(null); setResult(null); setView(null); };
  const showCalendar = async (calendarId: string) => {
    try {
      const next = await getPublicationCalendarView(weekStart, calendarId);
      if (mounted.current) setView(next);
    } catch { if (mounted.current) setView(null); }
  };

  /** retry – ponowienie po błędzie: bez wymuszonego wyniku, żeby pokazać, że publikowane są tylko brakujące pozycje. */
  const confirm = async (retry = false) => {
    if (!preview || busy) return;
    setBusy(true); setNotice(null);
    try {
      const outcome = await publishGoogleSchedule(weekStart, preview.scheduleVersion, preview.target.id, retry ? undefined : simulate ?? undefined);
      if (!mounted.current) return;
      setResult(outcome); setPreview(outcome.preview); setNotice(publicationNotice(outcome));
      // Krok 10: po publikacji (także częściowej) – kalendarz Google z opublikowanymi zmianami wśród pozostałych wydarzeń.
      if (outcome.attempt.status !== 'error') void showCalendar(outcome.preview.target.id);
    } catch (error) {
      if (!mounted.current) return;
      const code = codeOf(error);
      setNotice({ tone: 'error', text: publicationErrorMessage(code) });
      if (code === 'schedule_version_conflict') void loadPreview(preview.target.id);
    } finally {
      if (mounted.current) setBusy(false);
    }
  };

  const tone = { success: palette.green, info: palette.ink, error: palette.red };
  const chip = (selected: boolean) => ({ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 99, borderWidth: 1,
    borderColor: selected ? palette.blue : palette.line, backgroundColor: selected ? palette.blueSoft : 'transparent' });
  const resultColor = { published: palette.green, unchanged: palette.muted, failed: palette.red, skipped: palette.amber };

  if (!open) return <View style={{ marginTop: 12 }}>
    <Button title="Opublikuj w Google Calendar" disabled={!entry.enabled} onPress={() => void start()} />
    {!!entry.reason && <Text style={[styles.muted, { marginTop: 4 }]}>{entry.reason}</Text>}
  </View>;

  return (
    <View accessibilityLabel="Publikacja grafiku w Google Calendar" style={[styles.card, { marginTop: 12, borderColor: palette.amber }]}>
      <Text style={styles.heading}>Publikacja w Google Calendar</Text>
      {!!preview?.simulated && <Text accessibilityRole="text" style={{ marginTop: 6, fontSize: 12, fontWeight: '800', color: palette.amber }}>{SIMULATION_BANNER}</Text>}

      {!!account && (() => {
        const access = publicationAccount(account);
        return <View style={{ marginTop: 10 }}>
          <Text style={styles.label}>KONTO GOOGLE</Text>
          <Text style={[styles.body, { marginTop: 4, color: access.state === 'ok' ? palette.ink : palette.red }]}>{access.text}</Text>
          {access.state !== 'ok' && !!onOpenSettings && <View style={{ marginTop: 6, alignSelf: 'flex-start' }}>
            <Button title={access.state === 'no_write' ? 'Połącz ponownie konto Google' : 'Połącz konto Google'} primary onPress={onOpenSettings} />
          </View>}
        </View>;
      })()}

      {busy && !preview && <Text accessibilityLiveRegion="polite" style={[styles.muted, { marginTop: 8 }]}>Wczytywanie podglądu…</Text>}

      {choices && <View style={{ marginTop: 10 }}>
        <Text style={styles.label}>KALENDARZE, DO KTÓRYCH MOŻESZ DODAWAĆ WYDARZENIA</Text>
        {choices.length === 0 && <Text style={styles.muted}>Konto nie ma kalendarza z prawem zapisu. Wybierz inny dostęp w Ustawieniach → Google Calendar.</Text>}
        {choices.map((option) => <Button key={option.id} title={option.name} disabled={busy} onPress={() => void loadPreview(option.id)} />)}
      </View>}

      {preview && <>
        {preview.targets.length > 0 && <View style={{ marginTop: 10 }}>
          <Text style={styles.label}>KALENDARZE, DO KTÓRYCH MOŻESZ DODAWAĆ WYDARZENIA</Text>
          <View accessibilityRole="radiogroup" accessibilityLabel="Kalendarz docelowy publikacji" style={[styles.row, { flexWrap: 'wrap', gap: 6, marginTop: 6 }]}>
            {preview.targets.map((target) => {
              const selected = target.id === preview.target.id;
              return <Pressable key={target.id} accessibilityRole="radio" accessibilityLabel={target.name} accessibilityState={{ checked: selected, disabled: busy }}
                disabled={busy || selected} onPress={() => { setResult(null); void loadPreview(target.id); }} style={chip(selected)}>
                <Text style={{ fontSize: 12, fontWeight: '700', color: selected ? palette.blue : palette.muted }}>{target.name}</Text>
              </Pressable>;
            })}
          </View>
        </View>}

        <Text style={[styles.body, { marginTop: 10, fontWeight: '700' }]}>{previewSummary(preview)}</Text>
        <View style={{ marginTop: 6 }}>
          {(result?.items ?? preview.items.map((item) => ({ ...item, result: null }))).map((item) => {
            const outcome: PublicationItemResult | null = item.result;
            return <View key={item.shiftId} style={[styles.row, { paddingVertical: 7, borderTopWidth: 1, borderColor: palette.line }]}>
              <Text style={[styles.body, { flex: 1, minWidth: 0 }]} numberOfLines={1}>{item.title} · {itemTimeLabel(item)}</Text>
              <Text style={[styles.muted, { marginLeft: 8 }, outcome ? { color: resultColor[outcome], fontWeight: '700' } : item.action !== 'unchanged' && { color: palette.blue, fontWeight: '700' }]}>
                {outcome ? itemResultLabel(outcome, preview.simulated) : actionLabel(item.action)}
              </Text>
            </View>;
          })}
        </View>

        {!result && preview.simulated && pendingCount(preview) > 0 && <View style={{ marginTop: 10 }}>
          <Text style={styles.muted}>Wynik symulacji (do pokazania przebiegów błędów):</Text>
          <View accessibilityRole="radiogroup" accessibilityLabel="Wynik symulacji publikacji" style={[styles.row, { flexWrap: 'wrap', gap: 6, marginTop: 6 }]}>
            {PUBLICATION_SIMULATIONS.map((option) => {
              const selected = simulate === option.id;
              return <Pressable key={option.label} accessibilityRole="radio" accessibilityLabel={option.label} accessibilityState={{ checked: selected, disabled: busy }}
                disabled={busy} onPress={() => setSimulate(option.id)} style={chip(selected)}>
                <Text style={{ fontSize: 12, fontWeight: '700', color: selected ? palette.blue : palette.muted }}>{option.label}</Text>
              </Pressable>;
            })}
          </View>
        </View>}
      </>}

      {!!notice && <Text accessibilityRole={notice.tone === 'error' ? 'alert' : undefined} accessibilityLiveRegion="polite"
        style={[styles.body, { color: tone[notice.tone], marginTop: 10 }]}>{notice.text}</Text>}

      {!!view && <View accessibilityLabel="Widok kalendarza Google" style={{ marginTop: 12, padding: 10, borderRadius: 10, borderWidth: 1, borderColor: palette.line }}>
        <Text style={styles.label}>KALENDARZ GOOGLE{view.simulated ? ' · SYMULACJA' : ''}</Text>
        <Text style={[styles.body, { marginTop: 4 }]}>{calendarViewTitle(view)}</Text>
        {!!view.othersError && <Text style={[styles.muted, { marginTop: 4, color: palette.amber }]}>Nie udało się odczytać pozostałych wydarzeń z Google – widać tylko opublikowane zmiany.</Text>}
        {calendarViewLines(view).map((line) => <View key={line.key} style={[styles.row, { paddingVertical: 6, borderTopWidth: 1, borderColor: palette.line }]}>
          <Text style={[styles.muted, { width: 150 }]}>{line.when}</Text>
          <Text style={[styles.body, { flex: 1, minWidth: 0 }, line.published && { fontWeight: '700' }]} numberOfLines={1}>{line.title}</Text>
          {line.published && <Text style={{ fontSize: 11, fontWeight: '800', color: palette.green, marginLeft: 6 }}>{view.simulated ? 'OPUBLIKOWANE (SYMULACJA)' : 'OPUBLIKOWANE'}</Text>}
        </View>)}
      </View>}

      <View style={[styles.row, { marginTop: 12, flexWrap: 'wrap' }]}>
        {preview && !result && <Button title={busy ? 'Publikowanie…' : 'Opublikuj'} primary disabled={busy || pendingCount(preview) === 0} onPress={() => void confirm()} />}
        {canRetry(result) && <Button title="Spróbuj ponownie" primary disabled={busy} onPress={() => void confirm(true)} />}
        <Button title={result ? 'Zamknij' : 'Anuluj'} disabled={busy} onPress={cancel} />
      </View>
    </View>
  );
}
