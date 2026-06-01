const express = require('express');
const pool = require('../config/database');
const logger = require('../config/logger');
const { authMiddleware } = require('../middleware/auth');
const { validateBody, validateParams, validateQuery } = require('../middleware/validate');
const { z } = require('zod');

const router = express.Router();

const godzinyCreateSchema = z.object({
  task_id: z.coerce.number().int().positive(),
  godziny: z.coerce.number().positive(),
  data_pracy: z.string().trim().min(1, 'Data pracy jest wymagana'),
});

const godzinyStatusSchema = z.object({
  status: z.enum(['Potwierdzone', 'Odrzucone']),
});

const godzinyIdParamsSchema = z.object({
  id: z.coerce.number().int().positive(),
});

const godzinyListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

const ecpQuerySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  user_id: z.coerce.number().int().positive().optional(),
  oddzial_id: z.coerce.number().int().positive().optional(),
});

function canSeeAllBranches(user) {
  return ['Prezes', 'Dyrektor', 'Administrator'].includes(user?.rola);
}

function ecpBranchScope(user, requestedBranchId) {
  if (canSeeAllBranches(user)) return requestedBranchId ?? null;
  return user.oddzial_id ?? null;
}

// POST /api/godziny
router.post('/', authMiddleware, validateBody(godzinyCreateSchema), async (req, res) => {
  try {
    const { task_id, godziny, data_pracy } = req.body;

    const check = await pool.query(
      `SELECT t.id, t.brygadzista_id FROM tasks t
       WHERE t.id = $1 AND EXISTS (
         SELECT 1 FROM task_pomocnicy tp WHERE tp.task_id = t.id AND tp.pomocnik_id = $2
       )`,
      [task_id, req.user.id]
    );
    if (check.rows.length === 0) return res.status(403).json({ error: req.t('errors.godziny.notAssignedToTask') });

    const brygadzista_id = check.rows[0].brygadzista_id;
    const existing = await pool.query(
      'SELECT id FROM godziny_potwierdzenia WHERE task_id=$1 AND pomocnik_id=$2 AND data_pracy=$3',
      [task_id, req.user.id, data_pracy]
    );
    if (existing.rows.length > 0) {
      await pool.query('UPDATE godziny_potwierdzenia SET godziny=$1, status=$2, updated_at=NOW() WHERE id=$3',
        [godziny, 'Oczekuje', existing.rows[0].id]);
    } else {
      await pool.query(
        `INSERT INTO godziny_potwierdzenia (task_id, pomocnik_id, brygadzista_id, godziny, data_pracy, status, created_at)
         VALUES ($1,$2,$3,$4,$5,'Oczekuje',NOW())`,
        [task_id, req.user.id, brygadzista_id, godziny, data_pracy]
      );
    }
    res.json({ success: true, message: 'Zgłoszenie wysłane do brygadzisty' });
  } catch (err) {
    logger.error('Blad zapisywania godzin', { message: err.message, requestId: req.requestId });
    res.status(500).json({ error: req.t('errors.http.serverError') });
  }
});

