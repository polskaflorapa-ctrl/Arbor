-- ============================================================
-- MIGRACJA: Wyceny + Auto-Dniówka
-- Uruchom w PostgreSQL: psql -U postgres -d arbor -f migration_wyceny_dniowka.sql
-- ============================================================

-- 1. Dodaj kolumny do tabeli zlecen (tasks)
ALTER TABLE zlecenia ADD COLUMN IF NOT EXISTS typ VARCHAR(20) DEFAULT 'zlecenie';
ALTER TABLE zlecenia ADD COLUMN IF NOT EXISTS status_akceptacji VARCHAR(30) DEFAULT NULL;
ALTER TABLE zlecenia ADD COLUMN IF NOT EXISTS zatwierdzone_przez INTEGER REFERENCES users(id);
ALTER TABLE zlecenia ADD COLUMN IF NOT EXISTS zatwierdzone_at TIMESTAMP;
ALTER TABLE zlecenia ADD COLUMN IF NOT EXISTS wycena_uwagi TEXT;
ALTER TABLE zlecenia ADD COLUMN IF NOT EXISTS wycena_notatki TEXT;
ALTER TABLE zlecenia ADD COLUMN IF NOT EXISTS created_by INTEGER REFERENCES users(id);

-- Indeks dla szybkiego wyszukiwania wycen oczekujacych
CREATE INDEX IF NOT EXISTS idx_zlecenia_typ ON zlecenia(typ);
CREATE INDEX IF NOT EXISTS idx_zlecenia_akceptacja ON zlecenia(status_akceptacji);

-- 2. Tabela auto-dniówek (generowanych automatycznie po zakończeniu zlecenia)
CREATE TABLE IF NOT EXISTS dniowki (
  id SERIAL PRIMARY KEY,
  zlecenie_id INTEGER REFERENCES zlecenia(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  rola VARCHAR(30) NOT NULL,           -- 'Brygadzista' | 'Pomocnik'
  stawka_typ VARCHAR(20) NOT NULL,     -- 'procent' | 'godzinowa'
  stawka_wartosc DECIMAL(8,2) DEFAULT 0,
  godziny DECIMAL(6,2) DEFAULT 0,      -- dla pomocników
  wartosc_zlecenia DECIMAL(10,2) DEFAULT 0,
  kwota DECIMAL(10,2) NOT NULL,
  data_wypracowania DATE NOT NULL,
  zatwierdzona BOOLEAN DEFAULT false,
  zatwierdzona_przez INTEGER REFERENCES users(id),
  zatwierdzona_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dniowki_user ON dniowki(user_id);
CREATE INDEX IF NOT EXISTS idx_dniowki_zlecenie ON dniowki(zlecenie_id);

-- 3. Funkcja auto-dniówki — uruchamiana przez trigger przy zmianie statusu na 'Zakonczone'
CREATE OR REPLACE FUNCTION auto_dniowka()
RETURNS TRIGGER AS $$
DECLARE
  v_ekipa_id INTEGER;
  v_wartosc DECIMAL(10,2);
  v_godziny DECIMAL(6,2);
  v_data DATE;
  v_brygadzista RECORD;
  v_pomocnik RECORD;
BEGIN
  -- Tylko gdy status zmienia się NA 'Zakonczone'
  IF NEW.status = 'Zakonczone' AND OLD.status != 'Zakonczone' THEN
    v_ekipa_id := NEW.ekipa_id;
    v_wartosc  := COALESCE(NEW.wartosc_planowana, 0);
    v_godziny  := COALESCE(NEW.czas_planowany_godziny, 8);
    v_data     := COALESCE(NEW.data_wykonania, CURRENT_DATE);

    IF v_ekipa_id IS NULL THEN
      RETURN NEW;
    END IF;

    -- Usuń stare dniówki dla tego zlecenia (idempotentność)
    DELETE FROM dniowki WHERE zlecenie_id = NEW.id;

    -- Brygadzista ekipy
    SELECT u.id, u.procent_wynagrodzenia, u.imie, u.nazwisko
      INTO v_brygadzista
      FROM teams t
      JOIN users u ON u.id = t.brygadzista_id
     WHERE t.id = v_ekipa_id
     LIMIT 1;

    IF v_brygadzista.id IS NOT NULL AND v_wartosc > 0 THEN
      INSERT INTO dniowki (
        zlecenie_id, user_id, rola, stawka_typ, stawka_wartosc,
        wartosc_zlecenia, kwota, data_wypracowania
      ) VALUES (
        NEW.id,
        v_brygadzista.id,
        'Brygadzista',
        'procent',
        COALESCE(v_brygadzista.procent_wynagrodzenia, 15),
        v_wartosc,
        ROUND(v_wartosc * COALESCE(v_brygadzista.procent_wynagrodzenia, 15) / 100, 2),
        v_data
      );
    END IF;

    -- Pomocnicy ekipy (wszyscy użytkownicy w ekipie z rolą Pomocnik)
    FOR v_pomocnik IN
      SELECT u.id, u.stawka_godzinowa, u.imie, u.nazwisko
        FROM team_members tm
        JOIN users u ON u.id = tm.user_id
       WHERE tm.team_id = v_ekipa_id
         AND u.rola = 'Pomocnik'
    LOOP
      INSERT INTO dniowki (
        zlecenie_id, user_id, rola, stawka_typ, stawka_wartosc,
        godziny, wartosc_zlecenia, kwota, data_wypracowania
      ) VALUES (
        NEW.id,
        v_pomocnik.id,
        'Pomocnik',
        'godzinowa',
        COALESCE(v_pomocnik.stawka_godzinowa, 0),
        v_godziny,
        v_wartosc,
        ROUND(v_godziny * COALESCE(v_pomocnik.stawka_godzinowa, 0), 2),
        v_data
      );
    END LOOP;

  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 4. Podłącz trigger
DROP TRIGGER IF EXISTS trigger_auto_dniowka ON zlecenia;
CREATE TRIGGER trigger_auto_dniowka
  AFTER UPDATE ON zlecenia
  FOR EACH ROW
  EXECUTE FUNCTION auto_dniowka();

-- 5. Sprawdź czy tabela team_members istnieje (może mieć inną nazwę)
-- Jeśli masz inną tabelę łączącą users z teams, zaktualizuj zapytanie w funkcji powyżej.
-- Sprawdź: SELECT table_name FROM information_schema.tables WHERE table_schema='public';

-- ============================================================
-- GOTOWE! Teraz przy każdej zmianie statusu zlecenia na 'Zakonczone'
-- system automatycznie tworzy dniówki dla brygadzisty i pomocników.
-- ============================================================
