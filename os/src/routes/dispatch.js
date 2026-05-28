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
const { pushToUser } = require('./notifications');

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

let dispatchRouteBriefTablesReady = false;
async function ensureDispatchRouteBriefTables(client) {
  if (dispatchRouteBriefTablesReady) return;
  await client.query(`
    CREATE TABLE IF NOT EXISTS dispatch_route_briefs (
      id SERIAL PRIMARY KEY,
      date_ymd DATE,
      team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      oddzial_id INTEGER,
      sent_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      brief TEXT NOT NULL,
      task_ids INTEGER[] NOT NULL DEFAULT '{}'::integer[],
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await client.query(`
    CREATE TABLE IF NOT EXISTS dispatch_route_brief_recipients (
      id SERIAL PRIMARY KEY,
      brief_id INTEGER NOT NULL REFERENCES dispatch_route_briefs(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      notification_id INTEGER REFERENCES notifications(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (brief_id, user_id)
    )
  `);
  await client.query('CREATE INDEX IF NOT EXISTS idx_dispatch_route_briefs_day_team ON dispatch_route_briefs(date_ymd, team_id, created_at DESC)');
  await client.query('CREATE INDEX IF NOT EXISTS idx_dispatch_route_briefs_branch_day ON dispatch_route_briefs(oddzial_id, date_ymd)');
  await client.query('CREATE INDEX IF NOT EXISTS idx_dispatch_route_brief_recipients_brief ON dispatch_route_brief_recipients(brief_id)');
  dispatchRouteBriefTablesReady = true;
}

function toDateYmd(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  return String(value || '').slice(0, 10);
}

function parsePositiveInt(value) {
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric > 0 ? numeric : null;
}

function distinctPositiveInts(values) {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.map(parsePositiveInt).filter(Boolean))];
}

function queryPositiveInts(value) {
  if (Array.isArray(value)) return distinctPositiveInts(value);
  return distinctPositiveInts(String(value || '').split(/[,\s]+/));
}

function attachDispatchBenchmark(result) {
  const targetMs = Math.max(1000, Number(process.env.DISPATCH_SOLVER_TARGET_MS || 30000));
  const solverMs = Number(result?.stats?.solver_ms || 0);
  return {
    ...result,
    stats: {
      ...(result.stats || {}),
      solver_target_ms: targetMs,
      solver_sla_ok: solverMs <= targetMs,
    },
  };
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

    const result = attachDispatchBenchmark(solve({ tasks, teams, date, oddzial_id: branchId }));
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

    const result = attachDispatchBenchmark(solve({ tasks, teams, date, oddzial_id: branchId }));
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

// POST /api/dispatch/route-brief/send
router.post('/route-brief/send', async (req, res) => {
  if (!canDispatch(req.user)) {
    return res.status(403).json({ error: 'Brak uprawnien do wysylania odpraw ekip' });
  }

  const teamId = parsePositiveInt(req.body?.team_id);
  const brief = String(req.body?.brief || '').trim();
  const date = toDateYmd(req.body?.date);
  const requestedBranchId = req.body?.oddzial_id != null ? parsePositiveInt(req.body.oddzial_id) : null;
  const branchId = scopedOddzialId(req.user, requestedBranchId);
  const taskIds = distinctPositiveInts(req.body?.task_ids).slice(0, 100);

  if (!teamId) return res.status(400).json({ error: 'Wymagane pole team_id' });
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: 'Pole date musi miec format YYYY-MM-DD' });
  }
  if (!brief) return res.status(400).json({ error: 'Wymagane pole brief' });
  if (brief.length > 6000) return res.status(400).json({ error: 'Odprawa jest za dluga (max 6000 znakow)' });

  const client = await pool.connect();
  let transactionStarted = false;
  try {
    await ensureDispatchRouteBriefTables(client);
    const teamResult = await client.query(
      'SELECT id, nazwa, oddzial_id FROM teams WHERE id = $1',
      [teamId]
    );
    const team = teamResult.rows[0];
    if (!team) return res.status(404).json({ error: 'Ekipa nie istnieje' });
    if (branchId && team.oddzial_id && Number(team.oddzial_id) !== Number(branchId)) {
      return res.status(403).json({ error: 'Brak uprawnien do tej ekipy' });
    }

    const recipientsResult = await client.query(
      `SELECT DISTINCT recipients.user_id,
              COALESCE(NULLIF(TRIM(CONCAT_WS(' ', u.imie, u.nazwisko)), ''), u.login, 'User #' || u.id::text) AS recipient_name
       FROM (
         SELECT e.brygadzista_id AS user_id
         FROM teams e
         WHERE e.id = $1 AND e.brygadzista_id IS NOT NULL
         UNION
         SELECT tm.user_id
         FROM team_members tm
         WHERE tm.team_id = $1
       ) recipients
       JOIN users u ON u.id = recipients.user_id
       WHERE recipients.user_id IS NOT NULL
         AND COALESCE(u.aktywny, true) = true`,
      [teamId]
    );
    const recipientRows = recipientsResult.rows
      .map((row) => ({
        user_id: Number(row.user_id),
        name: row.recipient_name || `User #${row.user_id}`,
      }))
      .filter((row) => Number.isInteger(row.user_id) && row.user_id > 0);
    const recipientIds = recipientRows.map((row) => row.user_id);

    if (!recipientIds.length) {
      return res.status(409).json({ error: 'Ekipa nie ma aktywnych odbiorcow odprawy' });
    }

    await client.query('BEGIN');
    transactionStarted = true;

    const notificationsResult = await client.query(
      `INSERT INTO notifications (from_user_id, to_user_id, task_id, typ, tresc, status)
       SELECT $1, recipient_id, NULL, 'Odprawa ekipy', $2, 'Nowe'
       FROM UNNEST($3::int[]) AS recipient_id
       RETURNING id, to_user_id, typ, tresc, task_id, status, data_utworzenia`,
      [req.user.id, brief, recipientIds]
    );
    const notifications = notificationsResult.rows || [];
    const notificationIds = notifications
      .map((notification) => Number(notification.id))
      .filter((id) => Number.isInteger(id) && id > 0);

    const briefResult = await client.query(
      `INSERT INTO dispatch_route_briefs (date_ymd, team_id, oddzial_id, sent_by, brief, task_ids)
       VALUES ($1::date, $2, $3, $4, $5, $6::int[])
       RETURNING id, created_at`,
      [date || null, teamId, branchId || team.oddzial_id || null, req.user.id, brief, taskIds]
    );
    const briefRecord = briefResult.rows[0] || {};
    if (briefRecord.id && recipientIds.length && notificationIds.length) {
      await client.query(
        `INSERT INTO dispatch_route_brief_recipients (brief_id, user_id, notification_id)
         SELECT $1, payload.user_id, payload.notification_id
         FROM UNNEST($2::int[], $3::int[]) AS payload(user_id, notification_id)
         ON CONFLICT (brief_id, user_id) DO UPDATE
           SET notification_id = EXCLUDED.notification_id`,
        [briefRecord.id, recipientIds, notificationIds]
      );
    }

    await client.query('COMMIT');
    transactionStarted = false;

    await req.auditLog({
      action: 'dispatch.route_brief_sent',
      entityType: 'team',
      entityId: teamId,
      metadata: {
        date: date || null,
        team_name: team.nazwa || req.body?.team_name || null,
        task_ids: taskIds,
        recipients: recipientIds,
        brief_id: briefRecord.id || null,
        notification_count: notifications.length,
      },
    });

    const status = {
      brief_id: briefRecord.id || null,
      team_id: teamId,
      team_name: team.nazwa || req.body?.team_name || null,
      sent_at: briefRecord.created_at || new Date().toISOString(),
      sent_to: notifications.length,
      confirmed: 0,
      pending: notifications.length,
      recipients: recipientRows.map((recipient, index) => ({
        user_id: recipient.user_id,
        name: recipient.name,
        notification_id: notificationIds[index] || null,
        status: 'Nowe',
        confirmed_at: null,
      })),
    };

    notifications.forEach((notification) => {
      pushToUser(notification.to_user_id, { event: 'notification', notification });
    });

    res.json({
      message: 'Odprawa wyslana do ekipy',
      brief_id: briefRecord.id || null,
      team_id: teamId,
      team_name: team.nazwa || req.body?.team_name || null,
      notification_count: notifications.length,
      recipients: recipientIds,
      recipient_details: status.recipients,
      status,
    });
  } catch (err) {
    if (transactionStarted) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        logger.warn('dispatch route brief rollback failed', { message: rollbackError.message, requestId: req.requestId });
      }
    }
    logger.error('dispatch route brief send error', { message: err.message, requestId: req.requestId });
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// GET /api/dispatch/route-brief/status?date=YYYY-MM-DD&team_ids=1,2
router.get('/route-brief/status', async (req, res) => {
  if (!canDispatch(req.user)) {
    return res.status(403).json({ error: 'Brak uprawnien do podgladu odpraw ekip' });
  }

  const date = toDateYmd(req.query?.date);
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: 'Parametr date musi miec format YYYY-MM-DD' });
  }

  const requestedBranchId = req.query?.oddzial_id != null ? parsePositiveInt(req.query.oddzial_id) : null;
  const branchId = scopedOddzialId(req.user, requestedBranchId);
  const teamIds = queryPositiveInts(req.query?.team_ids);

  try {
    await ensureDispatchRouteBriefTables(pool);
    const params = [date];
    const where = ['rb.date_ymd = $1::date'];
    if (branchId) {
      params.push(branchId);
      where.push(`rb.oddzial_id = $${params.length}`);
    }
    if (teamIds.length) {
      params.push(teamIds);
      where.push(`rb.team_id = ANY($${params.length}::int[])`);
    }

    const result = await pool.query(
      `WITH latest AS (
         SELECT DISTINCT ON (rb.team_id) rb.*
         FROM dispatch_route_briefs rb
         WHERE ${where.join(' AND ')}
         ORDER BY rb.team_id, rb.created_at DESC, rb.id DESC
       )
       SELECT latest.id AS brief_id,
              latest.date_ymd::text AS date,
              latest.team_id,
              e.nazwa AS team_name,
              latest.created_at AS sent_at,
              latest.task_ids,
              COUNT(drr.id)::int AS sent_to,
              COUNT(drr.id) FILTER (WHERE COALESCE(n.status, 'Nowe') <> 'Nowe')::int AS confirmed,
              COUNT(drr.id) FILTER (WHERE COALESCE(n.status, 'Nowe') = 'Nowe')::int AS pending,
              COALESCE(
                json_agg(
                  json_build_object(
                    'user_id', drr.user_id,
                    'name', COALESCE(NULLIF(TRIM(CONCAT_WS(' ', u.imie, u.nazwisko)), ''), u.login, 'User #' || u.id::text),
                    'notification_id', drr.notification_id,
                    'status', COALESCE(n.status, 'Nowe'),
                    'confirmed_at', n.data_odczytu
                  )
                  ORDER BY u.nazwisko, u.imie, drr.user_id
                ) FILTER (WHERE drr.id IS NOT NULL),
                '[]'::json
              ) AS recipients
       FROM latest
       JOIN teams e ON e.id = latest.team_id
       LEFT JOIN dispatch_route_brief_recipients drr ON drr.brief_id = latest.id
       LEFT JOIN users u ON u.id = drr.user_id
       LEFT JOIN notifications n ON n.id = drr.notification_id
       GROUP BY latest.id, latest.date_ymd, latest.team_id, e.nazwa, latest.created_at, latest.task_ids
       ORDER BY e.nazwa`,
      params
    );

    const items = result.rows.map((row) => ({
      brief_id: row.brief_id,
      date: row.date,
      team_id: Number(row.team_id),
      team_name: row.team_name,
      sent_at: row.sent_at,
      task_ids: row.task_ids || [],
      sent_to: Number(row.sent_to || 0),
      confirmed: Number(row.confirmed || 0),
      pending: Number(row.pending || 0),
      recipients: Array.isArray(row.recipients) ? row.recipients : [],
    }));

    res.json({
      date,
      items,
      summary: {
        teams_sent: items.length,
        sent_to: items.reduce((sum, item) => sum + item.sent_to, 0),
        confirmed: items.reduce((sum, item) => sum + item.confirmed, 0),
        pending: items.reduce((sum, item) => sum + item.pending, 0),
      },
    });
  } catch (err) {
    logger.error('dispatch route brief status error', { message: err.message, requestId: req.requestId });
    res.status(500).json({ error: err.message });
  }
});