router.get('/ecp', authMiddleware, validateQuery(ecpQuerySchema), async (req, res) => {
  try {
    const { from, to, user_id } = req.query;
    if (to < from) return res.status(400).json({ error: 'data_do_przed_data_od' });
    const branchId = ecpBranchScope(req.user, req.query.oddzial_id ? Number(req.query.oddzial_id) : null);
    const params = [from, to];
    const filters = [];
    if (branchId != null) {
      params.push(branchId);
      filters.push(`COALESCE(t.oddzial_id, u.oddzial_id) = $${params.length}`);
    }
    if (user_id != null) {
      params.push(Number(user_id));
      filters.push(`wl.user_id = $${params.length}`);
    }
    const where = filters.length ? `AND ${filters.join(' AND ')}` : '';
    const result = await pool.query(
      `WITH logs AS (
         SELECT wl.user_id,
                (wl.start_time AT TIME ZONE 'Europe/Warsaw')::date AS data_pracy,
                COALESCE(u.imie || ' ' || u.nazwisko, 'Pracownik #' || wl.user_id) AS pracownik,
                COALESCE(t.oddzial_id, u.oddzial_id) AS oddzial_id,
                COALESCE(o.nazwa, b.nazwa) AS oddzial_nazwa,
                wl.task_id,
                COALESCE(NULLIF(wl.czas_pracy_minuty, 0)::numeric,
                  EXTRACT(EPOCH FROM (wl.end_time - wl.start_time)) / 60.0
                ) AS minutes
           FROM work_logs wl
           LEFT JOIN tasks t ON t.id = wl.task_id
           LEFT JOIN users u ON u.id = wl.user_id
           LEFT JOIN oddzialy o ON o.id = COALESCE(t.oddzial_id, u.oddzial_id)
           LEFT JOIN branches b ON b.id = COALESCE(t.oddzial_id, u.oddzial_id)
          WHERE wl.end_time IS NOT NULL
            AND (wl.start_time AT TIME ZONE 'Europe/Warsaw')::date BETWEEN $1::date AND $2::date
            ${where}
       ),
       daily AS (
         SELECT user_id, data_pracy, pracownik, oddzial_id, oddzial_nazwa,
                ROUND((SUM(minutes) / 60.0)::numeric, 2) AS godziny,
                ROUND((GREATEST(SUM(minutes) - 480, 0) / 60.0)::numeric, 2) AS nadgodziny,
                COUNT(DISTINCT task_id)::int AS zlecenia_count,
                COUNT(*)::int AS work_logs_count
           FROM logs
          GROUP BY user_id, data_pracy, pracownik, oddzial_id, oddzial_nazwa
       )
       SELECT *,
              ROUND((godziny - nadgodziny)::numeric, 2) AS godziny_normatywne
         FROM daily
        ORDER BY data_pracy DESC, pracownik ASC`,
      params
    );
    const summary = result.rows.reduce((acc, row) => {
      acc.godziny += Number(row.godziny) || 0;
      acc.nadgodziny += Number(row.nadgodziny) || 0;
      acc.dni += 1;
      acc.work_logs_count += Number(row.work_logs_count) || 0;
      return acc;
    }, { godziny: 0, nadgodziny: 0, dni: 0, work_logs_count: 0 });
    res.json({
      from,
      to,
      oddzial_id: branchId,
      items: result.rows,
      summary: {
        ...summary,
        godziny: Math.round(summary.godziny * 100) / 100,
        nadgodziny: Math.round(summary.nadgodziny * 100) / 100,
      },
      overtime_rule: 'daily_minutes_over_480',
      legal_note: 'Regula nadgodzin jest robocza i wymaga weryfikacji prawnej przed payroll.',
    });
  } catch (err) {
    if (err.code === '42P01') return res.status(404).json({ error: 'ecp_not_migrated' });
    logger.error('Blad automatycznej ewidencji czasu pracy', { message: err.message, requestId: req.requestId });
    res.status(500).json({ error: req.t('errors.http.serverError') });
  }
});

router.get('/moje', authMiddleware, validateQuery(godzinyListQuerySchema), async (req, res) => {
  try {
    const { limit, offset } = req.query;
    const base = `
      FROM godziny_potwierdzenia g
      LEFT JOIN tasks t ON g.task_id = t.id
      LEFT JOIN users u ON g.brygadzista_id = u.id
      WHERE g.pomocnik_id = $1`;
    const selectList = `
      SELECT g.*, t.klient_nazwa, t.adres, t.typ_uslugi,
        u.imie || ' ' || u.nazwisko AS brygadzista_nazwa
      ${base}
      ORDER BY g.data_pracy DESC`;
    const params = [req.user.id];
    if (limit != null) {
      const lim = Number(limit);
      const off = Number(offset ?? 0);
      const countR = await pool.query(`SELECT COUNT(*)::int AS c ${base}`, params);
      const total = countR.rows[0]?.c ?? 0;
      const { rows } = await pool.query(`${selectList} LIMIT $2 OFFSET $3`, [req.user.id, lim, off]);
      return res.json({ items: rows, total, limit: lim, offset: off });
    }
    const result = await pool.query(selectList, params);
    res.json(result.rows);
  } catch (err) {
    if (err.code === '42P01') return res.json([]);
    logger.error('Blad pobierania moich godzin', { message: err.message, requestId: req.requestId });
    res.status(500).json({ error: req.t('errors.http.serverError') });
  }
});

