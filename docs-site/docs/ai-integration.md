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
- Oryginalny PDF/JPG/PNG jest walidowany i przekazywany inline do requestu. Interfejs informuje przed wysłaniem o przekazaniu pliku do Azure AI; anulowanie przerywa request do API i upstream Responses. Oryginalne bajty nie trafiają do bazy, cache ani Azure Files API. Zwykły import zapisuje znormalizowane wiersze, fragment źródłowy i numer strony. Import w czacie przechowuje ponadto ograniczoną miniaturę obrazu, opisaną poniżej.
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

## Czat, streaming i personalizacja

Czat od razu wyświetla wysłaną wiadomość i wskaźnik odpowiadania. Korzysta z `POST /api/v1/assistant/conversations/{id}/messages?stream=true`, który zwraca `application/x-ndjson`. Każda linia jest osobnym zdarzeniem: `accepted` potwierdza zapis wiadomości użytkownika, `delta` dopisuje fragment tekstu, `reset` czyści wstępny tekst przed kolejną rundą narzędzi, a `done` zwraca zapisaną odpowiedź i propozycje. `error` kończy nieudaną turę. Zamknięcie połączenia przerywa żądanie upstream. Bez parametru `stream` endpoint nadal zwraca dotychczasowy JSON. Niekompletny strumień bez `done` nie jest sukcesem.

Puste lub niepełne odpowiedzi modelu są błędem `assistant_incomplete_response` (502 przed rozpoczęciem streamingu, zdarzenie `error` po jego rozpoczęciu), nie zapisanym podsumowaniem. Limit 4000 tokenów obejmuje również rozumowanie modelu; diagnostyka błędu zapisuje powód niepełnej odpowiedzi bez treści rozmowy.

Zatwierdzanie pozostawia użytkownika w czacie. **Zatwierdź wszystko** wykonuje propozycje kolejno i zatrzymuje się przy pierwszym błędzie lub kolizji. Udane akcje znikają z listy; pozostałe zachowują identyfikatory do ponowienia. Zbiorcze zatwierdzenie nie jest transakcją obejmującą wszystkie propozycje.

W Ustawieniach → Personalizacja agenta można zapisać formę zwracania się (do 60 znaków) i ton: rzeczowy, przyjazny lub formalny. Preferencje są przechowywane na urządzeniu i dołączane do kolejnych wiadomości jako opcjonalne `preferences: { addressAs, tone }`; API akceptuje `tone` równy `neutral`, `friendly` lub `formal`. To preferencje stylu, które nie zmieniają uprawnień ani wymogu potwierdzania akcji.

Przy regeneracji karty Dziś powstaje świeża, ukryta rozmowa techniczna. Nie odziedziczy ona wyniku odczytu kalendarza z wcześniejszego podsumowania. Niezmieniony stan kalendarza korzysta z cache w bieżącej sesji aplikacji.

### Blokada Azure a przerwana odpowiedź

`assistant_content_filtered` oznacza, że Azure zablokował wejście lub odpowiedź filtrem treści; `assistant_refused` oznacza jawną odmowę modelu. Oba przypadki zwracają 422 w trybie JSON albo zdarzenie `error` po rozpoczęciu streamingu. Interfejs usuwa wstępny tekst odmowy i pokazuje polski komunikat; nie oznacza go jako przerwanej transmisji. Kalendarz pozostaje bez zmian.

Bezpieczna diagnostyka zapisuje kod dostawcy i nazwy kategorii filtrów, bez treści promptu. Błędna klasyfikacja dozwolonej prośby przez Azure wymaga weryfikacji przypisanej polityki w Foundry lub zgłoszenia dostawcy. Aplikacja nie wyłącza filtrów ani nie przepisuje automatycznie wiadomości w celu uniknięcia blokady.

### Wiele propozycji w jednej turze

Model może zwrócić wiele wywołań narzędzi w jednej odpowiedzi (`parallel_tool_calls: true`); backend wykonuje i waliduje je kolejno. Domyślny `AZURE_AI_MAX_TOOL_ROUNDS` wynosi 8 (konfigurowalny do 16), a tura ma dodatkowy limit 64 wywołań. Bieżąca tura zachowuje pełne pary wywołań i wyników, niezależnie od 24-wiadomościowego okna wcześniejszej historii.

Wyczerpanie limitu zwraca `assistant_tool_limit` (409 lub zdarzenie `error`). Odpowiedź błędu może zawierać `pendingActions`; interfejs pokazuje już przygotowane podglądy do zatwierdzenia lub odrzucenia. Ponowne przygotowanie identycznej akcji w tej samej rozmowie wykorzystuje istniejący, niewygasły podgląd. Limity i błędy nie zatwierdzają żadnych zmian w kalendarzu.

