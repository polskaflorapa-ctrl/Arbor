/**
 * Dispatch / VRP routes
 *
 * POST /api/dispatch/plan        — run solver, return plan (not saved)
 * POST /api/dispatch/plan/save   — run solver + save to dispatch_plans
 * POST /api/dispatch/apply/:id   — apply saved plan (PUT tasks ekipa_id + status)
 * GET  /api/dispatch/plans       — list saved plans
 * GET  /api/dispatch/plans/:id   — get one plan
 * DELETE /api/dispatch/plans/:id — archive plan
 */

const express = require('express');
const pool = require('../config/database');
const logger = require('../config/logger');
const { authMiddleware, isDyrektorOrAdmin, isKierownik, scopedOddzialId } = require('../middleware/auth');
const { solve } = require('../services/vrp');

const router = express.Router();
router.use(authMiddleware);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function canDispatch(user) {
  return isDyrektorOrAdmin(user) || isKierownik(user);
}

let teamAttendanceTablesReady = false;
async function ensureTeamAttendanceTables(client) {
  if (teamAttendanceTablesReady) return;
  await client.query(`
    CREATE TABLE IF NOT EXISTS team_attendance (
      id SERIAL PRIMARY KEY,
      date_ymd DATE NOT NULL,
      team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      present BOOLEAN NOT NULL DEFAULT true,
      note TEXT,
      actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      actor_name VARCHAR(160),
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await client.query('CREATE UNIQUE INDEX IF NOT EXISTS idx_team_attendance_day_team ON team_attendance(date_ymd, team_id)');
  await client.query('CREATE INDEX IF NOT EXISTS idx_team_attendance_date ON team_attendance(date_ymd)');
  await client.query('CREATE INDEX IF NOT EXISTS idx_team_attendance_team ON team_attendance(team_id)');
  teamAttendanceTablesReady = true;
}

function toDateYmd(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  return String(value || '').slice(0, 10);
}

async function fetchTasksForDate(client, date, oddzialId) {
  const params = [date];
  let where = `t.data_planowana::date = $1
    AND t.status NOT IN ('Zakonczone','Anulowane','W_Realizacji')`;
  if (oddzialId) {
    params.push(oddzialId);
    where += ` AND t.oddzial_id = $${params.length}`;
  }
  const r = await client.query(
    `SELECT t.id, t.numer, t.adres, t.miasto,
            t.klient_nazwa, t.klient_telefon,
            t.pin_lat, t.pin_lng,
            t.priorytet, t.status,
            t.czas_planowany_godziny,
            t.czas_obslugi_min,
            t.okno_od, t.okno_do,
            t.wymagany_sprzet_typ,
            t.wymagane_kompetencje,
            t.ekipa_id
     FROM tasks t
     WHERE ${where}
     ORDER BY t.priorytet ASC NULLS LAST, t.data_planowana ASC`,
    params
  );
  return r.rows.map(row => ({
    ...row,
    // czas_obslugi_min fallback from czas_planowany_godziny
    czas_obslugi_min: row.czas_obslugi_min
      ?? (row.czas_planowany_godziny ? Math.round(row.czas_planowany_godziny * 60) : null),
    pin_lat: row.pin_lat != null ? Number(row.pin_lat) : null,
    pin_lng: row.pin_lng != null ? Number(row.pin_lng) : null,
  }));
}

async function fetchTeamsForDispatch(client, oddzialId, date) {
  await ensureTeamAttendanceTables(client);
  const params = [date];
  let where = 'COALESCE(e.aktywny, true) = true';
  if (oddzialId) {
    params.push(oddzialId);
    where += ` AND e.oddzial_id = $${params.length}`;
  }
  const r = await client.query(
    `SELECT e.id, e.nazwa, e.oddzial_id,
            e.depot_lat, e.depot_lng, e.max_godzin_dzien,
            a.present AS attendance_present,
            a.note AS attendance_note,
            a.actor_name AS attendance_actor,
            COALESCE(
              (SELECT array_agg(DISTINCT ei.typ)
               FROM equipment_items ei
               WHERE ei.ekipa_id = e.id AND ei.status = 'Dostepny'),
              '{}'
            ) AS sprzet_typy,
            COALESCE(
              (SELECT array_agg(DISTINCT uc.nazwa)
               FROM user_competencies uc
               JOIN team_members tm ON tm.user_id = uc.user_id
               WHERE tm.team_id = e.id),
              '{}'
             ) AS kompetencje
     FROM teams e
     LEFT JOIN team_attendance a ON a.team_id = e.id AND a.date_ymd = $1::date
     WHERE ${where}
     ORDER BY e.nazwa`,
    params
  );
  const allTeams = r.rows.map(row => ({
    ...row,
    depot_lat: row.depot_lat != null ? Number(row.depot_lat) : null,
    depot_lng: row.depot_lng != null ? Number(row.depot_lng) : null,
    attendance: {
      present: row.attendance_present === null || row.attendance_present === undefined ? true : row.attendance_present === true,
      note: row.attendance_note || '',
      actor: row.attendance_actor || '',
    },
  }));
  return {
    teams: allTeams.filter(team => team.attendance.present !== false),
    absentTeams: allTeams.filter(team => team.attendance.present === false),
  };
}

async function findAbsentTeamsForPlan(client, teamIds, date) {
  const ids = [...new Set((teamIds || []).map(Number).filter(Boolean))];
  const day = toDateYmd(date);
  if (!ids.length || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return [];
  await ensureTeamAttendanceTables(client);
  const r = await client.query(
    `SELECT e.id AS team_id,
            e.nazwa AS team_name,
            a.note,
            a.actor_name
       FROM teams e
       JOIN team_attendance a ON a.team_id = e.id AND a.date_ymd = $2::date
      WHERE e.id = ANY($1::int[])
        AND a.present = false
      ORDER BY e.nazwa`,
    [ids, day]
  );
  return r.rows.map(row => ({
    team_id: Number(row.team_id),
    team_name: row.team_name || `Ekipa #${row.team_id}`,
    date_ymd: day,
    note: row.note || '',
    actor: row.actor_name || '',
  }));
}

