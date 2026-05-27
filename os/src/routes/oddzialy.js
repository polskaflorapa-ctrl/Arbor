const express = require('express');
const pool = require('../config/database');
const logger = require('../config/logger');
const {
  authMiddleware,
  requireNieBrygadzista,
  isDyrektor,
  isSalesDirector,
  canTransferSpecialist,
} = require('../middleware/auth');
const { validateQuery, validateBody, validateParams } = require('../middleware/validate');
const { getBranchResources, ensureDelegationResourceSchema, isEstimatorRole, toId } = require('../services/branchResources');
const { z } = require('zod');

const router = express.Router();
const canSeeAllOddzialy = (user) => isDyrektor(user) || isSalesDirector(user);

const oddzialListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

const branchReportingQuerySchema = z.object({
  rok: z.coerce.number().int().min(2000).max(2100),
  miesiac: z.coerce.number().int().min(1).max(12),
});

const branchGoalBodySchema = branchReportingQuerySchema.extend({
  oddzial_id: z.coerce.number().int().positive(),
  plan_zlecen: z.coerce.number().min(0).default(0),
  plan_obrotu: z.coerce.number().min(0).default(0),
  plan_marzy: z.coerce.number().min(0).default(0),
});

const branchSalesBodySchema = branchReportingQuerySchema.extend({
  oddzial_id: z.coerce.number().int().positive(),
  calls_total: z.coerce.number().int().min(0).default(0),
  calls_answered: z.coerce.number().int().min(0).default(0),
  calls_missed: z.coerce.number().int().min(0).default(0),
  leads_new: z.coerce.number().int().min(0).default(0),
  meetings_booked: z.coerce.number().int().min(0).default(0),
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

const optionalResourceId = z
  .any()
  .optional()
  .nullable()
  .transform((v) => toId(v));

const delegacjaCreateSchema = z.object({
  zasob_typ: z.enum(['ekipa', 'wyceniajacy']).optional(),
  ekipa_id: optionalResourceId,
  user_id: optionalResourceId,
  wyceniajacy_id: optionalResourceId,
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

const branchResourcesQuerySchema = z.object({
  date: z.string().max(40).optional(),
});

const delegationSelectList = `
      SELECT d.*,
        COALESCE(d.zasob_typ, CASE WHEN d.ekipa_id IS NOT NULL THEN 'ekipa' ELSE 'wyceniajacy' END) as zasob_typ,
        t.nazwa as ekipa_nazwa,
        wu.imie as user_imie,
        wu.nazwisko as user_nazwisko,
        wu.login as user_login,
        NULLIF(TRIM(COALESCE(wu.imie, '') || ' ' || COALESCE(wu.nazwisko, '')), '') as user_nazwa,
        COALESCE(
          t.nazwa,
          NULLIF(TRIM(COALESCE(wu.imie, '') || ' ' || COALESCE(wu.nazwisko, '')), ''),
          wu.login
        ) as zasob_nazwa,
        bo.nazwa as oddzial_z_nazwy,
        bo.nazwa as oddzial_z_nazwa,
        bd.nazwa as oddzial_do_nazwy,
        bd.nazwa as oddzial_do_nazwa,
        u.imie || ' ' || u.nazwisko as dodal_nazwa
      FROM delegacje d
      LEFT JOIN teams t ON d.ekipa_id = t.id
      LEFT JOIN users wu ON COALESCE(d.user_id, d.wyceniajacy_id) = wu.id
      LEFT JOIN branches bo ON d.oddzial_z = bo.id
      LEFT JOIN branches bd ON d.oddzial_do = bd.id
      LEFT JOIN users u ON d.dodal_id = u.id`;

async function ensureBranchReportingTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS branch_goals (
      id SERIAL PRIMARY KEY,
      oddzial_id INTEGER NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
      rok INTEGER NOT NULL,
      miesiac INTEGER NOT NULL CHECK (miesiac BETWEEN 1 AND 12),
      plan_zlecen INTEGER NOT NULL DEFAULT 0,
      plan_obrotu NUMERIC(12,2) NOT NULL DEFAULT 0,
      plan_marzy NUMERIC(8,2) NOT NULL DEFAULT 0,
      updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (oddzial_id, rok, miesiac)
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS branch_sales_metrics (
      id SERIAL PRIMARY KEY,
      oddzial_id INTEGER NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
      rok INTEGER NOT NULL,
      miesiac INTEGER NOT NULL CHECK (miesiac BETWEEN 1 AND 12),
      calls_total INTEGER NOT NULL DEFAULT 0,
      calls_answered INTEGER NOT NULL DEFAULT 0,
      calls_missed INTEGER NOT NULL DEFAULT 0,
      leads_new INTEGER NOT NULL DEFAULT 0,
      meetings_booked INTEGER NOT NULL DEFAULT 0,
      updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (oddzial_id, rok, miesiac)
    )
  `);
}

function branchReportingScope(user, params) {
  if (canSeeAllOddzialy(user)) return { where: '', params };
  return { where: ` AND oddzial_id = $${params.length + 1}`, params: [...params, user.oddzial_id] };
}

// Lista oddziałów
router.get('/', authMiddleware, validateQuery(oddzialListQuerySchema), async (req, res) => {
  try {
    const { limit, offset } = req.query;
    const scoped = !canSeeAllOddzialy(req.user);
    const whereSql = scoped ? 'WHERE b.id = $1' : '';
    const params = scoped ? [req.user.oddzial_id] : [];
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
      ${whereSql}
      ${groupBy}
      ORDER BY b.nazwa`;
    if (limit != null) {
      const lim = Number(limit);
      const off = Number(offset ?? 0);
      const countR = await pool.query(`SELECT COUNT(*)::int AS c FROM (SELECT b.id ${base} ${whereSql} ${groupBy}) sub`, params);
      const total = countR.rows[0]?.c ?? 0;
      const { rows } = await pool.query(
        `${selectBody} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, lim, off]
      );
      return res.json({ items: rows, total, limit: lim, offset: off });
    }
    const result = await pool.query(selectBody, params);
    res.json(result.rows);
  } catch (err) {
    logger.error('Blad pobierania oddzialow', { message: err.message, requestId: req.requestId });
    res.status(500).json({ error: req.t('errors.http.serverError') });
  }
});

router.get('/cele', authMiddleware, validateQuery(branchReportingQuerySchema), async (req, res) => {
  try {
    await ensureBranchReportingTables();
    const rok = Number(req.query.rok);
    const miesiac = Number(req.query.miesiac);
    const scoped = branchReportingScope(req.user, [rok, miesiac]);
    const { rows } = await pool.query(
      `SELECT id, oddzial_id, rok, miesiac, plan_zlecen, plan_obrotu, plan_marzy, updated_at
       FROM branch_goals
       WHERE rok = $1 AND miesiac = $2${scoped.where}
       ORDER BY oddzial_id`,
      scoped.params
    );
    res.json(rows);
  } catch (err) {
    logger.error('Blad pobierania celow oddzialow', { message: err.message, requestId: req.requestId });
    res.status(500).json({ error: req.t('errors.http.serverError') });
  }
});

router.post('/cele', authMiddleware, requireNieBrygadzista, validateBody(branchGoalBodySchema), async (req, res) => {
  try {
    if (!canSeeAllOddzialy(req.user)) return res.status(403).json({ error: req.t('errors.auth.forbidden') });
    await ensureBranchReportingTables();
    const { oddzial_id, rok, miesiac, plan_zlecen, plan_obrotu, plan_marzy } = req.body;
    const { rows } = await pool.query(
      `INSERT INTO branch_goals (
         oddzial_id, rok, miesiac, plan_zlecen, plan_obrotu, plan_marzy, updated_by
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (oddzial_id, rok, miesiac)
       DO UPDATE SET
         plan_zlecen = EXCLUDED.plan_zlecen,
         plan_obrotu = EXCLUDED.plan_obrotu,
         plan_marzy = EXCLUDED.plan_marzy,
         updated_by = EXCLUDED.updated_by,
         updated_at = NOW()
       RETURNING id, oddzial_id, rok, miesiac, plan_zlecen, plan_obrotu, plan_marzy, updated_at`,
      [oddzial_id, rok, miesiac, plan_zlecen, plan_obrotu, plan_marzy, req.user.id]
    );
    res.json(rows[0]);
  } catch (err) {
    logger.error('Blad zapisu celu oddzialu', { message: err.message, requestId: req.requestId });
    res.status(500).json({ error: req.t('errors.http.serverError') });
  }
});

router.get('/sprzedaz', authMiddleware, validateQuery(branchReportingQuerySchema), async (req, res) => {
  try {
    await ensureBranchReportingTables();
    const rok = Number(req.query.rok);
    const miesiac = Number(req.query.miesiac);
    const scoped = branchReportingScope(req.user, [rok, miesiac]);
    const { rows } = await pool.query(
      `SELECT id, oddzial_id, rok, miesiac, calls_total, calls_answered, calls_missed, leads_new, meetings_booked, updated_at
       FROM branch_sales_metrics
       WHERE rok = $1 AND miesiac = $2${scoped.where}
       ORDER BY oddzial_id`,
      scoped.params
    );
    res.json(rows);
  } catch (err) {
    logger.error('Blad pobierania sprzedazy oddzialow', { message: err.message, requestId: req.requestId });
    res.status(500).json({ error: req.t('errors.http.serverError') });
  }
});

router.post('/sprzedaz', authMiddleware, requireNieBrygadzista, validateBody(branchSalesBodySchema), async (req, res) => {
  try {
    if (!canSeeAllOddzialy(req.user)) return res.status(403).json({ error: req.t('errors.auth.forbidden') });
    await ensureBranchReportingTables();
    const { oddzial_id, rok, miesiac, calls_total, calls_answered, calls_missed, leads_new, meetings_booked } = req.body;
    const { rows } = await pool.query(
      `INSERT INTO branch_sales_metrics (
         oddzial_id, rok, miesiac, calls_total, calls_answered, calls_missed, leads_new, meetings_booked, updated_by
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (oddzial_id, rok, miesiac)
       DO UPDATE SET
         calls_total = EXCLUDED.calls_total,
         calls_answered = EXCLUDED.calls_answered,
         calls_missed = EXCLUDED.calls_missed,
         leads_new = EXCLUDED.leads_new,
         meetings_booked = EXCLUDED.meetings_booked,
         updated_by = EXCLUDED.updated_by,
         updated_at = NOW()
       RETURNING id, oddzial_id, rok, miesiac, calls_total, calls_answered, calls_missed, leads_new, meetings_booked, updated_at`,
      [oddzial_id, rok, miesiac, calls_total, calls_answered, calls_missed, leads_new, meetings_booked, req.user.id]
    );
    res.json(rows[0]);
  } catch (err) {
    logger.error('Blad zapisu sprzedazy oddzialu', { message: err.message, requestId: req.requestId });
    res.status(500).json({ error: req.t('errors.http.serverError') });
  }
});

router.get('/delegacje/wszystkie', authMiddleware, validateQuery(delegacjeListQuerySchema), async (req, res) => {
  try {
    await ensureDelegationResourceSchema(pool);
    const { limit, offset } = req.query;
    const params = [];
    let whereSql = '';
    if (!canSeeAllOddzialy(req.user)) {
      params.push(req.user.oddzial_id);
      whereSql = `WHERE (d.oddzial_z = $${params.length} OR d.oddzial_do = $${params.length})`;
    }
    const selectList = `${delegationSelectList} ORDER BY d.data_od DESC`;
    if (limit != null) {
      const lim = Number(limit);
      const off = Number(offset ?? 0);
      const countR = await pool.query(`SELECT COUNT(*)::int AS c FROM delegacje d ${whereSql}`, params);
      const total = countR.rows[0]?.c ?? 0;
      const result = await pool.query(
        `${selectList} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, lim, off]
      );
      return res.json({ items: result.rows, total, limit: lim, offset: off });
    }
    const result = await pool.query(selectList, params);
    res.json(result.rows);
  } catch (err) {
    logger.error('Blad pobierania wszystkich delegacji', { message: err.message, requestId: req.requestId });
    res.status(500).json({ error: req.t('errors.http.serverError') });
  }
});

router.post('/delegacje', authMiddleware, requireNieBrygadzista, validateBody(delegacjaCreateSchema), async (req, res) => {
  try {
    await ensureDelegationResourceSchema(pool);
    const { zasob_typ, ekipa_id, user_id, wyceniajacy_id, oddzial_z, oddzial_do, data_od, data_do, cel, uwagi } = req.body;
    const teamId = toId(ekipa_id);
    const estimatorId = toId(user_id) || toId(wyceniajacy_id);
    const resourceType = zasob_typ || (estimatorId ? 'wyceniajacy' : 'ekipa');

    if (Number(oddzial_z) === Number(oddzial_do)) {
      return res.status(400).json({ error: 'Oddzial zrodlowy i docelowy musza byc rozne.' });
    }
    if (!isDyrektor(req.user) && Number(req.user.oddzial_id) !== Number(oddzial_z)) {
      return res.status(403).json({ error: req.t('errors.auth.forbidden') });
    }
    if ((teamId && estimatorId) || (resourceType === 'ekipa' && !teamId) || (resourceType === 'wyceniajacy' && !estimatorId)) {
      return res.status(400).json({ error: 'Delegacja wymaga dokladnie jednego zasobu: ekipy albo wyceniajacego.' });
    }
    if (resourceType === 'ekipa') {
      const team = await pool.query('SELECT id, oddzial_id FROM teams WHERE id = $1', [teamId]);
      if (!team.rows[0]) return res.status(400).json({ error: 'Nieprawidlowa ekipa.' });
      if (Number(team.rows[0].oddzial_id) !== Number(oddzial_z)) {
        return res.status(400).json({ error: 'Ekipa musi nalezec do oddzialu zrodlowego delegacji.' });
      }
    } else {
      const user = await pool.query('SELECT id, rola, oddzial_id FROM users WHERE id = $1', [estimatorId]);
      if (!user.rows[0] || !isEstimatorRole(user.rows[0].rola)) {
        return res.status(400).json({ error: 'Nieprawidlowy wyceniajacy.' });
      }
      if (Number(user.rows[0].oddzial_id) !== Number(oddzial_z)) {
        return res.status(400).json({ error: 'Wyceniajacy musi nalezec do oddzialu zrodlowego delegacji.' });
      }
    }

    const result = await pool.query(
      `INSERT INTO delegacje (
         zasob_typ, ekipa_id, user_id, wyceniajacy_id,
         oddzial_z, oddzial_do, data_od, data_do, cel, uwagi, dodal_id, status
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'Planowana') RETURNING id`,
      [
        resourceType,
        resourceType === 'ekipa' ? teamId : null,
        resourceType === 'wyceniajacy' ? estimatorId : null,
        resourceType === 'wyceniajacy' ? estimatorId : null,
        oddzial_z,
        oddzial_do,
        data_od,
        data_do || null,
        cel,
        uwagi || null,
        req.user.id,
      ]
    );
    res.json({ id: result.rows[0].id, message: 'Delegacja dodana' });
  } catch (err) {
    logger.error('Blad dodawania delegacji', { message: err.message, requestId: req.requestId });
    res.status(500).json({ error: req.t('errors.http.serverError') });
  }
});

router.put('/delegacje/:id/status', authMiddleware, requireNieBrygadzista, validateParams(delegacjaIdParamsSchema), validateBody(delegacjaStatusSchema), async (req, res) => {
  try {
    await ensureDelegationResourceSchema(pool);
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
    const { oddzial_id } = req.body;
    const target = await pool.query('SELECT id, rola, oddzial_id FROM users WHERE id = $1', [req.params.userId]);
    if (!target.rows.length) return res.status(404).json({ error: req.t('errors.user.notFound') });
    if (!canTransferSpecialist(req.user, target.rows[0])) {
      return res.status(403).json({ error: req.t('errors.auth.forbidden') });
    }
    const branch = await pool.query('SELECT id FROM branches WHERE id = $1', [oddzial_id]);
    if (!branch.rows.length) return res.status(400).json({ error: 'Nieprawidlowy oddzial' });
    await pool.query('UPDATE users SET oddzial_id = $1 WHERE id = $2', [oddzial_id, req.params.userId]);
    res.json({ message: 'Pracownik przeniesiony' });
  } catch (err) {
    logger.error('Blad przenoszenia pracownika', { message: err.message, requestId: req.requestId });
    res.status(500).json({ error: req.t('errors.http.serverError') });
  }
});

router.get(
  '/:id/zasoby',
  authMiddleware,
  validateParams(oddzialIdParamsSchema),
  validateQuery(branchResourcesQuerySchema),
  async (req, res) => {
    try {
      if (!isDyrektor(req.user) && Number(req.user.oddzial_id) !== Number(req.params.id)) {
        return res.status(403).json({ error: req.t('errors.auth.forbidden') });
      }
      const resources = await getBranchResources(pool, req.params.id, req.query.date);
      res.json(resources);
    } catch (err) {
      logger.error('Blad pobierania zasobow oddzialu', { message: err.message, requestId: req.requestId });
      res.status(500).json({ error: req.t('errors.http.serverError') });
    }
  }
);

router.get('/:id/delegacje', authMiddleware, validateParams(oddzialIdParamsSchema), async (req, res) => {
  try {
    await ensureDelegationResourceSchema(pool);
    const result = await pool.query(
      `${delegationSelectList}
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
    if (!canSeeAllOddzialy(req.user) && Number(req.params.id) !== Number(req.user.oddzial_id)) {
      return res.status(403).json({ error: req.t('errors.auth.branchAccessDenied') });
    }
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
