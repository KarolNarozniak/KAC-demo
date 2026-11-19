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

## Karta „Dziś” i pytania o kalendarz (S23KC2S1P2-254)

### Źródła danych

| Dane | Skąd pochodzą | Kto je liczy |
| --- | --- | --- |
| Dzisiejsze wydarzenia na karcie | Kalendarz pobrany przez aplikację, rozwinięty dla bieżącego dnia funkcją `occurrencesForRange` | Aplikacja (urządzenie) |
| Wydarzenia w odpowiedzi modelu | Narzędzie `calendar_search_events`, tylko kalendarz bieżącego `UserScope` | Backend |
| Profil, dostępność, cel godzin | Narzędzie `work_profile_get` | Backend |
| Bieżąca data, godzina i strefa | Zaufany kontekst serwera (`trustedTimeContext`): czas UTC i czas w strefie IANA właściciela kalendarza | Backend |

Model nie dostaje danych spoza tych źródeł. Treść wiadomości, nazwy i lokalizacje wydarzeń są danymi niezaufanymi — zdanie „dziś jest 1 stycznia” nie zmienia zaufanego czasu. Nieprawidłowa strefa konta jest zastępowana strefą `Europe/Warsaw`.

`calendar_search_events` przyjmuje zakres dat do 93 dni i zwraca najwyżej 100 wydarzeń. Filtr tekstowy sprawdza tytuł i lokalizację.

### Obliczenia

Karta „Dziś” prosi model o 2–4 zdania: najważniejsze wydarzenia z godzinami i dłuższe wolne okna. Model nie zapisuje zmian i nie przygotowuje akcji.

Na pytania typu „ile mam zajęć w czwartek?” albo „kiedy mam wolne?” model odpowiada na podstawie listy wydarzeń zwróconej przez narzędzie. Backend nie ma jeszcze osobnego narzędzia liczącego sumę godzin ani wolne okna — sumy i przerwy wylicza model z tej listy, dlatego odpowiedź należy traktować jako pomocniczą. Dokładne wolne okna do planowania pracy liczy generator grafiku (zob. niżej).

Przedziały czasu są półotwarte `[początek, koniec)`: wydarzenia 10:00–11:00 i 11:00–12:00 nie nakładają się i nie tworzą przerwy.

### Cykliczność

Na karcie „Dziś” wydarzenia z `repeatWeekly` są rozwijane na bieżący dzień — wystąpienie serii rozpoczętej w poprzednich tygodniach pojawia się w podsumowaniu. Wystąpienie zachowuje lokalną godzinę serii.

Ograniczenie: `calendar_search_events` porównuje daty pierwszego wystąpienia, nie rozwija serii. W pytaniu o przyszły tydzień model może nie zobaczyć zajęć cotygodniowych, które zaczęły się wcześniej. Pełna obsługa wystąpień w wyszukiwaniu należy do części backendowej historyjki.

### Północ i zmiana czasu (DST)

- Wydarzenie przechodzące przez północ (np. 23:00–01:00) należy do obu dni: wpływa na podsumowanie dnia, w którym się zaczyna, i dnia, w którym się kończy. Wydarzenie kończące się dokładnie o 00:00 nie należy do następnego dnia.
- O północy zmienia się klucz dnia — karta tworzy nowe podsumowanie w nowej ukrytej rozmowie „Dzień w skrócie YYYY-MM-DD”.
- Przy zmianie czasu (w strefie `Europe/Warsaw` 29.03.2026 doba ma 23 h, 25.10.2026 — 25 h) wydarzenia cotygodniowe zachowują godzinę lokalną, np. zajęcia o 10:00 pozostają o 10:00. Czas trwania liczony jest w czasie rzeczywistym: wydarzenie 01:00–04:00 w dniu 25.10.2026 trwa 4 h.
- Karta wyznacza „dziś” i powitanie według strefy **urządzenia**, a model — według strefy **konta** z zaufanego kontekstu. Przy urządzeniu w innej strefie niż konto oba widoki mogą wskazywać inny dzień.
- Powitanie: „Dzień dobry!” od 05:00 do 17:59, „Dobry wieczór!” poza tym zakresem.

### Cache i odświeżanie

