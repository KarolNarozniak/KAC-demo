# Niezależny audyt wizualny G

Ocena całości: **8,0/10**. Desktop: **8,1/10**. Mobile: **7,9/10**. Oceny dotyczą wyłącznie wyglądu i informacji widocznych na PNG w `/tmp/kac-review-g`; nie potwierdzają działania, dostępności klawiaturą, kontrastu pomiarowego ani zachowania po otwarciu klawiatury ekranowej. Obejrzano wszystkie 74 zrzuty PNG, seriami po najwyżej cztery. Nie czytano kodu ani raportów. Powtórzenia identycznych stanów nie zwiększają wagi oceny.

## Oceny widoków

Wartości w tabeli odnoszą się do nazw plików po odjęciu prefiksu desktop-/mobile-. Każdy stan przewinięcia także obejrzano; wspólny wiersz oznacza wspólną ocenę, a nie pominięcie.

| Widok / stan | Desktop | Mobile | Co widać i co poprawiłoby ocenę |
|---|---:|---:|---|
| startup, today | 8,5 | 8 | Klarowny nagłówek, podsumowanie dnia i trzy rozróżnione kolorem oraz tekstem kategorie. Desktop ma bardzo szerokie karty przy krótkiej treści. Na telefonie dół karty Trening jest odcięty przez stały obszar plusa; warto zmniejszyć wysokość pustego pasa nad nawigacją i sprawdzić odstęp końcowy listy. |
| week | 8,5 | 8 | Desktop pokazuje cały tydzień i godzinowe proporcje wydarzeń. Mobile daje czytelne, duże karty i siedem dni bez poziomego przewijania. Początkowo zaznaczony wtorek, ale lista zaczyna się od poniedziałku: powiązanie zaznaczenia z pozycją listy mogłoby być czytelniejsze. |
| week-selected-day | — | 8,5 | Środa zaznaczona i widoczna jako pierwszy dzień listy; dobry efekt wyboru. Wciąż widoczne następne dni, co pomaga zachować ciągłość. |
| week-boundary-3px, week-boundary-10px | — | 7 | Tytuł środy pozostaje pod paskiem dni, gdy jej karta przesuwa się ku górze. To pomaga orientacji, ale przy granicy karta jest niemal dotykana przez nagłówek; potrzebny stały, spokojniejszy odstęp. |
| week-lower, week-bottom | 8 | 7 | Desktop utrzymuje prawie pełną siatkę. Mobile pokazuje nagłówek czwartku i pod nim sam wąski dolny fragment pomarańczowej karty bez treści; taki stan wygląda jak uszkodzona karta. Doprecyzować przejście przypiętego nagłówka przy przewijaniu. Puste dni mają czytelny komunikat, lecz cztery podobne bloki niepotrzebnie wydłużają listę. |
| schedule, schedule-lower, schedule-bottom | 8 | 8,5 | Dobra hierarchia profilu, generowania i historii; mobile mieści główne działania w jednym ekranie. Przycisk generowania dobrze dominuje. Desktop ma sporo niewykorzystanej szerokości i pustej przestrzeni. Nazwa „Pracoholik” jest wyrazista, lecz mniej precyzyjna niż opis zwiększenia liczby godzin. |
| schedule-proposal | 8,5 | 8 | Zwięzłe zestawienie celu, nowych godzin, już zapisanych godzin i wynagrodzenia. Zielona obwódka odróżnia propozycję. Na telefonie zatwierdzenie zaczyna się dopiero na samym dole ekranu; skrócenie pionowych odstępów poprawiłoby skanowanie. |
| schedule-proposal-shifts, schedule-proposal-bottom | 8,5 | 8,5 | Duże wiersze zmian, kwoty i jasno nazwane zatwierdzenie. Odrzucenie jest oddzielone kolorem i pozycją. Brakuje w dostarczonych PNG rozwiniętego edytora pojedynczej zmiany, więc jego jakości nie oceniam. Warto wizualnie wzmocnić możliwość edycji inną ikoną niż plus, który może sugerować dodawanie. |
| work-profile | 8,5 | 8,5 | Zwięzły przegląd pięciu sekcji z aktualnymi wartościami; dobry podział przez linie i stały pasek zapisu. Stan „Wszystkie zmiany zapisane” z przygaszonym przyciskiem jest zrozumiały. |
| profile-pay | 8 | 8 | Czytelne opcje trybu pracy i brutto/netto, duże pole. Zdanie o dozwolonej stawce 0 PLN dodaje techniczny szczegół o małej wartości przy codziennym użyciu; skrócić pomoc. |
| profile-hours | 8 | 8 | Dobre etykiety minimum/maksimum oraz tydzień/miesiąc. Na mobile pola są logicznie ułożone pionowo. Nagłówek sekcji na zrzucie przylega do stałego nagłówka aplikacji; zwiększyć przestrzeń po automatycznym przewinięciu do sekcji. |
| profile-rest | 7,5 | 8 | Mobile porządkuje kolejno odpoczynek i długości zmian. Desktop miesza w jednym rzędzie pola o różnych etykietach, wysokościach i długościach; wyrównać grupy oraz stosować konsekwentną wielkość liter etykiet. |
| profile-availability | 8 | 8 | Widać sumę dostępności, dni, zakres godzin, usuwanie i kopiowanie. Dużo przycisków i kolejna zagnieżdżona sekcja zwiększają obciążenie. Zgrupować działania przedziału bliżej jego pól; wyraźniej oddzielić kopiowanie od dodawania. |
| profile-availability-day | 8 | 8 | Zmiana poniedziałku na wtorek widoczna w zaznaczeniu i nagłówku. Na mobile górna część sekcji jest poza ekranem; nadal można odczytać dzień i pola. Dodać przestrzeń przy przewijaniu do aktywnej sekcji. |
| profile-preferences | 8 | 8 | Czytelne odróżnienie preferencji od twardego limitu, czytelny brak przedziału z możliwością dodania. Pomoc na mobile zajmuje trzy wiersze; można skrócić. |
| blocks | 8 | 8 | Jasne wyjaśnienie skutku blokady, typ Urlop i pełny termin. Mobile pozostawia dużo pustej przestrzeni, ale układ nie jest chaotyczny. Przycisk Usuń zdominowałby pojedynczą kartę mniej, gdyby znajdował się przy jej prawym brzegu. |
| blocks-form, blocks-lower, blocks-bottom | 8 | 8 | Sensowne grupy początku i końca, jasny przycisk dodania. Mobile zachowuje użyteczne szerokości pól. Rodzaje blokad łamią się na dwa rzędy; można ujednolicić ich układ zamiast zostawiać pojedynczą opcję w drugim rzędzie. |
| settings | 8 | 7,5 | Sekcje są dobrze opisane. W mobile ustawienia układu „na komputerze” zajmują znaczną część pierwszego ekranu; obniżyć ich priorytet lub zwinąć je na telefonie. Opcje tonu łamią się do dwóch wierszy nierówno. |
| settings-lower, settings-bottom | 8 | 7,5 | Przypomnienia mają kompletną informację i jasny zapis. Tekst o uprawnieniach, ograniczeniach oraz działaniu w aplikacji jest długi; podzielić informację na krótki status i opcjonalną pomoc. W kilku sekcjach inne zasady zapisu (automatycznie / osobne przyciski) wymagają uważnego czytania. |
| assistant | 8,5 | 8,5 | Klarowne dymki, autorzy i godziny, duże pole wiadomości bez tekstu pod nim. Desktop dobrze wykorzystuje boczną historię. Mobile ma czytelny przycisk historii. Przygaszony Wyślij jest wizualnie spójny ze stanem pustego pola. |
| assistant-history, assistant-history-bottom | — | 8 | Wygodna pełna szerokość, widoczny wybór, stałe Nowa rozmowa i Usuń rozmowę. Na dole listy nadal widnieje „Więcej rozmów ↓”, chociaż suwak jest już przy końcu — kierunek sugeruje dalszą treść. Zmienić ten komunikat zależnie od pozycji lub usunąć. |
| assistant-attachment | 8 | 8 | Dwie pary wyborów i trzy jasne działania mieszczą się w oknie. Podpisy „Plan zajęć/Grafik pracy” i „Odczyt AI/Odczyt lokalny” są wizualnie równie silne; dodać krótkie etykiety grup, aby szybciej odróżnić rodzaj treści od sposobu odczytu. |
| menu | — | 8,5 | W prawym górnym rogu są dokładnie Blokady i Ustawienia, duże cele dotykowe i czytelna warstwa nad przyciemnionym ekranem. Można zmniejszyć nieco podwójne obramowanie i odstęp kontenera, ale to drobiazg. |
| event-form | 8 | 8 | Wszystkie pola i działania są widoczne. Kategoria ma także tekst, nie sam kolor. Mobile modal jest bardzo wysoki; przy 844 px mieści się, lecz pozostaje niewielki zapas. Wzmocnić wizualnie opcjonalność miejsca i uprościć drugi rząd działań. Z PNG nie wiadomo, jak zachowuje się po otwarciu klawiatury. |
| event-details | 8,5 | 8,5 | Nazwa, czas, miejsce i obowiązkowość są czytelne, edycja i usuwanie rozdzielone. Przycisk Zamknij obok nazwy na mobile zostawia tytułowi mało miejsca dla dłuższego wydarzenia; dopuścić większą przestrzeń tytułu. |
| event-delete-confirmation | 9 | 9 | Zwięzłe potwierdzenie z nazwą i datą, jasna konsekwencja, odróżnione Anuluj i Usuń wydarzenie. |
| import-sources | 8,5 | 8,5 | Prosty wybór trzech źródeł, jasna informacja o sprawdzeniu przed zapisem. Można wzbogacić źródła o małe ikony dla szybszego skanowania. |
| import-classes | 8 | 8 | Jasne formaty, limity, wybór odczytu i zapowiedź podglądu. Dość dużo drobnego tekstu przed jedyną akcją; zredukować odstępy i przenieść szczegóły usługi do rozwijanej informacji. |
| import-work | 8 | 7,5 | Praktyczna rada o czytelnym zdjęciu, dwie sensowne akcje. Mobile ma bardzo długi modal i kilka akapitów o podobnej wadze; ograniczyć tekst na wejściu, zachowując informację o wysyłaniu danych. |
| import-google | 8,5 | 8,5 | Wyraźnie wyjaśniony import jednorazowy i brak późniejszej aktualizacji, jeden dominujący przycisk. Dobra zwięzłość. |

