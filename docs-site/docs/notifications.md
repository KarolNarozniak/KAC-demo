---
id: notifications
title: Przypomnienia o zmianach
sidebar_label: Przypomnienia
description: Ustawienia, planowanie, dostarczanie i otwieranie przypomnień o zmianach w pracy.
---

# Przypomnienia o zmianach

## Ustawienia

W ustawieniach powiadomień można włączyć lub wyłączyć przypomnienia i określić dodatnie wyprzedzenie od 1 do 1440 minut. Zmiany są robocze do chwili wybrania „Zapisz ustawienia”; „Anuluj edycję” przywraca ostatnio zapisane wartości. Włączenie wymaga zgody przeglądarki. Interfejs pokazuje stan zgody i liczbę zaplanowanych przypomnień; zero oznacza, że obecnie nie ma nadchodzących, zatwierdzonych zmian.

Zapis lub zmiana ustawień atomowo anuluje poprzednie oczekujące przypomnienia i planuje nowe dla istniejących, zatwierdzonych zmian w kategorii „Praca”. Późniejsze dodanie, zatwierdzenie, zmiana terminu lub usunięcie zmiany jest obsługiwane przez outbox. Zmiana ustawień przypomnień nie modyfikuje grafiku.

## Dostarczenie i nawigacja

Powiadomienie zawiera tytuł oraz aktualną datę, godzinę rozpoczęcia i godzinę zakończenia zmiany w strefie użytkownika. Jeśli termin przypomnienia już minął, ale zmiana jeszcze się nie rozpoczęła, przypomnienie jest dostępne niezwłocznie. Dla rozpoczętych zmian nie jest planowane.

API przejmuje przypomnienie na dwuminutowy lease. Przeglądarka potwierdza je dopiero po utworzeniu powiadomienia systemowego; bez potwierdzenia lease wygasa i pozycja jest ponawiana. Wyświetlenie nie jest potwierdzeniem przeczytania. Kliknięcie przenosi do tygodnia i otwiera szczegóły zmiany. Gdy zmiana została usunięta, aplikacja informuje o tym i otwiera kalendarz.

Web Push jest opcjonalny i wymaga VAPID. Użytkownik zapisuje subskrypcję dla bieżącego zakresu; klucz publiczny jest udostępniany przeglądarce, a prywatny pozostaje wyłącznie w konfiguracji worker'a API. API akceptuje hosty usług push używane przez Chrome, Firefox, Safari i Windows, a nie dowolne endpointy HTTPS. Worker wysyła gotowe przypomnienia do subskrypcji, ponawia przejściowe błędy i usuwa wygasłe endpointy. Gdy VAPID nie jest skonfigurowany, klient nadal odpyta API i pokaże powiadomienie systemowe w działającej aplikacji po uzyskaniu zgody; nie jest wtedy gwarantowana dostawa po zamknięciu aplikacji.

Do aktywacji wygeneruj klucze jednorazowo:

```powershell
npx web-push generate-vapid-keys
```

Ustaw `WEB_PUSH_VAPID_PUBLIC_KEY`, `WEB_PUSH_VAPID_PRIVATE_KEY` i `WEB_PUSH_VAPID_SUBJECT` w konfiguracji API/worker'a. Klucz prywatny jest sekretem i nie może być ustawiony we frontendzie.

## Zmiany planu (S23KC2S1P2-299)

Konsument zdarzeń outboxa tworzy powiadomienie typu **„Zmiana planu”**, gdy zmieni się data, godzina albo miejsce przyszłego wydarzenia – niezależnie od źródła: edycja w kalendarzu, korekta serii, import z zamianą istniejącego wydarzenia. Treść zawiera nazwę, nowy termin i poprzedni termin, np. „Zmiana planu: „Laboratorium” – nowy termin 2026-11-20 12:00–13:30 (było 2026-11-19 10:00–11:30)”.

- Ponowny zapis tych samych danych (także w innym formacie czasu) oraz zmiana samego tytułu nie są zmianą planu.
- Jedna wersja wydarzenia daje najwyżej jedno powiadomienie (klucz idempotencji `plan-change:{id}:{wersja}`), więc ponowna dostawa zdarzenia nie tworzy duplikatu.
- Kilka szybkich zmian przed dostarczeniem łączy się w jedno powiadomienie z różnicą od pierwotnego terminu; powrót do pierwotnego terminu nie wysyła nic.
- Gdy zdarzenie nie zawiera stanu „przed”, powiadomienie nie zgaduje różnicy – prosi o otwarcie kalendarza i pokazuje aktualny termin.
- Obowiązują ustawienia `wlaczone` i `zmiany_wlaczone` oraz godziny ciszy (wysyłka przesuwa się na ich koniec).
- Kliknięcie najpierw ponownie wczytuje kalendarz, potem otwiera wydarzenie z ramką „Zmiana planu” (było → jest). Jeśli wydarzenie zmieniło się jeszcze raz po wysłaniu powiadomienia, aplikacja to zaznacza.

Szczegóły różnicy są zapisywane w kolumnie `t_powiadomienia.szczegoly` (migracja `016_plan_change_notifications.sql`) i zwracane jako pole `change` w `GET /api/v1/notifications/due`. Zmiany z Google (pobieranie zmian, G05) i zastąpienie zatwierdzonego grafiku są poza zakresem – nie generują jeszcze zdarzenia `calendar_event.updated` z różnicą.

## API

- `GET /api/v1/notifications/settings` zwraca zapisane preferencje i liczbę oczekujących przypomnień.
- `PUT /api/v1/notifications/settings` zapisuje ustawienie aktywności i wyprzedzenie oraz ponownie planuje oczekujące pozycje.
- `GET /api/v1/notifications/due` atomowo przejmuje gotowe przypomnienia na ograniczony czas; dla typu „Zmiana planu” pole `change` zawiera `kind`, `fields`, `before`, `after` i `eventVersion`.
- `POST /api/v1/notifications/{id}/ack` oznacza przypomnienie jako wyświetlone po potwierdzeniu klienta; nie oznacza przeczytania.
- `GET /api/v1/notifications/push-config` zwraca stan konfiguracji oraz wyłącznie publiczny klucz VAPID.
- `POST /api/v1/notifications/subscriptions` zapisuje subskrypcję bieżącego zakresu; `DELETE` usuwa tylko subskrypcję tego zakresu.