router.get('/do-potwierdzenia', authMiddleware, validateQuery(godzinyListQuerySchema), async (req, res) => {
  try {
    const { limit, offset } = req.query;
    const base = `
      FROM godziny_potwierdzenia g
      LEFT JOIN tasks t ON g.task_id = t.id
      LEFT JOIN users u ON g.pomocnik_id = u.id
      WHERE g.brygadzista_id = $1 AND g.status = 'Oczekuje'`;
    const selectList = `
      SELECT g.*, t.klient_nazwa, t.adres, t.typ_uslugi,
        u.imie || ' ' || u.nazwisko AS pomocnik_nazwa, u.stawka_godzinowa
      ${base}
      ORDER BY g.data_pracy DESC`;
    const params = [req.user.id];
    if (limit != null) {
      const lim = Number(limit);
      const off = Number(offset ?? 0);
      const countR = await pool.query(`SELECT COUNT(*)::int AS c ${base}`, params);
      const total = countR.rows[0]?.c ?? 0;
      const { rows } = await pool.query(`${selectList} LIMIT $2 OFFSET $3`, [req.user.id, lim, off]);
      return res.json({ items: rows, total, limit: lim, offset: off });
    }
    const result = await pool.query(selectList, params);
    res.json(result.rows);
  } catch (err) {
    if (err.code === '42P01') return res.json([]);
    logger.error('Blad pobierania godzin do potwierdzenia', { message: err.message, requestId: req.requestId });
    res.status(500).json({ error: req.t('errors.http.serverError') });
  }
});

router.get('/wszystkie', authMiddleware, validateQuery(godzinyListQuerySchema), async (req, res) => {
  try {
    const isKierownik = req.user.rola === 'Kierownik';
    const { limit, offset } = req.query;
    let base = `
      FROM godziny_potwierdzenia g
      LEFT JOIN tasks t ON g.task_id = t.id
      LEFT JOIN users ph ON g.pomocnik_id = ph.id
      LEFT JOIN users br ON g.brygadzista_id = br.id`;
    const params = [];
    if (isKierownik) {
      base += ' WHERE t.oddzial_id=$1';
      params.push(req.user.oddzial_id);
    }
    const selectList = `
      SELECT g.*, t.klient_nazwa, t.adres, t.typ_uslugi, t.oddzial_id,
        ph.imie || ' ' || ph.nazwisko AS pomocnik_nazwa, ph.stawka_godzinowa,
        br.imie || ' ' || br.nazwisko AS brygadzista_nazwa
      ${base}
      ORDER BY g.data_pracy DESC`;

    if (limit != null) {
      const lim = Number(limit);
      const off = Number(offset ?? 0);
      const countR = await pool.query(`SELECT COUNT(*)::int AS c ${base}`, params);
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
    if (err.code === '42P01') return res.json([]);
    logger.error('Blad pobierania wszystkich godzin', { message: err.message, requestId: req.requestId });
    res.status(500).json({ error: req.t('errors.http.serverError') });
  }
});

router.put('/:id/status', authMiddleware, validateParams(godzinyIdParamsSchema), validateBody(godzinyStatusSchema), async (req, res) => {
  try {
    const { status } = req.body;
    const { id } = req.params;

    const check = await pool.query(
      'SELECT * FROM godziny_potwierdzenia WHERE id=$1 AND brygadzista_id=$2',
      [id, req.user.id]
    );
    if (check.rows.length === 0) return res.status(403).json({ error: req.t('errors.auth.forbidden') });

    await pool.query(
      'UPDATE godziny_potwierdzenia SET status=$1, potwierdzone_at=NOW(), updated_at=NOW() WHERE id=$2',
      [status, id]
    );
    res.json({ success: true });
  } catch (err) {
    logger.error('Blad aktualizacji statusu godzin', { message: err.message, requestId: req.requestId });
    res.status(500).json({ error: req.t('errors.http.serverError') });
  }
});

module.exports = router;
