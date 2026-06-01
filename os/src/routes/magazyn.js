const express = require('express');
const pool = require('../config/database');
const logger = require('../config/logger');
const { authMiddleware, isDyrektorOrAdmin } = require('../middleware/auth');
const { validateBody, validateParams, validateQuery } = require('../middleware/validate');
const { z } = require('zod');

const router = express.Router();

const materialQuerySchema = z.object({
  oddzial_id: z.coerce.number().int().positive().optional(),
  q: z.string().trim().max(120).optional(),
});

const materialCreateSchema = z.object({
  nazwa: z.string().trim().min(1).max(200),
  jednostka: z.string().trim().min(1).max(24).default('szt'),
  sku: z.string().trim().max(80).optional().nullable(),
  min_stan: z.coerce.number().min(0).optional().default(0),
  koszt_jednostkowy: z.coerce.number().min(0).optional().nullable(),
  oddzial_id: z.coerce.number().int().positive().optional().nullable(),
});

const movementSchema = z.object({
  material_id: z.coerce.number().int().positive(),
  typ: z.enum(['przyjecie', 'rozchod']),
  ilosc: z.coerce.number().positive(),
  task_id: z.coerce.number().int().positive().optional().nullable(),
  koszt_jednostkowy: z.coerce.number().min(0).optional().nullable(),
  notatka: z.string().trim().max(500).optional().nullable(),
});

const idParamsSchema = z.object({
  id: z.coerce.number().int().positive(),
});

function scopedBranch(user, requestedBranchId) {
  if (isDyrektorOrAdmin(user)) return requestedBranchId ?? null;
  return user.oddzial_id ?? null;
}

function canUseBranch(user, branchId) {
  return isDyrektorOrAdmin(user) || Number(user.oddzial_id) === Number(branchId);
}

router.get('/materialy', authMiddleware, validateQuery(materialQuerySchema), async (req, res) => {
  try {
    const params = [];
    const where = [];
    const oddzialId = scopedBranch(req.user, req.query.oddzial_id ? Number(req.query.oddzial_id) : null);
    if (oddzialId != null) {
      params.push(oddzialId);
      where.push(`m.oddzial_id = $${params.length}`);
    }
    if (req.query.q) {
      params.push(`%${req.query.q}%`);
      where.push(`(m.nazwa ILIKE $${params.length} OR m.sku ILIKE $${params.length})`);
    }
    const result = await pool.query(
      `SELECT m.id, m.oddzial_id, o.nazwa AS oddzial_nazwa, m.nazwa, m.jednostka, m.sku,
              m.min_stan, m.koszt_jednostkowy, m.stan, m.updated_at,
              CASE WHEN m.stan <= m.min_stan THEN 'low' ELSE 'ok' END AS stan_alert
         FROM inventory_materials m
         LEFT JOIN oddzialy o ON o.id = m.oddzial_id
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY stan_alert DESC, m.nazwa ASC`,
      params
    );
    res.json(result.rows);
  } catch (err) {
    if (err.code === '42P01') {
      return res.status(404).json({ error: 'magazyn_not_migrated' });
    }
    logger.error('Blad pobierania materialow magazynu', { message: err.message, requestId: req.requestId });
    res.status(500).json({ error: req.t('errors.http.serverError') });
  }
});

router.post('/materialy', authMiddleware, validateBody(materialCreateSchema), async (req, res) => {
  try {
    const oddzialId = scopedBranch(req.user, req.body.oddzial_id ? Number(req.body.oddzial_id) : null);
    if (!oddzialId) return res.status(400).json({ error: 'oddzial_wymagany' });
    if (!canUseBranch(req.user, oddzialId)) return res.status(403).json({ error: 'brak_dostepu_oddzial' });
    const result = await pool.query(
      `INSERT INTO inventory_materials (oddzial_id, nazwa, jednostka, sku, min_stan, koszt_jednostkowy, stan)
       VALUES ($1,$2,$3,$4,$5,$6,0)
       RETURNING id`,
      [
        oddzialId,
        req.body.nazwa,
        req.body.jednostka || 'szt',
        req.body.sku || null,
        req.body.min_stan || 0,
        req.body.koszt_jednostkowy ?? null,
      ]
    );
    res.json({ id: result.rows[0].id });
  } catch (err) {
    if (err.code === '42P01') {
      return res.status(404).json({ error: 'magazyn_not_migrated' });
    }
    logger.error('Blad tworzenia materialu magazynu', { message: err.message, requestId: req.requestId });
    res.status(500).json({ error: err.code === '23505' ? 'material_juz_istnieje' : req.t('errors.http.serverError') });
  }
});

