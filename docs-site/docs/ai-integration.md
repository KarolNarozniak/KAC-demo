---
id: ai-integration
title: Azure AI Foundry
sidebar_label: Integracja AI
description: Konfiguracja Entra ID, stateless Responses API, importów AI, narzędzi, retencji i Managed Identity.
---

# Azure AI Foundry

## Wybrany model integracji

API używa projektu Foundry i **model deploymentu**, a nie Hosted Agent Service. Klient projektu OpenAI wywołuje Responses API z `store: false`; wejścia narzędzi, historii i plików są przygotowywane w backendzie. Testowy Hosted Agent `jovial-agent-…` nie jest używany przez runtime i nie należy wpisywać jego `agentName` jako deploymentu modelu.

Powód: eksport ze sprintu wymaga Responses API, stateless requestów, lokalnej pamięci rozmów i backendowego rejestru narzędzi bez Agent Service. Wywołanie `getOpenAIClient({agentName})` kieruje do osobnej ścieżki preview i nie przyjmuje takiego samego zestawu ustawień request-level jak bezpośredni model. Skrypt diagnostyczny Hosted Agenta jest oddzielny.

## Jednorazowa konfiguracja w Foundry

1. Użyj istniejącego projektu Foundry wskazanego przez `AZURE_AI_PROJECT_ENDPOINT`.
2. W **Models + endpoints / Deployments** utwórz lub potwierdź standardowy deployment modelu. Zanotuj deployment name, model/version, region i typ wdrożenia. `model` w Responses API ma być dokładną nazwą deploymentu, nie `agent_name`.
3. Sprawdź obsługę Responses API, obrazów, PDF `input_file`, function calling i JSON Schema na tym konkretnym deploymentcie. Dostępność zależy od modelu, wersji, regionu i limitów TPM/RPM.
4. Nadaj lokalnemu użytkownikowi rolę **Foundry User** na zakresie projektu. Nie przyznawaj Contributor/Owner ani dostępu do całej subskrypcji.
5. Skonfiguruj politykę filtrów treści. Włącz bazowe kategorie bezpieczeństwa i Prompt Shields dla ataków użytkownika; sprawdź również ochronę przed instrukcjami ukrytymi w dokumentach. Domyślne ustawienia mogą nie aktywować kontroli ataków dokumentowych.

### Istotne rozróżnienie endpointów

`https://…services.ai.azure.com/api/projects/…` jest endpointem projektu, który przekazałeś w teście. To nie jest identyfikator deploymentu. Runtime korzysta z oficjalnego klienta projektu `AIProjectClient.getOpenAIClient()` **bez `agentName`**, a `model` ustawia na nazwę deploymentu. Nie konstruuj endpointu z adresu Hosted Agenta. Dla klasycznego zasobu Azure OpenAI Microsoft dokumentuje inny adres `https://<resource>.openai.azure.com/openai/v1`; zmiana typu endpointu wymaga dopasowania RBAC i konfiguracji.

## Lokalny development

Uwierzytelnienie korzysta z zapisanej sesji Azure CLI. Zaloguj się raz, w prawidłowym tenant/subscription:

```powershell
az login --tenant <tenant-id>
az account set --subscription <subscription-id>
az account get-access-token --resource https://ai.azure.com --query expiresOn --output tsv
```

API używa `AzureCliCredential`, więc nie otwiera przeglądarki przy każdym wywołaniu. Nie ustawiaj lokalnie `AZURE_CLIENT_SECRET`; jeśli takie zmienne są w środowisku, `DefaultAzureCredential` mogłoby wybrać nieoczekiwaną tożsamość.

W ignorowanym `.env` (lub `apps/api/.env` jeśli API jest uruchamiane osobno) ustaw:

```dotenv
AZURE_AI_PROJECT_ENDPOINT=<Foundry project endpoint>
AZURE_AI_MODEL_DEPLOYMENT=gpt-5-mini
AZURE_AI_AUTH_MODE=azure-cli
```

