const express = require('express');
const pool = require('../config/database');
const logger = require('../config/logger');
const { authMiddleware, isDyrektorOrAdmin, scopedOddzialId } = require('../middleware/auth');
const { validateBody, validateParams, validateQuery } = require('../middleware/validate');
const { z } = require('zod');

const router = express.Router();

const materialListQuerySchema = z.object({
  oddzial_id: z.coerce.number().int().positive().optional(),
  q: z.string().trim().max(80).optional(),
  include_inactive: z
    .preprocess((v) => (v === undefined ? false : ['1', 'true', true].includes(v)), z.boolean())
    .optional()
    .default(false),
});

const materialIdParamsSchema = z.object({
  id: z.coerce.number().int().positive(),
});

const materialCreateSchema = z.object({
  nazwa: z.string().trim().min(1).max(160),
  jednostka: z.string().trim().min(1).max(20).default('szt'),
  min_stan: z.coerce.number().min(0).optional().default(0),
  koszt_jednostkowy: z.coerce.number().min(0).optional().default(0),
  oddzial_id: z.coerce.number().int().positive().optional().nullable(),
  kod: z.string().trim().max(80).optional().nullable(),
  kategoria: z.string().trim().max(80).optional().nullable(),
});

const movementCreateSchema = z.object({
  material_id: z.coerce.number().int().positive(),
  ilosc: z.coerce.number().positive(),
  koszt_jednostkowy: z.coerce.number().min(0).optional().nullable(),
  task_id: z.coerce.number().int().positive().optional().nullable(),
  notatki: z.string().trim().max(1000).optional().nullable(),
});

function movementSignSql() {
  return `CASE
    WHEN wm.typ IN ('przyjecie', 'korekta_plus') THEN wm.ilosc
    WHEN wm.typ IN ('rozchod', 'korekta_minus') THEN -wm.ilosc
    ELSE 0
  END`;
}

function canUseBranch(user, oddzialId) {
  return isDyrektorOrAdmin(user) || Number(user?.oddzial_id) === Number(oddzialId);
}

async function getMaterialForWrite(id) {
  const result = await pool.query(
    'SELECT id, oddzial_id, nazwa, jednostka, koszt_jednostkowy FROM warehouse_materials WHERE id = $1',
    [id]
  );
  return result.rows[0] || null;
}

async function currentStock(materialId) {
  const result = await pool.query(
    `SELECT COALESCE(SUM(${movementSignSql()}), 0)::numeric AS stan
       FROM warehouse_material_movements wm
      WHERE wm.material_id = $1`,
    [materialId]
  );
  return Number(result.rows[0]?.stan || 0);
}

async function validateTaskScope(taskId, oddzialId, user) {
  if (!taskId) return null;
  const task = await pool.query('SELECT id, oddzial_id FROM tasks WHERE id = $1', [taskId]);
  if (!task.rows[0]) return { status: 404, body: { error: 'task_nieznaleziony' } };
  if (task.rows[0].oddzial_id && Number(task.rows[0].oddzial_id) !== Number(oddzialId)) {
    return { status: 400, body: { error: 'material_task_oddzial' } };
  }
  if (!isDyrektorOrAdmin(user) && Number(task.rows[0].oddzial_id) !== Number(user.oddzial_id)) {
    return { status: 403, body: { error: 'brak_dostepu_zlecenie' } };
  }
  return null;
}

async function createMovement(req, res, typ) {
  const { material_id, ilosc, koszt_jednostkowy, task_id, notatki } = req.body;
  const material = await getMaterialForWrite(material_id);
  if (!material) return res.status(404).json({ error: 'material_nieznaleziony' });
  if (!canUseBranch(req.user, material.oddzial_id)) return res.status(403).json({ error: 'brak_dostepu_oddzial' });

  if (typ === 'rozchod') {
    const taskScopeError = await validateTaskScope(task_id, material.oddzial_id, req.user);
    if (taskScopeError) return res.status(taskScopeError.status).json(taskScopeError.body);
    const stan = await currentStock(material_id);
    if (stan < Number(ilosc)) {
      return res.status(409).json({
        error: 'magazyn_brak_stanu',
        code: 'WAREHOUSE_STOCK_UNDERFLOW',
        material: { id: material.id, nazwa: material.nazwa, stan },
      });
    }
  }

  const unitCost = koszt_jednostkowy == null ? Number(material.koszt_jednostkowy || 0) : Number(koszt_jednostkowy);
  const inserted = await pool.query(
    `INSERT INTO warehouse_material_movements
       (oddzial_id, material_id, typ, ilosc, koszt_jednostkowy, task_id, notatki, user_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING id`,
    [material.oddzial_id, material_id, typ, ilosc, unitCost, task_id || null, notatki || null, req.user.id]
  );
  return res.json({ id: inserted.rows[0].id });
}