router.post('/ruchy', authMiddleware, validateBody(movementSchema), async (req, res) => {
  try {
    const material = await pool.query(
      'SELECT id, oddzial_id, koszt_jednostkowy FROM inventory_materials WHERE id = $1',
      [req.body.material_id]
    );
    if (!material.rows[0]) return res.status(404).json({ error: 'material_nieznaleziony' });
    if (!canUseBranch(req.user, material.rows[0].oddzial_id)) return res.status(403).json({ error: 'brak_dostepu_oddzial' });
    if (req.body.typ === 'rozchod' && !req.body.task_id) {
      return res.status(400).json({ error: 'task_wymagany_dla_rozchodu' });
    }
    const multiplier = req.body.typ === 'przyjecie' ? 1 : -1;
    const qtyDelta = Number(req.body.ilosc) * multiplier;
    const update = await pool.query(
      `UPDATE inventory_materials
          SET stan = stan + $1::numeric, updated_at = NOW()
        WHERE id = $2
          AND ($1::numeric >= 0 OR stan >= ABS($1::numeric))
        RETURNING id, oddzial_id, stan`,
      [qtyDelta, req.body.material_id]
    );
    if (!update.rows[0]) return res.status(409).json({ error: 'stan_magazynu_za_maly' });
    const unitCost = req.body.koszt_jednostkowy ?? material.rows[0].koszt_jednostkowy ?? null;
    const movement = await pool.query(
      `INSERT INTO inventory_movements (
         material_id, oddzial_id, typ, ilosc, task_id, koszt_jednostkowy, notatka, user_id
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING id`,
      [
        req.body.material_id,
        update.rows[0].oddzial_id,
        req.body.typ,
        req.body.ilosc,
        req.body.task_id || null,
        unitCost,
        req.body.notatka || null,
        req.user.id,
      ]
    );
    res.json({ id: movement.rows[0].id, stan: update.rows[0].stan });
  } catch (err) {
    if (err.code === '42P01') {
      return res.status(404).json({ error: 'magazyn_not_migrated' });
    }
    logger.error('Blad ruchu magazynowego', { message: err.message, requestId: req.requestId });
    res.status(500).json({ error: req.t('errors.http.serverError') });
  }
});

router.get('/materialy/:id/ruchy', authMiddleware, validateParams(idParamsSchema), async (req, res) => {
  try {
    const material = await pool.query('SELECT id, oddzial_id FROM inventory_materials WHERE id = $1', [req.params.id]);
    if (!material.rows[0]) return res.status(404).json({ error: 'material_nieznaleziony' });
    if (!canUseBranch(req.user, material.rows[0].oddzial_id)) return res.status(403).json({ error: 'brak_dostepu_oddzial' });
    const result = await pool.query(
      `SELECT id, material_id, typ, ilosc, task_id, koszt_jednostkowy, notatka, created_at
         FROM inventory_movements
        WHERE material_id = $1
        ORDER BY created_at DESC, id DESC
        LIMIT 50`,
      [req.params.id]
    );
    res.json(result.rows);
  } catch (err) {
    if (err.code === '42P01') {
      return res.status(404).json({ error: 'magazyn_not_migrated' });
    }
    logger.error('Blad pobierania ruchow magazynu', { message: err.message, requestId: req.requestId });
    res.status(500).json({ error: req.t('errors.http.serverError') });
  }
});

module.exports = router;
