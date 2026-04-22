-- ============================================================
-- MIGRACJA: Dynamiczny system ról z uprawnieniami
-- Uruchom na PostgreSQL: psql -d arbor -f migration_role.sql
-- ============================================================

-- Tabela ról
CREATE TABLE IF NOT EXISTS role (
  id            SERIAL PRIMARY KEY,
  nazwa         VARCHAR(50) UNIQUE NOT NULL,
  kolor         VARCHAR(7)  DEFAULT '#94A3B8',
  opis          TEXT,
  poziom        INTEGER     DEFAULT 1,    -- 1=pracownik, 5=kierownik, 10=admin
  uprawnienia   JSONB       NOT NULL DEFAULT '{}'::jsonb,
  aktywna       BOOLEAN     DEFAULT true,
  stala         BOOLEAN     DEFAULT false, -- true = nie można usunąć (role systemowe)
  created_at    TIMESTAMP   DEFAULT NOW()
);

-- ============================================================
-- DOMYŚLNE ROLE SYSTEMOWE (stala=true)
-- ============================================================

INSERT INTO role (nazwa, kolor, opis, poziom, stala, uprawnienia) VALUES

('Dyrektor', '#8B5CF6', 'Najwyższy poziom dostępu. Zarządza całą firmą.', 10, true, '{
  "zlecenia_widok": true,
  "zlecenia_tworzenie": true,
  "zlecenia_edycja": true,
  "zlecenia_usuniecie": true,
  "zlecenia_zmiana_statusu": true,
  "wyceny_widok": true,
  "wyceny_tworzenie": true,
  "wyceny_zatwierdzanie": true,
  "dniowki_widok": true,
  "dniowki_zatwierdzanie": true,
  "uzytkownicy_widok": true,
  "uzytkownicy_tworzenie": true,
  "uzytkownicy_edycja": true,
  "uzytkownicy_usuniecie": true,
  "role_zarzadzanie": true,
  "raporty_widok": true,
  "raporty_eksport": true,
  "harmonogram_widok": true,
  "harmonogram_edycja": true,
  "flota_widok": true,
  "flota_zarzadzanie": true,
  "oddzialy_zarzadzanie": true,
  "ekipy_zarzadzanie": true,
  "rozliczenia_widok": true
}'::jsonb),

('Administrator', '#F59E0B', 'Administracja systemu. Dostęp techniczny do ustawień.', 9, true, '{
  "zlecenia_widok": true,
  "zlecenia_tworzenie": true,
  "zlecenia_edycja": true,
  "zlecenia_usuniecie": true,
  "zlecenia_zmiana_statusu": true,
  "wyceny_widok": true,
  "wyceny_tworzenie": true,
  "wyceny_zatwierdzanie": true,
  "dniowki_widok": true,
  "dniowki_zatwierdzanie": true,
  "uzytkownicy_widok": true,
  "uzytkownicy_tworzenie": true,
  "uzytkownicy_edycja": true,
  "uzytkownicy_usuniecie": false,
  "role_zarzadzanie": true,
  "raporty_widok": true,
  "raporty_eksport": true,
  "harmonogram_widok": true,
  "harmonogram_edycja": true,
  "flota_widok": true,
  "flota_zarzadzanie": true,
  "oddzialy_zarzadzanie": true,
  "ekipy_zarzadzanie": true,
  "rozliczenia_widok": true
}'::jsonb),

('Kierownik', '#3B82F6', 'Zarządza ekipami, zatwierdza zlecenia i wyceny.', 5, true, '{
  "zlecenia_widok": true,
  "zlecenia_tworzenie": true,
  "zlecenia_edycja": true,
  "zlecenia_usuniecie": false,
  "zlecenia_zmiana_statusu": true,
  "wyceny_widok": true,
  "wyceny_tworzenie": true,
  "wyceny_zatwierdzanie": true,
  "dniowki_widok": true,
  "dniowki_zatwierdzanie": true,
  "uzytkownicy_widok": true,
  "uzytkownicy_tworzenie": false,
  "uzytkownicy_edycja": false,
  "uzytkownicy_usuniecie": false,
  "role_zarzadzanie": false,
  "raporty_widok": true,
  "raporty_eksport": true,
  "harmonogram_widok": true,
  "harmonogram_edycja": true,
  "flota_widok": true,
  "flota_zarzadzanie": false,
  "oddzialy_zarzadzanie": false,
  "ekipy_zarzadzanie": true,
  "rozliczenia_widok": true
}'::jsonb),