`AZURE_AI_AGENT_NAME` jest używany wyłącznie przez `npm run ai:inspect` i `npm run ai:smoke` do diagnostyki Hosted Agenta. Nie wpływa na runtime API.

## Azure App Service

Włącz **system-assigned managed identity** na API App Service (nie na frontendzie), a następnie nadaj jej rolę `Foundry User` do projektu. W konfiguracji aplikacji ustaw `AZURE_AI_PROJECT_ENDPOINT`, `AZURE_AI_MODEL_DEPLOYMENT` i `AZURE_AI_AUTH_MODE=managed-identity`. Dla user-assigned identity dodaj `AZURE_AI_CLIENT_ID` — to identyfikator, nie sekret. Nie kopiuj do App Service sekretów/publish profile wykorzystywanych przez GitHub Actions; runtime identity i tożsamość wdrożeniowa są osobne.

Przy private endpoint wymagane są VNet Integration API App Service i poprawne private DNS. Przy publicznym endpointcie nadal wymagaj Entra ID i minimalnej roli RBAC.

## Dane i retencja

- Responses API requesty jawnie ustawiają `store: false`; kontekst rozmowy jest odtwarzany z tabel aplikacji.
- Każda tura asystenta otrzymuje zaufany kontekst serwera: bieżący czas UTC, datę/czas w strefie IANA właściciela kalendarza oraz nazwę tej strefy. Nie jest on wyliczany z treści użytkownika.
- Rozmowy, wiadomości, metryki tokenów i podglądy akcji przechowuje PostgreSQL. Rozmowy wygasają po 30 dniach nieaktywności; podgląd akcji po 15 minutach. Worker usuwa wygasłą historię. Nie logujemy promptów, odpowiedzi, tokenów ani bajtów dokumentu.
- Oryginalny PDF/JPG/PNG jest walidowany i przekazywany inline do requestu. Interfejs informuje przed wysłaniem o przekazaniu pliku do Azure AI; anulowanie przerywa request do API i upstream Responses. Bajty nie trafiają do `t_importy`, cache ani Azure Files API. Baza przechowuje wyłącznie znormalizowane wiersze importu, krótki fragment źródłowy i numer strony do korekty.
- `store: false` wyłącza trwały stan odpowiedzi używany do kolejnych Responses turns. Nie jest samo w sobie gwarancją wyłączenia wszystkich logów bezpieczeństwa/abuse monitoring. Azure deklaruje brak trenowania modeli na danych klienta; szczegóły retencji zależą od funkcji i polityki usługi. Dla wymogu rezydencji wybierz deployment regionalny, nie zakładaj tego samego dla globalnego/Data Zone.
- W obrazie najpierw sprawdzamy format, rozmiar, piksele i zmniejszamy duże dane URI. PDF ma limit 5 MB i 10 stron; obrazy limit 20 MP. Nieudane wywołanie nie przełącza się automatycznie na OCR/Document Intelligence.

## Instructions, tools, knowledge i guardrails

- **Instructions:** wersjonowany `KAC_ASSISTANT_INSTRUCTIONS` i instrukcja zadania importu są przekazywane w requestcie. Wskazują polski język, wiarygodne źródła i traktowanie tekstu w pliku jako niezaufanych danych.
- **Tools:** `assistantTools` jest ścisłą allow-listą w `src/ai/tools.ts`: odczyt kalendarza/profilu, wolne okna i sumy czasu liczone w backendzie oraz przygotowanie podglądu utworzenia, zmiany lub usunięcia wydarzenia. Argumenty są sprawdzane ponownie w backendzie. Model nigdy nie ma narzędzia `confirm`.
- **Knowledge:** nie konfigurujemy File Search, vector store ani zewnętrznego RAG w MVP. Kalendarz/profil są pobierane przez scope-owane narzędzia, a plik jest wejściem tylko bieżącego importu.
- **Memory:** źródłem pamięci jest PostgreSQL z `UserScope`. Historie są ograniczane do ostatnich 24 wiadomości w kontekście i zapisywane z monotoniczną kolejnością; wywołania narzędzi są odtwarzane jako stateless Responses input items. `demoScope` odpowiada obecnemu środowisku bez logowania.
- **Guardrails:** model nie może modyfikować kalendarza. Zmiana tworzy `t_ai_akcje` z TTL, a niezależny endpoint potwierdzenia weryfikuje właściciela, pełny snapshot wydarzenia, kolizje i idempotency key. Aktualizacje i usunięcia zapisują wynik akcji w tej samej transakcji co zmianę kalendarza; ponowienie po utracie odpowiedzi odczytuje ten wynik zamiast ponownie zapisywać. Nieaktualny podgląd przechodzi do stanu `failed` i wymaga nowej propozycji. Rolę Prompt Shields uzupełniają limity wejścia, parsowanie JSON Schema, limit narzędzi/cykli i walidacja serwerowa.

