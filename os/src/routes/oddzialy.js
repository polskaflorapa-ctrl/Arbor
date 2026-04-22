const express = require('express');
const pool = require('../config/database');
const logger = require('../config/logger');
const { authMiddleware, requireNieBrygadzista } = require('../middleware/auth');
const { validateQuery, validateBody, validateParams } = require('../middleware/validate');
const { z } = require('zod');

const router = express.Router();
const isDyrektor = (user) => user.rola === 'Dyrektor' || user.rola === 'Administrator';

const oddzialListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

const oddzialIdParamsSchema = z.object({
  id: z.coerce.number().int().positive(),
});

const oddzialCreateSchema = z.object({
  nazwa: z.string().trim().min(1, 'Nazwa oddzialu jest wymagana'),
  adres: z.string().optional().nullable(),
  miasto: z.string().max(100).optional().nullable(),
  kod_pocztowy: z.string().max(10).optional().nullable(),
  telefon: z.string().max(30).optional().nullable(),
  email: z.string().max(255).optional().nullable(),
  kierownik_id: z.coerce.number().int().positive().optional().nullable(),
});

const oddzialUpdateSchema = oddzialCreateSchema.partial();

const przeniesPracownikSchema = z.object({
  oddzial_id: z.coerce.number().int().positive(),
});

const delegacjaCreateSchema = z.object({
  ekipa_id: z.coerce.number().int().positive(),
  oddzial_z: z.coerce.number().int().positive(),
  oddzial_do: z.coerce.number().int().positive(),
  data_od: z.string().max(30),
  data_do: z.string().max(30).optional().nullable(),
  cel: z.string().max(500).optional().nullable(),
  uwagi: z.string().optional().nullable(),
});

const delegacjaIdParamsSchema = z.object({
  id: z.coerce.number().int().positive(),
});

const delegacjaStatusSchema = z.object({
  status: z.string().trim().min(1).max(50),
});

const pracownikUserIdParamsSchema = z.object({
  userId: z.coerce.number().int().positive(),
});

const delegacjeListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

// Lista oddziałów
router.get('/', authMiddleware, validateQuery(oddzialListQuerySchema), async (req, res) => {
  try {
    const { limit, offset } = req.query;
    const base = `
      FROM branches b
      LEFT JOIN teams t ON t.oddzial_id = b.id AND t.aktywny = true
      LEFT JOIN users u ON u.oddzial_id = b.id AND u.aktywny = true
      LEFT JOIN users km ON km.id = b.kierownik_id`;
    const groupBy = 'GROUP BY b.id, km.imie, km.nazwisko, km.telefon';
    const selectBody = `
      SELECT b.*,
        COUNT(DISTINCT t.id) as liczba_ekip,
        COUNT(DISTINCT u.id) as liczba_pracownikow,
        km.imie as kierownik_imie,
        km.nazwisko as kierownik_nazwisko,
        km.telefon as kierownik_telefon
      ${base}
      ${groupBy}
      ORDER BY b.nazwa`;
    if (limit != null) {
      const lim = Number(limit);
      const off = Number(offset ?? 0);
      const countR = await pool.query(`SELECT COUNT(*)::int AS c FROM (SELECT b.id ${base} ${groupBy}) sub`);
      const total = countR.rows[0]?.c ?? 0;
      const { rows } = await pool.query(`${selectBody} LIMIT $1 OFFSET $2`, [lim, off]);
      return res.json({ items: rows, total, limit: lim, offset: off });
    }
    const result = await pool.query(selectBody);
    res.json(result.rows);
  } catch (err) {
    logger.error('Blad pobierania oddzialow', { message: err.message, requestId: req.requestId });
    res.status(500).json({ error: req.t('errors.http.serverError') });
  }
});

