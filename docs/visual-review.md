# Przegląd interfejsu / Visual review

## Powtarzalne zrzuty

W dwóch terminalach uruchom:

```sh
npm run build:web
npm run web:start
```

```sh
npm run ui:capture -- artifacts/ui-review/latest
```

Skrypt wykorzystuje Playwright i lokalny Chromium. Domyślnie używa `/usr/lib/chromium/chromium`; inną ścieżkę można wskazać przez `CHROMIUM_PATH`, a adres strony przez `UI_URL` (domyślnie `http://localhost:8080`).

Zrzuty obejmują desktop 1440×1000 i mobilną stronę 390×844, główne ekrany, rozwinięte formularze, okna dialogowe oraz pozycje przewijania. Żądania `/api/v1/` są przechwytywane i obsługiwane przez syntetyczne dane. Skrypt nie zapisuje danych w prawdziwej bazie ani nie wywołuje Azure AI. Pliki wynikowe nie trafiają do Gita.

`browser-errors.json` zawiera błędy renderowania i wyniki sprawdzeń zachowania: wysyłanie Enterem, nową linię przez Shift+Enter, wyrównanie pola wiadomości, stabilność przewijania historii, mobilną nawigację, położenie przycisku dodawania, pola dat/czasu, anulowanie edycji czasu trwania i tworzenie wydarzenia bez zbędnego komunikatu.

Każdą ocenę wizualną przeprowadza nowy agent bez historii rozmowy, kodu i wcześniejszych ocen. Otrzymuje wyłącznie bieżące zrzuty, opis aplikacji oraz wymagania dotyczące nawigacji. Raporty i zrzuty kolejnych rund należy zachować oddzielnie.

## Reproducing the review

Build and start the web application, then run `npm run ui:capture -- artifacts/ui-review/latest`. Configure `CHROMIUM_PATH` and `UI_URL` if needed. An optional third argument filters screenshot names, for example `npm run ui:capture -- artifacts/ui-review/latest today,week`; behavioral checks still run.

The harness uses synthetic intercepted API responses, an isolated browser context per viewport, Polish locale and the Warsaw time zone. It captures desktop and mobile web, not native Android/iOS. It checks browser behavior in addition to producing screenshots; this does not replace backend integration tests.

Use a fresh reviewer with no inherited conversation or earlier reports for every round. Keep its independent report alongside that round's screenshots. Generated artifacts belong under the ignored `artifacts/ui-review/` directory.

## Zakończenie przeglądu

Na prośbę użytkownika zakończono iteracje przed osiągnięciem zakładanego progu 8,5/10. Ostatnia niezależna ocena: **8,0/10** (desktop **8,1**, mobile **7,9**). Raport: [visual-review-report.md](visual-review-report.md). Przykładowe zrzuty sześciu ekranów dla obu rozmiarów znajdują się w [ui-screenshots](ui-screenshots/). Pełne 74 zrzuty, galeria i archiwum ZIP są w lokalnym katalogu `artifacts/ui-review/`.

## Poprawki z telefonu

Czat uwzględnia klawiaturę ekranową na Androidzie/iOS, a w przeglądarce dopasowuje wysokość do visual viewport. Nawigacja dolna chowa się podczas pisania. Test `npm run ui:capture -- artifacts/ui-review/mobile-keyboard-fix assistant,assistant-keyboard-visual,assistant-keyboard-resized chat` sprawdza oba sposoby zmiany viewportu, powrót nawigacji, kolor podpowiedzi oraz wyśrodkowanie plusa do zdjęć. Są to symulacje przeglądarkowe; eksport Androida potwierdza budowanie kodu natywnego, bez testu na fizycznym telefonie.
