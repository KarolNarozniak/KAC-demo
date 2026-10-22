# Dokumentacja Etapu A — KAC

Data przygotowania: 21.10.2026. Źródło backlogu: `Jira 2026-10-11T16_53_41+0200.csv` (migawka 11.10.2026 16:53 (UTC+02:00)).

## Status dokumentacji

Ten katalog zawiera historyczne artefakty Etapu A z 21.10.2026. Opisy makiety przedstawiają stan z dnia ich przygotowania, a nie bieżącą implementację. Aktualna aplikacja zapisuje wydarzenia i serie cotygodniowe w PostgreSQL; frontend korzysta z Expo SDK 58, React 19.3 i React Native 0.88. Wymagania środowiska, instrukcje uruchomienia i ograniczenia opisano w [głównym README](../README.md), a podgląd na urządzeniu w [README frontendu](../apps/web/README.md).

## Artefakty do przekazania

1. `01_Przedstawienie_problemu_Zamawiajacego_KAC.docx/.pdf` — problem, użytkownicy i oczekiwany zakres.
2. `02_Przedstawienie_problemu_Wykonawcy_KAC.docx/.pdf` — analiza domeny, granic, ryzyk i rozbieżności backlogu.
3. `03_Wizja_projektu_KAC.docx/.pdf` — wizja produktu, interesariusze, możliwości, ograniczenia i decyzje.
4. `04_Wstepny_harmonogram_RUP_KAC.xlsx/.pdf` — Gantt 13 tygodni względnych; pełny rejestr w arkuszu „Rejestr Jira”, a skład w arkuszu „Zespół”.
5. `05_Analiza_lingwistyczna_Jira_KAC.docx/.pdf` — kolorowane zdania użytkownika, osobne tabele grup czasownikowych/rzeczownikowych i opisowo wyprowadzeni kandydaci na obiekty.
6. `06_Slownik_pojec_KAC.docx/.pdf` — słownik pojęć domeny kalendarza studenta, bez technologii.
7. `generuj_dokumenty_kac.py` — skrypt odtwarzający DOCX, XLSX i Gantt PDF z lokalnego CSV Jira.

## Analiza CSV

- Rekordy: 55; historyjki: 49; epiki: 6.
- Status historyjek w eksporcie: 7 „W toku”, 42 „Do zrobienia”. To migawka z 11.10.2026, nie bieżący status.
- Udało się wyodrębnić zdanie „Jako–chcę–aby” z 49/49 historyjek. W pozostałych przypadkach kolorowana jest nazwa akcji ze zgłoszenia.

## Zespół

Skład przepisany ze zrzutu uprawnień przekazanego przez Zamawiającego:

| Osoba | Rola widoczna na zrzucie |
|---|---|
| Karol Narozniak | Właściciel |
| Michał Kozłowski | Współwłaściciel |
| Jan Lizińczyk | Współwłaściciel |
| Zuzanna Maksymów | Współwłaściciel |
| Krzysztof Olszewski | Współwłaściciel |
| Hubert Pogonowski | Współwłaściciel |
| Klaudia Porzuczek | Współwłaściciel |

„Właściciel/Współwłaściciel” oznacza rolę platformową, nie rolę Scrum/RUP. Eksport Jira zawiera osobne pole lidera projektu. Scrum Master nie jest wskazany na zrzucie; należy wyznaczyć go przed przypisaniem raportowania. Nie przypisano osobom ról w harmonogramie bez potwierdzenia kompetencji i dostępności.

## Granica mock/prod

Dokumenty rozróżniają istniejącą makietę (stan pamięciowy, symulowane importy/synchronizacja/powiadomienia) od wymagań Jira zawierających prawdziwą autoryzację, API, SQL/Redis lub Google Calendar. Wnioski auth/onboardingu zgłoszone po eksporcie CSV są odnotowane jako brakujące historyjki Jira.

## Uwagi organizacyjne

- Wyeksportowany MPP ma szablon RUP z historycznymi datami 2005; użyto go wyłącznie do nazw faz, ról i dyscyplin. Harmonogram KAC jest propozycją 13 tygodni od startu i nie używa przestarzałych dat.
- `Lista_kontrolna.xls` jest checklistą jakości przypadków użycia; traktujemy ją jako bramkę przeglądu, nie jako specyfikację produktu.
- Raport do SharePoint przesyła tylko Scrum Master. Brak adresu witryny i uprawnień oznacza, że plików nie opublikowano.
