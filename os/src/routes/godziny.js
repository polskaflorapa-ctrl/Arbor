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
