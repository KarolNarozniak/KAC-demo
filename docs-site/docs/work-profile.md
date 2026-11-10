---
id: work-profile
title: Profil pracy, dostępność i wynagrodzenie
sidebar_position: 5
---

## Jeden formularz i jeden planer

Zakładka **Grafik** zachowuje formularz i sposób planowania wprowadzony na masterze: tryb elastyczny lub zmianowy, minimum i maksimum godzin, cel tygodniowy lub miesięczny, dojazd, odpoczynek, długość zmiany, limit dzienny, dostępność oraz szablony. Stawkę PLN i brutto/netto dodano do tego samego formularza. Zapis, anulowanie, konflikt wersji i ostrzeżenie przy wyjściu obejmują cały szkic.

Pełny profil obsługuje `GET/PUT /api/v1/work-profile`. Pominięcie nowych pól finansowych przez starszego klienta zachowuje dotychczasową stawkę i oznaczenie. `null` oznacza brak ustawionej stawki, a zero jest poprawną stawką. Nie przeliczamy brutto na netto. Profil z dawną stawką bez oznaczenia można nadal edytować; przed nowym planowaniem trzeba uzupełnić brutto/netto.

`targetPeriod: month` zachowuje wpisany cel miesięczny. Generator korzysta z jego odpowiednika tygodniowego (miesiąc = 52/12 tygodnia). Zmiana stawki nie zmienia okresu celu.

## Dostępność jako część szkicu

Edytor pozwala dodawać i usuwać przedziały oraz kopiować dzień na zaznaczone dni. Godziny zapisują się dopiero razem z profilem. Nakładanie jest scalane przed wysłaniem; API odrzuca nieznormalizowane przecięcia. Zakres nocny jest dzielony na granicy dnia, także niedziela–poniedziałek, z zachowaniem `24:00`.

Edytor pokazuje zapisaną sumę godzin i sumę szkicu oraz ostrzega, gdy zapisane godziny są mniejsze od celu. Informacje o obowiązkowych zajęciach pochodzą z kontekstu wybranego tygodnia obliczanego przez istniejący planer; opcjonalne wyłączenie tych godzin z powtarzalnego wzorca wymaga akceptacji. Niezależnie od wzorca generator zawsze uwzględnia zajęcia danego tygodnia. Zapis dostępności nie zmienia wydarzeń.

Osobny zasób `GET/PUT /api/v1/work-profile/availability` jest nadal obsługiwany przez **to samo repozytorium**. Zapis jest atomowy, kontroluje właściciela i wersję, a pusta lista usuwa dostępność. Liczbowa `version` jest tokenem zgodności tego zasobu; pełny formularz używa `profileVersion`. Oba zmieniają się przy zapisie tego samego profilu.

## Planowanie i płaca

Generator i korekta zachowują limity dzienne i tygodniowe, szablony, istniejącą pracę, blokady i zajęcia. Nieobowiązkowe wykłady zachowują miękką regułę pomijania z ostrzeżeniem. Dojazd musi mieścić się w dostępności; pomiędzy dwiema zmianami wymagane jest `max(dojazd, odpoczynek)`, bez sumowania. Bufor nie jest płatną pracą i nie zależy od adresu ani usług map.

Każda zapisana zmiana zachowuje stawkę, brutto/netto i kwotę. Obliczenie wykorzystuje rzeczywiste minuty między instantami, również przy DST, oraz całkowite grosze: `halfUp(rateGrosz * durationMinutes / 60)`. Podsumowanie jest sumą osobno zaokrąglonych zmian propozycji. Nie zgadujemy wynagrodzenia innych wydarzeń, które nie mają historycznej stawki. Po ręcznej korekcie kwota pozostaje ostatnim snapshotem do zapisu. Akceptacja ponownie sprawdza ograniczenia wewnątrz transakcji.

Przycisk **Historia wybranego tygodnia** pokazuje zapisane grafiki, również pochodzące z wcześniejszej implementacji. Widok historii jest tylko do odczytu i nie przelicza kwot aktualną stawką. Nowe propozycje powstają wyłącznie przez `/api/v1/schedules`. Wcześniejsze rekordy i wydarzenia pozostają w bazie.

## Blokady i zgodność

Zakładka **Blokady** zachowuje urlopy, sesje egzaminacyjne i dni wolne przez `/api/v1/blocks`. Odczyt i usunięcie są ograniczone do właściciela. API przyjmuje instants ISO z offsetem, a formularz zamienia lokalne wpisy na UTC. Blokady nie są kopiowane do edytowalnych blokad profilu. Tworzenie i usuwanie blokady blokuje kalendarze, aby nie ominąć walidacji akceptacji. Strukturę tabeli tworzy migracja `010_calendar_blocks.sql`.

Wycofane adresy `/api/v1/work-profile/compensation` i `/api/v1/work-profile/schedules...` zwracają **410 workflow_consolidated** ze wskazaniem następcy. Nie uruchamiają drugiego silnika ani nie zapisują danych. Historia po ID pozostaje pod `/api/v1/schedules/id/{id}`. Nie ma niewersjonowanych aliasów.

Kanonicznym kontraktem jest [generowana referencja API](./api/openapi-reference), pochodząca ze schematów Fastify w `apps/api/src/api/v1/` i eksportu `apps/api/openapi/openapi.json`.
