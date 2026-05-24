const { HOLD_TTL_HOURS } = require('./taskScheduling');

function toId(value) {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function resourceDay(value) {
  const fallback = new Date().toISOString().slice(0, 10);
  if (!value) return fallback;
  const s = String(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : fallback;
}

function normalizeRole(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function isEstimatorRole(value) {
  return normalizeRole(value).startsWith('wyceniaj');
}

let delegationSchemaReady = false;

async function ensureDelegationResourceSchema(pool) {
  if (delegationSchemaReady) return;
  const statements = [
    `CREATE TABLE IF NOT EXISTS delegacje (
      id SERIAL PRIMARY KEY,
      zasob_typ VARCHAR(30) DEFAULT 'ekipa',
      ekipa_id INTEGER REFERENCES teams(id) ON DELETE SET NULL,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      wyceniajacy_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      oddzial_z INTEGER REFERENCES branches(id) ON DELETE SET NULL,
      oddzial_do INTEGER REFERENCES branches(id) ON DELETE SET NULL,
      data_od DATE NOT NULL DEFAULT CURRENT_DATE,
      data_do DATE,
      cel VARCHAR(500),
      uwagi TEXT,
      dodal_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      status VARCHAR(50) DEFAULT 'Planowana',
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )`,
    'ALTER TABLE delegacje ADD COLUMN IF NOT EXISTS zasob_typ VARCHAR(30) DEFAULT \'ekipa\'',
    'ALTER TABLE delegacje ADD COLUMN IF NOT EXISTS ekipa_id INTEGER REFERENCES teams(id) ON DELETE SET NULL',
    'ALTER TABLE delegacje ALTER COLUMN ekipa_id DROP NOT NULL',
    'ALTER TABLE delegacje ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id) ON DELETE SET NULL',
    'ALTER TABLE delegacje ADD COLUMN IF NOT EXISTS wyceniajacy_id INTEGER REFERENCES users(id) ON DELETE SET NULL',
    'ALTER TABLE delegacje ADD COLUMN IF NOT EXISTS oddzial_z INTEGER REFERENCES branches(id) ON DELETE SET NULL',
    'ALTER TABLE delegacje ADD COLUMN IF NOT EXISTS oddzial_do INTEGER REFERENCES branches(id) ON DELETE SET NULL',
    'ALTER TABLE delegacje ADD COLUMN IF NOT EXISTS data_od DATE DEFAULT CURRENT_DATE',
    'ALTER TABLE delegacje ADD COLUMN IF NOT EXISTS data_do DATE',
    'ALTER TABLE delegacje ADD COLUMN IF NOT EXISTS cel VARCHAR(500)',
    'ALTER TABLE delegacje ADD COLUMN IF NOT EXISTS uwagi TEXT',
    'ALTER TABLE delegacje ADD COLUMN IF NOT EXISTS dodal_id INTEGER REFERENCES users(id) ON DELETE SET NULL',
    'ALTER TABLE delegacje ADD COLUMN IF NOT EXISTS status VARCHAR(50) DEFAULT \'Planowana\'',
    'ALTER TABLE delegacje ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW()',
    'ALTER TABLE delegacje ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW()',
    'CREATE INDEX IF NOT EXISTS idx_delegacje_ekipa ON delegacje(ekipa_id, oddzial_do)',
    'CREATE INDEX IF NOT EXISTS idx_delegacje_user ON delegacje(user_id, oddzial_do)',
    'CREATE INDEX IF NOT EXISTS idx_delegacje_wyceniajacy ON delegacje(wyceniajacy_id, oddzial_do)',
    'CREATE INDEX IF NOT EXISTS idx_delegacje_oddzialy ON delegacje(oddzial_z, oddzial_do)',
  ];
  for (const sql of statements) {
    await pool.query(sql);
  }
  delegationSchemaReady = true;
}

function activeDelegationPredicate(dateParam = '$2') {
  return `
  LOWER(COALESCE(d.status, 'planowana')) NOT LIKE 'anul%'
  AND LOWER(COALESCE(d.status, 'planowana')) NOT LIKE 'zako%'
  AND (d.data_od IS NULL OR NULLIF(d.data_od::text, '')::date <= ${dateParam}::date)
  AND (d.data_do IS NULL OR NULLIF(d.data_do::text, '')::date >= ${dateParam}::date)
`;
}

async function getBranchResources(pool, branchIdValue, dateValue) {
  await ensureDelegationResourceSchema(pool);
  const branchId = toId(branchIdValue);
  if (!branchId) {
    return { oddzial_id: null, date: resourceDay(dateValue), ekipy: [], wyceniajacy: [] };
  }
  const day = resourceDay(dateValue);
  const teamSql = `
    WITH active_team_delegations AS (
      SELECT DISTINCT ON (d.ekipa_id)
        d.id, d.ekipa_id, d.oddzial_z, d.oddzial_do, d.data_od, d.data_do, d.status, d.cel
      FROM delegacje d
      WHERE d.ekipa_id IS NOT NULL
        AND d.oddzial_do = $1
        AND ${activeDelegationPredicate('$2')}
      ORDER BY d.ekipa_id, d.data_od DESC NULLS LAST, d.id DESC
    ),
    planned_task_load AS (
      SELECT
        ekipa_id,
        COUNT(*)::int AS task_count,
        COALESCE(SUM(GREATEST(0.25, COALESCE(czas_planowany_godziny, 2)) * 60), 0)::int AS task_minutes
      FROM tasks
      WHERE ekipa_id IS NOT NULL
        AND data_planowana::date = $2::date
        AND COALESCE(status::text, '') NOT IN ('Zakonczone', 'Anulowane')
      GROUP BY ekipa_id
    ),
    held_quote_load AS (
      SELECT
        COALESCE(proponowana_ekipa_id, ekipa_id) AS ekipa_id,
        COUNT(*)::int AS hold_count,
        COALESCE(SUM(GREATEST(0.25, COALESCE(czas_planowany_godziny, 2)) * 60), 0)::int AS hold_minutes
      FROM wyceny
      WHERE COALESCE(proponowana_ekipa_id, ekipa_id) IS NOT NULL
        AND COALESCE(proponowana_data, data_wykonania) = $2::date
        AND (
          status_akceptacji IN ('do_specjalisty', 'zatwierdzono')
          OR (
            status_akceptacji = 'rezerwacja_wstepna'
            AND COALESCE(rezerwacja_wygasa_at, proponowana_at + INTERVAL '${HOLD_TTL_HOURS} hours') >= NOW()
          )
        )
      GROUP BY COALESCE(proponowana_ekipa_id, ekipa_id)
    )
    SELECT
      t.*,
      u.imie as brygadzista_imie,
      u.nazwisko as brygadzista_nazwisko,
      u.telefon as brygadzista_telefon,
      u.procent_wynagrodzenia,
      b.nazwa as oddzial_nazwa,
      t.oddzial_id as oddzial_macierzysty_id,
      b.nazwa as oddzial_macierzysty_nazwa,
      $1::int as dostepny_w_oddziale_id,
      target.nazwa as dostepny_w_oddziale_nazwa,
      COUNT(DISTINCT tm.user_id)::int as liczba_czlonkow,
      (t.oddzial_id = $1) as natywny_oddzial,
      (ad.id IS NOT NULL AND t.oddzial_id <> $1) as delegowany,
      ad.id as delegacja_id,
      ad.oddzial_z as delegacja_oddzial_z,
      bo.nazwa as delegacja_oddzial_z_nazwa,
      ad.data_od as delegacja_data_od,
      ad.data_do as delegacja_data_do,
      ad.status as delegacja_status,
      ad.cel as delegacja_cel,
      COALESCE(pt.task_count, 0)::int as zlecenia_dzien,
      COALESCE(hq.hold_count, 0)::int as rezerwacje_wstepne_dzien,
      (COALESCE(pt.task_minutes, 0) + COALESCE(hq.hold_minutes, 0))::int as zajete_minuty_dzien,
      GREATEST(0, 480 - (COALESCE(pt.task_minutes, 0) + COALESCE(hq.hold_minutes, 0)))::int as wolne_minuty_dzien,
      ROUND(((COALESCE(pt.task_minutes, 0) + COALESCE(hq.hold_minutes, 0)) / 60.0)::numeric, 2)::float as planowane_godziny_dzien,
      LEAST(100, ROUND(((COALESCE(pt.task_minutes, 0) + COALESCE(hq.hold_minutes, 0)) / 480.0 * 100)::numeric))::int as obciazenie_proc_dzien,
      CASE
        WHEN (COALESCE(pt.task_minutes, 0) + COALESCE(hq.hold_minutes, 0)) >= 480 THEN 'pelna'
        WHEN (COALESCE(pt.task_minutes, 0) + COALESCE(hq.hold_minutes, 0)) >= 360 THEN 'duze'
        WHEN (COALESCE(pt.task_minutes, 0) + COALESCE(hq.hold_minutes, 0)) > 0 THEN 'czesciowa'
        ELSE 'wolna'
      END as dostepnosc_dzien
    FROM teams t
    LEFT JOIN active_team_delegations ad ON ad.ekipa_id = t.id
    LEFT JOIN users u ON t.brygadzista_id = u.id
    LEFT JOIN branches b ON t.oddzial_id = b.id
    LEFT JOIN branches target ON target.id = $1
    LEFT JOIN branches bo ON ad.oddzial_z = bo.id
    LEFT JOIN team_members tm ON tm.team_id = t.id
    LEFT JOIN planned_task_load pt ON pt.ekipa_id = t.id
    LEFT JOIN held_quote_load hq ON hq.ekipa_id = t.id
    WHERE COALESCE(t.aktywny, true) = true
      AND (t.oddzial_id = $1 OR ad.id IS NOT NULL)
    GROUP BY t.id, u.imie, u.nazwisko, u.telefon, u.procent_wynagrodzenia, b.nazwa, target.nazwa,
      ad.id, ad.oddzial_z, bo.nazwa, ad.data_od, ad.data_do, ad.status, ad.cel,
      pt.task_count, pt.task_minutes, hq.hold_count, hq.hold_minutes
    ORDER BY obciazenie_proc_dzien ASC, delegowany ASC, t.nazwa ASC`;

  const estimatorSql = `
    WITH active_user_delegations AS (
      SELECT DISTINCT ON (COALESCE(d.user_id, d.wyceniajacy_id))
        d.id,
        COALESCE(d.user_id, d.wyceniajacy_id) as delegate_user_id,
        d.oddzial_z,
        d.oddzial_do,
        d.data_od,
        d.data_do,
        d.status,
        d.cel
      FROM delegacje d
      WHERE COALESCE(d.user_id, d.wyceniajacy_id) IS NOT NULL
        AND d.oddzial_do = $1
        AND ${activeDelegationPredicate('$2')}
      ORDER BY COALESCE(d.user_id, d.wyceniajacy_id), d.data_od DESC NULLS LAST, d.id DESC
    )
    SELECT
      u.id, u.login, u.imie, u.nazwisko, u.email, u.telefon, u.rola, u.oddzial_id, u.aktywny,
      b.nazwa as oddzial_nazwa,
      u.oddzial_id as oddzial_macierzysty_id,
      b.nazwa as oddzial_macierzysty_nazwa,
      $1::int as dostepny_w_oddziale_id,
      target.nazwa as dostepny_w_oddziale_nazwa,
      (u.oddzial_id = $1) as natywny_oddzial,
      (ad.id IS NOT NULL AND u.oddzial_id <> $1) as delegowany,
      ad.id as delegacja_id,
      ad.oddzial_z as delegacja_oddzial_z,
      bo.nazwa as delegacja_oddzial_z_nazwa,
      ad.data_od as delegacja_data_od,
      ad.data_do as delegacja_data_do,
      ad.status as delegacja_status,
      ad.cel as delegacja_cel
    FROM users u
    LEFT JOIN active_user_delegations ad ON ad.delegate_user_id = u.id
    LEFT JOIN branches b ON u.oddzial_id = b.id
    LEFT JOIN branches target ON target.id = $1
    LEFT JOIN branches bo ON ad.oddzial_z = bo.id
    WHERE COALESCE(u.aktywny, true) = true
      AND LOWER(COALESCE(u.rola, '')) LIKE 'wyceniaj%'
      AND (u.oddzial_id = $1 OR ad.id IS NOT NULL)
    ORDER BY delegowany ASC, u.nazwisko ASC, u.imie ASC`;

  const [teamResult, estimatorResult] = await Promise.all([
    pool.query(teamSql, [branchId, day]),
    pool.query(estimatorSql, [branchId, day]),
  ]);

  return {
    oddzial_id: branchId,
    date: day,
    ekipy: teamResult.rows,
    wyceniajacy: estimatorResult.rows,
  };
}

async function assertTeamAvailableForBranch(pool, teamIdValue, branchIdValue, dateValue) {
  await ensureDelegationResourceSchema(pool);
  const teamId = toId(teamIdValue);
  const branchId = toId(branchIdValue);
  if (!teamId || !branchId) return { ok: true };
  const day = resourceDay(dateValue);
  const { rows } = await pool.query(
    `SELECT
       t.id, t.nazwa, t.oddzial_id,
       tb.nazwa as team_branch_name,
       target.nazwa as target_branch_name,
       EXISTS (
         SELECT 1 FROM delegacje d
         WHERE d.ekipa_id = t.id
           AND d.oddzial_do = $2
           AND ${activeDelegationPredicate('$3')}
       ) as has_delegation
     FROM teams t
     LEFT JOIN branches tb ON tb.id = t.oddzial_id
     LEFT JOIN branches target ON target.id = $2
     WHERE t.id = $1`,
    [teamId, branchId, day]
  );
  const row = rows[0];
  if (!row) return { ok: false, status: 400, error: 'Nieprawidlowa ekipa.' };
  if (row.oddzial_id == null) {
    return { ok: false, status: 409, error: `Ekipa ${row.nazwa} nie ma przypisanego oddzialu.` };
  }
  if (Number(row.oddzial_id) === Number(branchId) || row.has_delegation) return { ok: true, row };
  return {
    ok: false,
    status: 409,
    error: `Ekipa ${row.nazwa} nalezy do ${row.team_branch_name || 'innego oddzialu'}. Do ${row.target_branch_name || 'tego oddzialu'} mozna ja przypisac tylko przez aktywna delegacje.`,
  };
}

async function assertEstimatorAvailableForBranch(pool, userIdValue, branchIdValue, dateValue) {
  await ensureDelegationResourceSchema(pool);
  const userId = toId(userIdValue);
  const branchId = toId(branchIdValue);
  if (!userId || !branchId) return { ok: true };
  const day = resourceDay(dateValue);
  const { rows } = await pool.query(
    `SELECT
       u.id, u.imie, u.nazwisko, u.rola, u.oddzial_id,
       ub.nazwa as user_branch_name,
       target.nazwa as target_branch_name,
       EXISTS (
         SELECT 1 FROM delegacje d
         WHERE COALESCE(d.user_id, d.wyceniajacy_id) = u.id
           AND d.oddzial_do = $2
           AND ${activeDelegationPredicate('$3')}
       ) as has_delegation
     FROM users u
     LEFT JOIN branches ub ON ub.id = u.oddzial_id
     LEFT JOIN branches target ON target.id = $2
     WHERE u.id = $1`,
    [userId, branchId, day]
  );
  const row = rows[0];
  if (!row || !isEstimatorRole(row.rola)) {
    return { ok: false, status: 400, error: 'Nieprawidlowy wyceniajacy.' };
  }
  if (row.oddzial_id == null) {
    return { ok: false, status: 409, error: 'Wyceniajacy nie ma przypisanego oddzialu.' };
  }
  if (Number(row.oddzial_id) === Number(branchId) || row.has_delegation) return { ok: true, row };
  const name = `${row.imie || ''} ${row.nazwisko || ''}`.trim() || `#${row.id}`;
  return {
    ok: false,
    status: 409,
    error: `Wyceniajacy ${name} nalezy do ${row.user_branch_name || 'innego oddzialu'}. Do ${row.target_branch_name || 'tego oddzialu'} mozna go przypisac tylko przez aktywna delegacje.`,
  };
}

module.exports = {
  getBranchResources,
  assertTeamAvailableForBranch,
  assertEstimatorAvailableForBranch,
  ensureDelegationResourceSchema,
  isEstimatorRole,
  resourceDay,
  toId,
};
