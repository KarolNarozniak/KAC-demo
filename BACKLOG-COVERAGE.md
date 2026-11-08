# Jira Backlog Coverage

Source: `Jira 2026-10-11T16_53_41+0200.csv` in this repository. The export was parsed as quoted CSV with multiline fields; ticket rows were counted by the `Klucz zgłoszenia` column (not links mentioned inside descriptions): **55 issues = 49 stories + 6 epics**. Jira status labels below retain the export meaning (`Do zrobienia` = To do, `W toku` = In progress) as of the CSV snapshot on 2026-10-11. The CSV reports `-37` as **To do**; this corrects the earlier audit note that called it In progress.

Every row is represented by a visible route/control or by an explicit mock outcome. A visible demo treatment is not a claim that a production service exists. This is an in-memory mocked demo, not a backend implementation.

## Stories

| Key | CSV summary | Status at export | Demo-visible treatment and production boundary |
|---|---|---|---|
| S23KC2S1P2-7 | Zebranie zajęć i pracy w jednym kalendarzu | To do | Week combines seeded class, work and personal events; local only. |
| S23KC2S1P2-8 | Przeniesienie planu zajęć z pliku do aplikacji | To do | Imports > Class timetable; choose sample ICS/CSV/PDF/photo preview, correct and import. No file parser/OCR. |
| S23KC2S1P2-9 | Wskazanie godzin dostępnych do pracy | To do | Work planner day and time-window controls; sample plan uses them. |
| S23KC2S1P2-10 | Uzyskanie grafiku pracy dopasowanego do zajęć | To do | Generate a sample week, avoiding required-class days. Not an optimization service. |
| S23KC2S1P2-11 | Kategorie i kolory wydarzeń | To do | Week category selector, stable category colors and legend. |
| S23KC2S1P2-12 | Wykorzystanie istniejącego kalendarza Google | To do | Imports has simulated account/calendar selection and permission-denied control; no OAuth or Google read. |
| S23KC2S1P2-13 | Otrzymywanie przypomnień przed zajęciami i pracą | To do | Notification preferences and class/work reminder simulation; no delivery. |
| S23KC2S1P2-14 | Wykrywanie duplikatów wydarzeń | To do | Implemented: normalized title + start instant across import categories, including weekly occurrences; explicit skip/replace/keep-both, ambiguous target selection, atomic confirmation and counts. End time deliberately excluded. |
| S23KC2S1P2-15 | Edycja i zapis ustawień profilu | To do | Profile route edits demo identity and saves in-memory for this session. |
| S23KC2S1P2-16 | Uwzględnienie czasu dojazdu | To do | Commute buffer preference reduces sample planner capacity. |
| S23KC2S1P2-17 | Obsługa błędów synchronizacji | To do | Imports can force a mock sync failure and retry/reconnect; no network sync. |
| S23KC2S1P2-18 | Powiadomienie o braku możliwości realizacji celu godzin | To do | Planner shows possible/missing hours and permits changing goal/availability. |
| S23KC2S1P2-19 | Powielanie zajęć na kolejne tygodnie | To do | Weekly recurrence toggle; source local weekday/time retained. |
| S23KC2S1P2-20 | Korekta błędnie odczytanych danych | To do | Import title, place/location, date and times are editable and location is copied onto the saved event; no recognition engine. |
| S23KC2S1P2-21 | Określenie maksymalnej liczby godzin | To do | Planner weekly maximum validation and capacity cap. |
| S23KC2S1P2-22 | Uwzględnienie odpoczynku | To do | Configured break minutes separate sample shifts; no optimizer guarantee. |
| S23KC2S1P2-23 | Pobieranie zmian | To do | Mock Google sync button refreshes sample preview; errors/retry are simulated. |
| S23KC2S1P2-24 | Informacja o zmianie planu | To do | Event-change alert setting and sample reminder action; no background change detection. |
| S23KC2S1P2-25 | Dostosowanie planu do zmian w harmonogramie | To do | Regenerate after preference/calendar changes; review/reject proposal locally. No automatic sync from external calendars. |
| S23KC2S1P2-26 | Oznaczanie obowiązkowych zajęć | To do | Required-class toggle, card emphasis and planner avoidance. |
| S23KC2S1P2-27 | Jednorazowy import wydarzeń z Google Calendar | To do | Mock calendar, fixed demo date range/empty-calendar choice, preview, cancel and import count. |
| S23KC2S1P2-28 | Określenie preferowanych godzin | To do | Preferred start control influences sample proposal; required class remains a hard exclusion. |
| S23KC2S1P2-29 | Wykrywanie braku możliwości realizacji celu | To do | Planner infeasibility/missing-hours result and retry after changed settings. |
| S23KC2S1P2-30 | Publikacja zaakceptowanego grafiku | To do | Publish requires accepted proposal; an explicit non-mutating shift/calendar preview offers Cancel or Confirm. Permission/error/success outcomes remain simulations. |
| S23KC2S1P2-31 | Ustawienia powiadomień: włączanie i godziny ciszy (nowe) | To do | Enable/disable, overnight quiet window, validation, save/cancel and time preview. |
| S23KC2S1P2-32 | Kontrola rozpoznanych danych przed zapisem | To do | Editable title/place/date/time preview followed by local import; no API/Redis write. |
| S23KC2S1P2-33 | Blokowanie dni wolnych i okresu sesji | To do | Planner blocked-day controls; sample generation excludes them. |
| S23KC2S1P2-34 | Ręczna korekta zaproponowanego grafiku | To do | Proposed shift time fields and accept/reject review. |
| S23KC2S1P2-35 | Odłączenie konta i cofnięcie zgody | To do | Disconnect/revoke mock account control; no real token or consent exists. |
| S23KC2S1P2-36 | Ostrzeżenie o przekroczeniu limitu godzin | To do | Planner maximum constrains proposed capacity; feasibility result is local. |
| S23KC2S1P2-37 | Wyświetlanie tygodnia | To do | Responsive weekly view, next/previous navigation, empty state and seven-day mobile selector. |
| S23KC2S1P2-38 | Import planu zajęć z PDF/zdjęcia | To do | PDF demo implemented: local fixed-layout WAT mini e-D reader, editable preview and transactional save; PDF selection on web/Android/iOS. Photos, scanned PDFs and OCR deferred by scope decision. |
| S23KC2S1P2-39 | Określenie celu godzin | To do | Editable weekly work goal in Planner and Profile routes. |
| S23KC2S1P2-40 | Uwzględnienie zajęć | To do | Required class fixtures are shown and avoid planner time. |
| S23KC2S1P2-41 | Wybór kalendarzy | To do | Simulated University/Personal/Empty source and publish destination choices. |
| S23KC2S1P2-42 | Informacja o konflikcie | To do | Event details and overlap warning list conflicts. Pending creates/edits are described accurately; user can keep editing or explicitly accept the conflict. |
| S23KC2S1P2-43 | wykrywanie kolizji | To do | Implemented: server-authoritative half-open collision checks, weekly recurrence, detailed overlap warnings, explicit snapshot-bound override, cancellation and atomic whole-series editing. |
| S23KC2S1P2-44 | import grafiku pracy ze zdjęcia lub pliku | To do | Work-shift sample photo/PDF/CSV preview, corrections and duplicate choice; no parser/OCR. |
| S23KC2S1P2-45 | określenie stawki godzinowej | To do | Hourly rate and computed proposal earnings in Planner. |
| S23KC2S1P2-46 | akceptacja grafiku | To do | Accept/reject proposal state; accepted shifts unlock simulated publish. |
| S23KC2S1P2-47 | aktualizacja i usuwanie opublikowanych zmian | To do | Simulated update/delete controls mutate only the local published list. |
| S23KC2S1P2-48 | przypomnienie o zmianie w pracy | To do | Work reminder preference and reminder simulation; no push/email. |
| S23KC2S1P2-49 | Zapisanie wydarzenia w kilku kliknięciach | In progress | Week add form supports title/date/time/category and cancel; in-memory only. |
| S23KC2S1P2-50 | Przesunięcie wydarzenia na inną godzinę | In progress | Event detail/edit time form; recurring edit is explicitly series-level and preserves source anchor. |
| S23KC2S1P2-51 | Powielenie zajęć na kolejne tygodnie | In progress | Weekly repeat toggle and DST-safe wall-clock recurrence. |
| S23KC2S1P2-52 | Rozpoznawanie wydarzeń po kolorze | In progress | Fixed class/work/personal category colors and details labels. |
| S23KC2S1P2-53 | Przeglądanie kolejnych tygodni planu | In progress | Previous/next week navigation; weeks are generated locally with an empty state. |
| S23KC2S1P2-54 | Wyróżnienie zajęć, których nie można opuścić | In progress | Required marker/frame and planner avoidance. |
| S23KC2S1P2-55 | Ostrzeżenie o nakładających się terminach | In progress | Before confirmation, the calendar is unchanged. Add-anyway adds the new event alongside existing conflicts; an edit replaces only its source event while leaving the other conflict intact. |