## Dodawanie wydarzeń przez rozmowę (S23KC2S1P2-252)

Asystent przygotowuje wydarzenie narzędziem `calendar_prepare_event_create`, ale niczego nie zapisuje: tworzy akcję w `t_ai_akcje` z TTL. Wydarzenie powstaje dopiero po kliknięciu „Dodaj do kalendarza” (`POST /api/v1/assistant/actions/{id}/confirm`), przez tę samą operację co ręczne dodawanie.

- **Daty i braki:** daty względne („jutro”) model zamienia na konkretną datę według zaufanego kontekstu serwera (data, czas, strefa). Gdy brakuje daty, początku albo końca/czasu trwania, asystent dopytuje i nie przyjmuje domyślnej godziny końca.
- **Wspólna walidacja i kolizje** (`src/ai/event-preview.ts`): podgląd przechodzi przez `validateTimedEvent` (np. godzina nieistniejąca przy zmianie czasu → `invalid_event_time`) i `findEventCollisions`, także dla serii cotygodniowych. Kolizje trafiają do wyniku narzędzia, a przy każdym odczycie oczekujących akcji API dokleja aktualne pole `collisions` (liczone z bieżącego kalendarza). Czat nie omija kolizji ani nie przesuwa innych wydarzeń: przycisk dodania jest zablokowany, a zatwierdzenie i tak kończy się 409 `event_collision`; akcja wraca do stanu `pending`, więc użytkownik może poprawić termin w rozmowie albo anulować.
- **Zastępowanie podglądu:** nowy podgląd dodania w tej samej rozmowie anuluje poprzedni (`cancelPendingActionsOfKind`, `blad_kod = superseded_by_new_preview`), więc stary podgląd nie może już utworzyć wydarzenia.
- **Cykliczność i obowiązkowość:** `repeatWeekly` tylko na wyraźną prośbę; seria korzysta z istniejącego mechanizmu serii. `mandatory` jest zapisywane tylko dla zajęć. Zwykłe wydarzenie kategorii Work nie jest zatwierdzeniem grafiku i nie dostaje migawek wynagrodzenia.
- **Interfejs:** karta podglądu pokazuje tytuł, pełną datę z dniem tygodnia, godziny, kategorię, miejsce („nie podano”, gdy brak) i powtarzanie oraz listę kolidujących wydarzeń. Jedna decyzja naraz – podwójne kliknięcie nie wysyła drugiego żądania. Po dodaniu czat potwierdza zapis z datą i oferuje „Pokaż w kalendarzu”, które otwiera tydzień tej daty. Błąd zapisu zostawia podgląd; ponowienie tej samej akcji jest idempotentne i nie tworzy duplikatu.

## Podsumowanie dnia i pytania o kalendarz (S23KC2S1P2-254)

Karta „Twój dzień w skrócie” na ekranie „Dziś” korzysta z `GET /api/v1/assistant/day-summary?date=YYYY-MM-DD`. Endpoint tylko czyta kalendarz – nie tworzy ani nie zmienia wydarzeń.

