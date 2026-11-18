-- Pusty profil pracy dla kont, które go nie mają (konta założone przez rejestrację przed tą poprawką albo skryptem administratora).
-- Bez wiersza profilu formularz „Profil pracy”, blokady i grafik nie mają czego wczytać ani zapisać. Nowe konta dostają profil przy rejestracji.
-- Profil bez godzin i stawki (null), z dojazdem 0 min – godziny, dostępność i stawkę użytkownik uzupełnia w aplikacji.

insert into t_profile_pracy (id_uzytkownika, czas_dojazdu_min)
select u.id_uzytkownika, 0 from t_uzytkownicy u
where not exists (select 1 from t_profile_pracy p where p.id_uzytkownika = u.id_uzytkownika and p.aktywny);
