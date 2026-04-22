-- ============================================================
-- ARBOR-OS — KOMPLETNA MIGRACJA BAZY DANYCH
-- Wygenerowano automatycznie z kodu źródłowego
-- Uruchom jednorazowo na czystej bazie PostgreSQL
-- ============================================================

-- ─── 1. BRANCHES (Oddziały) ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS branches (
  id            SERIAL PRIMARY KEY,
  nazwa         VARCHAR(200) NOT NULL,
  adres         VARCHAR(255),
  miasto        VARCHAR(100),
  kod_pocztowy  VARCHAR(10),
  telefon       VARCHAR(30),
  email         VARCHAR(255),
  kierownik_id  INTEGER,
  aktywny       BOOLEAN DEFAULT true,
  created_at    TIMESTAMP DEFAULT NOW(),
  updated_at    TIMESTAMP DEFAULT NOW()
);

-- ─── 2. USERS (Użytkownicy) ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id                          SERIAL PRIMARY KEY,
  login                       VARCHAR(100) UNIQUE NOT NULL,
  haslo_hash                  VARCHAR(255) NOT NULL,
  imie                        VARCHAR(100) NOT NULL,
  nazwisko                    VARCHAR(100) NOT NULL,
  email                       VARCHAR(255),
  telefon                     VARCHAR(30),
  rola                        VARCHAR(50) NOT NULL DEFAULT 'Brygadzista',
  oddzial_id                  INTEGER REFERENCES branches(id),
  stawka_godzinowa            DECIMAL(8,2),
  aktywny                     BOOLEAN DEFAULT true,
  ekipa_id                    INTEGER,
  procent_wynagrodzenia       DECIMAL(5,2) DEFAULT 15,
  stanowisko                  VARCHAR(200),
  data_zatrudnienia           DATE,
  adres_zamieszkania          VARCHAR(255),
  kontakt_awaryjny_imie       VARCHAR(200),
  kontakt_awaryjny_telefon    VARCHAR(50),
  notatki                     TEXT,
  created_at                  TIMESTAMP DEFAULT NOW(),
  updated_at                  TIMESTAMP DEFAULT NOW()
);

-- Klucz obcy kierownik_id w branches (dodawany po utworzeniu users)
ALTER TABLE branches ADD COLUMN IF NOT EXISTS kierownik_fk INTEGER REFERENCES users(id);

-- ─── 3. TEAMS (Ekipy) ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS teams (
  id             SERIAL PRIMARY KEY,
  nazwa          VARCHAR(200) NOT NULL,
  brygadzista_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  oddzial_id     INTEGER REFERENCES branches(id) ON DELETE SET NULL,
  aktywny        BOOLEAN DEFAULT true,
  created_at     TIMESTAMP DEFAULT NOW(),
  updated_at     TIMESTAMP DEFAULT NOW()
);

-- Klucz obcy ekipa_id w users
ALTER TABLE users ADD COLUMN IF NOT EXISTS ekipa_id_fk INTEGER REFERENCES teams(id);

