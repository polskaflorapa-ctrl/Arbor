const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const logger = require('../config/logger');
const { authMiddleware, requireRole } = require('../middleware/auth');
const { logAudit } = require('../services/audit');
const { validateQuery, validateBody, validateParams } = require('../middleware/validate');
const { z } = require('zod');

const PERMISSIONS_SCHEMA = [
  { group: 'Zlecenia', permissions: [
    { key: 'zlecenia_widok', label: 'Przeglądanie zleceń' },
    { key: 'zlecenia_tworzenie', label: 'Tworzenie zleceń' },
    { key: 'zlecenia_edycja', label: 'Edycja zleceń' },
    { key: 'zlecenia_usuniecie', label: 'Usuwanie zleceń' },
  ]},
  { group: 'Wyceny', permissions: [
    { key: 'wyceny_widok', label: 'Przeglądanie wycen' },
    { key: 'wyceny_tworzenie', label: 'Tworzenie wycen' },
    { key: 'wyceny_zatwierdzanie', label: 'Zatwierdzanie wycen' },
  ]},
  { group: 'Użytkownicy', permissions: [
    { key: 'uzytkownicy_widok', label: 'Przeglądanie użytkowników' },
    { key: 'uzytkownicy_tworzenie', label: 'Tworzenie użytkowników' },
    { key: 'uzytkownicy_edycja', label: 'Edycja użytkowników' },
    { key: 'role_zarzadzanie', label: 'Zarządzanie rolami' },
  ]},
  { group: 'Raporty', permissions: [
    { key: 'raporty_widok', label: 'Przeglądanie raportów' },
    { key: 'raporty_eksport', label: 'Eksport raportów' },
    { key: 'rozliczenia_widok', label: 'Przeglądanie rozliczeń' },
  ]},
];

function defaultPermissions() {
  const perms = {};
  PERMISSIONS_SCHEMA.forEach(g => g.permissions.forEach(p => { perms[p.key] = false; }));
  return perms;
}

const roleListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

const roleIdParamsSchema = z.object({
  id: z.coerce.number().int().positive(),
});

const roleCreateSchema = z.object({
  nazwa: z.string().trim().min(1, 'Nazwa roli jest wymagana'),
  kolor: z.string().max(30).optional().nullable(),
  opis: z.string().optional().nullable(),
  poziom: z.coerce.number().int().min(0).max(999).optional(),
  uprawnienia: z.record(z.boolean()).optional(),
});

const roleUpdateSchema = z.object({
  nazwa: z.string().trim().min(1).optional().nullable(),
  kolor: z.string().max(30).optional().nullable(),
  opis: z.string().optional().nullable(),
  poziom: z.coerce.number().int().min(0).max(999).optional().nullable(),
  uprawnienia: z.record(z.boolean()).optional(),
  aktywna: z.boolean().optional(),
});

router.get('/', authMiddleware, validateQuery(roleListQuerySchema), async (req, res) => {
  try {
    const { limit, offset } = req.query;
    const orderBy = 'ORDER BY poziom DESC, nazwa ASC';
    if (limit != null) {
      const lim = Number(limit);
      const off = Number(offset ?? 0);
      const countR = await pool.query('SELECT COUNT(*)::int AS c FROM role');
      const total = countR.rows[0]?.c ?? 0;
      const { rows } = await pool.query(`SELECT * FROM role ${orderBy} LIMIT $1 OFFSET $2`, [lim, off]);
      return res.json({ items: rows, total, limit: lim, offset: off });
    }
    const { rows } = await pool.query(`SELECT * FROM role ${orderBy}`);
    res.json(rows);
  } catch (e) { logger.error('Blad role GET /', { message: e.message, requestId: req.requestId }); res.status(500).json({ error: req.t('errors.http.serverError') }); }
});

router.get('/permissions/schema', authMiddleware, (req, res) => res.json(PERMISSIONS_SCHEMA));