router.get('/materialy', authMiddleware, validateQuery(materialListQuerySchema), async (req, res) => {
  try {
    const oddzialId = scopedOddzialId(req.user, req.query.oddzial_id);
    const params = [];
    const where = [];
    if (oddzialId) {
      params.push(oddzialId);
      where.push(`m.oddzial_id = $${params.length}`);
    }
    if (!req.query.include_inactive) where.push('m.aktywny = true');
    if (req.query.q) {
      params.push(`%${req.query.q}%`);
      where.push(`(m.nazwa ILIKE $${params.length} OR m.kod ILIKE $${params.length} OR m.kategoria ILIKE $${params.length})`);
    }
    const result = await pool.query(
      `SELECT m.id, m.oddzial_id, b.nazwa AS oddzial_nazwa, m.nazwa, m.kod, m.kategoria,
              m.jednostka, m.min_stan, m.koszt_jednostkowy, m.aktywny,
              COALESCE(SUM(${movementSignSql()}), 0)::numeric AS stan,
              CASE WHEN COALESCE(SUM(${movementSignSql()}), 0) <= m.min_stan THEN true ELSE false END AS niski_stan
         FROM warehouse_materials m
         LEFT JOIN branches b ON b.id = m.oddzial_id
         LEFT JOIN warehouse_material_movements wm ON wm.material_id = m.id
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        GROUP BY m.id, b.nazwa
        ORDER BY niski_stan DESC, m.nazwa ASC`,
      params
    );
    res.json(result.rows);
  } catch (err) {
    if (err.code === '42P01') return res.status(404).json({ error: 'magazyn_not_migrated' });
    logger.error('Blad pobierania magazynu materialow', { message: err.message, requestId: req.requestId });
    res.status(500).json({ error: req.t('errors.http.serverError') });
  }
});

router.post('/materialy', authMiddleware, validateBody(materialCreateSchema), async (req, res) => {
  try {
    const oddzialId = scopedOddzialId(req.user, req.body.oddzial_id) || req.user.oddzial_id;
    if (!oddzialId) return res.status(400).json({ error: 'oddzial_wymagany' });
    const { nazwa, jednostka, min_stan, koszt_jednostkowy, kod, kategoria } = req.body;
    const result = await pool.query(
      `INSERT INTO warehouse_materials
        (oddzial_id, nazwa, jednostka, min_stan, koszt_jednostkowy, kod, kategoria)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING id`,
      [oddzialId, nazwa, jednostka, min_stan, koszt_jednostkowy, kod || null, kategoria || null]
    );
    res.json({ id: result.rows[0].id });
  } catch (err) {
    if (err.code === '42P01') return res.status(404).json({ error: 'magazyn_not_migrated' });
    logger.error('Blad dodawania materialu magazynowego', { message: err.message, requestId: req.requestId });
    res.status(500).json({ error: req.t('errors.http.serverError') });
  }
});

router.post('/przyjecia', authMiddleware, validateBody(movementCreateSchema), async (req, res) => {
  try {
    return await createMovement(req, res, 'przyjecie');
  } catch (err) {
    if (err.code === '42P01') return res.status(404).json({ error: 'magazyn_not_migrated' });
    logger.error('Blad przyjecia materialu', { message: err.message, requestId: req.requestId });
    return res.status(500).json({ error: req.t('errors.http.serverError') });
  }
});

router.post('/rozchody', authMiddleware, validateBody(movementCreateSchema), async (req, res) => {
  try {
    return await createMovement(req, res, 'rozchod');
  } catch (err) {
    if (err.code === '42P01') return res.status(404).json({ error: 'magazyn_not_migrated' });
    logger.error('Blad rozchodu materialu', { message: err.message, requestId: req.requestId });
    return res.status(500).json({ error: req.t('errors.http.serverError') });
  }
});

router.get('/materialy/:id/ruchy', authMiddleware, validateParams(materialIdParamsSchema), async (req, res) => {
  try {
    const material = await getMaterialForWrite(req.params.id);
    if (!material) return res.status(404).json({ error: 'material_nieznaleziony' });
    if (!canUseBranch(req.user, material.oddzial_id)) return res.status(403).json({ error: 'brak_dostepu_oddzial' });
    const result = await pool.query(
      `SELECT wm.id, wm.typ, wm.ilosc, wm.koszt_jednostkowy, wm.task_id, wm.notatki, wm.created_at,
              t.klient_nazwa AS task_klient_nazwa, t.adres AS task_adres,
              u.imie AS user_imie, u.nazwisko AS user_nazwisko
         FROM warehouse_material_movements wm
         LEFT JOIN tasks t ON t.id = wm.task_id
         LEFT JOIN users u ON u.id = wm.user_id
        WHERE wm.material_id = $1
        ORDER BY wm.created_at DESC, wm.id DESC
        LIMIT 100`,
      [req.params.id]
    );
    return res.json(result.rows);
  } catch (err) {
    if (err.code === '42P01') return res.status(404).json({ error: 'magazyn_not_migrated' });
    logger.error('Blad historii materialu', { message: err.message, requestId: req.requestId });
    return res.status(500).json({ error: req.t('errors.http.serverError') });
  }
});

module.exports = router;