// ─── POST /api/dispatch/plan ──────────────────────────────────────────────────

router.post('/plan', async (req, res) => {
  if (!canDispatch(req.user)) {
    return res.status(403).json({ error: 'Brak uprawnień do planowania tras' });
  }
  const { date, oddzial_id } = req.body;
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: 'Wymagane pole date (YYYY-MM-DD)' });
  }
  const branchId = scopedOddzialId(req.user, oddzial_id ? Number(oddzial_id) : null);

  const client = await pool.connect();
  try {
    const tasks = await fetchTasksForDate(client, date, branchId);
    const { teams, absentTeams } = await fetchTeamsForDispatch(client, branchId, date);

    const result = solve({ tasks, teams, date, oddzial_id: branchId });
    res.json({
      ...result,
      date,
      oddzial_id: branchId,
      team_availability: {
        total: teams.length + absentTeams.length,
        available: teams.length,
        absent: absentTeams.map(team => ({
          team_id: Number(team.id),
          team_name: team.nazwa,
          note: team.attendance.note,
          actor: team.attendance.actor,
        })),
      },
    });
  } catch (err) {
    logger.error('dispatch plan error', { message: err.message, requestId: req.requestId });
    res.status(500).json({ error: 'Błąd solvera: ' + err.message });
  } finally {
    client.release();
  }
});

// ─── POST /api/dispatch/plan/save ────────────────────────────────────────────

router.post('/plan/save', async (req, res) => {
  if (!canDispatch(req.user)) {
    return res.status(403).json({ error: 'Brak uprawnień do planowania tras' });
  }
  const { date, oddzial_id } = req.body;
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: 'Wymagane pole date (YYYY-MM-DD)' });
  }
  const branchId = scopedOddzialId(req.user, oddzial_id ? Number(oddzial_id) : null);

  const client = await pool.connect();
  try {
    const tasks = await fetchTasksForDate(client, date, branchId);
    const { teams, absentTeams } = await fetchTeamsForDispatch(client, branchId, date);

    const result = solve({ tasks, teams, date, oddzial_id: branchId });
    result.team_availability = {
      total: teams.length + absentTeams.length,
      available: teams.length,
      absent: absentTeams.map(team => ({
        team_id: Number(team.id),
        team_name: team.nazwa,
        note: team.attendance.note,
        actor: team.attendance.actor,
      })),
    };

    const saved = await client.query(
      `INSERT INTO dispatch_plans (data, oddzial_id, created_by, solver_ms, plan_json)
       VALUES ($1, $2, $3, $4, $5) RETURNING id, created_at`,
      [date, branchId, req.user.id, result.stats.solver_ms, JSON.stringify(result)]
    );

    await req.auditLog({
      action: 'dispatch.plan_saved',
      entityType: 'dispatch_plan',
      entityId: saved.rows[0].id,
      metadata: { date, oddzial_id: branchId, stats: result.stats },
    });

    res.json({ id: saved.rows[0].id, created_at: saved.rows[0].created_at, ...result });
  } catch (err) {
    logger.error('dispatch save error', { message: err.message, requestId: req.requestId });
    res.status(500).json({ error: 'Błąd zapisu planu: ' + err.message });
  } finally {
    client.release();
  }
});

// ─── POST /api/dispatch/apply/:id ────────────────────────────────────────────

