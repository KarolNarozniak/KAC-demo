// Stan formularza profilu pracy: wczytanie, zmiany, walidacja, zapis, anulowanie i konflikt wersji.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { draftFromProfile, inputFromDraft, isDirty, validateDraft, type ProfileDraft } from '../domain/workProfile';
import { loadWorkProfile, saveWorkProfile, WorkProfileConflictError, WorkProfileValidationError, type WorkProfile } from '../services/workProfileApi';

export type WorkProfileState = ReturnType<typeof useWorkProfile>;

export function useWorkProfile(active: boolean) {
  const [saved, setSaved] = useState<WorkProfile | null>(null);
  const [draft, setDraft] = useState<ProfileDraft | null>(null);
  const [loadError, setLoadError] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [notice, setNotice] = useState('');
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const [conflict, setConflict] = useState<WorkProfile | null>(null);

  const showSaved = (profile: WorkProfile) => { setSaved(profile); setDraft(draftFromProfile(profile)); setServerErrors({}); setConflict(null); };
  const reload = useCallback(async () => {
    setLoadError('');
    try { showSaved(await loadWorkProfile()); }
    catch (error) { setLoadError(error instanceof Error ? error.message : 'Nie udało się wczytać profilu pracy.'); }
  }, []);
  useEffect(() => { if (active && !saved) void reload(); }, [active, saved, reload]);

  const dirty = isDirty(draft, saved);
  const errors = useMemo(() => ({ ...(draft ? validateDraft(draft) : {}), ...serverErrors }), [draft, serverErrors]);
  const valid = Object.keys(errors).length === 0;

  const change = (update: (current: ProfileDraft) => ProfileDraft) => {
    setDraft((current) => current ? update(current) : current);
    setNotice(''); setSaveError(''); setServerErrors({});
  };

  /** Zapisuje profil. Zwraca zapisany profil albo null, gdy zapis się nie udał (komunikat jest w saveError). */
  const save = async (base: ProfileDraft | null = draft): Promise<WorkProfile | null> => {
    if (!base || saving) return null;
    if (Object.keys(validateDraft(base)).length) { setSaveError('Popraw zaznaczone pola.'); return null; }
    setSaving(true); setSaveError(''); setNotice('');
    try {
      const profile = await saveWorkProfile(inputFromDraft(base));
      showSaved(profile);
      setNotice('Zapisano profil pracy. Zmiany obejmą kolejne generowane grafiki; zatwierdzone grafiki pozostają bez zmian.');
      return profile;
    } catch (error) {
      if (error instanceof WorkProfileValidationError) { setServerErrors(error.fields); setSaveError(error.message); }
      else if (error instanceof WorkProfileConflictError) { setConflict(error.current); setSaveError('Profil zmieniono w innym miejscu. Wczytaj aktualny albo zapisz swoje zmiany ponownie.'); }
      else setSaveError(error instanceof Error ? error.message : 'Nie udało się zapisać profilu.');
      return null;
    } finally { setSaving(false); }
  };

  /** 6a / 3a: rezygnacja – formularz wraca do zapisanego profilu, nic nie trafia do bazy. */
  const cancel = () => { if (saved) showSaved(saved); setSaveError(''); setNotice(''); };
  /** Konflikt: wczytaj profil zapisany w innym miejscu (moje zmiany przepadają). */
  const loadCurrent = () => { if (conflict) showSaved(conflict); setSaveError(''); };
  /** Konflikt: zapisz moje zmiany na aktualnej wersji profilu. */
  const overwrite = async () => {
    if (!conflict || !draft) return null;
    const next = { ...draft, profileVersion: conflict.profileVersion };
    setSaved(conflict); setDraft(next); setConflict(null);
    return save(next);
  };

  return { saved, draft, dirty, errors, valid, loadError, saving, saveError, notice, conflict, reload, change, save, cancel, loadCurrent, overwrite };
}