## Epics (organizational scope, not UI routes)

| Key | CSV summary | Status at export | Organizational scope represented by |
|---|---|---|---|
| S23KC2S1P2-1 | Obszar związany z najbardziej podstawowymi funkcjami aplikacji | To do | Calendar basics, event CRUD, weekly browsing and local demo reset. |
| S23KC2S1P2-2 | Funkcja aplikacji związana z importem kalendarzy z innych platform do naszej aplikacji | To do | Mock import preview, correction, dedup and sync outcomes. |
| S23KC2S1P2-3 | Obszar poświęcony wybraniu preferencji dotyczących planowania grafiku do pracy | To do | Profile and work planner preferences. |
| S23KC2S1P2-4 | Funkcja związana z automatycznym planowaniem grafiku do pracy | To do | Deterministic mock plan proposal, feasibility and acceptance. |
| S23KC2S1P2-5 | Funkcja związana z importem danych z naszej aplikacji do Google Calendar | To do | Simulated accepted-plan publish preview/outcomes. |
| S23KC2S1P2-6 | Funkcja do wysyłania powiadomień z aplikacji do użytkownika | To do | Notification settings, quiet hours and local reminder simulations. |

## Explicit production deferrals

No Google OAuth or Calendar API read/write/sync; no real account or consent handling; no persistence, API, SQL or Redis; no push/email delivery or scheduled workers; no document/image upload, OCR or extraction; no production shift optimizer; no real published-event mutation. All sample state is in memory and reset restores fixtures. Jira's linked references inside descriptions were not counted as separate issues.
