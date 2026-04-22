const express = require('express');
const pool = require('../config/database');
const logger = require('../config/logger');
const { authMiddleware, requireNieBrygadzista } = require('../middleware/auth');
const { blockPayrollSettlements } = require('../middleware/payroll-policy');
const { validateQuery, validateBody, validateParams } = require('../middleware/validate');
const { z } = require('zod');

const router = express.Router();
const isDyrektor = (user) => user.rola === 'Dyrektor' || user.rola === 'Administrator';

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
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

const ekipaIdParamsSchema = z.object({
  id: z.coerce.number().int().positive(),
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

const ekipaCzlonkowieParamsSchema = z.object({
  id: z.coerce.number().int().positive(),
  userId: z.coerce.number().int().positive(),
});

router.get('/', authMiddleware, validateQuery(ekipaListQuerySchema), async (req, res) => {
  try {
    const { oddzial_id, limit, offset } = req.query;
    let where = '';
    let params = [];
    if (oddzial_id != null) {
      where = 'WHERE t.oddzial_id = $1';
      params = [oddzial_id];
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
    await pool.query('UPDATE tasks SET ekipa_id = NULL WHERE ekipa_id = $1', [req.params.id]);
    await pool.query('UPDATE delegacje SET ekipa_id = NULL WHERE ekipa_id = $1', [req.params.id]);
    await pool.query('UPDATE equipment_items SET ekipa_id = NULL WHERE ekipa_id = $1', [req.params.id]);
    await pool.query('UPDATE wyceny SET ekipa_id = NULL WHERE ekipa_id = $1', [req.params.id]);
    await pool.query('DELETE FROM team_members WHERE team_id = $1', [req.params.id]);
    await pool.query('DELETE FROM teams WHERE id = $1', [req.params.id]);
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