// POST /api/dispatch/route-brief/:briefId/confirm
router.post('/route-brief/:briefId/confirm', async (req, res) => {
  const briefId = parsePositiveInt(req.params.briefId);
  if (!briefId) return res.status(400).json({ error: 'Nieprawidlowy identyfikator odprawy' });

  try {
    await ensureDispatchRouteBriefTables(pool);
    const recipientResult = await pool.query(
      `SELECT rb.id,
              rb.date_ymd::text AS date,
              rb.team_id,
              e.nazwa AS team_name,
              drr.user_id,
              drr.notification_id,
              n.status,
              n.data_odczytu
       FROM dispatch_route_briefs rb
       JOIN dispatch_route_brief_recipients drr ON drr.brief_id = rb.id
       JOIN teams e ON e.id = rb.team_id
       LEFT JOIN notifications n ON n.id = drr.notification_id AND n.to_user_id = drr.user_id
       WHERE rb.id = $1
         AND drr.user_id = $2`,
      [briefId, req.user.id]
    );
    const recipient = recipientResult.rows[0];
    if (!recipient) return res.status(404).json({ error: 'Odprawa nie istnieje dla tego uzytkownika' });
    if (!recipient.notification_id) {
      return res.status(409).json({ error: 'Odprawa nie ma powiadomienia do potwierdzenia' });
    }

    const updateResult = await pool.query(
      `UPDATE notifications
       SET status = 'Odczytane',
           data_odczytu = COALESCE(data_odczytu, NOW())
       WHERE id = $1
         AND to_user_id = $2
       RETURNING id, status, data_odczytu`,
      [recipient.notification_id, req.user.id]
    );
    const notification = updateResult.rows[0];
    if (!notification) return res.status(404).json({ error: 'Powiadomienie odprawy nie istnieje' });

    await req.auditLog({
      action: 'dispatch.route_brief_confirmed',
      entityType: 'dispatch_route_brief',
      entityId: briefId,
      metadata: {
        date: recipient.date || null,
        team_id: Number(recipient.team_id),
        team_name: recipient.team_name || null,
        notification_id: Number(recipient.notification_id),
      },
    });

    res.json({
      message: 'Odprawa potwierdzona',
      brief_id: briefId,
      team_id: Number(recipient.team_id),
      team_name: recipient.team_name || null,
      notification_id: Number(notification.id),
      status: notification.status,
      confirmed_at: notification.data_odczytu,
    });
  } catch (err) {
    logger.error('dispatch route brief confirm error', { message: err.message, requestId: req.requestId });
    res.status(500).json({ error: err.message });
  }
});