router.post('/apply/:id', async (req, res) => {
  if (!canDispatch(req.user)) {
    return res.status(403).json({ error: 'Brak uprawnień' });
  }
  const planId = Number(req.params.id);
  const client = await pool.connect();
  try {
    const planR = await client.query(
      'SELECT * FROM dispatch_plans WHERE id = $1 AND status != $2',
      [planId, 'archived']
    );
    if (!planR.rows.length) return res.status(404).json({ error: 'Plan nie istnieje' });

    const plan = typeof planR.rows[0].plan_json === 'string'
      ? JSON.parse(planR.rows[0].plan_json)
      : planR.rows[0].plan_json;
    const branchId = planR.rows[0].oddzial_id;

    // Guard: non-directors only see their own branch
    if (!isDyrektorOrAdmin(req.user) && branchId && branchId !== req.user.oddzial_id) {
      return res.status(403).json({ error: 'Brak uprawnień do tego planu' });
    }

    const routeTeamIds = (plan.routes || []).map(route => route.team_id);
    const absentTeams = await findAbsentTeamsForPlan(client, routeTeamIds, planR.rows[0].data);
    if (absentTeams.length) {
      return res.status(409).json({
        error: 'Nie mozna zastosowac planu: co najmniej jedna ekipa jest oznaczona jako nieobecna.',
        code: 'TEAM_ABSENT',
        attendance: {
          dateYmd: absentTeams[0].date_ymd,
          absent: absentTeams,
        },
      });
    }

    await client.query('BEGIN');
    let applied = 0;
    for (const route of plan.routes || []) {
      for (const stop of route.stops || []) {
        await client.query(
          `UPDATE tasks SET ekipa_id = $1, status = 'Zaplanowane', updated_at = NOW()
           WHERE id = $2 AND status NOT IN ('Zakonczone','Anulowane','W_Realizacji')`,
          [route.team_id, stop.task_id]
        );
        applied++;
      }
    }
    await client.query(
      `UPDATE dispatch_plans SET status = 'applied' WHERE id = $1`,
      [planId]
    );
    await client.query('COMMIT');

    await req.auditLog({
      action: 'dispatch.plan_applied',
      entityType: 'dispatch_plan',
      entityId: planId,
      metadata: { tasks_applied: applied, date: planR.rows[0].data },
    });

    res.json({ message: `Plan zastosowany — ${applied} zleceń przypisanych` });
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      logger.warn('dispatch apply rollback failed', { message: rollbackError.message });
    }
    logger.error('dispatch apply error', { message: err.message });
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// ─── GET /api/dispatch/plans ─────────────────────────────────────────────────

router.get('/plans', async (req, res) => {
  if (!canDispatch(req.user)) {
    return res.status(403).json({ error: 'Brak uprawnień' });
  }
  const branchId = scopedOddzialId(req.user, req.query.oddzial_id ? Number(req.query.oddzial_id) : null);
  const params = [];
  let where = "dp.status != 'archived'";
  if (branchId) { params.push(branchId); where += ` AND dp.oddzial_id = $${params.length}`; }
  params.push(Number(req.query.limit) || 20);
  params.push(Number(req.query.offset) || 0);

  const r = await pool.query(
    `SELECT dp.id, dp.data, dp.oddzial_id, dp.status, dp.solver_ms, dp.created_at,
            u.imie || ' ' || u.nazwisko AS created_by_name,
            dp.plan_json->'stats' AS stats
     FROM dispatch_plans dp
     LEFT JOIN users u ON u.id = dp.created_by
     WHERE ${where}
     ORDER BY dp.created_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  res.json(r.rows);
});

// ─── GET /api/dispatch/plans/:id ─────────────────────────────────────────────

router.get('/plans/:id', async (req, res) => {
  if (!canDispatch(req.user)) return res.status(403).json({ error: 'Brak uprawnień' });
  const r = await pool.query('SELECT * FROM dispatch_plans WHERE id = $1', [req.params.id]);
  if (!r.rows.length) return res.status(404).json({ error: 'Plan nie istnieje' });
  const row = r.rows[0];
  if (!isDyrektorOrAdmin(req.user) && row.oddzial_id && row.oddzial_id !== req.user.oddzial_id) {
    return res.status(403).json({ error: 'Brak uprawnień do tego planu' });
  }
  res.json({ ...row, ...row.plan_json });
});

// ─── DELETE /api/dispatch/plans/:id ──────────────────────────────────────────

router.delete('/plans/:id', async (req, res) => {
  if (!isDyrektorOrAdmin(req.user) && !isKierownik(req.user)) {
    return res.status(403).json({ error: 'Brak uprawnień' });
  }
  await pool.query(
    "UPDATE dispatch_plans SET status = 'archived' WHERE id = $1",
    [req.params.id]
  );
  res.json({ message: 'Plan zarchiwizowany' });
});

module.exports = router;
