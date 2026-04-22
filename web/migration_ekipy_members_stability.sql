-- Stabilizacja relacji członków ekip
-- Uruchom na bazie backendu (PostgreSQL)

BEGIN;

-- 1) Czyścimy duplikaty (zostawiamy najstarszy wpis)
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (PARTITION BY team_id, user_id ORDER BY id ASC) AS rn
  FROM team_members
)
DELETE FROM team_members tm
USING ranked r
WHERE tm.id = r.id
  AND r.rn > 1;

-- 2) Wymuszamy spójność danych
ALTER TABLE team_members
  ALTER COLUMN team_id SET NOT NULL,
  ALTER COLUMN user_id SET NOT NULL;

-- 3) Unikalność członka w ekipie
CREATE UNIQUE INDEX IF NOT EXISTS ux_team_members_team_user
  ON team_members(team_id, user_id);

-- 4) Indeksy pomocnicze
CREATE INDEX IF NOT EXISTS ix_team_members_team_id
  ON team_members(team_id);

CREATE INDEX IF NOT EXISTS ix_team_members_user_id
  ON team_members(user_id);

COMMIT;