('Brygadzista', '#10B981', 'Lider ekipy. Składa raporty dzienne, widzi swoje zlecenia.', 3, true, '{
  "zlecenia_widok": true,
  "zlecenia_tworzenie": false,
  "zlecenia_edycja": false,
  "zlecenia_usuniecie": false,
  "zlecenia_zmiana_statusu": true,
  "wyceny_widok": true,
  "wyceny_tworzenie": true,
  "wyceny_zatwierdzanie": false,
  "dniowki_widok": true,
  "dniowki_zatwierdzanie": false,
  "uzytkownicy_widok": false,
  "uzytkownicy_tworzenie": false,
  "uzytkownicy_edycja": false,
  "uzytkownicy_usuniecie": false,
  "role_zarzadzanie": false,
  "raporty_widok": true,
  "raporty_eksport": false,
  "harmonogram_widok": true,
  "harmonogram_edycja": false,
  "flota_widok": true,
  "flota_zarzadzanie": false,
  "oddzialy_zarzadzanie": false,
  "ekipy_zarzadzanie": false,
  "rozliczenia_widok": true
}'::jsonb),

('Specjalista', '#06B6D4', 'Wykwalifikowany pracownik. Własna stawka godzinowa, dostęp do specjalistycznych raportów.', 3, true, '{
  "zlecenia_widok": true,
  "zlecenia_tworzenie": false,
  "zlecenia_edycja": false,
  "zlecenia_usuniecie": false,
  "zlecenia_zmiana_statusu": false,
  "wyceny_widok": true,
  "wyceny_tworzenie": true,
  "wyceny_zatwierdzanie": false,
  "dniowki_widok": true,
  "dniowki_zatwierdzanie": false,
  "uzytkownicy_widok": false,
  "uzytkownicy_tworzenie": false,
  "uzytkownicy_edycja": false,
  "uzytkownicy_usuniecie": false,
  "role_zarzadzanie": false,
  "raporty_widok": true,
  "raporty_eksport": false,
  "harmonogram_widok": true,
  "harmonogram_edycja": false,
  "flota_widok": false,
  "flota_zarzadzanie": false,
  "oddzialy_zarzadzanie": false,
  "ekipy_zarzadzanie": false,
  "rozliczenia_widok": true
}'::jsonb),

('Wyceniający', '#A78BFA', 'Wycenia prace w terenie. Tworzy wyceny do zatwierdzenia przez kierownika.', 2, true, '{
  "zlecenia_widok": false,
  "zlecenia_tworzenie": false,
  "zlecenia_edycja": false,
  "zlecenia_usuniecie": false,
  "zlecenia_zmiana_statusu": false,
  "wyceny_widok": true,
  "wyceny_tworzenie": true,
  "wyceny_zatwierdzanie": false,
  "dniowki_widok": false,
  "dniowki_zatwierdzanie": false,
  "uzytkownicy_widok": false,
  "uzytkownicy_tworzenie": false,
  "uzytkownicy_edycja": false,
  "uzytkownicy_usuniecie": false,
  "role_zarzadzanie": false,
  "raporty_widok": false,
  "raporty_eksport": false,
  "harmonogram_widok": false,
  "harmonogram_edycja": false,
  "flota_widok": false,
  "flota_zarzadzanie": false,
  "oddzialy_zarzadzanie": false,
  "ekipy_zarzadzanie": false,
  "rozliczenia_widok": false
}'::jsonb),

