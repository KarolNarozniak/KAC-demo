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
- **Tools:** `assistantTools` jest ścisłą allow-listą w `src/ai/tools.ts`: odczyt kalendarza/profilu i przygotowanie podglądu utworzenia, zmiany lub usunięcia wydarzenia. Argumenty są sprawdzane ponownie w backendzie. Model nigdy nie ma narzędzia `confirm`.
- **Knowledge:** nie konfigurujemy File Search, vector store ani zewnętrznego RAG w MVP. Kalendarz/profil są pobierane przez scope-owane narzędzia, a plik jest wejściem tylko bieżącego importu.
- **Memory:** źródłem pamięci jest PostgreSQL z `UserScope`. Historie są ograniczane do ostatnich 24 wiadomości w kontekście i zapisywane z monotoniczną kolejnością; wywołania narzędzi są odtwarzane jako stateless Responses input items. `demoScope` odpowiada obecnemu środowisku bez logowania.
- **Guardrails:** model nie może modyfikować kalendarza. Zmiana tworzy `t_ai_akcje` z TTL, a niezależny endpoint potwierdzenia weryfikuje właściciela, pełny snapshot wydarzenia, kolizje i idempotency key. Aktualizacje i usunięcia zapisują wynik akcji w tej samej transakcji co zmianę kalendarza; ponowienie po utracie odpowiedzi odczytuje ten wynik zamiast ponownie zapisywać. Nieaktualny podgląd przechodzi do stanu `failed` i wymaga nowej propozycji. Rolę Prompt Shields uzupełniają limity wejścia, parsowanie JSON Schema, limit narzędzi/cykli i walidacja serwerowa.

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

## Dodawanie wydarzeń przez czat (S23KC2S1P2-252)

Asystent dopytuje o tytuł, datę, początek i koniec lub czas trwania oraz niejednoznaczną kategorię. Lokalizacja jest opcjonalna; obowiązkowość i cotygodniowe powtarzanie są domyślnie wyłączone. Reguły rozmowy są instrukcjami modelu i wymagają również testu z rzeczywistym deploymentem Azure.

Podgląd w Asystencie pokazuje termin, kategorię, lokalizację i obie flagi. Dopiero **Zatwierdź** zapisuje wydarzenie; **Odrzuć** anuluje propozycję. Samo „tak” w czacie nie zastępuje potwierdzenia przyciskiem.

`POST /api/v1/assistant/actions/{id}/confirm` przyjmuje `{}` albo `{ "collisionToken": "<64 znaki hex>" }`. Pierwsza próba przy kolizji zwraca HTTP 409, listę `conflicts` i token związany z propozycją oraz aktualnymi konfliktami. Interfejs pokazuje listę i osobny przycisk **Zapisz mimo kolizji**. Zmiana konfliktów unieważnia poprzedni token i wymaga kolejnej decyzji. Token pochodzi z backendu; model nie może nim zatwierdzać operacji.

Po utracie odpowiedzi ponów zatwierdzenie **tej samej propozycji**. Idempotencja zapisu korzysta z istniejącego identyfikatora akcji; nie trzeba ponownie prosić modelu o utworzenie wydarzenia. Anulowane i wygasłe akcje nie mogą zostać zapisane.

### Test ręczny

1. W Asystencie rozpocznij rozmowę: „Dodaj spotkanie osobiste”. Sprawdź dopytanie o nazwę i termin oraz brak wydarzenia w kalendarzu.
2. Podaj: „Spotkanie testowe, 20 listopada 2026, od 10:00 do 11:00”. Sprawdź wszystkie dane podglądu. Napisanie „tak” nie powinno zapisać wydarzenia.
3. Wybierz **Odrzuć** i sprawdź kalendarz. Przygotuj ponownie, wybierz **Zatwierdź** i sprawdź pojedyncze wydarzenie.
4. Dodaj drugie wydarzenie na ten sam termin. Sprawdź listę konfliktów, a następnie świadomie wybierz zapis mimo kolizji. Sprawdź również wariant odrzucenia i podania innej godziny.
5. Przy utracie odpowiedzi ponów zatwierdzenie tej samej karty. W kalendarzu ma powstać tylko jedno wydarzenie dla tej akcji.

## Karta „Dziś”

Pusty dzień wyświetla stały komunikat bez odpytywania API asystenta i Azure. Sprawdzane są także dzisiejsze wystąpienia cotygodniowe oraz wydarzenia przechodzące przez północ. Podsumowanie odświeża się automatycznie po zmianie dzisiejszych wydarzeń; nie ma przycisku „Odśwież”. Niezmienione dane korzystają z wyniku zachowanego w bieżącej sesji aplikacji. Powitanie wyświetla aplikacja: „Dzień dobry!” od 05:00 do 17:59, „Dobry wieczór!” poza tym zakresem, według lokalnego czasu urządzenia. Model otrzymuje instrukcję pominięcia daty i dodatkowego powitania.

Rozmowy techniczne zatytułowane „Dzień w skrócie YYYY-MM-DD” są wykorzystywane przez kartę, ale ukryte na liście rozmów w Asystencie.