- Pusty dzień wyświetla stały komunikat „Nie masz dziś zaplanowanych wydarzeń” bez wywołania API asystenta i Azure.
- Klucz podsumowania to data oraz migawka dzisiejszych wystąpień: identyfikator, tytuł, kategoria, lokalizacja, obowiązkowość, powtarzanie, początek i koniec. Zmiana dowolnego z tych pól w dzisiejszym wydarzeniu generuje nowe podsumowanie; zmiana wydarzenia z innego dnia — nie.
- Niezmieniony dzień korzysta z wyniku zachowanego w pamięci bieżącej sesji aplikacji. Cache jest czyszczony przy wylogowaniu, przy błędzie generowania i po przejściu na pusty dzień. Po ponownym uruchomieniu aplikacji cache jest pusty, więc powstaje nowe podsumowanie.
- Każde nowe podsumowanie powstaje w świeżej ukrytej rozmowie, aby model nie użył starego wyniku odczytu kalendarza. Nie ma przycisku „Odśwież”.
- Gdyby model przygotował akcję w rozmowie podsumowania, aplikacja ją anuluje — karta nie zmienia kalendarza.
- Gdy asystent jest wyłączony (`GET /api/v1/assistant/config` zwraca `enabled: false`), karta pokazuje komunikat o niedostępności Azure AI.
- Rozmowy „Dzień w skrócie YYYY-MM-DD” są ukryte na liście rozmów w Asystencie.

### Luka w kalendarzu a dostępność do pracy

Te pojęcia nie są tożsame:

- **Luka w kalendarzu** to czas między wydarzeniami danego dnia. Wynika wyłącznie z kalendarza i pojawia się w podsumowaniu jako „wolne okno”. Nie oznacza, że w tym czasie można pracować.
- **Dostępność do pracy** wylicza generator grafiku (`freeWindows`): okna dostępności z profilu pracy minus zajęcia obowiązkowe i inne wydarzenia, minus bufor dojazdu i odpoczynek, minus dni niedostępne. Pozostają tylko okna nie krótsze niż minimalna długość zmiany. Zajęcia nieobowiązkowe są ograniczeniem miękkim (ostrzeżenie).

Przykład: przerwa 13:00–14:30 między zajęciami jest luką w kalendarzu. Przy dojeździe 30 min i minimalnej zmianie 3 h nie jest dostępnością do pracy. Odwrotnie — wolny wieczór w kalendarzu nie jest dostępnością, jeśli profil nie ma na ten czas okna dostępności. Pytania o możliwość pracy należy kierować do Grafiku; asystent odczytuje profil, ale nie uruchamia generatora.

### Testy

| Obszar | Testy |
| --- | --- |
| Kontekst dnia, cykliczność, północ, powitanie | `apps/web/tests/dailySummary.test.ts` |
| Cache, pusty dzień, regeneracja, ukrycie rozmów | `apps/web/tests/dailySummary.test.ts` |
| Narzędzia, zaufany czas, zakres użytkownika | `apps/api/tests/ai.test.ts`, `apps/api/tests/assistant-api.test.ts` |
| Wolne okna i dostępność do pracy | `apps/api/tests/class-constraints.test.ts`, `apps/api/tests/class-constraints.integration.test.ts` |

Testy zależne od strefy uruchamiaj ze strefą `Europe/Warsaw` (np. `TZ=Europe/Warsaw`).

#### Test ręczny

1. Dodaj zajęcia cotygodniowe rozpoczęte tydzień wcześniej i otwórz Dziś — zajęcia muszą być w podsumowaniu.
2. Przejdź na inną zakładkę i wróć do Dziś bez zmian w kalendarzu — tekst się nie zmienia, nie ma nowej tury asystenta.
3. Zmień godzinę dzisiejszego wydarzenia — podsumowanie odświeża się samo. Zmiana jutrzejszego wydarzenia nie zmienia podsumowania.
4. Usuń wszystkie dzisiejsze wydarzenia — pojawia się stały komunikat bez wywołania asystenta.
5. Zapytaj w Asystencie: „Ile mam wolnego czasu jutro?”. Sprawdź, czy odpowiedź opiera się na wydarzeniach z kalendarza i czy nie przygotowano żadnej akcji.

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

## Planowanie przez rozmowę (S23KC2S1P2-257)

### Stan obecny

Asystent **nie uruchamia generatora grafiku**. Rejestr narzędzi (`apps/api/src/ai/tools.ts`) nie zawiera narzędzia planowania ani zapisu grafiku. W rozmowie o planowaniu pracy asystent może:

- odczytać profil pracy narzędziem `work_profile_get`: cel i limity godzin, tryb pracy, dostępność, preferowane okna, blokady, szablony zmian, dojazd i odpoczynek;
- odczytać kalendarz narzędziem `calendar_search_events` (zakres do 93 dni, maks. 100 wydarzeń, bez rozwijania serii cotygodniowych);
- przygotować podgląd pojedynczej zmiany pracy narzędziem `calendar_prepare_event_create` (kategoria `Work`), który zapisuje się dopiero po **Zatwierdź**.

Pełny grafik tygodnia tworzy się na ekranie **Grafik** (`POST /api/v1/schedules/generate`), a zatwierdza przyciskiem w tym ekranie (`POST /api/v1/schedules/{weekStart}/approve`). Przekazanie propozycji z Asystenta do Grafiku nie jest jeszcze zaimplementowane.

