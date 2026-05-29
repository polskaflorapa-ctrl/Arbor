const express = require('express');
const pool = require('../config/database');
const logger = require('../config/logger');
const { authMiddleware, requireNieBrygadzista, isSalesDirector } = require('../middleware/auth');
const { blockPayrollSettlements } = require('../middleware/payroll-policy');
const { validateQuery, validateBody, validateParams } = require('../middleware/validate');
const { ensureGpsTables, syncJuwentusGps, getLiveTeamLocations, getGpsHistory } = require('../services/juwentus-gps');
const { getBranchResources } = require('../services/branchResources');
const { z } = require('zod');

const router = express.Router();
const isDyrektor = (user) => ['Prezes', 'Dyrektor', 'Administrator'].includes(user.rola) || isSalesDirector(user);

const optionalIntId = z
  .any()
  .optional()
  .nullable()
  .transform((v) => {
    if (v === undefined || v === null || v === '') return null;
    const n = parseInt(String(v), 10);
    return Number.isNaN(n) ? null : n;
  });

const ekipaListQuerySchema = z.object({
  oddzial_id: z.coerce.number().int().positive().optional(),
  include_delegacje: z
    .preprocess((v) => (v === undefined ? false : ['1', 'true', true].includes(v)), z.boolean())
    .optional()
    .default(false),
  date: z.string().max(40).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

const ekipaRankingQuerySchema = z.object({
  rok: z.coerce.number().int().min(2020).max(2100).optional(),
  miesiac: z.coerce.number().int().min(1).max(12).optional(),
  oddzial_id: z.coerce.number().int().positive().optional(),
});

const ekipaIdParamsSchema = z.object({
  id: z.coerce.number().int().positive(),
});

const ymdSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data musi miec format YYYY-MM-DD');

const teamAttendanceQuerySchema = z.object({
  date: ymdSchema.optional(),
  oddzial_id: z.coerce.number().int().positive().optional(),
});

const teamAttendanceBodySchema = z.object({
  dateYmd: ymdSchema.optional(),
  date: ymdSchema.optional(),
  present: z.boolean(),
  note: z.string().max(1000).optional().nullable(),
}).refine((body) => body.dateYmd || body.date, {
  message: 'Data jest wymagana',
  path: ['dateYmd'],
});

const liveLocationsQuerySchema = z.object({
  refresh: z
    .preprocess((v) => (v === undefined ? false : ['1', 'true', true].includes(v)), z.boolean())
    .optional()
    .default(false),
});

const gpsHistoryQuerySchema = z.object({
  date: ymdSchema.optional(),
  team_id: z.coerce.number().int().positive().optional(),
  user_id: z.coerce.number().int().positive().optional(),
  vehicle_id: z.coerce.number().int().positive().optional(),
  plate_number: z.string().trim().min(1).max(50).optional(),
  provider: z.enum(['mobile', 'juwentus']).optional(),
  limit: z.coerce.number().int().min(1).max(1000).optional(),
});

const taskIdParamsSchema = z.object({
  taskId: z.coerce.number().int().positive(),
});

const ekipaCreateSchema = z.object({
  nazwa: z.string().trim().min(1, 'Nazwa ekipy jest wymagana'),
  brygadzista_id: optionalIntId,
  oddzial_id: optionalIntId,
});

const ekipaUpdateSchema = z.object({
  nazwa: z.string().trim().min(1).optional(),
  brygadzista_id: optionalIntId,
});

const czlonkowieAddSchema = z.object({
  user_id: z.coerce.number().int().positive(),
  rola: z.string().max(30).optional(),
});

const gpsUserAssignmentSchema = z.object({
  user_id: z.coerce.number().int().positive(),
  plate_number: z.string().trim().min(3).max(50),
  active: z.boolean().optional().default(true),
  notes: z.string().optional().nullable(),
});

const ekipaCzlonkowieParamsSchema = z.object({
  id: z.coerce.number().int().positive(),
  userId: z.coerce.number().int().positive(),
});

const canSeeAllTeamRanking = (user) => isDyrektor(user) || user?.rola === 'Administrator' || isSalesDirector(user);
const canViewTeamRanking = (user) => canSeeAllTeamRanking(user) || user?.rola === 'Kierownik';
const COMPLETED_STATUS = new Set(['zakonczone', 'zakonczony']);
let teamAttendanceTablesReady = false;

function pad2(n) {
  return String(n).padStart(2, '0');
}

function ymd(year, month, day) {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

function daysInMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

function toDateKey(value) {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  const raw = String(value);
  const direct = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  if (direct) return direct[1];
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function actorName(user) {
  return [user?.imie, user?.nazwisko].map((value) => String(value || '').trim()).filter(Boolean).join(' ') ||
    user?.login ||
    user?.rola ||
    'system';
}

async function ensureTeamAttendanceTables() {
  if (teamAttendanceTablesReady) return;
  await pool.query(`
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
  await pool.query('CREATE UNIQUE INDEX IF NOT EXISTS idx_team_attendance_day_team ON team_attendance(date_ymd, team_id)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_team_attendance_date ON team_attendance(date_ymd)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_team_attendance_team ON team_attendance(team_id)');
  teamAttendanceTablesReady = true;
}

function mapAttendanceRow(row, dateValue) {
  const present = row.present === null || row.present === undefined ? true : row.present === true;
  const teamId = row.team_id ?? row.teamId;
  const teamName = row.team_name || row.teamName || row.nazwa || `Ekipa #${teamId}`;
  const stamp = row.updated_at || row.created_at || null;
  return {
    id: row.attendance_id ? String(row.attendance_id) : `${teamId}_${dateValue}`,
    dateYmd: dateValue,
    teamId: String(teamId),
    teamName,
    present,
    note: row.note || '',
    actor: row.actor_name || '',
    at: stamp,
    oddzial_id: row.oddzial_id || null,
    oddzial_nazwa: row.oddzial_nazwa || null,
  };
}

function attendanceSummary(items) {
  const total = items.length;
  const absent = items.filter((item) => item.present === false).length;
  return {
    total,
    confirmed: total - absent,
    absent,
  };
}

function normalizeStatus(status) {
  return String(status || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, '_')
    .toLowerCase();
}

function periodLabel(start, end) {
  return `${start.slice(8, 10)}-${end.slice(8, 10)}.${start.slice(5, 7)}`;
}

function buildRankingForPeriod(rows, start, end) {
  const buckets = new Map();
  for (const task of rows) {
    const dateKey = toDateKey(task.data_zakonczenia || task.data_planowana || task.created_at);
    const teamId = Number(task.ekipa_id);
    if (!dateKey || !teamId || dateKey < start || dateKey > end) continue;
    if (!buckets.has(teamId)) {
      buckets.set(teamId, {
        ekipa_id: teamId,
        ekipa_nazwa: task.ekipa_nazwa || `Ekipa #${teamId}`,
        oddzial_id: task.oddzial_id || null,
        oddzial_nazwa: task.oddzial_nazwa || null,
        ekipa_oddzial_id: task.ekipa_oddzial_id || null,
        ekipa_oddzial_nazwa: task.ekipa_oddzial_nazwa || null,
        zadania: 0,
        delegowane_zadania: 0,
        macierzyste_zadania: 0,
        zakonczone: 0,
        w_realizacji: 0,
        zaplanowane: 0,
        wartosc: 0,
        godziny_planowane: 0,
        score_raw: 0,
      });
    }
    const row = buckets.get(teamId);
    const status = normalizeStatus(task.status);
    const value = Number(task.wartosc_rzeczywista ?? task.wartosc_planowana ?? 0) || 0;
    const hours = Number(task.czas_planowany_godziny ?? 0) || 0;
    const delegatedTask = Boolean(
      task.oddzial_id &&
      task.ekipa_oddzial_id &&
      Number(task.oddzial_id) !== Number(task.ekipa_oddzial_id)
    );
    row.zadania += 1;
    if (delegatedTask) row.delegowane_zadania += 1;
    else row.macierzyste_zadania += 1;
    row.wartosc += value;
    row.godziny_planowane += hours;
    if (COMPLETED_STATUS.has(status) || status.includes('zakoncz')) {
      row.zakonczone += 1;
      row.score_raw += 100;
    } else if (status.includes('realizacji')) {
      row.w_realizacji += 1;
      row.score_raw += 35;
    } else {
      row.zaplanowane += 1;
      row.score_raw += 15;
    }
    row.score_raw += value / 1000;
    row.score_raw += hours * 2;
  }
  return Array.from(buckets.values())
    .map((row) => ({
      ...row,
      wartosc: Math.round(row.wartosc * 100) / 100,
      godziny_planowane: Math.round(row.godziny_planowane * 10) / 10,
      skutecznosc: row.zadania ? Math.round((row.zakonczone / row.zadania) * 100) : 0,
      score: Math.round(row.score_raw * 10) / 10,
      delegowany: row.delegowane_zadania > 0,
    }))
    .sort((a, b) =>
      b.score - a.score ||
      b.zakonczone - a.zakonczone ||
      b.wartosc - a.wartosc ||
      String(a.ekipa_nazwa).localeCompare(String(b.ekipa_nazwa), 'pl')
    )
    .map((row, index) => ({ ...row, miejsce: index + 1 }));
}

function buildTeamRanking(rows, year, month) {
  const monthStart = ymd(year, month, 1);
  const monthEnd = ymd(year, month, daysInMonth(year, month));
  const halfStartMonth = month <= 6 ? 1 : 7;
  const halfEndMonth = month <= 6 ? 6 : 12;
  const halfStart = ymd(year, halfStartMonth, 1);
  const halfEnd = ymd(year, halfEndMonth, daysInMonth(year, halfEndMonth));
  const yearStart = ymd(year, 1, 1);
  const yearEnd = ymd(year, 12, 31);
  const weeks = [];

  for (let day = 1, idx = 1; day <= daysInMonth(year, month); day += 7, idx += 1) {
    const start = ymd(year, month, day);
    const end = ymd(year, month, Math.min(day + 6, daysInMonth(year, month)));
    const ranking = buildRankingForPeriod(rows, start, end);
    weeks.push({
      key: `week-${idx}`,
      label: `Tydzien ${idx} (${periodLabel(start, end)})`,
      start,
      end,
      winner: ranking[0] || null,
      ranking,
    });
  }

  const monthRanking = buildRankingForPeriod(rows, monthStart, monthEnd);
  const halfYearRanking = buildRankingForPeriod(rows, halfStart, halfEnd);
  const yearRanking = buildRankingForPeriod(rows, yearStart, yearEnd);
  return {
    rok: year,
    miesiac: month,
    generated_at: new Date().toISOString(),
    weeks,
    month: { label: `Miesiac ${pad2(month)}.${year}`, start: monthStart, end: monthEnd, winner: monthRanking[0] || null, ranking: monthRanking },
    halfYear: { label: `${month <= 6 ? 'I' : 'II'} polrocze ${year}`, start: halfStart, end: halfEnd, winner: halfYearRanking[0] || null, ranking: halfYearRanking },
    year: { label: `Rok ${year}`, start: yearStart, end: yearEnd, winner: yearRanking[0] || null, ranking: yearRanking },
  };
}

router.get('/', authMiddleware, validateQuery(ekipaListQuerySchema), async (req, res) => {
  try {
    const { oddzial_id, include_delegacje, date, limit, offset } = req.query;
    if (!isDyrektor(req.user) && oddzial_id != null && Number(oddzial_id) !== Number(req.user.oddzial_id)) {
      return res.status(403).json({ error: req.t('errors.auth.forbidden') });
    }
    const targetBranchId = oddzial_id != null ? oddzial_id : (!isDyrektor(req.user) ? req.user.oddzial_id : null);
    if (include_delegacje && targetBranchId) {
      const resources = await getBranchResources(pool, targetBranchId, date);
      const rows = resources.ekipy;
      if (limit != null) {
        const lim = Number(limit);
        const off = Number(offset ?? 0);
        return res.json({ items: rows.slice(off, off + lim), total: rows.length, limit: lim, offset: off });
      }
      return res.json(rows);
    }
    let where = '';
    let params = [];
    if (oddzial_id != null && isDyrektor(req.user)) {
      where = 'WHERE t.oddzial_id = $1';
      params = [oddzial_id];
    } else if (oddzial_id != null) {
      if (Number(oddzial_id) !== Number(req.user.oddzial_id)) {
        return res.status(403).json({ error: req.t('errors.auth.branchAccessDenied') });
      }
      where = 'WHERE t.oddzial_id = $1';
      params = [req.user.oddzial_id];
    } else if (!isDyrektor(req.user)) {
      where = 'WHERE t.oddzial_id = $1';
      params = [req.user.oddzial_id];
    }
    const groupBy = 'GROUP BY t.id, u.imie, u.nazwisko, u.telefon, u.procent_wynagrodzenia, b.nazwa';
    const joinGrouped = `
       FROM teams t
       LEFT JOIN users u ON t.brygadzista_id = u.id
       LEFT JOIN branches b ON t.oddzial_id = b.id
       LEFT JOIN team_members tm ON tm.team_id = t.id
       ${where}
       ${groupBy}`;
    const selectList = `
      SELECT t.*,
        u.imie as brygadzista_imie, u.nazwisko as brygadzista_nazwisko,
        u.telefon as brygadzista_telefon, u.procent_wynagrodzenia,
        b.nazwa as oddzial_nazwa,
        COUNT(DISTINCT tm.user_id) as liczba_czlonkow
      ${joinGrouped}
      ORDER BY t.nazwa`;

    if (limit != null) {
      const lim = Number(limit);
      const off = Number(offset ?? 0);
      const countR = await pool.query(`SELECT COUNT(*)::int AS c FROM (SELECT t.id ${joinGrouped}) sub`, params);
      const total = countR.rows[0]?.c ?? 0;
      const limIdx = params.length + 1;
      const offIdx = params.length + 2;
      const { rows } = await pool.query(
        `${selectList} LIMIT $${limIdx} OFFSET $${offIdx}`,
        [...params, lim, off]
      );
      return res.json({ items: rows, total, limit: lim, offset: off });
    }
    const result = await pool.query(selectList, params);
    res.json(result.rows);
  } catch (err) {
    logger.error('Blad pobierania ekip', { message: err.message, requestId: req.requestId });
    res.status(500).json({ error: req.t('errors.http.serverError') });
  }
});

router.get('/ranking', authMiddleware, validateQuery(ekipaRankingQuerySchema), async (req, res) => {
  try {
    if (!canViewTeamRanking(req.user)) {
      return res.status(403).json({ error: req.t('errors.auth.forbidden') });
    }

    const now = new Date();
    const year = req.query.rok || now.getFullYear();
    const month = req.query.miesiac || now.getMonth() + 1;
    const requestedOddzialId = req.query.oddzial_id || null;
    if (requestedOddzialId && !canSeeAllTeamRanking(req.user) && Number(requestedOddzialId) !== Number(req.user.oddzial_id)) {
      return res.status(403).json({ error: req.t('errors.auth.branchAccessDenied') });
    }

    const params = [ymd(year, 1, 1), ymd(year + 1, 1, 1)];
    let where = `
      WHERE t.ekipa_id IS NOT NULL
        AND COALESCE(t.data_zakonczenia, t.data_planowana, t.created_at) >= $1::date
        AND COALESCE(t.data_zakonczenia, t.data_planowana, t.created_at) < $2::date`;
    const scopedOddzialId = canSeeAllTeamRanking(req.user) ? requestedOddzialId : req.user.oddzial_id;
    if (scopedOddzialId) {
      params.push(scopedOddzialId);
      where += ` AND t.oddzial_id = $${params.length}`;
    }

    const { rows } = await pool.query(
      `SELECT
         t.id,
         t.ekipa_id,
         t.oddzial_id,
         t.status,
         t.wartosc_planowana,
         t.wartosc_rzeczywista,
         t.czas_planowany_godziny,
         t.data_planowana,
         t.data_zakonczenia,
         t.created_at,
         te.nazwa AS ekipa_nazwa,
         te.oddzial_id AS ekipa_oddzial_id,
         tb.nazwa AS ekipa_oddzial_nazwa,
         b.nazwa AS oddzial_nazwa
       FROM tasks t
       LEFT JOIN teams te ON te.id = t.ekipa_id
       LEFT JOIN branches tb ON tb.id = te.oddzial_id
       LEFT JOIN branches b ON b.id = t.oddzial_id
       ${where}`,
      params
    );

    let branchName = null;
    if (scopedOddzialId) {
      const branch = await pool.query('SELECT nazwa FROM branches WHERE id = $1', [scopedOddzialId]);
      branchName = branch.rows[0]?.nazwa || null;
    }

    res.json({
      ...buildTeamRanking(rows, year, month),
      scope: {
        oddzial_id: scopedOddzialId || null,
        oddzial_nazwa: branchName,
      },
    });
  } catch (err) {
    logger.error('Blad pobierania rankingu ekip', { message: err.message, requestId: req.requestId });
    res.status(500).json({ error: req.t('errors.http.serverError') });
  }
});

router.get('/attendance', authMiddleware, validateQuery(teamAttendanceQuerySchema), async (req, res) => {
  try {
    await ensureTeamAttendanceTables();
    const date = req.query.date || todayKey();
    const requestedOddzialId = req.query.oddzial_id || null;
    if (requestedOddzialId && !isDyrektor(req.user) && Number(requestedOddzialId) !== Number(req.user.oddzial_id)) {
      return res.status(403).json({ error: req.t('errors.auth.branchAccessDenied') });
    }

    const scopedOddzialId = requestedOddzialId || (!isDyrektor(req.user) ? req.user.oddzial_id : null);
    const params = [date];
    let where = 'WHERE COALESCE(t.aktywny, true) = true';
    if (scopedOddzialId) {
      params.push(scopedOddzialId);
      where += ` AND t.oddzial_id = $${params.length}`;
    }

    const { rows } = await pool.query(
      `SELECT
         t.id AS team_id,
         t.nazwa AS team_name,
         t.oddzial_id,
         b.nazwa AS oddzial_nazwa,
         a.id AS attendance_id,
         a.present,
         a.note,
         a.actor_name,
         a.created_at,
         a.updated_at
       FROM teams t
       LEFT JOIN branches b ON b.id = t.oddzial_id
       LEFT JOIN team_attendance a ON a.team_id = t.id AND a.date_ymd = $1::date
       ${where}
       ORDER BY t.nazwa`,
      params
    );
    const items = rows.map((row) => mapAttendanceRow(row, date));
    res.json({
      date,
      items,
      summary: attendanceSummary(items),
    });
  } catch (err) {
    logger.error('Blad pobierania potwierdzen ekip', { message: err.message, requestId: req.requestId });
    res.status(500).json({ error: req.t('errors.http.serverError') });
  }
});

router.put('/:id/attendance', authMiddleware, validateParams(ekipaIdParamsSchema), validateBody(teamAttendanceBodySchema), async (req, res) => {
  try {
    await ensureTeamAttendanceTables();
    const date = req.body.dateYmd || req.body.date;
    const team = await pool.query('SELECT id, nazwa, oddzial_id FROM teams WHERE id = $1', [req.params.id]);
    if (!team.rows.length) return res.status(404).json({ error: req.t('errors.generic.notFound') });
    const row = team.rows[0];
    if (!isDyrektor(req.user) && row.oddzial_id != null && Number(row.oddzial_id) !== Number(req.user.oddzial_id)) {
      return res.status(403).json({ error: req.t('errors.auth.branchAccessDenied') });
    }

    const actor = actorName(req.user);
    const saved = await pool.query(
      `INSERT INTO team_attendance (date_ymd, team_id, present, note, actor_id, actor_name)
       VALUES ($1::date, $2, $3, $4, $5, $6)
       ON CONFLICT (date_ymd, team_id) DO UPDATE SET
         present = EXCLUDED.present,
         note = EXCLUDED.note,
         actor_id = EXCLUDED.actor_id,
         actor_name = EXCLUDED.actor_name,
         updated_at = NOW()
       RETURNING id AS attendance_id, date_ymd, team_id, present, note, actor_name, created_at, updated_at`,
      [date, req.params.id, req.body.present, req.body.note || '', req.user.id || null, actor]
    );
    res.json({
      item: mapAttendanceRow({
        ...saved.rows[0],
        team_name: row.nazwa,
        oddzial_id: row.oddzial_id,
      }, date),
      message: 'Potwierdzenie ekipy zapisane',
    });
  } catch (err) {
    logger.error('Blad zapisu potwierdzenia ekipy', { message: err.message, requestId: req.requestId });
    res.status(500).json({ error: req.t('errors.http.serverError') });
  }
});

router.get('/live-locations', authMiddleware, validateQuery(liveLocationsQuerySchema), async (req, res) => {
  try {
    if (req.query.refresh) {
      try {
        await syncJuwentusGps();
      } catch (err) {
        logger.warn('Nie udalo sie odswiezyc pozycji GPS z Juwentus', {
          message: err.message,
          requestId: req.requestId,
        });
      }
    }
    const scopedOddzialId = isDyrektor(req.user) ? null : req.user.oddzial_id;
    const rows = await getLiveTeamLocations({ oddzialId: scopedOddzialId });
    res.json({ items: rows, count: rows.length });
  } catch (err) {
    logger.error('Blad pobierania live-locations ekip', { message: err.message, requestId: req.requestId });
    res.status(500).json({ error: req.t('errors.http.serverError') });
  }
});

router.get('/gps-history', authMiddleware, validateQuery(gpsHistoryQuerySchema), async (req, res) => {
  try {
    const date = req.query.date || todayKey();
    const queryNumber = (value) => (value == null ? null : Number(value));
    const scopedOddzialId = isDyrektor(req.user) ? null : req.user.oddzial_id;
    const rows = await getGpsHistory({
      date,
      oddzialId: scopedOddzialId,
      teamId: queryNumber(req.query.team_id),
      userId: queryNumber(req.query.user_id),
      vehicleId: queryNumber(req.query.vehicle_id),
      plateNumber: req.query.plate_number || null,
      provider: req.query.provider || null,
      limit: queryNumber(req.query.limit) || 240,
    });
    res.json({ date, items: rows, count: rows.length });
  } catch (err) {
    logger.error('Blad pobierania gps-history ekip', { message: err.message, requestId: req.requestId });
    res.status(500).json({ error: req.t('errors.http.serverError') });
  }
});

router.get('/gps-user-assignments', authMiddleware, async (req, res) => {
  try {
    await ensureGpsTables();
    const scopedOddzialId = isDyrektor(req.user) ? null : req.user.oddzial_id;
    const params = [];
    let where = '';
    if (scopedOddzialId != null) {
      params.push(scopedOddzialId);
      where = `WHERE u.oddzial_id = $1`;
    }
    const result = await pool.query(
      `SELECT guva.*, u.imie, u.nazwisko, u.oddzial_id
       FROM gps_user_vehicle_assignments guva
       JOIN users u ON u.id = guva.user_id
       ${where}
       ORDER BY guva.active DESC, u.nazwisko, u.imie`,
      params
    );
    res.json(result.rows);
  } catch (err) {
    logger.error('Blad pobierania gps-user-assignments', { message: err.message, requestId: req.requestId });
    res.status(500).json({ error: req.t('errors.http.serverError') });
  }
});

router.post('/gps-user-assignments', authMiddleware, requireNieBrygadzista, validateBody(gpsUserAssignmentSchema), async (req, res) => {
  try {
    await ensureGpsTables();
    const { user_id, plate_number, active, notes } = req.body;
    await pool.query(
      `INSERT INTO gps_user_vehicle_assignments (user_id, plate_number, active, notes)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, plate_number) DO UPDATE SET
         active = EXCLUDED.active,
         notes = EXCLUDED.notes,
         updated_at = NOW()`,
      [user_id, plate_number, active, notes || null]
    );
    res.json({ message: 'Powiazanie GPS użytkownika zapisane' });
  } catch (err) {
    logger.error('Blad zapisu gps-user-assignments', { message: err.message, requestId: req.requestId });
    res.status(500).json({ error: req.t('errors.http.serverError') });
  }
});

router.get('/:id/live-location', authMiddleware, validateParams(ekipaIdParamsSchema), validateQuery(liveLocationsQuerySchema), async (req, res) => {
  try {
    if (req.query.refresh) {
      try {
        await syncJuwentusGps();
      } catch (err) {
        logger.warn('Nie udalo sie odswiezyc pozycji GPS z Juwentus (single team)', {
          message: err.message,
          requestId: req.requestId,
        });
      }
    }
    const scopedOddzialId = isDyrektor(req.user) ? null : req.user.oddzial_id;
    const rows = await getLiveTeamLocations({ oddzialId: scopedOddzialId });
    const match = rows.find((row) => Number(row.ekipa_id) === Number(req.params.id));
    if (!match) return res.status(404).json({ error: req.t('errors.generic.notFound') });
    res.json(match);
  } catch (err) {
    logger.error('Blad pobierania live-location ekipy', { message: err.message, requestId: req.requestId });
    res.status(500).json({ error: req.t('errors.http.serverError') });
  }
});

router.get('/rozliczenie/:taskId', authMiddleware, validateParams(taskIdParamsSchema), blockPayrollSettlements);
router.post('/rozliczenie/:taskId', authMiddleware, requireNieBrygadzista, validateParams(taskIdParamsSchema), blockPayrollSettlements);

router.get('/:id', authMiddleware, validateParams(ekipaIdParamsSchema), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT t.*,
        u.imie as brygadzista_imie, u.nazwisko as brygadzista_nazwisko,
        u.telefon as brygadzista_telefon, u.procent_wynagrodzenia,
        b.nazwa as oddzial_nazwa
       FROM teams t
       LEFT JOIN users u ON t.brygadzista_id = u.id
       LEFT JOIN branches b ON t.oddzial_id = b.id
       WHERE t.id = $1`,
      [req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: req.t('errors.generic.notFound') });
    const czlonkowie = await pool.query(
      `SELECT tm.*, u.imie, u.nazwisko, u.telefon, u.rola, u.stawka_godzinowa
       FROM team_members tm
       LEFT JOIN users u ON tm.user_id = u.id
       WHERE tm.team_id = $1`,
      [req.params.id]
    );
    res.json({ ...result.rows[0], czlonkowie: czlonkowie.rows });
  } catch (err) {
    logger.error('Blad pobierania ekipy po id', { message: err.message, requestId: req.requestId });
    res.status(500).json({ error: req.t('errors.http.serverError') });
  }
});

router.post('/', authMiddleware, requireNieBrygadzista, validateBody(ekipaCreateSchema), async (req, res) => {
  try {
    const { nazwa, brygadzista_id, oddzial_id } = req.body;
    const finalOddzial = isDyrektor(req.user) ? (oddzial_id || req.user.oddzial_id) : req.user.oddzial_id;
    const result = await pool.query(
      `INSERT INTO teams (nazwa, brygadzista_id, oddzial_id, aktywny)
       VALUES ($1, $2, $3, true) RETURNING id`,
      [nazwa, brygadzista_id || null, finalOddzial]
    );
    res.json({ id: result.rows[0].id, message: 'Ekipa utworzona' });
  } catch (err) {
    logger.error('Blad tworzenia ekipy', { message: err.message, requestId: req.requestId });
    res.status(500).json({ error: req.t('errors.http.serverError') });
  }
});

router.put('/:id', authMiddleware, requireNieBrygadzista, validateParams(ekipaIdParamsSchema), validateBody(ekipaUpdateSchema), async (req, res) => {
  try {
    const { nazwa, brygadzista_id } = req.body;
    await pool.query(
      'UPDATE teams SET nazwa = COALESCE($1, nazwa), brygadzista_id = COALESCE($2, brygadzista_id) WHERE id = $3',
      [nazwa ?? null, brygadzista_id ?? null, req.params.id]
    );
    res.json({ message: 'Zaktualizowano' });
  } catch (err) {
    logger.error('Blad aktualizacji ekipy', { message: err.message, requestId: req.requestId });
    res.status(500).json({ error: req.t('errors.http.serverError') });
  }
});

router.delete('/:id', authMiddleware, validateParams(ekipaIdParamsSchema), async (req, res) => {
  try {
    if (!isDyrektor(req.user)) return res.status(403).json({ error: req.t('errors.auth.forbidden') });
    const id = req.params.id;
    // Null-out all nullable FK references first (ON DELETE SET NULL columns)
    await pool.query('UPDATE tasks SET ekipa_id = NULL WHERE ekipa_id = $1', [id]);
    await pool.query('UPDATE delegacje SET ekipa_id = NULL WHERE ekipa_id = $1', [id]);
    await pool.query('UPDATE equipment_items SET ekipa_id = NULL WHERE ekipa_id = $1', [id]);
    await pool.query('UPDATE vehicles SET ekipa_id = NULL WHERE ekipa_id = $1', [id]);
    await pool.query('UPDATE users SET ekipa_id_fk = NULL WHERE ekipa_id_fk = $1', [id]);
    await pool.query('UPDATE wyceny SET ekipa_id = NULL WHERE ekipa_id = $1', [id]);
    await pool.query('UPDATE wyceny SET proponowana_ekipa_id = NULL WHERE proponowana_ekipa_id = $1', [id]);
    // Delete equipment reservations (NOT NULL FK — must delete before team row)
    await pool.query('DELETE FROM equipment_reservations WHERE ekipa_id = $1', [id]);
    // Delete members then the team itself
    await pool.query('DELETE FROM team_members WHERE team_id = $1', [id]);
    await pool.query('DELETE FROM teams WHERE id = $1', [id]);
    res.json({ message: 'Ekipa usunieta.' });
  } catch (err) {
    logger.error('Blad usuwania ekipy', { message: err.message, requestId: req.requestId });
    res.status(500).json({ error: `${req.t('errors.http.serverError')}: ${err.message}` });
  }
});

router.post('/:id/czlonkowie', authMiddleware, requireNieBrygadzista, validateParams(ekipaIdParamsSchema), validateBody(czlonkowieAddSchema), async (req, res) => {
  try {
    const { user_id, rola } = req.body;
    await pool.query(
      `INSERT INTO team_members (team_id, user_id, rola)
       VALUES ($1, $2, $3) ON CONFLICT (team_id, user_id) DO UPDATE SET rola = $3`,
      [req.params.id, user_id, rola || 'Pomocnik']
    );
    res.json({ message: 'Dodano do ekipy' });
  } catch (err) {
    logger.error('Blad dodawania czlonka ekipy', { message: err.message, requestId: req.requestId });
    res.status(500).json({ error: req.t('errors.http.serverError') });
  }
});

router.delete('/:id/czlonkowie/:userId', authMiddleware, requireNieBrygadzista, validateParams(ekipaCzlonkowieParamsSchema), async (req, res) => {
  try {
    await pool.query(
      'DELETE FROM team_members WHERE team_id = $1 AND user_id = $2',
      [req.params.id, req.params.userId]
    );
    res.json({ message: 'Usunieto z ekipy' });
  } catch (err) {
    logger.error('Blad usuwania czlonka ekipy', { message: err.message, requestId: req.requestId });
    res.status(500).json({ error: req.t('errors.http.serverError') });
  }
});

module.exports = router;