### Aktualny status dawnych propozycji

Historyczny wynik `awaiting_user_confirmation` nie oznacza, że podgląd nadal jest ważny. Przed każdą turą backend odświeża w kontekście modelu statusy wskazanych akcji na podstawie bazy i bieżącego zakresu użytkownika oraz rozmowy. Wygasłe, anulowane, błędne lub niedostępne propozycje wymagają nowego podglądu po ponowieniu prośby; potwierdzone oznaczają już wykonany zapis, a przetwarzane nie powinny być duplikowane. Sam zapis dawnej historii pozostaje niezmieniony.

Asystent pokazuje liczbę faktycznie oczekujących propozycji obok przycisku zbiorczego zatwierdzania. Dawna deklaracja tekstowa modelu nie jest potwierdzeniem, że wszystkie propozycje nadal są dostępne do zapisu. TTL podglądu pozostaje równy 15 minut.

### Zdjęcie i dokończenie importu w rozmowie

Ikona aparatu obok wiadomości pozwala wybrać plan zajęć lub grafik pracy, lokalny OCR lub Azure AI, a następnie plik albo aparat. Zdjęcie pojawia się od razu w rozmowie. Po odczycie podgląd pozostaje w czacie: można poprosić o poprawienie godzin, daty, tytułu, wybór pracownika, pominięcie wierszy lub rozstrzygnięcie duplikatów. Kliknięcie zdjęcia powiększa podgląd.

Agent korzysta z `import_get_preview` i `import_prepare_changes`. Poprawki dotyczą wskazanej rewizji szkicu; `rowId: null` dodaje brakujący wiersz, a pozostałe wartości null pozostawiają pole bez zmian. Model nie ma narzędzia zatwierdzania. Przycisk **Zatwierdź import** zapisuje wyłącznie przejrzaną rewizję przez wspólny mechanizm importu, z walidacją duplikatów, zmian nocnych i transakcyjnym zapisem. Ponowienie skutecznego potwierdzenia zwraca ten sam wynik. Poprawki przedłużają ważność szkicu o 15 minut. Stan i zdjęcie pozostają dostępne po ponownym otwarciu rozmowy.

Backend przechowuje szkic w istniejącym `t_importy` (migracja `016_chat_import_drafts.sql`), związany z użytkownikiem, kalendarzem i rozmową. Oryginalne bajty obrazu/PDF nie są zapisywane. Dla obrazu powstaje pochodny JPEG do 1600×1600 i maks. 700 tys. znaków data URL; miniatura podlega retencji rozmowy. Najnowsza miniatura wybrana do odczytu AI może trafić do kontekstu modelu przy dalszej rozmowie. W trybie lokalnego OCR obraz pozostaje poza kontekstem Azure; model omawia odczytane wiersze. PDF ma wiadomość z nazwą pliku bez miniatury strony.

Formularze planu i grafiku noszą nazwę **Szybki import**. Gdy odczyt, walidacja lub zapis wymaga poprawy, dostępny jest **Dokończ w czacie**. Po wybraniu przycisku zdjęcie i dane zostają przekazane do przepływu AI. Istniejąca aktywna sesja zachowuje poprawione wiersze, zaznaczenia i decyzje o duplikatach; przy błędzie rozpoznawania bez sesji zdjęcie jest ponownie odczytywane. Przekazanie nie zatwierdza wydarzeń.

#### Sprawdzenie ręczne

1. W Asystencie kliknij aparat, wybierz plan zajęć i Azure AI, a następnie syntetyczne zdjęcie. Sprawdź miniaturę w wiadomości i podgląd wydarzeń bez zmian w kalendarzu.
2. Napisz „w pierwszym wierszu koniec 10:30”. Sprawdź zmianę rewizji i godziny. Dodaj brakujący wiersz, pomiń niepotrzebny i rozstrzygnij duplikaty w rozmowie.
3. Odśwież stronę i otwórz rozmowę ponownie — zdjęcie i szkic powinny pozostać dostępne.
4. Zatwierdź import. Ponowienie tej samej rewizji nie powinno dodać kolejnych kopii. Sprawdź też anulowanie i odrzucenie starej rewizji po poprawkach.
5. W Szybkim imporcie doprowadź do błędu/niekompletnego wiersza. Wybierz Dokończ w czacie i sprawdź zachowanie zdjęcia oraz wcześniejszych poprawek.