('Pomocnik', '#94A3B8', 'Pracownik ogólny. Widzi swoje zlecenia i rozliczenia godzinowe.', 1, true, '{
  "zlecenia_widok": true,
  "zlecenia_tworzenie": false,
  "zlecenia_edycja": false,
  "zlecenia_usuniecie": false,
  "zlecenia_zmiana_statusu": false,
  "wyceny_widok": false,
  "wyceny_tworzenie": false,
  "wyceny_zatwierdzanie": false,
  "dniowki_widok": true,
  "dniowki_zatwierdzanie": false,
  "uzytkownicy_widok": false,
  "uzytkownicy_tworzenie": false,
  "uzytkownicy_edycja": false,
  "uzytkownicy_usuniecie": false,
  "role_zarzadzanie": false,
  "raporty_widok": false,
  "raporty_eksport": false,
  "harmonogram_widok": false,
  "harmonogram_edycja": false,
  "flota_widok": false,
  "flota_zarzadzanie": false,
  "oddzialy_zarzadzanie": false,
  "ekipy_zarzadzanie": false,
  "rozliczenia_widok": true
}'::jsonb),

('Pomocnik bez doświadczenia', '#64748B', 'Nowy pracownik. Tylko widok własnych zleceń, brak dostępu do rozliczeń.', 1, true, '{
  "zlecenia_widok": true,
  "zlecenia_tworzenie": false,
  "zlecenia_edycja": false,
  "zlecenia_usuniecie": false,
  "zlecenia_zmiana_statusu": false,
  "wyceny_widok": false,
  "wyceny_tworzenie": false,
  "wyceny_zatwierdzanie": false,
  "dniowki_widok": false,
  "dniowki_zatwierdzanie": false,
  "uzytkownicy_widok": false,
  "uzytkownicy_tworzenie": false,
  "uzytkownicy_edycja": false,
  "uzytkownicy_usuniecie": false,
  "role_zarzadzanie": false,
  "raporty_widok": false,
  "raporty_eksport": false,
  "harmonogram_widok": false,
  "harmonogram_edycja": false,
  "flota_widok": false,
  "flota_zarzadzanie": false,
  "oddzialy_zarzadzanie": false,
  "ekipy_zarzadzanie": false,
  "rozliczenia_widok": false
}'::jsonb),

('Magazynier', '#F97316', 'Zarządza flotą, sprzętem i materiałami. Dostęp do modułu floty.', 2, true, '{
  "zlecenia_widok": true,
  "zlecenia_tworzenie": false,
  "zlecenia_edycja": false,
  "zlecenia_usuniecie": false,
  "zlecenia_zmiana_statusu": false,
  "wyceny_widok": false,
  "wyceny_tworzenie": false,
  "wyceny_zatwierdzanie": false,
  "dniowki_widok": false,
  "dniowki_zatwierdzanie": false,
  "uzytkownicy_widok": false,
  "uzytkownicy_tworzenie": false,
  "uzytkownicy_edycja": false,
  "uzytkownicy_usuniecie": false,
  "role_zarzadzanie": false,
  "raporty_widok": false,
  "raporty_eksport": false,
  "harmonogram_widok": true,
  "harmonogram_edycja": false,
  "flota_widok": true,
  "flota_zarzadzanie": true,
  "oddzialy_zarzadzanie": false,
  "ekipy_zarzadzanie": false,
  "rozliczenia_widok": false
}'::jsonb)

ON CONFLICT (nazwa) DO NOTHING;

-- Opcjonalnie: dodaj kolumnę rola_id do users (jeśli chcesz przejść na FK)
-- ALTER TABLE users ADD COLUMN IF NOT EXISTS rola_id INTEGER REFERENCES role(id);
-- UPDATE users u SET rola_id = r.id FROM role r WHERE r.nazwa = u.rola;

-- ============================================================
-- WIDOK: users z pełnymi uprawnieniami roli
-- ============================================================
CREATE OR REPLACE VIEW users_with_permissions AS
SELECT
  u.*,
  r.uprawnienia AS role_uprawnienia,
  r.kolor      AS role_kolor,
  r.poziom     AS role_poziom
FROM users u
LEFT JOIN role r ON r.nazwa = u.rola;