// POST /api/dispatch/route-brief/:briefId/remind
router.post('/route-brief/:briefId/remind', async (req, res) => {
  if (!canDispatch(req.user)) {
    return res.status(403).json({ error: 'Brak uprawnien do przypominania o odprawach ekip' });
  }

  const briefId = parsePositiveInt(req.params.briefId);
  if (!briefId) return res.status(400).json({ error: 'Nieprawidlowy identyfikator odprawy' });

  const client = await pool.connect();
  let transactionStarted = false;
  try {
    await ensureDispatchRouteBriefTables(client);
    const briefResult = await client.query(
      `SELECT rb.id, rb.date_ymd::text AS date, rb.team_id, rb.oddzial_id, rb.brief,
              e.nazwa AS team_name, e.oddzial_id AS team_oddzial_id
       FROM dispatch_route_briefs rb
       JOIN teams e ON e.id = rb.team_id
       WHERE rb.id = $1`,
      [briefId]
    );
    const brief = briefResult.rows[0];
    if (!brief) return res.status(404).json({ error: 'Odprawa nie istnieje' });

    const briefBranchId = brief.oddzial_id || brief.team_oddzial_id || null;
    if (!isDyrektorOrAdmin(req.user) && briefBranchId && Number(briefBranchId) !== Number(req.user.oddzial_id)) {
      return res.status(403).json({ error: 'Brak uprawnien do tej odprawy' });
    }

    const pendingResult = await client.query(
      `SELECT drr.user_id,
              drr.notification_id,
              COALESCE(NULLIF(TRIM(CONCAT_WS(' ', u.imie, u.nazwisko)), ''), u.login, 'User #' || u.id::text) AS name
       FROM dispatch_route_brief_recipients drr
       JOIN users u ON u.id = drr.user_id
       LEFT JOIN notifications n ON n.id = drr.notification_id
       WHERE drr.brief_id = $1
         AND COALESCE(n.status, 'Nowe') = 'Nowe'
         AND COALESCE(u.aktywny, true) = true
       ORDER BY u.nazwisko, u.imie, drr.user_id`,
      [briefId]
    );
    const recipients = (pendingResult.rows || [])
      .map((row) => ({
        user_id: Number(row.user_id),
        name: row.name || `User #${row.user_id}`,
        notification_id: row.notification_id || null,
      }))
      .filter((row) => Number.isInteger(row.user_id) && row.user_id > 0);

    if (!recipients.length) {
      return res.json({
        message: 'Wszyscy odbiorcy potwierdzili odprawe',
        brief_id: briefId,
        team_id: Number(brief.team_id),
        reminded: 0,
        recipients: [],
      });
    }

    const recipientIds = recipients.map((recipient) => recipient.user_id);
    const reminderText = [
      `Przypomnienie: potwierdz odprawe ekipy ${brief.team_name || `#${brief.team_id}`}.`,
      brief.date ? `Data: ${brief.date}.` : '',
      String(brief.brief || '').slice(0, 900),
    ].filter(Boolean).join('\n');

    await client.query('BEGIN');
    transactionStarted = true;
    const reminderResult = await client.query(
      `INSERT INTO notifications (from_user_id, to_user_id, task_id, typ, tresc, status)
       SELECT $1, recipient_id, NULL, 'Przypomnienie odprawy', $2, 'Nowe'
       FROM UNNEST($3::int[]) AS recipient_id
       RETURNING id, to_user_id, typ, tresc, task_id, status, data_utworzenia`,
      [req.user.id, reminderText, recipientIds]
    );
    await client.query('COMMIT');
    transactionStarted = false;

    const notifications = reminderResult.rows || [];
    await req.auditLog({
      action: 'dispatch.route_brief_reminded',
      entityType: 'dispatch_route_brief',
      entityId: briefId,
      metadata: {
        date: brief.date || null,
        team_id: Number(brief.team_id),
        team_name: brief.team_name || null,
        recipients: recipientIds,
        notification_count: notifications.length,
      },
    });

    notifications.forEach((notification) => {
      pushToUser(notification.to_user_id, { event: 'notification', notification });
    });

    res.json({
      message: 'Przypomnienie wyslane',
      brief_id: briefId,
      team_id: Number(brief.team_id),
      team_name: brief.team_name || null,
      reminded: notifications.length,
      recipients,
    });
  } catch (err) {
    if (transactionStarted) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        logger.warn('dispatch route brief reminder rollback failed', { message: rollbackError.message, requestId: req.requestId });
      }
    }
    logger.error('dispatch route brief reminder error', { message: err.message, requestId: req.requestId });
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

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