router.get('/delegacje/wszystkie', authMiddleware, validateQuery(delegacjeListQuerySchema), async (req, res) => {
  try {
    const { limit, offset } = req.query;
    const selectList = `
      SELECT d.*,
        t.nazwa as ekipa_nazwa,
        bo.nazwa as oddzial_z_nazwy,
        bd.nazwa as oddzial_do_nazwy,
        u.imie || ' ' || u.nazwisko as dodal_nazwa
      FROM delegacje d
      LEFT JOIN teams t ON d.ekipa_id = t.id
      LEFT JOIN branches bo ON d.oddzial_z = bo.id
      LEFT JOIN branches bd ON d.oddzial_do = bd.id
      LEFT JOIN users u ON d.dodal_id = u.id
      ORDER BY d.data_od DESC`;
    if (limit != null) {
      const lim = Number(limit);
      const off = Number(offset ?? 0);
      const countR = await pool.query('SELECT COUNT(*)::int AS c FROM delegacje');
      const total = countR.rows[0]?.c ?? 0;
      const result = await pool.query(`${selectList} LIMIT $1 OFFSET $2`, [lim, off]);
      return res.json({ items: result.rows, total, limit: lim, offset: off });
    }
    const result = await pool.query(selectList);
    res.json(result.rows);
  } catch (err) {
    logger.error('Blad pobierania wszystkich delegacji', { message: err.message, requestId: req.requestId });
    res.status(500).json({ error: req.t('errors.http.serverError') });
  }
});

router.post('/delegacje', authMiddleware, requireNieBrygadzista, validateBody(delegacjaCreateSchema), async (req, res) => {
  try {
    const { ekipa_id, oddzial_z, oddzial_do, data_od, data_do, cel, uwagi } = req.body;
    const result = await pool.query(
      `INSERT INTO delegacje (ekipa_id, oddzial_z, oddzial_do, data_od, data_do, cel, uwagi, dodal_id, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'Planowana') RETURNING id`,
      [ekipa_id, oddzial_z, oddzial_do, data_od, data_do || null, cel, uwagi || null, req.user.id]
    );
    res.json({ id: result.rows[0].id, message: 'Delegacja dodana' });
  } catch (err) {
    logger.error('Blad dodawania delegacji', { message: err.message, requestId: req.requestId });
    res.status(500).json({ error: req.t('errors.http.serverError') });
  }
});

router.put('/delegacje/:id/status', authMiddleware, requireNieBrygadzista, validateParams(delegacjaIdParamsSchema), validateBody(delegacjaStatusSchema), async (req, res) => {
  try {
    const { status } = req.body;
    await pool.query('UPDATE delegacje SET status = $1 WHERE id = $2', [status, req.params.id]);
    res.json({ message: 'Status zmieniony' });
  } catch (err) {
    logger.error('Blad aktualizacji statusu delegacji', { message: err.message, requestId: req.requestId });
    res.status(500).json({ error: req.t('errors.http.serverError') });
  }
});

router.put('/pracownik/:userId/przenies', authMiddleware, validateParams(pracownikUserIdParamsSchema), validateBody(przeniesPracownikSchema), async (req, res) => {
  try {
    if (!isDyrektor(req.user)) return res.status(403).json({ error: req.t('errors.auth.forbidden') });
    const { oddzial_id } = req.body;
    await pool.query('UPDATE users SET oddzial_id = $1 WHERE id = $2', [oddzial_id, req.params.userId]);
    res.json({ message: 'Pracownik przeniesiony' });
  } catch (err) {
    logger.error('Blad przenoszenia pracownika', { message: err.message, requestId: req.requestId });
    res.status(500).json({ error: req.t('errors.http.serverError') });
  }
});

router.get('/:id/delegacje', authMiddleware, validateParams(oddzialIdParamsSchema), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT d.*,
        t.nazwa as ekipa_nazwa,
        bo.nazwa as oddzial_z_nazwy,
        bd.nazwa as oddzial_do_nazwy,
        u.imie || ' ' || u.nazwisko as dodal_nazwa
       FROM delegacje d
       LEFT JOIN teams t ON d.ekipa_id = t.id
       LEFT JOIN branches bo ON d.oddzial_z = bo.id
       LEFT JOIN branches bd ON d.oddzial_do = bd.id
       LEFT JOIN users u ON d.dodal_id = u.id
       WHERE d.oddzial_z = $1 OR d.oddzial_do = $1
       ORDER BY d.data_od DESC`,
      [req.params.id]
    );
    res.json(result.rows);
  } catch (err) {
    logger.error('Blad pobierania delegacji oddzialu', { message: err.message, requestId: req.requestId });
    res.status(500).json({ error: req.t('errors.http.serverError') });
  }
});

router.get('/:id', authMiddleware, validateParams(oddzialIdParamsSchema), async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT b.*,
        km.imie as kierownik_imie,
        km.nazwisko as kierownik_nazwisko,
        km.telefon as kierownik_telefon,
        km.email as kierownik_email
      FROM branches b
      LEFT JOIN users km ON km.id = b.kierownik_id
      WHERE b.id = $1
    `, [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: req.t('errors.generic.notFound') });

    const pracownicy = await pool.query(
      `SELECT id, imie, nazwisko, rola, telefon, email, aktywny, stawka_godzinowa, procent_wynagrodzenia
       FROM users WHERE oddzial_id = $1 ORDER BY rola, nazwisko`,
      [req.params.id]
    );
    const ekipy = await pool.query(
      `SELECT t.*, u.imie as brygadzista_imie, u.nazwisko as brygadzista_nazwisko
       FROM teams t LEFT JOIN users u ON t.brygadzista_id = u.id
       WHERE t.oddzial_id = $1`,
      [req.params.id]
    );

    res.json({ ...result.rows[0], pracownicy: pracownicy.rows, ekipy: ekipy.rows });
  } catch (err) {
    logger.error('Blad pobierania oddzialu po id', { message: err.message, requestId: req.requestId });
    res.status(500).json({ error: req.t('errors.http.serverError') });
  }
});

