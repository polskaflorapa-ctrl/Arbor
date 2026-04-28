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
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS wyceniajacy_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS pin_lat DECIMAL(10,7);
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS pin_lng DECIMAL(10,7);
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS ankieta_uproszczona BOOLEAN DEFAULT false;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS source_wycena_id INTEGER REFERENCES wyceny(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_wyceniajacy ON tasks(wyceniajacy_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_source_wycena_unique ON tasks(source_wycena_id) WHERE source_wycena_id IS NOT NULL;

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS kommo_last_sync_at TIMESTAMPTZ;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS kommo_last_sync_status VARCHAR(32);
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS kommo_last_sync_http INTEGER;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS kommo_last_sync_error TEXT;

-- Kolumny używane przez POST /tasks/nowe (API)
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS kierownik_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS czas_planowany_godziny DECIMAL(5,2);

-- Idempotencja (F3.8): nagłówek Idempotency-Key na wybranych POST/PUT — zapobiega duplikatom po retry kolejki offline
CREATE TABLE IF NOT EXISTS api_idempotency_log (
  idempotency_key VARCHAR(200) PRIMARY KEY,
  scope             VARCHAR(160) NOT NULL,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_api_idempotency_created ON api_idempotency_log(created_at DESC);

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
ALTER TABLE wyceny ADD COLUMN IF NOT EXISTS proponowana_ekipa_id INTEGER REFERENCES teams(id) ON DELETE SET NULL;
ALTER TABLE wyceny ADD COLUMN IF NOT EXISTS proponowana_data DATE;
ALTER TABLE wyceny ADD COLUMN IF NOT EXISTS proponowana_godzina TIME;
ALTER TABLE wyceny ADD COLUMN IF NOT EXISTS proponowana_przez INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE wyceny ADD COLUMN IF NOT EXISTS proponowana_at TIMESTAMP;
ALTER TABLE wyceny ADD COLUMN IF NOT EXISTS rezerwacja_wygasa_at TIMESTAMP;
CREATE INDEX IF NOT EXISTS idx_wyceny_proponowana_ekipa_data ON wyceny(proponowana_ekipa_id, proponowana_data);

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

ALTER TABLE klienci ADD COLUMN IF NOT EXISTS kommo_last_sync_at TIMESTAMPTZ;
ALTER TABLE klienci ADD COLUMN IF NOT EXISTS kommo_last_sync_status VARCHAR(32);
ALTER TABLE klienci ADD COLUMN IF NOT EXISTS kommo_last_sync_http INTEGER;
ALTER TABLE klienci ADD COLUMN IF NOT EXISTS kommo_last_sync_error TEXT;

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
ALTER TABLE work_logs ADD COLUMN IF NOT EXISTS czas_pracy_minuty INTEGER DEFAULT 0;

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
ALTER TABLE photos ADD COLUMN IF NOT EXISTS opis TEXT;
ALTER TABLE photos ADD COLUMN IF NOT EXISTS tagi TEXT[];

-- F3.7 — zużycie materiałów zgłoszone przy zakończeniu zlecenia (POST /tasks/:id/finish, pole `zuzyte_materialy`)
CREATE TABLE IF NOT EXISTS task_finish_material_usage (
  id            SERIAL PRIMARY KEY,
  task_id       INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  recorded_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  recorded_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  nazwa         VARCHAR(200) NOT NULL,
  ilosc         NUMERIC(14, 4),
  jednostka     VARCHAR(24),
  notatka       TEXT
);
CREATE INDEX IF NOT EXISTS idx_task_finish_usage_task ON task_finish_material_usage (task_id);

-- ─── GPS LIVE (Juwentus) ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS gps_vehicle_positions (
  id            BIGSERIAL PRIMARY KEY,
  provider      VARCHAR(40) NOT NULL,
  external_id   VARCHAR(120) NOT NULL,
  plate_number  VARCHAR(50),
  lat           DECIMAL(10,7) NOT NULL,
  lng           DECIMAL(10,7) NOT NULL,
  speed_kmh     DECIMAL(8,2),
  heading       DECIMAL(8,2),
  recorded_at   TIMESTAMP NOT NULL,
  source_payload JSONB DEFAULT '{}'::jsonb,
  created_at    TIMESTAMP DEFAULT NOW(),
  UNIQUE(provider, external_id, recorded_at)
);
CREATE INDEX IF NOT EXISTS idx_gps_vehicle_positions_plate_time
  ON gps_vehicle_positions(plate_number, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_gps_vehicle_positions_provider_time
  ON gps_vehicle_positions(provider, recorded_at DESC);

CREATE TABLE IF NOT EXISTS gps_user_vehicle_assignments (
  id            SERIAL PRIMARY KEY,
  user_id       INTEGER REFERENCES users(id) ON DELETE CASCADE,
  plate_number  VARCHAR(50) NOT NULL,
  active        BOOLEAN DEFAULT true,
  notes         TEXT,
  created_at    TIMESTAMP DEFAULT NOW(),
  updated_at    TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id, plate_number)
);
CREATE INDEX IF NOT EXISTS idx_gps_user_vehicle_assignments_user_active
  ON gps_user_vehicle_assignments(user_id, active);

-- ─── CMR (listy przewozowe — konwencja CMR) ───────────────────────────────────
CREATE SEQUENCE IF NOT EXISTS cmr_numer_seq;

CREATE TABLE IF NOT EXISTS cmr_lists (
  id                      SERIAL PRIMARY KEY,
  numer                   VARCHAR(64) NOT NULL UNIQUE,
  oddzial_id              INTEGER REFERENCES branches(id) ON DELETE SET NULL,
  task_id                 INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
  vehicle_id              INTEGER REFERENCES vehicles(id) ON DELETE SET NULL,
  status                  VARCHAR(30) DEFAULT 'Roboczy',
  nadawca_nazwa           VARCHAR(255),
  nadawca_adres           TEXT,
  nadawca_kraj            VARCHAR(3) DEFAULT 'PL',
  odbiorca_nazwa          VARCHAR(255),
  odbiorca_adres          TEXT,
  odbiorca_kraj           VARCHAR(3) DEFAULT 'PL',
  miejsce_zaladunku       VARCHAR(255),
  miejsce_rozladunku      VARCHAR(255),
  data_zaladunku          DATE,
  data_rozladunku         DATE,
  przewoznik_nazwa        VARCHAR(255),
  przewoznik_adres        TEXT,
  przewoznik_kraj         VARCHAR(3),
  kolejni_przewoznicy     TEXT,
  nr_rejestracyjny        VARCHAR(50),
  nr_naczepy              VARCHAR(50),
  kierowca                VARCHAR(220),
  instrukcje_nadawcy      TEXT,
  uwagi_do_celnych        TEXT,
  umowy_szczegolne        TEXT,
  zalaczniki              TEXT,
  towary                  JSONB NOT NULL DEFAULT '[]'::jsonb,
  platnosci               JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by              INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at              TIMESTAMPTZ DEFAULT NOW(),
  updated_at              TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cmr_lists_task_id ON cmr_lists(task_id);
CREATE INDEX IF NOT EXISTS idx_cmr_lists_oddzial_id ON cmr_lists(oddzial_id);
CREATE INDEX IF NOT EXISTS idx_cmr_lists_created_at ON cmr_lists(created_at DESC);

-- ─── CRM (pipeline leadów, panel /crm) ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS crm_leads (
  id              SERIAL PRIMARY KEY,
  title           TEXT NOT NULL,
  oddzial_id      INTEGER NOT NULL REFERENCES branches(id),
  client_id       INTEGER REFERENCES klienci(id) ON DELETE SET NULL,
  owner_user_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  stage           VARCHAR(32) NOT NULL DEFAULT 'Lead',
  source          VARCHAR(50) NOT NULL DEFAULT 'inne',
  value           NUMERIC(12,2) NOT NULL DEFAULT 0,
  phone           VARCHAR(32),
  email           VARCHAR(255),
  notes           TEXT,
  tags            JSONB NOT NULL DEFAULT '[]'::jsonb,
  next_action_at  TIMESTAMPTZ,
  created_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_crm_leads_oddzial ON crm_leads(oddzial_id);
CREATE INDEX IF NOT EXISTS idx_crm_leads_stage ON crm_leads(stage);

CREATE TABLE IF NOT EXISTS crm_lead_activities (
  id                 SERIAL PRIMARY KEY,
  lead_id            INTEGER NOT NULL REFERENCES crm_leads(id) ON DELETE CASCADE,
  type               VARCHAR(32) NOT NULL,
  text               TEXT NOT NULL,
  due_at             TIMESTAMPTZ,
  call_duration_sec  INTEGER,
  completed_at       TIMESTAMPTZ,
  created_by         INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_crm_lead_activities_lead ON crm_lead_activities(lead_id);

-- ─── Wyceny terenowe (Wyceniający) — quotations / items / approvals / photos ─
CREATE TABLE IF NOT EXISTS quotations (
  id                      SERIAL PRIMARY KEY,
  crm_lead_id             INTEGER REFERENCES crm_leads(id) ON DELETE SET NULL,
  kommo_lead_external_id  VARCHAR(64),
  wyceniajacy_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  oddzial_id              INTEGER NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
  klient_nazwa            VARCHAR(200),
  klient_telefon          VARCHAR(40),
  klient_email            VARCHAR(255),
  adres                   VARCHAR(500),
  miasto                  VARCHAR(100),
  lat                     DOUBLE PRECISION,
  lng                     DOUBLE PRECISION,
  kommo_sales_notes       TEXT,
  status                  VARCHAR(40) NOT NULL DEFAULT 'Draft',
  visit_started_at        TIMESTAMPTZ,
  visit_ended_at          TIMESTAMPTZ,
  visit_start_lat         DOUBLE PRECISION,
  visit_start_lng         DOUBLE PRECISION,
  visit_end_lat           DOUBLE PRECISION,
  visit_end_lng           DOUBLE PRECISION,
  locked_at               TIMESTAMPTZ,
  czas_wizyty_minuty      INTEGER,
  wartosc_sugerowana      NUMERIC(12,2),
  wartosc_zaproponowana   NUMERIC(12,2),
  marza_pct               NUMERIC(6,2),
  korekta_uzasadnienie    TEXT,
  data_zatwierdzenia      TIMESTAMPTZ,
  waznosc_do              TIMESTAMPTZ,
  created_by              INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_quotations_oddzial ON quotations(oddzial_id);
CREATE INDEX IF NOT EXISTS idx_quotations_wyceniajacy ON quotations(wyceniajacy_id);
CREATE INDEX IF NOT EXISTS idx_quotations_status ON quotations(status);
CREATE INDEX IF NOT EXISTS idx_quotations_crm_lead ON quotations(crm_lead_id);

CREATE TABLE IF NOT EXISTS quotation_items (
  id                   SERIAL PRIMARY KEY,
  quotation_id       INTEGER NOT NULL REFERENCES quotations(id) ON DELETE CASCADE,
  kolejnosc            INTEGER NOT NULL DEFAULT 0,
  gatunek              VARCHAR(64),
  wysokosc_pas         VARCHAR(32),
  piersnica_pas        VARCHAR(32),
  typ_pracy            VARCHAR(80),
  warunki_dojazdu      VARCHAR(80),
  przeszkody           JSONB NOT NULL DEFAULT '[]'::jsonb,
  wymagane_uprawnienia JSONB NOT NULL DEFAULT '[]'::jsonb,
  czas_planowany_min   INTEGER,
  wymagany_sprzet      VARCHAR(500),
  koszt_wlasny         NUMERIC(12,2),
  cena_pozycji         NUMERIC(12,2),
  metadata             JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_quotation_items_q ON quotation_items(quotation_id);

CREATE TABLE IF NOT EXISTS quotation_approvals (
  id                       SERIAL PRIMARY KEY,
  quotation_id             INTEGER NOT NULL REFERENCES quotations(id) ON DELETE CASCADE,
  wymagany_typ             VARCHAR(40) NOT NULL,
  zatwierdzajacy_user_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  decyzja                  VARCHAR(20) NOT NULL DEFAULT 'Pending',
  komentarz                TEXT,
  data_decyzji             TIMESTAMPTZ,
  due_at                   TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_quotation_approvals_q ON quotation_approvals(quotation_id);
CREATE INDEX IF NOT EXISTS idx_quotation_approvals_pending ON quotation_approvals(quotation_id) WHERE decyzja = 'Pending';

CREATE TABLE IF NOT EXISTS annotated_photos (
  id                     SERIAL PRIMARY KEY,
  parent_object_type     VARCHAR(32) NOT NULL,
  parent_object_id       INTEGER NOT NULL,
  original_url           TEXT NOT NULL,
  annotated_preview_url  TEXT,
  annotations_json       JSONB NOT NULL DEFAULT '{}'::jsonb,
  lat                    DOUBLE PRECISION,
  lng                    DOUBLE PRECISION,
  photo_timestamp        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  autor_user_id          INTEGER REFERENCES users(id) ON DELETE SET NULL,
  autor_typ              VARCHAR(24),
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_annotated_photos_parent ON annotated_photos(parent_object_type, parent_object_id);

-- ─── M1 Wycena u klienta — rozszerzenia (idempotentne ALTER) ─────────────────
ALTER TABLE quotations ALTER COLUMN wyceniajacy_id DROP NOT NULL;
ALTER TABLE quotations ADD COLUMN IF NOT EXISTS priorytet VARCHAR(30) NOT NULL DEFAULT 'Normalny';
ALTER TABLE quotations ADD COLUMN IF NOT EXISTS geocode_status VARCHAR(32);
ALTER TABLE quotations ADD COLUMN IF NOT EXISTS wartosc_szacunkowa_lead NUMERIC(12,2);
ALTER TABLE quotations ADD COLUMN IF NOT EXISTS data_wizyty_planowana TIMESTAMPTZ;
ALTER TABLE quotations ADD COLUMN IF NOT EXISTS flag_pomnikowe BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE quotations ADD COLUMN IF NOT EXISTS flag_reklamacja_vip BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE quotations ADD COLUMN IF NOT EXISTS klient_czeka_na_miejscu BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE quotations ADD COLUMN IF NOT EXISTS visit_gps_override_note TEXT;
ALTER TABLE quotations ADD COLUMN IF NOT EXISTS visit_gps_override_at TIMESTAMPTZ;
ALTER TABLE quotations ADD COLUMN IF NOT EXISTS korekta_dropdown VARCHAR(80);
ALTER TABLE quotations ADD COLUMN IF NOT EXISTS koszt_wlasny_calkowity NUMERIC(12,2);
ALTER TABLE quotations ADD COLUMN IF NOT EXISTS client_acceptance_token VARCHAR(64);
ALTER TABLE quotations ADD COLUMN IF NOT EXISTS pdf_url TEXT;
ALTER TABLE quotations ADD COLUMN IF NOT EXISTS wyslano_klientowi_at TIMESTAMPTZ;
ALTER TABLE quotations ADD COLUMN IF NOT EXISTS klient_akceptacja_at TIMESTAMPTZ;
ALTER TABLE quotations ADD COLUMN IF NOT EXISTS klient_akceptacja_ip VARCHAR(64);
ALTER TABLE quotations ADD COLUMN IF NOT EXISTS reopened_at TIMESTAMPTZ;
ALTER TABLE quotations ADD COLUMN IF NOT EXISTS reopened_note TEXT;
ALTER TABLE quotations ADD COLUMN IF NOT EXISTS reopened_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_quotations_accept_token ON quotations(client_acceptance_token) WHERE client_acceptance_token IS NOT NULL;

ALTER TABLE branches ADD COLUMN IF NOT EXISTS lat DOUBLE PRECISION;
ALTER TABLE branches ADD COLUMN IF NOT EXISTS lng DOUBLE PRECISION;
ALTER TABLE branches ADD COLUMN IF NOT EXISTS marza_domyslna_pct NUMERIC(5,2) NOT NULL DEFAULT 35;
ALTER TABLE branches ADD COLUMN IF NOT EXISTS marza_prog_korekty_pct NUMERIC(5,2) NOT NULL DEFAULT 30;
ALTER TABLE branches ADD COLUMN IF NOT EXISTS marza_prog_rentowosci_pct NUMERIC(5,2) NOT NULL DEFAULT 15;
ALTER TABLE branches ADD COLUMN IF NOT EXISTS stawka_roboczogodzina_pln NUMERIC(10,2) NOT NULL DEFAULT 85;
ALTER TABLE branches ADD COLUMN IF NOT EXISTS stawka_motogodzina_pln NUMERIC(10,2) NOT NULL DEFAULT 120;
ALTER TABLE branches ADD COLUMN IF NOT EXISTS stawka_dojazd_km_pln NUMERIC(10,2) NOT NULL DEFAULT 3.5;
ALTER TABLE branches ADD COLUMN IF NOT EXISTS utylizacja_m3_pln NUMERIC(10,2) NOT NULL DEFAULT 80;

ALTER TABLE annotated_photos ADD COLUMN IF NOT EXISTS photo_kind VARCHAR(24) NOT NULL DEFAULT 'general';
ALTER TABLE annotated_photos ADD COLUMN IF NOT EXISTS rendered_png_url TEXT;

ALTER TABLE quotation_approvals ADD COLUMN IF NOT EXISTS sla_reminder_sent_at TIMESTAMPTZ;
ALTER TABLE quotation_approvals ADD COLUMN IF NOT EXISTS escalated_at TIMESTAMPTZ;

ALTER TABLE notifications ADD COLUMN IF NOT EXISTS quotation_id INTEGER REFERENCES quotations(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_notifications_quotation ON notifications(quotation_id);

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS source_quotation_id INTEGER REFERENCES quotations(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_source_quotation_unique ON tasks(source_quotation_id) WHERE source_quotation_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS quotation_service_norms (
  id               SERIAL PRIMARY KEY,
  gatunek_key      VARCHAR(32) NOT NULL,
  wysokosc_pas     VARCHAR(32) NOT NULL,
  typ_pracy_key    VARCHAR(64) NOT NULL,
  czas_min_bazowy  INTEGER NOT NULL DEFAULT 60,
  sprzet_hint      VARCHAR(200),
  motogodziny      NUMERIC(6,2) NOT NULL DEFAULT 0.25,
  valid_from       DATE NOT NULL DEFAULT CURRENT_DATE,
  valid_to         DATE
);
CREATE INDEX IF NOT EXISTS idx_quotation_norms_lookup ON quotation_service_norms(gatunek_key, wysokosc_pas, typ_pracy_key);

INSERT INTO quotation_service_norms (gatunek_key, wysokosc_pas, typ_pracy_key, czas_min_bazowy, sprzet_hint, motogodziny)
SELECT v.gatunek_key, v.wysokosc_pas, v.typ_pracy_key, v.czas_min_bazowy, v.sprzet_hint, v.motogodziny
FROM (
  VALUES
    ('topola'::varchar(32), '15-20'::varchar(32), 'wycinka pełna'::varchar(64), 180, 'Podnośnik 20 m + rębak'::varchar(200), 0.5::numeric),
    ('topola', '10-15', 'wycinka pełna', 120, 'Podnośnik 20 m', 0.35),
    ('dąb', '15-20', 'wycinka pełna', 240, 'Podnośnik + rębak', 0.5),
    ('dąb', '5-10', 'redukcja korony', 90, 'Alpin + rębak', 0.2),
    ('brzoza', '5-10', 'wycinka pełna', 75, 'Rębak', 0.2),
    ('świerk', '10-15', 'wycinka pełna', 150, 'Podnośnik', 0.4),
    ('inne', '5-10', 'podkrzesanie', 45, 'Rębak', 0.1),
    ('inne', '20+', 'wycinka pełna', 300, 'Podnośnik 20 m + alpin', 0.6)
) AS v(gatunek_key, wysokosc_pas, typ_pracy_key, czas_min_bazowy, sprzet_hint, motogodziny)
WHERE NOT EXISTS (
  SELECT 1 FROM quotation_service_norms n
  WHERE n.gatunek_key = v.gatunek_key AND n.wysokosc_pas = v.wysokosc_pas AND n.typ_pracy_key = v.typ_pracy_key
);

-- ─── M3 F3.9 / F3.10 + M11 Rozliczenia i wynagrodzenia (szkielet) ─────────────
CREATE TABLE IF NOT EXISTS task_client_payments (
  task_id            INTEGER PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
  forma_platnosc     VARCHAR(32) NOT NULL,
  kwota_odebrana     NUMERIC(12,2),
  faktura_vat        BOOLEAN NOT NULL DEFAULT false,
  nip                VARCHAR(20),
  notatki            TEXT,
  recorded_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  recorded_by        INTEGER REFERENCES users(id) ON DELETE SET NULL
);

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS wartosc_netto_do_rozliczenia NUMERIC(12,2);

CREATE TABLE IF NOT EXISTS task_extra_work (
  id                   SERIAL PRIMARY KEY,
  task_id              INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  created_by           INTEGER REFERENCES users(id) ON DELETE SET NULL,
  opis                 TEXT NOT NULL,
  status               VARCHAR(32) NOT NULL DEFAULT 'OczekujeWyceny',
  amount_pln           NUMERIC(12,2),
  quoted_by            INTEGER REFERENCES users(id) ON DELETE SET NULL,
  quoted_at            TIMESTAMPTZ,
  accepted_at          TIMESTAMPTZ,
  acceptance_channel   VARCHAR(24),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_task_extra_work_task ON task_extra_work(task_id);

ALTER TABLE photos ADD COLUMN IF NOT EXISTS extra_work_id INTEGER REFERENCES task_extra_work(id) ON DELETE SET NULL;

-- ═══ F0.1 — M11: nazewnictwo spec / dokumentacja ↔ tabele w tym repo (ARBOR-OS) ═══
-- Stawki godzinowe pracownika (historia wersji, mnożniki weekend/noc/święto):
--   repo: user_payroll_rates   |  często w spec: „employee_rates”, „stawki_pracownika”, „payroll_rates”
-- Raport dnia ekipy (jeden wiersz na team_id + data), linie rozliczenia użytkowników:
--   repo: payroll_team_day_reports, payroll_team_day_report_lines
--   |  spec: „team_day_report”, „dniówka_ekipy”, „daily_crew_report”
-- Kasa zadeklarowana przez ekipę / odbiór w oddziale:
--   repo: branch_cash_pickups  |  spec: „cash_pickup”, „kasa_oddzialu”
-- Naliczenia miesięczne wyceniającego (prowizja + extra work):
--   repo: estimator_month_accrual  |  spec: „estimator_accrual”, „naliczenie_wyceniajacego”
-- Audyt ręcznych korekt linii raportu dnia:
--   repo: payroll_line_correction_log
-- Log matrycy płatności przy finish zlecenia (F11.3):
--   repo: task_calc_log
-- Tokeny push Expo (F11.8):
--   repo: user_expo_push_tokens
-- Snapshot linii przy eksporcie miesiąca (CSV/ZIP — F11.2):
--   repo: daily_payroll  |  spec: „snapshot eksportu”, „kopia dzienna wypłat z raportów”
-- Zużycie przy finish zlecenia (F3.7):
--   repo: task_finish_material_usage
-- API (web/mobile): prefix /api/payroll/* ; cron kasa: GET /api/ops/payroll-cash-reminder-tick

CREATE TABLE IF NOT EXISTS user_payroll_rates (
  id                    SERIAL PRIMARY KEY,
  user_id               INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  effective_from        DATE NOT NULL DEFAULT CURRENT_DATE,
  rate_pln_per_hour     NUMERIC(10,2) NOT NULL,
  role_scope            VARCHAR(24) NOT NULL DEFAULT 'pomocnik',
  weekend_multiplier    NUMERIC(6,3) NOT NULL DEFAULT 1.25,
  night_multiplier      NUMERIC(6,3) NOT NULL DEFAULT 1.15,
  holiday_multiplier    NUMERIC(6,3) NOT NULL DEFAULT 1.5,
  alpine_addon_pln      NUMERIC(10,2) NOT NULL DEFAULT 0,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by            INTEGER REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_user_payroll_rates_user_from ON user_payroll_rates(user_id, effective_from DESC);

CREATE TABLE IF NOT EXISTS payroll_team_day_reports (
  id              SERIAL PRIMARY KEY,
  team_id         INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  oddzial_id      INTEGER REFERENCES branches(id) ON DELETE SET NULL,
  report_date     DATE NOT NULL,
  payload_json    JSONB NOT NULL DEFAULT '{}'::jsonb,
  first_closed_at TIMESTAMPTZ,
  approved_at     TIMESTAMPTZ,
  approved_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(team_id, report_date)
);
CREATE INDEX IF NOT EXISTS idx_payroll_team_day_reports_date ON payroll_team_day_reports(report_date);

CREATE TABLE IF NOT EXISTS payroll_team_day_report_lines (
  id           SERIAL PRIMARY KEY,
  report_id    INTEGER NOT NULL REFERENCES payroll_team_day_reports(id) ON DELETE CASCADE,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  hours_total  NUMERIC(8,2) NOT NULL DEFAULT 0,
  pay_pln      NUMERIC(12,2) NOT NULL DEFAULT 0,
  detail_json  JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_payroll_report_lines_report ON payroll_team_day_report_lines(report_id);

CREATE TABLE IF NOT EXISTS branch_cash_pickups (
  id              SERIAL PRIMARY KEY,
  oddzial_id      INTEGER NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  team_id         INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  pickup_date     DATE NOT NULL,
  declared_cash   NUMERIC(12,2) NOT NULL DEFAULT 0,
  received_at     TIMESTAMPTZ,
  received_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  cash_reminder_48h_sent_at TIMESTAMPTZ,
  cash_reminder_7d_sent_at TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(team_id, pickup_date)
);

CREATE TABLE IF NOT EXISTS estimator_month_accrual (
  id                 SERIAL PRIMARY KEY,
  wyceniajacy_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  accrual_month      DATE NOT NULL,
  commission_base    NUMERIC(14,2) NOT NULL DEFAULT 0,
  extra_work_pln     NUMERIC(14,2) NOT NULL DEFAULT 0,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(wyceniajacy_id, accrual_month)
);

-- F11.3 — log wyliczenia netto do rozliczeń (audyt matrycy)
CREATE TABLE IF NOT EXISTS task_calc_log (
  id               SERIAL PRIMARY KEY,
  task_id          INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  gross            NUMERIC(14,2) NOT NULL DEFAULT 0,
  forma_platnosc   VARCHAR(32),
  net_result       NUMERIC(14,2) NOT NULL DEFAULT 0,
  detail_json      JSONB NOT NULL DEFAULT '{}'::jsonb,
  recorded_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  recorded_by      INTEGER REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_task_calc_log_task ON task_calc_log(task_id, recorded_at DESC);

-- F11.4 — pierwsze zamknięcie dnia (opcjonalne okno korekt: PAYROLL_TEAM_DAY_CORRECTION_HOURS)
ALTER TABLE payroll_team_day_reports ADD COLUMN IF NOT EXISTS first_closed_at TIMESTAMPTZ;
UPDATE payroll_team_day_reports SET first_closed_at = created_at WHERE first_closed_at IS NULL;

-- F11.5 — przypomnienia o nieodebranej kasie (tick GET /api/ops/payroll-cash-reminder-tick)
ALTER TABLE branch_cash_pickups ADD COLUMN IF NOT EXISTS cash_reminder_48h_sent_at TIMESTAMPTZ;
ALTER TABLE branch_cash_pickups ADD COLUMN IF NOT EXISTS cash_reminder_7d_sent_at TIMESTAMPTZ;

-- F11.4 — audyt ręcznych korekt linii raportu dnia (PATCH /payroll/team-day-report/.../lines/...)
CREATE TABLE IF NOT EXISTS payroll_line_correction_log (
  id                SERIAL PRIMARY KEY,
  line_id           INTEGER REFERENCES payroll_team_day_report_lines(id) ON DELETE SET NULL,
  report_id         INTEGER NOT NULL REFERENCES payroll_team_day_reports(id) ON DELETE CASCADE,
  target_user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  edited_by         INTEGER NOT NULL REFERENCES users(id) ON DELETE SET NULL,
  prev_pay_pln      NUMERIC(12,2),
  prev_hours_total  NUMERIC(8,2),
  new_pay_pln       NUMERIC(12,2) NOT NULL,
  new_hours_total   NUMERIC(8,2) NOT NULL,
  correction_note   TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_payroll_line_corr_report ON payroll_line_correction_log(report_id);
CREATE INDEX IF NOT EXISTS idx_payroll_line_corr_line ON payroll_line_correction_log(line_id);

-- F11.2 — snapshot linii eksportu miesiąca (audyt: kto, kiedy, jakie kwoty poszły do pliku CSV/ZIP)
CREATE TABLE IF NOT EXISTS daily_payroll (
  id               BIGSERIAL PRIMARY KEY,
  payroll_month    DATE NOT NULL,
  snapshot_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  export_batch_id  UUID NOT NULL,
  export_kind      VARCHAR(8) NOT NULL CHECK (export_kind IN ('csv', 'zip')),
  exported_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  report_date      DATE NOT NULL,
  team_id          INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  hours_total      NUMERIC(12, 4) NOT NULL DEFAULT 0,
  pay_pln          NUMERIC(14, 2) NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_daily_payroll_month ON daily_payroll (payroll_month DESC, snapshot_at DESC);
CREATE INDEX IF NOT EXISTS idx_daily_payroll_user_month ON daily_payroll (user_id, payroll_month);
CREATE INDEX IF NOT EXISTS idx_daily_payroll_batch ON daily_payroll (export_batch_id);

-- F11.8 — tokeny Expo Push (rejestracja z mobile; jeden token = jedno urządzenie, przy logowaniu innego użytkownika nadpisuje user_id)
CREATE TABLE IF NOT EXISTS user_expo_push_tokens (
  id           SERIAL PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expo_token   TEXT NOT NULL,
  platform     VARCHAR(16),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(expo_token)
);
CREATE INDEX IF NOT EXISTS idx_expo_push_user ON user_expo_push_tokens(user_id);

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