- **Fakty liczy backend** (`src/ai/calendar-facts.ts`): wystąpienia dnia w strefie właściciela kalendarza (serie cotygodniowe rozwinięte przez `eventOccurrences`, wydarzenia przez północ przycięte do dnia z flagami `startsBeforeDay`/`endsAfterDay`), przerwy między wydarzeniami (od 15 min) i sumy minut w kategoriach liczone na rzeczywistych chwilach czasu, więc dzień zmiany czasu ma prawidłową długość. Model dostaje tylko te fakty i ma je opisać; nie ma narzędzi i nie liczy sum.
- **Statusy:** `ai` – tekst modelu; `empty` – brak wydarzeń, tekst bez wywołania modelu; `local` – model niedostępny albo nieskonfigurowany (`aiError`), tekst złożony lokalnie z tych samych faktów. Awaria AI zwraca 200, żeby ekran „Dziś” pozostał użyteczny.
- **Cache:** wynik jest zapamiętywany per użytkownik, kalendarz i dzień razem z odciskiem (`fingerprint`) odczytanych wydarzeń. Niezmieniony kalendarz zwraca ten sam tekst z `cached: true` bez kolejnego płatnego wywołania; zmiana wydarzeń daje nowy odcisk i nowe podsumowanie; `refresh=true` wymusza nowe wywołanie. Cache jest w pamięci procesu API (ograniczony do 500 wpisów) – po restarcie lub na innej instancji podsumowanie powstaje ponownie. Frontend pobiera podsumowanie tylko po zmianie daty albo wydarzeń dnia.
- **Pytania w Asystencie:** narzędzia `calendar_free_windows` (luki w kalendarzu w podanych godzinach, maks. 14 dni) i `calendar_time_totals` (sumy minut w kategoriach, maks. 93 dni) liczą wynik w backendzie; `calendar_search_events` zwraca wystąpienia serii w zakresie. Wolny czas oznacza lukę w kalendarzu, a nie dostępność do pracy z profilu. Przycisk „Zapytaj asystenta” na karcie przechodzi do Asystenta z przygotowanym pytaniem, którego nie wysyła automatycznie.

## Anulowanie odczytu pliku

Przed wysłaniem interfejs informuje, że PDF/PNG/JPG zostanie przekazany do Azure AI Foundry. Podczas odczytu przycisk anulowania zamyka klientowski request; API przekazuje sygnał przerwania do Responses API i nie tworzy sesji podglądu, jeśli odczyt został przerwany. Nawet przy udanym odczycie wydarzenia powstają dopiero po osobnym potwierdzeniu sesji.

## Testy manualne z deploymentem

Płatne wywołania Azure nie są częścią CI. Po skonfigurowaniu `.env` można wykonać kontrolowany test tekstu/JSON/narzędzia:

```powershell
npm run ai:smoke:responses --workspace @kac/api -- structured
npm run ai:smoke:responses --workspace @kac/api -- tools
npm run ai:smoke:responses --workspace @kac/api -- file tests/fixtures/ai-import/Plan_test_1.png work
npm run ai:smoke:responses --workspace @kac/api -- file tests/fixtures/ai-import/Plan_test_2.png work
```

Skrypt wypisuje jedynie liczbę wierszy, unresolved fields i usage; nie drukuje danych pracowników. Zmienna `AZURE_AI_AGENT_NAME` pozwala osobno sprawdzić testowego Hosted Agenta poleceniem `npm run ai:smoke --workspace @kac/api -- "krótka wiadomość"`.

## Ograniczenia wdrożeniowe sprintu

W02 uruchamia osobny outbox worker. Przypomnienia są planowane w bazie, a opcjonalny Web Push wymaga ustawienia VAPID w API/workerze. Google importer ma dziś scope tylko `calendar.readonly`; publikacja zmian wymaga rozszerzenia OAuth do zapisu i ponownej zgody. Konsument Google pozostawia dostawy jawnie zablokowane do czasu uzyskania scope zapisu.