router.get('/:id', authMiddleware, validateParams(roleIdParamsSchema), async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM role WHERE id=$1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: req.t('errors.role.roleNotFound') });
    res.json(rows[0]);
  } catch (e) { logger.error('Blad role GET /:id', { message: e.message, requestId: req.requestId }); res.status(500).json({ error: req.t('errors.http.serverError') }); }
});

router.post('/', authMiddleware, requireRole('Dyrektor', 'Administrator'), validateBody(roleCreateSchema), async (req, res) => {
  const { nazwa, kolor, opis, poziom, uprawnienia } = req.body;
  try {
    const { rows } = await pool.query(
      `INSERT INTO role (nazwa, kolor, opis, poziom, uprawnienia) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [nazwa.trim(), kolor || '#94A3B8', opis || null, poziom ?? 1, JSON.stringify(uprawnienia || defaultPermissions())]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(400).json({ error: req.t('errors.role.roleNameExists') });
    logger.error('Blad role POST /', { message: e.message, requestId: req.requestId });
    res.status(500).json({ error: req.t('errors.http.serverError') });
  }
});

router.put('/:id', authMiddleware, requireRole('Dyrektor', 'Administrator'), validateParams(roleIdParamsSchema), validateBody(roleUpdateSchema), async (req, res) => {
  const { nazwa, kolor, opis, poziom, uprawnienia, aktywna } = req.body;
  try {
    const check = await pool.query('SELECT stala FROM role WHERE id=$1', [req.params.id]);
    if (!check.rows.length) return res.status(404).json({ error: req.t('errors.role.roleNotFound') });
    const { rows } = await pool.query(
      `UPDATE role SET
        nazwa=CASE WHEN $1 THEN nazwa ELSE COALESCE($2,nazwa) END,
        kolor=COALESCE($3,kolor), opis=COALESCE($4,opis),
        poziom=CASE WHEN $1 THEN poziom ELSE COALESCE($5,poziom) END,
        uprawnienia=COALESCE($6::jsonb,uprawnienia), aktywna=COALESCE($7,aktywna)
       WHERE id=$8 RETURNING *`,
      [check.rows[0].stala, nazwa || null, kolor || null, opis || null, poziom ?? null,
        uprawnienia ? JSON.stringify(uprawnienia) : null, aktywna !== undefined ? aktywna : null, req.params.id]
    );
    res.json(rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(400).json({ error: req.t('errors.role.roleNameExists') });
    logger.error('Blad role PUT /:id', { message: e.message, requestId: req.requestId });
    res.status(500).json({ error: req.t('errors.http.serverError') });
  }
});

router.delete('/:id', authMiddleware, requireRole('Dyrektor', 'Administrator'), validateParams(roleIdParamsSchema), async (req, res) => {
  try {
    const check = await pool.query('SELECT stala, nazwa FROM role WHERE id=$1', [req.params.id]);
    if (!check.rows.length) return res.status(404).json({ error: req.t('errors.role.roleNotFound') });
    if (check.rows[0].stala) return res.status(400).json({ error: req.t('errors.role.cannotDeleteSystem') });
    const inUse = await pool.query('SELECT COUNT(*) FROM users WHERE rola=$1', [check.rows[0].nazwa]);
    if (parseInt(inUse.rows[0].count, 10) > 0) {
      return res.status(400).json({ error: req.tv('errors.role.cannotDeleteInUse', { count: inUse.rows[0].count }) });
    }
    await pool.query('DELETE FROM role WHERE id=$1', [req.params.id]);
    await logAudit(pool, req, {
      action: 'role_deleted',
      entityType: 'role',
      entityId: req.params.id,
      metadata: { nazwa: check.rows[0].nazwa },
    });
    res.json({ message: 'Rola usunięta' });
  } catch (e) { logger.error('Blad role DELETE /:id', { message: e.message, requestId: req.requestId }); res.status(500).json({ error: req.t('errors.http.serverError') }); }
});

module.exports = router;
