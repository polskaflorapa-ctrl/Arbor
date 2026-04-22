-- Uruchom na Postgresie (jednorazowo lub przez migracje).
-- Dostosuj nazwę tabeli zleceń jeśli u Ciebie inna (np. tasks).

-- Kto wycenił zlecenie (po zatwierdzeniu wyceny = created_by rekordu typu wycena)
ALTER TABLE zlecenia ADD COLUMN IF NOT EXISTS wyceniajacy_id INTEGER REFERENCES users (id);

-- Adnotowane zdjęcia (JSON tablica { mime, dataBase64 } lub później same URL-e)
ALTER TABLE zlecenia ADD COLUMN IF NOT EXISTS zdjecia_adnotowane JSONB;

-- Reguły rozliczenia wyceniającego (alternatywa: osobna tabela stawek per oddział)
ALTER TABLE users ADD COLUMN IF NOT EXISTS wynagrodzenie_stawka_dzienna_pln NUMERIC DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS wynagrodzenie_procent_realizacji NUMERIC DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS wynagrodzenie_dodatki_pln NUMERIC DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS wynagrodzenie_dodatki_opis TEXT;

-- Załączniki wideo (ścieżka na dysku lub w S3 — backend zapisuje plik i wstawia wiersz)
CREATE TABLE IF NOT EXISTS wycena_zalaczniki (
  id SERIAL PRIMARY KEY,
  zlecenie_id INTEGER NOT NULL REFERENCES zlecenia (id) ON DELETE CASCADE,
  typ VARCHAR(20) NOT NULL DEFAULT 'video',
  nazwa_pliku TEXT NOT NULL,
  sciezka_relatywna TEXT NOT NULL,
  rozmiar_bajtow BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wycena_zalaczniki_zlecenie ON wycena_zalaczniki (zlecenie_id);