## Najważniejsze obserwacje

Interfejs jest spójny: ciemne tło, granatowe powierzchnie, lawendowe akcje i konsekwentne kolory kategorii. Typografia ma wyraźną hierarchię, formularze są zrozumiałe, a większość ekranów mobile dobrze przekłada szeroki układ na jedną kolumnę. Mocne strony to przegląd dnia, profil w zwijanych sekcjach, propozycja grafiku oraz potwierdzenie usuwania.

Najbardziej konkretny problem widoczny w materiałach występuje w mobilnym tygodniu podczas przewijania: nagłówek dnia pozostaje, a karta pod nim zmienia się w cienki fragment bez zawartości (`mobile-week-lower`). Dodatkowo stały obszar pływającego plusa zasłania znaczną część dolnej karty na pierwszym ekranie dnia i tygodnia. Sam plus i jego położenie są właściwe; warto poprawić wyłącznie zajmowaną przez jego otoczenie przestrzeń i relację do przewijanej treści.

## Zmiany o największej wartości

1. Dopracować przypinanie nagłówków dni i znikanie częściowo przewiniętych kart, aby nie tworzyły pustych kolorowych pasków.
2. Zmniejszyć pusty obszar nad dolną nawigacją wokół plusa; zapewnić bezpieczny odstęp końca treści, bez zmiany samego sposobu dodawania.
3. Skrócić tekst pomocniczy w importach, powiadomieniach i preferencjach; zachować widoczną informację o wysyłaniu danych i imporcie jednorazowym.
4. Na mobile obniżyć priorytet ustawień przeznaczonych dla komputera oraz ujednolicić łamanie grup opcji.
5. W profilu poprawić wyrównanie desktopowych grup czasu oraz odstęp między przewiniętą sekcją a stałym nagłówkiem.
6. Użyć czytelniejszego oznaczenia edycji zmiany zamiast plusa i zlikwidować mylące „Więcej rozmów ↓” na końcu historii.

Zachować wymagania: cztery zakładki na telefonie z Asystentem jako trzecią, Blokady/Ustawienia w hamburgerze w prawym górnym rogu, dodawanie wydarzeń samym pływającym plusem w prawym dolnym rogu oraz brak tekstu pod polem czatu. Dostarczone obrazy realizują te wybory. Nie rekomenduję ich zmiany.
