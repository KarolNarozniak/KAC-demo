# Przegląd implementacji AI — 15.11.2026

Sprawdzono kod, testy i historię po `git fetch origin --prune`. Branch Karola `origin/S23KC2S1P2-251&253&48` (29580f4) jest w całości w `origin/master` (628f5a8, merge #22). Nie ma nowszych niezmergowanych commitów na tym branchu. Baza zmian: master, osobny branch `feature/S23KC2S1P2-252-chat-events`. Ocena dotyczy repozytorium, nie aktualizacji statusów w Jirze.

| Historyjka | Co już zrobił Karol / obecny kod | Pozostały zakres |
| --- | --- | --- |
| 252 — dodawanie przez czat | Narzędzie `calendar_prepare_event_create`, trwałe rozmowy i propozycje z TTL, osobne confirm/cancel, sprawdzanie kolizji w kalendarzu, idempotentny zapis, testy DB współbieżności i ponowienia. | Ten branch uzupełnia instrukcje dopytywania, pełny podgląd i jawne rozstrzyganie kolizji oraz zachowanie karty przy błędzie zapisu. Wymagany test rozmowy z Azure. |
| 254 — dzień i pytania o kalendarz | Zakładka Dziś, karta podsumowania AI, odświeżanie, ponowne użycie rozmowy dziennej, narzędzia wyszukiwania i odczytu profilu. | Brak dedykowanych obliczeń sumy przepracowanych godzin i wolnych okien. Wyszukiwanie porównuje bazowe daty, nie rozwija cotygodniowych wystąpień, i ogranicza wynik do 100 wpisów; odpowiedzi nie są jeszcze pełną realizacją historyjki. |
| 256 — import tekstu | Azure import PDF/JPG/PNG, ścisły schemat, istniejące sesje podglądu, korekta, pracownicy i rozstrzyganie duplikatów. | Brak wejścia wklejonego tekstu w UI i API. Należy dołączyć je do istniejącej ekstrakcji i sesji importu. |
| 255 — wyszukiwanie/edycja/usuwanie | Narzędzia search/update/delete, podglądy, potwierdzenie, snapshot i odrzucenie nieaktualnego podglądu, idempotencja. | Doprecyzowanie wyboru spośród wyników i reguł pojedynczego wystąpienia/całej serii; obecny podgląd zmiany nie pokazuje pełnego porównania przed/po. Wyszukiwanie wymaga obsługi wystąpień cyklicznych. |
| 257 — grafik z czatu | Generator i ekran Grafiku już istnieją; asystent odczytuje profil. | Brak narzędzia generatora w rejestrze AI i przekazania propozycji z Asystenta do Grafiku. |
| 31 — powiadomienia i cisza | Ustawienia przypomnień, dostawa w aplikacji/Web Push, pola ciszy w bazie i odczycie API, funkcja przesuwania przypomnień uwzględnia północ. | Brak edytora godzin ciszy z walidacją i podglądem przykładowej godziny; obecność pól w backendzie nie kończy historyjki. |

## Zakres do testów

Implementowany jako pierwszy: 252. Pozostałe wysokie priorytety (254 i 256) wymagają osobnych uzupełnień; ten branch nie deklaruje ich ukończenia. Instrukcja testu ręcznego: `docs-site/docs/ai-integration.md`, sekcja „Dodawanie wydarzeń przez czat”. Bez nowych tabel, migracji ani równoległego systemu propozycji.

## Środowisko testów

- Zastosowano brakujące istniejące migracje Karola w lokalnym PostgreSQL: 009 AI, 010 outbox, 011 konsumenci, 012 kolejność wiadomości, 013 lease, 014 efekty akcji, 015 Web Push. Ten branch nie dodaje migracji.
- Testy integracyjne bazy: 12/13 zaliczonych, w tym scenariusz AI (izolacja zakresu, współbieżne zatwierdzenie, ponowienie zapisu). Istniejący `postgres.integration.test.ts:24` oczekuje 201 przy stałym terminie cotygodniowej zmiany, ale lokalny kalendarz zwraca 409 z powodu kolizji. Nie usuwano istniejących wydarzeń w celu wymuszenia wyniku testu.
- W lokalnym środowisku nie skonfigurowano endpointu/deploymentu Azure AI i nie znaleziono Azure CLI. Nie wykonano rozmowy z rzeczywistym modelem. Konfiguracja i logowanie: README oraz dokumentacja integracji AI.
- Końcowe `npm test`: 25/25 web i 156/156 API. `npm run typecheck` oraz `npm run api:openapi:check` zaliczone. Kontrakt i obie wersje referencji API zregenerowane na zależnościach odtworzonych przez `npm ci` (bez zmiany lockfile).
- `npm run docs:build` i `npm run build`: zaliczone (obie wersje językowe dokumentacji, API i web).

## Poprawki UX i diagnostyka podsumowania

- Czat pokazuje wiadomość od razu, wskaźnik odpowiadania i rzeczywiste fragmenty odpowiedzi z Responses API. Potwierdzenie pozostaje w czacie; „Zatwierdź wszystko” wykonuje akcje kolejno, zatrzymując się przy błędzie lub kolizji.
- Ustawienia zawierają zapisywaną lokalnie formę zwracania się i ton agenta. Preferencje stylu nie zmieniają zasad potwierdzania akcji.
- Historia podsumowania z 15.11 wykazała ponowne użycie wyniku odczytu pustego kalendarza z 15:01 przy turze o 15:10, bez ponownego wywołania narzędzia. Regeneracja podsumowania używa teraz świeżej ukrytej rozmowy.
- W turze o 15:20 narzędzie zwróciło trzy wydarzenia, ale końcowy tekst modelu był pusty. Stary kod zapisywał komunikat zastępczy jako sukces. Niepełne i puste wyniki są teraz błędami, a limit wyjściowy podniesiono z 1200 do 4000 tokenów (obejmuje również rozumowanie). Historyczne logi nie zawierają statusu zakończenia modelu, więc nie potwierdzają jednoznacznie przyczyny pustego wyniku; nowa diagnostyka zapisuje powód niepełnej odpowiedzi.
- Weryfikacja: 34 testy web, 163 API; testy streamingu obejmują rzeczywiste lokalne połączenie HTTP i przerwanie upstream po rozłączeniu klienta. Sprawdzanie typów, kontrakt OpenAPI, dokumentacja PL/EN i pełny build zaliczone.
