const express = require('express');
const bcrypt = require('bcryptjs');
const pool = require('../config/database');
const logger = require('../config/logger');
const { authMiddleware } = require('../middleware/auth');
const { validateQuery, validateBody, validateParams } = require('../middleware/validate');
const { getBranchResources, isEstimatorRole } = require('../services/branchResources');
const { z } = require('zod');

const router = express.Router();
const isDyrektor = (user) => user.rola === 'Dyrektor' || user.rola === 'Administrator';

const userListQuerySchema = z.object({
  rola: z.string().max(80).optional(),
  oddzial_id: z.coerce.number().int().positive().optional(),
  include_delegacje: z
    .preprocess((v) => (v === undefined ? false : ['1', 'true', true].includes(v)), z.boolean())
    .optional()
    .default(false),
  date: z.string().max(40).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

const userIdParamsSchema = z.object({
  id: z.coerce.number().int().positive(),
});

const userAktywnySchema = z.object({
  aktywny: z.boolean({
    required_error: 'Pole aktywny jest wymagane',
    invalid_type_error: 'Pole aktywny musi byc true lub false',
  }),
});

const userCreateSchema = z.object({
  login: z.string().trim().min(1, 'Login jest wymagany'),
  haslo: z.string().min(8, 'Nowe haslo musi miec min. 8 znakow'),
  imie: z.string().optional().nullable(),
  nazwisko: z.string().optional().nullable(),
  email: z.string().optional().nullable(),
  telefon: z.string().optional().nullable(),
  rola: z.string().trim().min(1, 'Rola jest wymagana'),
  oddzial_id: z
    .any()
    .optional()
    .transform((v) => {
      if (v === undefined || v === null || v === '') return null;
      const n = parseInt(String(v), 10);
      return Number.isNaN(n) ? null : n;
    }),
  stawka_godzinowa: z
    .any()
    .optional()
    .transform((v) => {
      if (v === undefined || v === null || v === '') return null;
      const n = parseFloat(String(v));
      return Number.isNaN(n) ? null : n;
    }),
});

router.get('/', authMiddleware, validateQuery(userListQuerySchema), async (req, res) => {
  try {
    const { limit, offset, rola, oddzial_id, include_delegacje, date } = req.query;
    if (!isDyrektor(req.user) && oddzial_id != null && Number(oddzial_id) !== Number(req.user.oddzial_id)) {
      return res.status(403).json({ error: req.t('errors.auth.forbidden') });
    }
    const targetBranchId = oddzial_id != null ? oddzial_id : (!isDyrektor(req.user) ? req.user.oddzial_id : null);
    if (include_delegacje && targetBranchId && rola && isEstimatorRole(rola)) {
      const resources = await getBranchResources(pool, targetBranchId, date);
      const rows = resources.wyceniajacy;
      if (limit != null) {
        const lim = Number(limit);
        const off = Number(offset ?? 0);
        return res.json({ items: rows.slice(off, off + lim), total: rows.length, limit: lim, offset: off });
      }
      return res.json(rows);
    }

    const params = [];
    const where = [];
    if (targetBranchId) {
      params.push(targetBranchId);
      where.push(`oddzial_id = $${params.length}`);
    }
    if (rola) {
      if (isEstimatorRole(rola)) {
        where.push(`LOWER(COALESCE(rola, '')) LIKE 'wyceniaj%'`);
      } else {
        params.push(rola);
        where.push(`rola = $${params.length}`);
      }
    }
    const whereSql = where.length ? ` WHERE ${where.join(' AND ')}` : '';
    const baseSql =
      `SELECT id, login, imie, nazwisko, email, telefon, rola, oddzial_id, stawka_godzinowa, aktywny FROM users${whereSql}`;
    const orderBy = 'ORDER BY rola, nazwisko';

    if (limit != null) {
      const lim = Number(limit);
      const off = Number(offset ?? 0);
      const countR = await pool.query(`SELECT COUNT(*)::int AS c FROM users${whereSql}`, params);
      const total = countR.rows[0]?.c ?? 0;
      const result = await pool.query(
        `${baseSql} ${orderBy} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, lim, off]
      );
      return res.json({ items: result.rows, total, limit: lim, offset: off });
    }

    const result = await pool.query(`${baseSql} ${orderBy}`, params);
    res.json(result.rows);
  } catch (err) {
    logger.error('Blad pobierania uzytkownikow', { message: err.message, requestId: req.requestId });
    res.status(500).json({ error: req.t('errors.http.serverError') });
  }
});

router.post('/', authMiddleware, validateBody(userCreateSchema), async (req, res) => {
  try {
    const { login, haslo, imie, nazwisko, email, telefon, rola, oddzial_id, stawka_godzinowa } = req.body;
    const haslo_hash = await bcrypt.hash(haslo, 12);
    const result = await pool.query(
      `INSERT INTO users (login, haslo_hash, imie, nazwisko, email, telefon, rola, oddzial_id, stawka_godzinowa)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
      [login, haslo_hash, imie, nazwisko, email, telefon, rola, oddzial_id || null, stawka_godzinowa || null]
    );
    res.json({ id: result.rows[0].id, message: 'Uzytkownik utworzony' });
  } catch (err) {
    logger.error('Blad tworzenia uzytkownika', { message: err.message, requestId: req.requestId });
    if (err.code === '23505') {
      res.status(400).json({ error: req.t('errors.user.loginExists') });
    } else {
      res.status(500).json({ error: req.t('errors.http.serverError') });
    }
  }
});

router.put('/:id/aktywny', authMiddleware, validateParams(userIdParamsSchema), validateBody(userAktywnySchema), async (req, res) => {
  try {
    const { aktywny } = req.body;
    await pool.query('UPDATE users SET aktywny = $1 WHERE id = $2', [aktywny, req.params.id]);
    res.json({ message: 'Status zmieniony' });
  } catch (err) {
    logger.error('Blad aktualizacji statusu aktywnosci', { message: err.message, requestId: req.requestId });
    res.status(500).json({ error: req.t('errors.http.serverError') });
  }
});

module.exports = router;