### Odpowiedź asystenta a wynik generatora

| | Asystent w rozmowie | Generator na ekranie Grafik |
| --- | --- | --- |
| Źródło profilu | `work_profile_get` – ten sam odczyt co `GET /api/v1/work-profile` (`profileFromContext` z kontekstu planowania) | `getPlanningContext` – ten sam kontekst planowania |
| Zajęcia cotygodniowe | Nie rozwija serii; może nie widzieć zajęć rozpoczętych wcześniej | Rozwija serie w wybranym tygodniu, także po zmianie czasu |
| Wolny czas | Szacuje z listy wydarzeń | Liczy `freeWindows`: dostępność minus zajęcia obowiązkowe, inne wydarzenia, bufor dojazdu, odpoczynek i dni niedostępne; okna krótsze niż minimalna zmiana są pomijane |
| Wynik | Tekst i ewentualne podglądy pojedynczych wydarzeń | Zapisana propozycja grafiku z `solutionStatus`, zmianami, sumą godzin i ostrzeżeniami |
| Zapis do kalendarza | Tylko po Zatwierdź dla każdego podglądu | Tylko po zatwierdzeniu grafiku |

Wiążący jest wynik generatora. Odpowiedź asystenta o tym, czy cel godzin się zmieści, jest pomocnicza – może różnić się od generatora, bo model nie stosuje jego reguł (bufory, odpoczynek, minimalna zmiana, limity dzienne) i nie widzi wszystkich wystąpień serii.

### Sytuacje szczególne

| Sytuacja | Asystent | Generator (`POST /schedules/generate`) |
| --- | --- | --- |
| Brak profilu pracy | `work_profile_get` zwraca `work_profile_not_found`; asystent nie zgaduje celu ani dostępności | 404 `work_profile_not_found` |
| Profil bez dostępności albo celu | Widzi puste pola w profilu | 409 `profile_setup_required` z listą `missing` (`availability`, `target`) |
| Nieaktualna wersja profilu | – | 409 `profile_version_conflict` z bieżącą `profileVersion` |
| Brak zajęć w tygodniu | Może o tym poinformować na podstawie kalendarza | 409 `no_classes_for_week` z `requiresConfirmation: true`; ponowienie z `confirmNoClasses: true` |
| Niedobór czasu na cel | Szacunek modelu | Poprawny wynik (201) z ostrzeżeniem `insufficient_free_time` (`freeMinutes`, `missingMinutes`), `shortfallMinutes` i `solutionStatus` `proven_infeasible` albo `not_found` |
| Ponowienie | Identyczny, niewygasły podgląd jest używany ponownie; wygasłe, anulowane i potwierdzone wymagają nowej prośby; ponowienie zatwierdzenia nie dubluje wydarzenia | Generowanie jest deterministyczne dla tych samych danych; zatwierdzenie wymaga aktualnej wersji (`schedule_version_conflict`, `schedule_already_approved`) |

### Brak zapisu bez akceptacji

- Model nie ma narzędzia zatwierdzania. Narzędzia `calendar_prepare_*` tworzą wyłącznie podgląd w `t_ai_akcje` z TTL 15 minut.
- Wydarzenie powstaje dopiero po `POST /api/v1/assistant/actions/{id}/confirm`, wywołanym przyciskiem **Zatwierdź**. Samo „tak” w rozmowie niczego nie zapisuje. Kolizje wymagają osobnej decyzji (`collisionToken`).
- Wygenerowany grafik jest zapisaną propozycją, nie wydarzeniami. Zmiany trafiają do kalendarza dopiero po zatwierdzeniu grafiku, które ponownie sprawdza kolizje z zajęciami obowiązkowymi i limity.

### Test ręczny

1. Bez profilu pracy zapytaj w Asystencie: „Zaplanuj mi pracę na przyszły tydzień”. Asystent informuje o braku profilu i nie tworzy propozycji.
2. Uzupełnij profil (dostępność i cel). Zapytaj: „Czy zmieszczę 20 godzin pracy w przyszłym tygodniu?”. Porównaj odpowiedź z wynikiem **Generuj** na ekranie Grafik dla tego samego tygodnia – rozstrzyga wynik generatora.
3. Poproś o dodanie jednej zmiany pracy. Sprawdź podgląd i brak wydarzenia w kalendarzu przed **Zatwierdź**; po **Odrzuć** kalendarz pozostaje bez zmian.
4. W tygodniu bez zajęć wygeneruj grafik na ekranie Grafik – wymagane jest potwierdzenie braku zajęć.
5. Ustaw cel większy niż dostępny czas – wynik zawiera ostrzeżenie o niedoborze czasu, a kalendarz się nie zmienia do zatwierdzenia grafiku.