router.post('/', authMiddleware, validateBody(oddzialCreateSchema), async (req, res) => {
  try {
    if (!isDyrektor(req.user)) return res.status(403).json({ error: req.t('errors.auth.forbidden') });
    const { nazwa, adres, miasto, kod_pocztowy, telefon, email, kierownik_id } = req.body;
    const result = await pool.query(
      `INSERT INTO branches (nazwa, adres, miasto, kod_pocztowy, telefon, email, kierownik_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [nazwa, adres, miasto, kod_pocztowy, telefon || null, email || null, kierownik_id || null]
    );
    res.json({ id: result.rows[0].id, message: 'Oddzial utworzony' });
  } catch (err) {
    logger.error('Blad tworzenia oddzialu', { message: err.message, requestId: req.requestId });
    res.status(500).json({ error: req.t('errors.http.serverError') });
  }
});

router.put('/:id', authMiddleware, validateParams(oddzialIdParamsSchema), validateBody(oddzialUpdateSchema), async (req, res) => {
  try {
    if (!isDyrektor(req.user)) return res.status(403).json({ error: req.t('errors.auth.forbidden') });
    const { nazwa, adres, miasto, kod_pocztowy, telefon, email, kierownik_id } = req.body;
    await pool.query(
      `UPDATE branches SET nazwa=COALESCE($1,nazwa), adres=COALESCE($2,adres), miasto=COALESCE($3,miasto), kod_pocztowy=COALESCE($4,kod_pocztowy),
       telefon=COALESCE($5,telefon), email=COALESCE($6,email), kierownik_id=COALESCE($7,kierownik_id) WHERE id=$8`,
      [nazwa ?? null, adres ?? null, miasto ?? null, kod_pocztowy ?? null, telefon ?? null, email ?? null, kierownik_id ?? null, req.params.id]
    );
    res.json({ message: 'Zaktualizowano' });
  } catch (err) {
    logger.error('Blad aktualizacji oddzialu', { message: err.message, requestId: req.requestId });
    res.status(500).json({ error: req.t('errors.http.serverError') });
  }
});

router.delete('/:id', authMiddleware, validateParams(oddzialIdParamsSchema), async (req, res) => {
  try {
    if (!isDyrektor(req.user)) return res.status(403).json({ error: req.t('errors.auth.forbidden') });
    const check = await pool.query(
      'SELECT COUNT(*) as cnt FROM users WHERE oddzial_id = $1 AND aktywny = true',
      [req.params.id]
    );
    if (parseInt(check.rows[0].cnt, 10) > 0) {
      return res.status(400).json({ error: req.t('errors.branch.cannotDeleteWithActiveEmployees') });
    }
    await pool.query('UPDATE teams SET oddzial_id = NULL WHERE oddzial_id = $1', [req.params.id]);
    await pool.query('DELETE FROM branches WHERE id = $1', [req.params.id]);
    res.json({ message: 'Usunieto' });
  } catch (err) {
    logger.error('Blad usuwania oddzialu', { message: err.message, requestId: req.requestId });
    res.status(500).json({ error: req.t('errors.http.serverError') });
  }
});

module.exports = router;
