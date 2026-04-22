-- ============================================================
-- ARBOR-OS: Wyceny v2 — uruchom w pgAdmin
-- ============================================================

-- 1. Dodaj rolę Wyceniający do systemu (jeśli używasz enum)
-- ALTER TYPE rola_uzytkownika ADD VALUE IF NOT EXISTS 'Wyceniający';

-- 2. Nowe kolumny w tabeli wyceny
ALTER TABLE wyceny
  ADD COLUMN IF NOT EXISTS oddzial_id       INTEGER REFERENCES oddzialy(id),
  ADD COLUMN IF NOT EXISTS pozycje          JSONB    DEFAULT '[]',   -- [{opis,kwota}]
  ADD COLUMN IF NOT EXISTS wywoz            BOOLEAN  DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS usuwanie_pni     BOOLEAN  DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS czas_realizacji  VARCHAR(20),             -- np. "1.5h"
  ADD COLUMN IF NOT EXISTS ilosc_osob       INTEGER  DEFAULT 1,
  ADD COLUMN IF NOT EXISTS wynik            VARCHAR(30) DEFAULT 'oczekuje',
  -- wynik: oczekuje | oddzwoni | zaakceptowane | odrzucone
  ADD COLUMN IF NOT EXISTS budzet           DECIMAL(10,2),
  ADD COLUMN IF NOT EXISTS rabat            DECIMAL(5,2)  DEFAULT 0,
  ADD COLUMN IF NOT EXISTS kwota_minimalna  DECIMAL(10,2),
  ADD COLUMN IF NOT EXISTS rebak            BOOLEAN  DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS pila_wysiegniku  BOOLEAN  DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS nozyce_dlugie    BOOLEAN  DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS kosiarka         BOOLEAN  DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS podkaszarka      BOOLEAN  DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS lopata           BOOLEAN  DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS mulczer          BOOLEAN  DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS arborysta        BOOLEAN  DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS zrebki           INTEGER  DEFAULT 0,
  ADD COLUMN IF NOT EXISTS drewno           BOOLEAN  DEFAULT FALSE;

-- 3. Indeks na oddzial_id dla szybszego filtrowania
CREATE INDEX IF NOT EXISTS idx_wyceny_oddzial ON wyceny(oddzial_id);
CREATE INDEX IF NOT EXISTS idx_wyceny_autor   ON wyceny(autor_id);
CREATE INDEX IF NOT EXISTS idx_wyceny_wynik   ON wyceny(wynik);
