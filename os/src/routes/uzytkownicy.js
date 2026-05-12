const express = require('express');
const bcrypt = require('bcryptjs');
const pool = require('../config/database');
const logger = require('../config/logger');
const {
  authMiddleware,
  isDyrektor,
  isSalesDirector,
  canTransferSpecialist,
} = require('../middleware/auth');
const { validateQuery, validateBody, validateParams } = require('../middleware/validate');
const { z } = require('zod');

const router = express.Router();

const userListQuerySchema = z.object({
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

const userOddzialSchema = z.object({
  oddzial_id: z.coerce.number().int().positive(),
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

const SALES_DIRECTOR_ROLE_VALUES = new Set([
  'Dyrektor Sprzedazy',
  'Dyrektor Sprzedaży',
  'Dyrektor dzialu sprzedaz',
  'Dyrektor działu sprzedaż',
]);

const HIGH_PRIVILEGE_ROLES = new Set([
  'Prezes',
  'Dyrektor',
  'Administrator',
  'Kierownik',
  ...SALES_DIRECTOR_ROLE_VALUES,
]);

const userSelectSql = `
  SELECT u.id, u.login, u.imie, u.nazwisko, u.email, u.telefon, u.rola,
         u.oddzial_id, b.nazwa AS oddzial_nazwa, u.stawka_godzinowa, u.aktywny
  FROM users u
  LEFT JOIN branches b ON b.id = u.oddzial_id`;

const userOrderSql = 'ORDER BY u.rola, u.nazwisko';

const buildUserScope = (user, startParam = 1) => {
  if (isDyrektor(user)) return { clause: '', params: [] };
  if (isSalesDirector(user)) {
    return { clause: `(u.rola = 'Specjalista' OR u.id = $${startParam})`, params: [user.id] };
  }
  if (user.oddzial_id != null) {
    return { clause: `u.oddzial_id = $${startParam}`, params: [user.oddzial_id] };
  }
  return { clause: `u.id = $${startParam}`, params: [user.id] };
};

const canCreateUserWithRole = (actor, rola) => {
  if (isDyrektor(actor)) return true;
  if (actor?.rola === 'Kierownik') return !HIGH_PRIVILEGE_ROLES.has(rola);
  return false;
};

const canManageTargetUser = (actor, target) => {
  if (isDyrektor(actor)) return true;
  if (actor?.rola === 'Kierownik') {
    return (
      Number(actor.oddzial_id) === Number(target?.oddzial_id) &&
      !HIGH_PRIVILEGE_ROLES.has(target?.rola)
    );
  }
  return false;
};

router.get('/', authMiddleware, validateQuery(userListQuerySchema), async (req, res) => {
  try {
    const { limit, offset } = req.query;
    const scope = buildUserScope(req.user, 1);
    const whereSql = scope.clause ? `WHERE ${scope.clause}` : '';

    if (limit != null) {
      const lim = Number(limit);
      const off = Number(offset ?? 0);
      const countR = await pool.query(
        `SELECT COUNT(*)::int AS c FROM users u ${whereSql}`,
        scope.params
      );
      const total = countR.rows[0]?.c ?? 0;
      const result = await pool.query(
        `${userSelectSql} ${whereSql} ${userOrderSql} LIMIT $${scope.params.length + 1} OFFSET $${scope.params.length + 2}`,
        [...scope.params, lim, off]
      );
      return res.json({ items: result.rows, total, limit: lim, offset: off });
    }

    const result = await pool.query(`${userSelectSql} ${whereSql} ${userOrderSql}`, scope.params);
    res.json(result.rows);
  } catch (err) {
    logger.error('Blad pobierania uzytkownikow', { message: err.message, requestId: req.requestId });
    res.status(500).json({ error: req.t('errors.http.serverError') });
  }
});

router.post('/', authMiddleware, validateBody(userCreateSchema), async (req, res) => {
  try {
    const { login, haslo, imie, nazwisko, email, telefon, rola, oddzial_id, stawka_godzinowa } = req.body;
    if (!canCreateUserWithRole(req.user, rola)) {
      return res.status(403).json({ error: req.t('errors.auth.forbidden') });
    }
    const finalOddzialId = (isDyrektor(req.user) || isSalesDirector(req.user))
      ? (oddzial_id || null)
      : (req.user.oddzial_id || null);
    if (!isDyrektor(req.user) && !finalOddzialId) {
      return res.status(400).json({ error: 'Oddzial jest wymagany' });
    }
    const haslo_hash = await bcrypt.hash(haslo, 12);
    const result = await pool.query(
      `INSERT INTO users (login, haslo_hash, imie, nazwisko, email, telefon, rola, oddzial_id, stawka_godzinowa)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
      [login, haslo_hash, imie, nazwisko, email, telefon, rola, finalOddzialId, stawka_godzinowa || null]
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
    const target = await pool.query('SELECT id, rola, oddzial_id FROM users WHERE id = $1', [req.params.id]);
    if (!target.rows.length) return res.status(404).json({ error: req.t('errors.user.notFound') });
    if (!canManageTargetUser(req.user, target.rows[0])) {
      return res.status(403).json({ error: req.t('errors.auth.forbidden') });
    }
    await pool.query('UPDATE users SET aktywny = $1 WHERE id = $2', [aktywny, req.params.id]);
    res.json({ message: 'Status zmieniony' });
  } catch (err) {
    logger.error('Blad aktualizacji statusu aktywnosci', { message: err.message, requestId: req.requestId });
    res.status(500).json({ error: req.t('errors.http.serverError') });
  }
});

const przeniesOddzialHandler = async (req, res) => {
  try {
    const { oddzial_id } = req.body;
    const target = await pool.query('SELECT id, rola, oddzial_id FROM users WHERE id = $1', [req.params.id]);
    if (!target.rows.length) return res.status(404).json({ error: req.t('errors.user.notFound') });
    if (!canTransferSpecialist(req.user, target.rows[0])) {
      return res.status(403).json({ error: req.t('errors.auth.forbidden') });
    }
    const branch = await pool.query('SELECT id FROM branches WHERE id = $1', [oddzial_id]);
    if (!branch.rows.length) return res.status(400).json({ error: 'Nieprawidlowy oddzial' });

    await pool.query('UPDATE users SET oddzial_id = $1 WHERE id = $2', [oddzial_id, req.params.id]);
    const refreshed = await pool.query(`${userSelectSql} WHERE u.id = $1`, [req.params.id]);
    res.json(refreshed.rows[0]);
  } catch (err) {
    logger.error('Blad przenoszenia specjalisty', { message: err.message, requestId: req.requestId });
    res.status(500).json({ error: req.t('errors.http.serverError') });
  }
};

router.patch('/:id/oddzial', authMiddleware, validateParams(userIdParamsSchema), validateBody(userOddzialSchema), przeniesOddzialHandler);
router.put('/:id/oddzial', authMiddleware, validateParams(userIdParamsSchema), validateBody(userOddzialSchema), przeniesOddzialHandler);

module.exports = router;