-- ─── 4. TASKS (Zlecenia) ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tasks (
  id                     SERIAL PRIMARY KEY,
  klient_nazwa           VARCHAR(200) NOT NULL,
  klient_telefon         VARCHAR(30),
  klient_email           VARCHAR(255),
  adres                  VARCHAR(255) NOT NULL,
  miasto                 VARCHAR(100),
  kod_pocztowy           VARCHAR(10),
  typ_uslugi             VARCHAR(100),
  opis                   TEXT,
  data_planowana         TIMESTAMP,
  data_rozpoczecia       TIMESTAMP,
  data_zakonczenia       TIMESTAMP,
  priorytet              VARCHAR(30) DEFAULT 'Normalny',
  status                 VARCHAR(50) DEFAULT 'Nowe',
  wartosc_planowana      DECIMAL(10,2),
  wartosc_rzeczywista    DECIMAL(10,2),
  ekipa_id               INTEGER REFERENCES teams(id) ON DELETE SET NULL,
  oddzial_id             INTEGER REFERENCES branches(id),
  brygadzista_id         INTEGER REFERENCES users(id) ON DELETE SET NULL,
  notatki_wewnetrzne     TEXT,
  notatki_klienta        TEXT,
  link_statusowy_token   VARCHAR(64),
  created_at             TIMESTAMP DEFAULT NOW(),
  updated_at             TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tasks_status      ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_data        ON tasks(data_planowana);
CREATE INDEX IF NOT EXISTS idx_tasks_oddzial     ON tasks(oddzial_id);
CREATE INDEX IF NOT EXISTS idx_tasks_brygadzista ON tasks(brygadzista_id);
CREATE INDEX IF NOT EXISTS idx_tasks_ekipa       ON tasks(ekipa_id);

-- ─── 5. WYCENY ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS wyceny (
  id                        SERIAL PRIMARY KEY,
  klient_nazwa              VARCHAR(200),
  klient_telefon            VARCHAR(30),
  adres                     VARCHAR(255),
  miasto                    VARCHAR(100),
  typ_uslugi                VARCHAR(100),
  wartosc_szacowana         DECIMAL(10,2),
  wartosc_planowana         DECIMAL(10,2),
  opis                      TEXT,
  notatki_wewnetrzne        TEXT,
  wycena_uwagi              TEXT,
  lat                       DECIMAL(10,7),
  lon                       DECIMAL(10,7),
  autor_id                  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  ekipa_id                  INTEGER REFERENCES teams(id) ON DELETE SET NULL,
  zatwierdzone_przez        INTEGER REFERENCES users(id) ON DELETE SET NULL,
  status                    VARCHAR(50) DEFAULT 'Nowa',
  status_akceptacji         VARCHAR(30) DEFAULT 'oczekuje',
  data_wykonania            DATE,
  godzina_rozpoczecia       TIME,
  czas_planowany_godziny    DECIMAL(5,2),
  created_at                TIMESTAMP DEFAULT NOW(),
  updated_at                TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS wyceny_zdjecia (
  id         SERIAL PRIMARY KEY,
  wycena_id  INTEGER REFERENCES wyceny(id) ON DELETE CASCADE,
  sciezka    TEXT,
  url        TEXT,
  lat        DECIMAL(10,7),
  lon        DECIMAL(10,7),
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wyceny_autor         ON wyceny(autor_id);
CREATE INDEX IF NOT EXISTS idx_wyceny_status        ON wyceny(status);
CREATE INDEX IF NOT EXISTS idx_wyceny_status_akc    ON wyceny(status_akceptacji);
CREATE INDEX IF NOT EXISTS idx_wyceny_zdjecia_wycena ON wyceny_zdjecia(wycena_id);

-- ─── 6. KLIENCI ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS klienci (
  id           SERIAL PRIMARY KEY,
  imie         VARCHAR(100),
  nazwisko     VARCHAR(100),
  firma        VARCHAR(200),
  telefon      VARCHAR(30),
  email        VARCHAR(255),
  adres        VARCHAR(255),
  miasto       VARCHAR(100),
  kod_pocztowy VARCHAR(10),
  notatki      TEXT,
  zrodlo       VARCHAR(50) DEFAULT 'telefon',
  created_by   INTEGER REFERENCES users(id),
  created_at   TIMESTAMP DEFAULT NOW(),
  updated_at   TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_klienci_telefon ON klienci(telefon);
CREATE INDEX IF NOT EXISTS idx_klienci_miasto  ON klienci(miasto);

-- ─── 7. OGLEDZINY ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ogledziny (
  id             SERIAL PRIMARY KEY,
  klient_id      INTEGER REFERENCES klienci(id) ON DELETE SET NULL,
  brygadzista_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  data_planowana TIMESTAMP,
  status         VARCHAR(30) DEFAULT 'Zaplanowane',
  adres          VARCHAR(255),
  miasto         VARCHAR(100),
  notatki        TEXT,
  notatki_wyniki TEXT,
  wycena_id      INTEGER REFERENCES wyceny(id) ON DELETE SET NULL,
  task_id        INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
  created_by     INTEGER REFERENCES users(id),
  created_at     TIMESTAMP DEFAULT NOW(),
  updated_at     TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ogledziny_brygadzista ON ogledziny(brygadzista_id);
CREATE INDEX IF NOT EXISTS idx_ogledziny_status      ON ogledziny(status);
CREATE INDEX IF NOT EXISTS idx_ogledziny_data        ON ogledziny(data_planowana);

-- ─── 8. TASK_POMOCNICY ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS task_pomocnicy (
  id               SERIAL PRIMARY KEY,
  task_id          INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
  pomocnik_id      INTEGER REFERENCES users(id) ON DELETE CASCADE,
  godziny          DECIMAL(5,2) DEFAULT 0,
  stawka_godzinowa DECIMAL(8,2) DEFAULT 0,
  created_at       TIMESTAMP DEFAULT NOW(),
  UNIQUE(task_id, pomocnik_id)
);

-- ─── 9. WORK_LOGS ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS work_logs (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  task_id        INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
  user_id        INTEGER REFERENCES users(id),
  start_time     TIMESTAMP DEFAULT NOW(),
  end_time       TIMESTAMP,
  duration_hours DECIMAL(5,2),
  opis           TEXT,
  status         VARCHAR(20) DEFAULT 'completed',
  created_at     TIMESTAMP DEFAULT NOW()
);

-- ─── 10. ISSUES ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS issues (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  task_id     INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
  user_id     INTEGER REFERENCES users(id),
  resolved_by INTEGER REFERENCES users(id),
  typ         VARCHAR(50) DEFAULT 'inne',
  opis        TEXT,
  status      VARCHAR(30) DEFAULT 'Nowy',
  created_at  TIMESTAMP DEFAULT NOW(),
  resolved_at TIMESTAMP
);

-- ─── 11. TASK_PHOTOS ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS task_photos (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  task_id    INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
  user_id    INTEGER REFERENCES users(id),
  url        TEXT NOT NULL,
  opis       TEXT,
  typ        VARCHAR(20) DEFAULT 'inne',
  created_at TIMESTAMP DEFAULT NOW()
);

-- ─── 12. TASK_POMOCNIK_GODZINY ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS task_pomocnik_godziny (
  id               SERIAL PRIMARY KEY,
  task_id          INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
  pomocnik_id      INTEGER REFERENCES users(id) ON DELETE CASCADE,
  godziny          DECIMAL(5,2) DEFAULT 0,
  stawka_godzinowa DECIMAL(8,2) DEFAULT 0,
  data_pracy       DATE NOT NULL,
  status           VARCHAR(50) DEFAULT 'Oczekuje',
  potwierdzone_at  TIMESTAMP,
  created_at       TIMESTAMP DEFAULT NOW(),
  updated_at       TIMESTAMP DEFAULT NOW(),
  UNIQUE(task_id, pomocnik_id, data_pracy)
);

-- ─── 13. TASK_ROZLICZENIE ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS task_rozliczenie (
  id                        SERIAL PRIMARY KEY,
  task_id                   INTEGER REFERENCES tasks(id) UNIQUE,
  wartosc_brutto            DECIMAL(10,2) DEFAULT 0,
  vat_stawka                DECIMAL(5,2) DEFAULT 23,
  wartosc_netto             DECIMAL(10,2) DEFAULT 0,
  koszt_pomocnikow          DECIMAL(10,2) DEFAULT 0,
  podstawa_brygadzisty      DECIMAL(10,2) DEFAULT 0,
  procent_brygadzisty       DECIMAL(5,2) DEFAULT 15,
  wynagrodzenie_brygadzisty DECIMAL(10,2) DEFAULT 0,
  created_at                TIMESTAMP DEFAULT NOW(),
  updated_at                TIMESTAMP DEFAULT NOW()
);

-- ─── 14. GODZINY_POTWIERDZENIA ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS godziny_potwierdzenia (
  id             SERIAL PRIMARY KEY,
  task_id        INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
  pomocnik_id    INTEGER REFERENCES users(id) ON DELETE CASCADE,
  brygadzista_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  godziny        DECIMAL(5,2) NOT NULL,
  data_pracy     DATE NOT NULL,
  status         VARCHAR(30) DEFAULT 'Oczekuje',
  created_at     TIMESTAMP DEFAULT NOW(),
  updated_at     TIMESTAMP DEFAULT NOW()
);

-- ─── 15. DAILY_REPORTS ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS daily_reports (
  id               SERIAL PRIMARY KEY,
  user_id          INTEGER REFERENCES users(id),
  oddzial_id       INTEGER REFERENCES branches(id),
  data_raportu     DATE NOT NULL,
  czas_pracy_minuty INTEGER DEFAULT 0,
  opis_pracy       TEXT,
  podpis_url       TEXT,
  status           VARCHAR(50) DEFAULT 'Roboczy',
  wyslany_at       TIMESTAMP,
  created_at       TIMESTAMP DEFAULT NOW(),
  updated_at       TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id, data_raportu)
);

CREATE TABLE IF NOT EXISTS daily_report_tasks (
  id         SERIAL PRIMARY KEY,
  report_id  INTEGER REFERENCES daily_reports(id) ON DELETE CASCADE,
  task_id    INTEGER REFERENCES tasks(id),
  czas_minuty INTEGER DEFAULT 0,
  uwagi      TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS daily_report_materials (
  id                SERIAL PRIMARY KEY,
  report_id         INTEGER REFERENCES daily_reports(id) ON DELETE CASCADE,
  nazwa             VARCHAR(200) NOT NULL,
  ilosc             DECIMAL(10,2) DEFAULT 1,
  jednostka         VARCHAR(20) DEFAULT 'szt',
  koszt_jednostkowy DECIMAL(10,2) DEFAULT 0,
  created_at        TIMESTAMP DEFAULT NOW()
);

-- ─── 16. NOTIFICATIONS ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notifications (
  id             SERIAL PRIMARY KEY,
  from_user_id   INTEGER REFERENCES users(id),
  to_user_id     INTEGER REFERENCES users(id),
  task_id        INTEGER REFERENCES tasks(id),
  typ            VARCHAR(50) NOT NULL,
  tresc          TEXT,
  status         VARCHAR(50) DEFAULT 'Nowe',
  data_utworzenia TIMESTAMP DEFAULT NOW(),
  data_odczytu   TIMESTAMP,
  created_at     TIMESTAMP DEFAULT NOW(),
  updated_at     TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_to_user ON notifications(to_user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_status  ON notifications(status);

-- ─── 17. SMS_HISTORY ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sms_history (
  id         SERIAL PRIMARY KEY,
  task_id    INTEGER REFERENCES tasks(id),
  telefon    VARCHAR(20) NOT NULL,
  tresc      TEXT NOT NULL,
  status     VARCHAR(50) DEFAULT 'Wyslany',
  sid        VARCHAR(100),
  error      TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- ─── 18. USER_COMPETENCIES ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_competencies (
  id              SERIAL PRIMARY KEY,
  user_id         INTEGER REFERENCES users(id) ON DELETE CASCADE,
  nazwa           VARCHAR(200) NOT NULL,
  typ             VARCHAR(50) DEFAULT 'inne',
  nr_dokumentu    VARCHAR(100),
  data_uzyskania  DATE,
  data_waznosci   DATE,
  wydawca         VARCHAR(200),
  created_at      TIMESTAMP DEFAULT NOW(),
  updated_at      TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_competencies_user         ON user_competencies(user_id);
CREATE INDEX IF NOT EXISTS idx_user_competencies_data_waznosci ON user_competencies(data_waznosci);

-- ─── 19. COMPANY_SETTINGS ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS company_settings (
  id             SERIAL PRIMARY KEY,
  nazwa          VARCHAR(200),
  nip            VARCHAR(20),
  adres          TEXT,
  kod_pocztowy   VARCHAR(10),
  miasto         VARCHAR(100),
  konto_bankowe  VARCHAR(50),
  bank_nazwa     VARCHAR(100),
  email          VARCHAR(100),
  telefon        VARCHAR(20),
  created_at     TIMESTAMP DEFAULT NOW(),
  updated_at     TIMESTAMP DEFAULT NOW()
);

-- ─── 20. INVOICES ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS invoices (
  id               SERIAL PRIMARY KEY,
  numer            VARCHAR(50) UNIQUE NOT NULL,
  task_id          INTEGER,
  oddzial_id       INTEGER,
  wystawil_id      INTEGER,
  klient_nazwa     VARCHAR(200) NOT NULL,
  klient_nip       VARCHAR(20),
  klient_adres     TEXT,
  klient_email     VARCHAR(100),
  klient_typ       VARCHAR(20) DEFAULT 'firma',
  data_wystawienia DATE NOT NULL,
  data_sprzedazy   DATE,
  termin_platnosci DATE,
  forma_platnosci  VARCHAR(50) DEFAULT 'przelew',
  uwagi            TEXT,
  netto            DECIMAL(10,2) NOT NULL,
  vat_stawka       DECIMAL(5,2) NOT NULL,
  vat_kwota        DECIMAL(10,2) NOT NULL,
  brutto           DECIMAL(10,2) NOT NULL,
  status           VARCHAR(50) DEFAULT 'Nieoplacona',
  created_at       TIMESTAMP DEFAULT NOW(),
  updated_at       TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS invoice_items (
  id              SERIAL PRIMARY KEY,
  invoice_id      INTEGER REFERENCES invoices(id) ON DELETE CASCADE,
  nazwa           VARCHAR(200) NOT NULL,
  jednostka       VARCHAR(20) DEFAULT 'szt',
  ilosc           DECIMAL(10,2) NOT NULL,
  cena_netto      DECIMAL(10,2) NOT NULL,
  vat_stawka      DECIMAL(5,2) NOT NULL,
  wartosc_netto   DECIMAL(10,2) NOT NULL,
  wartosc_brutto  DECIMAL(10,2) NOT NULL,
  created_at      TIMESTAMP DEFAULT NOW()
);

-- ─── 21. TEAM_MEMBERS ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS team_members (
  id          SERIAL PRIMARY KEY,
  team_id     INTEGER REFERENCES teams(id) ON DELETE CASCADE,
  user_id     INTEGER REFERENCES users(id) ON DELETE CASCADE,
  joined_at   TIMESTAMP DEFAULT NOW(),
  UNIQUE(team_id, user_id)
);

-- ─── 22. VEHICLES (FLOTA - POJAZDY) ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS vehicles (
  id                    SERIAL PRIMARY KEY,
  oddzial_id            INTEGER REFERENCES branches(id),
  marka                 VARCHAR(100),
  model                 VARCHAR(100),
  nr_rejestracyjny      VARCHAR(50) UNIQUE,
  rok_produkcji         INTEGER,
  typ                   VARCHAR(50),
  ekipa_id              INTEGER REFERENCES teams(id),
  data_przegladu        DATE,
  data_ubezpieczenia    DATE,
  przebieg              INTEGER DEFAULT 0,
  notatki               TEXT,
  status                VARCHAR(30) DEFAULT 'Dostepny',
  created_at            TIMESTAMP DEFAULT NOW(),
  updated_at            TIMESTAMP DEFAULT NOW()
);

-- ─── 23. EQUIPMENT_ITEMS (FLOTA - SPRZET) ────────────────────────────────────
CREATE TABLE IF NOT EXISTS equipment_items (
  id                SERIAL PRIMARY KEY,
  oddzial_id        INTEGER REFERENCES branches(id),
  nazwa             VARCHAR(200),
  typ               VARCHAR(100),
  nr_seryjny        VARCHAR(100),
  rok_produkcji     INTEGER,
  ekipa_id          INTEGER REFERENCES teams(id),
  data_przegladu    DATE,
  koszt_motogodziny NUMERIC(10,2) DEFAULT 0,
  notatki           TEXT,
  status            VARCHAR(30) DEFAULT 'Dostepny',
  created_at        TIMESTAMP DEFAULT NOW(),
  updated_at        TIMESTAMP DEFAULT NOW()
);

-- ─── 24. REPAIRS (FLOTA - NAPRAWY) ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS repairs (
  id            SERIAL PRIMARY KEY,
  typ_zasobu    VARCHAR(20),
  zasob_id      INTEGER,
  oddzial_id    INTEGER REFERENCES branches(id),
  nr_faktury    VARCHAR(100),
  data_naprawy  DATE,
  koszt         NUMERIC(10,2) DEFAULT 0,
  opis_usterki  TEXT,
  opis_naprawy  TEXT,
  wykonawca     VARCHAR(200),
  status        VARCHAR(30) DEFAULT 'Zakonczona',
  user_id       INTEGER REFERENCES users(id),
  created_at    TIMESTAMP DEFAULT NOW()
);

-- ─── 25. ROLE (UPRAWNIENIA) ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS role (
  id          SERIAL PRIMARY KEY,
  nazwa       VARCHAR(100) UNIQUE,
  kolor       VARCHAR(20),
  opis        TEXT,
  poziom      INTEGER DEFAULT 1,
  uprawnienia JSONB DEFAULT '{}',
  stala       BOOLEAN DEFAULT false
);

-- ─── 26. ROZMOWY TELEFONICZNE (nagranie + transkrypcja + raport AI) ───────────
CREATE TABLE IF NOT EXISTS phone_call_conversations (
  id                      SERIAL PRIMARY KEY,
  twilio_call_sid         VARCHAR(64) UNIQUE NOT NULL,
  twilio_recording_sid    VARCHAR(64),
  user_id                 INTEGER REFERENCES users(id) ON DELETE SET NULL,
  task_id                 INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
  staff_number            VARCHAR(40),
  client_number           VARCHAR(40),
  recording_url           TEXT,
  recording_duration_sec  INTEGER,
  recording_archive_backend VARCHAR(16),
  recording_archive_ref   TEXT,
  recording_archive_url   TEXT,
  transcript              TEXT,
  raport                  TEXT,
  wskazowki_specjalisty   TEXT,
  status                  VARCHAR(40) DEFAULT 'in_progress',
  error_message           TEXT,
  created_at              TIMESTAMP DEFAULT NOW(),
  updated_at              TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_phone_calls_user_created ON phone_call_conversations(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_phone_calls_task ON phone_call_conversations(task_id);

ALTER TABLE phone_call_conversations ADD COLUMN IF NOT EXISTS recording_archive_backend VARCHAR(16);
ALTER TABLE phone_call_conversations ADD COLUMN IF NOT EXISTS recording_archive_ref TEXT;
ALTER TABLE phone_call_conversations ADD COLUMN IF NOT EXISTS recording_archive_url TEXT;
ALTER TABLE phone_call_conversations ADD COLUMN IF NOT EXISTS wskazowki_specjalisty TEXT;

-- ─── work_logs: geolokalizacja + checklista startu (ekipa) ───────────────────
ALTER TABLE work_logs ADD COLUMN IF NOT EXISTS start_lat DECIMAL(10,7);
ALTER TABLE work_logs ADD COLUMN IF NOT EXISTS start_lng DECIMAL(10,7);
ALTER TABLE work_logs ADD COLUMN IF NOT EXISTS end_lat DECIMAL(10,7);
ALTER TABLE work_logs ADD COLUMN IF NOT EXISTS end_lng DECIMAL(10,7);
ALTER TABLE work_logs ADD COLUMN IF NOT EXISTS dmuchawa_filtr_ok BOOLEAN;
ALTER TABLE work_logs ADD COLUMN IF NOT EXISTS rebak_zatankowany BOOLEAN;
ALTER TABLE work_logs ADD COLUMN IF NOT EXISTS kaski_zespol BOOLEAN;
ALTER TABLE work_logs ADD COLUMN IF NOT EXISTS bhp_potwierdzone BOOLEAN;

-- ─── photos (zdjęcia zleceń; lat/lon przy robieniu zdjęcia z telefonu) ─────────
CREATE TABLE IF NOT EXISTS photos (
  id           SERIAL PRIMARY KEY,
  task_id      INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
  user_id      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  typ          VARCHAR(50),
  url          TEXT,
  sciezka      TEXT,
  data_dodania TIMESTAMP,
  lat          DECIMAL(10,7),
  lon          DECIMAL(10,7)
);
ALTER TABLE photos ADD COLUMN IF NOT EXISTS lat DECIMAL(10,7);
ALTER TABLE photos ADD COLUMN IF NOT EXISTS lon DECIMAL(10,7);

-- ─── 21. PIERWSZE KONTO ADMINISTRATORA ───────────────────────────────────────
-- Hasło: Admin123! (bcrypt hash)
-- ZMIEŃ HASŁO po pierwszym logowaniu!
INSERT INTO users (login, haslo_hash, imie, nazwisko, rola, aktywny)
VALUES (
  'admin',
  '$2b$12$3KxtQ6b/zJrmqUUYXQk6JeN3AJJ9wzFJaSPXWouV5024EsM/vRIwW',
  'Administrator',
  'Systemu',
  'Administrator',
  true
)
ON CONFLICT (login) DO UPDATE SET haslo_hash = EXCLUDED.haslo_hash;

-- ============================================================
-- KONIEC MIGRACJI
-- ==========================