const express = require('express');
const fs = require('fs');
const path = require('path');
const pool = require('../config/database');
const logger = require('../config/logger');
const { authMiddleware, isDyrektorOrAdmin } = require('../middleware/auth');
const { validateQuery, validateBody, validateParams } = require('../middleware/validate');
const { z } = require('zod');

const router = express.Router();
const isDyrektor = (user) => ['Prezes', 'Dyrektor'].includes(user.rola);

const flotaOddzialQuerySchema = z.object({
  oddzial_id: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

const flotaNaprawyQuerySchema = flotaOddzialQuerySchema.extend({
  typ_zasobu: z.string().max(30).optional(),
});

const flotaKatalogQuerySchema = z.object({
  /** Nazwa arkusza z importu (np. Kraków, Katowice) — lista w polu `arkusze` odpowiedzi. */
  arkusz: z.string().trim().max(80).optional(),
  /** Szukanie po numerze, marce, modelu, VIN, notatce. */
  q: z.string().trim().max(80).optional(),
});

const flotaIdParamsSchema = z.object({
  id: z.coerce.number().int().positive(),
});

const pojazdCreateSchema = z.object({
  marka: z.string().trim().min(1),
  model: z.string().trim().min(1),
  nr_rejestracyjny: z.string().trim().min(1),
  rok_produkcji: z.coerce.number().int().optional().nullable(),
  typ: z.string().max(50).optional().nullable(),
  ekipa_id: z.coerce.number().int().positive().optional().nullable(),
  data_przegladu: z.string().max(20).optional().nullable(),
  data_ubezpieczenia: z.string().max(20).optional().nullable(),
  przebieg: z.coerce.number().optional().nullable(),
  notatki: z.string().optional().nullable(),
  oddzial_id: z.coerce.number().int().positive().optional().nullable(),
});

const sprzetCreateSchema = z.object({
  nazwa: z.string().trim().min(1),
  typ: z.string().max(50).optional().nullable(),
  nr_seryjny: z.string().max(80).optional().nullable(),
  rok_produkcji: z.coerce.number().int().optional().nullable(),
  ekipa_id: z.coerce.number().int().positive().optional().nullable(),
  data_przegladu: z.string().max(20).optional().nullable(),
  koszt_motogodziny: z.coerce.number().optional().nullable(),
  notatki: z.string().optional().nullable(),
  oddzial_id: z.coerce.number().int().positive().optional().nullable(),
});

const naprawaCreateSchema = z.object({
  typ_zasobu: z.string().trim().min(1),
  zasob_id: z.coerce.number().int().positive(),
  nr_faktury: z.string().max(80).optional().nullable(),
  data_naprawy: z.string().max(20),
  koszt: z.coerce.number().optional().nullable(),
  opis_usterki: z.string().optional().nullable(),
  opis_naprawy: z.string().optional().nullable(),
  wykonawca: z.string().max(200).optional().nullable(),
  status: z.string().max(50).optional().nullable(),
  oddzial_id: z.coerce.number().int().positive().optional().nullable(),
});

const flotaStatusBodySchema = z.object({
  status: z.string().trim().min(1).max(50),
});

/**
 * GET /api/flota/katalog-pojazdow
 * Statyczny katalog z `data/flota-pojazdy-katalog.json` (generowany skryptem z Excela) — do listy wyboru przy dodawaniu pojazdu.
 */
router.get('/katalog-pojazdow', authMiddleware, validateQuery(flotaKatalogQuerySchema), (req, res) => {
  try {
    const filePath = path.join(__dirname, '..', '..', 'data', 'flota-pojazdy-katalog.json');
    if (!fs.existsSync(filePath)) {
      return res.json({ liczba: 0, arkusze: [], zrodlo: null, wygenerowano: null, items: [] });
    }
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    let items = Array.isArray(data.items) ? [...data.items] : [];
    const { arkusz, q } = req.query;
    if (arkusz) {
      items = items.filter((i) => i.arkusz === arkusz);
    }
    if (q) {
      const qq = q.toLowerCase();
      items = items.filter((i) => {
        const hay = `${i.nr_rejestracyjny} ${i.marka} ${i.model} ${i.vin || ''} ${i.notatki || ''}`.toLowerCase();
        return hay.includes(qq);
      });
    }
    const arkusze =
      data.arkusze && Array.isArray(data.arkusze)
        ? data.arkusze
        : [...new Set((data.items || []).map((x) => x.arkusz).filter(Boolean))].sort((a, b) =>
            a.localeCompare(b, 'pl')
          );
    res.json({
      liczba: items.length,
      arkusze,
      zrodlo: data.zrodlo_pliku || null,
      wygenerowano: data.wygenerowano || null,
      items,
    });
  } catch (e) {
    logger.error('Blad flota katalog-pojazdow', { message: e.message, requestId: req.requestId });
    res.status(500).json({ error: req.t('errors.http.serverError'), requestId: req.requestId });
  }
});

router.get('/pojazdy', authMiddleware, validateQuery(flotaOddzialQuerySchema), async (req, res) => {
  try {
    const { oddzial_id, limit, offset } = req.query;
    let where = '';
    let params = [];
    if (oddzial_id != null) {
      where = 'WHERE v.oddzial_id = $1';
      params = [oddzial_id];
    } else if (!isDyrektor(req.user)) {
      where = 'WHERE v.oddzial_id = $1';
      params = [req.user.oddzial_id];
    }
    const selectList = `SELECT v.*, b.nazwa as oddzial_nazwa, t.nazwa as ekipa_nazwa
      FROM vehicles v
      LEFT JOIN branches b ON v.oddzial_id = b.id
      LEFT JOIN teams t ON v.ekipa_id = t.id
      ${where}
      ORDER BY v.marka, v.model`;
    if (limit != null) {
      const lim = Number(limit);
      const off = Number(offset ?? 0);
      const countR = await pool.query(`SELECT COUNT(*)::int AS c FROM vehicles v ${where}`, params);
      const total = countR.rows[0]?.c ?? 0;
      const limIdx = params.length + 1;
      const offIdx = params.length + 2;
      const result = await pool.query(
        `SELECT v.*, b.nazwa as oddzial_nazwa, t.nazwa as ekipa_nazwa FROM vehicles v
         LEFT JOIN branches b ON v.oddzial_id = b.id LEFT JOIN teams t ON v.ekipa_id = t.id
         ${where} ORDER BY v.marka, v.model LIMIT $${limIdx} OFFSET $${offIdx}`,
        [...params, lim, off]
      );
      return res.json({ items: result.rows, total, limit: lim, offset: off });
    }
    const result = await pool.query(selectList, params);
    res.json(result.rows);
  } catch (err) {
    logger.error('Blad pobierania pojazdow', { message: err.message, requestId: req.requestId });
    res.status(500).json({ error: req.t('errors.http.serverError') });
  }
});

router.post('/pojazdy', authMiddleware, validateBody(pojazdCreateSchema), async (req, res) => {
  try {
    const { marka, model, nr_rejestracyjny, rok_produkcji, typ, ekipa_id, data_przegladu, data_ubezpieczenia, przebieg, notatki, oddzial_id } = req.body;
    const finalOddzialId = isDyrektor(req.user) ? (oddzial_id || req.user.oddzial_id) : req.user.oddzial_id;
    const result = await pool.query(
      `INSERT INTO vehicles (oddzial_id, marka, model, nr_rejestracyjny, rok_produkcji, typ, ekipa_id, data_przegladu, data_ubezpieczenia, przebieg, notatki)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
      [finalOddzialId, marka, model, nr_rejestracyjny, rok_produkcji, typ, ekipa_id || null, data_przegladu || null, data_ubezpieczenia || null, przebieg || 0, notatki]
    );
    res.json({ id: result.rows[0].id });
  } catch (err) {
    logger.error('Blad dodawania pojazdu', { message: err.message, requestId: req.requestId });
    res.status(500).json({ error: err.code === '23505' ? req.t('errors.flota.duplicatePlate') : req.t('errors.http.serverError') });
  }
});

router.get('/sprzet', authMiddleware, validateQuery(flotaOddzialQuerySchema), async (req, res) => {
  try {
    const { oddzial_id, limit, offset } = req.query;
    let where = '';
    let params = [];
    if (oddzial_id != null) {
      where = 'WHERE e.oddzial_id = $1';
      params = [oddzial_id];
    } else if (!isDyrektor(req.user)) {
      where = 'WHERE e.oddzial_id = $1';
      params = [req.user.oddzial_id];
    }
    const selectList = `SELECT e.*, b.nazwa as oddzial_nazwa, t.nazwa as ekipa_nazwa
       FROM equipment_items e
       LEFT JOIN branches b ON e.oddzial_id = b.id
       LEFT JOIN teams t ON e.ekipa_id = t.id
       ${where}
       ORDER BY e.typ, e.nazwa`;
    if (limit != null) {
      const lim = Number(limit);
      const off = Number(offset ?? 0);
      const countR = await pool.query(`SELECT COUNT(*)::int AS c FROM equipment_items e ${where}`, params);
      const total = countR.rows[0]?.c ?? 0;
      const limIdx = params.length + 1;
      const offIdx = params.length + 2;
      const result = await pool.query(
        `${selectList} LIMIT $${limIdx} OFFSET $${offIdx}`,
        [...params, lim, off]
      );
      return res.json({ items: result.rows, total, limit: lim, offset: off });
    }
    const result = await pool.query(selectList, params);
    res.json(result.rows);
  } catch (err) {
    logger.error('Blad pobierania sprzetu', { message: err.message, requestId: req.requestId });
    res.status(500).json({ error: req.t('errors.http.serverError') });
  }
});

router.post('/sprzet', authMiddleware, validateBody(sprzetCreateSchema), async (req, res) => {
  try {
    const { nazwa, typ, nr_seryjny, rok_produkcji, ekipa_id, data_przegladu, koszt_motogodziny, notatki, oddzial_id } = req.body;
    const finalOddzialId = isDyrektor(req.user) ? (oddzial_id || req.user.oddzial_id) : req.user.oddzial_id;
    const result = await pool.query(
      `INSERT INTO equipment_items (oddzial_id, nazwa, typ, nr_seryjny, rok_produkcji, ekipa_id, data_przegladu, koszt_motogodziny, notatki)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [finalOddzialId, nazwa, typ, nr_seryjny, rok_produkcji, ekipa_id || null, data_przegladu || null, koszt_motogodziny || 0, notatki]
    );
    res.json({ id: result.rows[0].id });
  } catch (err) {
    logger.error('Blad dodawania sprzetu', { message: err.message, requestId: req.requestId });
    res.status(500).json({ error: req.t('errors.http.serverError') });
  }
});

router.get('/naprawy', authMiddleware, validateQuery(flotaNaprawyQuerySchema), async (req, res) => {
  try {
    const { oddzial_id, typ_zasobu, limit, offset } = req.query;
    let where = 'WHERE 1=1';
    let params = [];
    let idx = 1;
    if (oddzial_id != null) {
      where += ` AND r.oddzial_id = $${idx++}`;
      params.push(oddzial_id);
    } else if (!isDyrektor(req.user)) {
      where += ` AND r.oddzial_id = $${idx++}`;
      params.push(req.user.oddzial_id);
    }
    if (typ_zasobu) {
      where += ` AND r.typ_zasobu = $${idx++}`;
      params.push(typ_zasobu);
    }
    const selectList = `
      SELECT r.*, b.nazwa as oddzial_nazwa,
        u.imie || ' ' || u.nazwisko as dodal
       FROM repairs r
       LEFT JOIN branches b ON r.oddzial_id = b.id
       LEFT JOIN users u ON r.user_id = u.id
       ${where}
       ORDER BY r.data_naprawy DESC`;
    if (limit != null) {
      const lim = Number(limit);
      const off = Number(offset ?? 0);
      const countR = await pool.query(`SELECT COUNT(*)::int AS c FROM repairs r ${where}`, params);
      const total = countR.rows[0]?.c ?? 0;
      const limIdx = params.length + 1;
      const offIdx = params.length + 2;
      const result = await pool.query(`${selectList} LIMIT $${limIdx} OFFSET $${offIdx}`, [...params, lim, off]);
      return res.json({ items: result.rows, total, limit: lim, offset: off });
    }
    const result = await pool.query(selectList, params);
    res.json(result.rows);
  } catch (err) {
    logger.error('Blad pobierania napraw', { message: err.message, requestId: req.requestId });
    res.status(500).json({ error: req.t('errors.http.serverError') });
  }
});

router.post('/naprawy', authMiddleware, validateBody(naprawaCreateSchema), async (req, res) => {
  try {
    const { typ_zasobu, zasob_id, nr_faktury, data_naprawy, koszt, opis_usterki, opis_naprawy, wykonawca, status, oddzial_id } = req.body;
    const finalOddzialId = isDyrektor(req.user) ? (oddzial_id || req.user.oddzial_id) : req.user.oddzial_id;
    const result = await pool.query(
      `INSERT INTO repairs (typ_zasobu, zasob_id, oddzial_id, nr_faktury, data_naprawy, koszt, opis_usterki, opis_naprawy, wykonawca, status, user_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
      [typ_zasobu, zasob_id, finalOddzialId, nr_faktury, data_naprawy, koszt, opis_usterki, opis_naprawy, wykonawca, status || 'Zakonczona', req.user.id]
    );
    res.json({ id: result.rows[0].id });
  } catch (err) {
    logger.error('Blad dodawania naprawy', { message: err.message, requestId: req.requestId });
    res.status(500).json({ error: req.t('errors.http.serverError') });
  }
});

router.put('/pojazdy/:id/status', authMiddleware, validateParams(flotaIdParamsSchema), validateBody(flotaStatusBodySchema), async (req, res) => {
  try {
    const { status } = req.body;
    await pool.query('UPDATE vehicles SET status = $1 WHERE id = $2', [status, req.params.id]);
    res.json({ message: 'Status zmieniony' });
  } catch (err) {
    logger.error('Blad aktualizacji statusu pojazdu', { message: err.message, requestId: req.requestId });
    res.status(500).json({ error: req.t('errors.http.serverError') });
  }
});

router.put('/sprzet/:id/status', authMiddleware, validateParams(flotaIdParamsSchema), validateBody(flotaStatusBodySchema), async (req, res) => {
  try {
    const { status } = req.body;
    await pool.query('UPDATE equipment_items SET status = $1 WHERE id = $2', [status, req.params.id]);
    res.json({ message: 'Status zmieniony' });
  } catch (err) {
    logger.error('Blad aktualizacji statusu sprzetu', { message: err.message, requestId: req.requestId });
    res.status(500).json({ error: req.t('errors.http.serverError') });
  }
});

const rezerwacjeRangeQuerySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

const rezerwacjaPostBodySchema = z.object({
  sprzet_id: z.coerce.number().int().positive(),
  ekipa_id: z.coerce.number().int().positive(),
  data_od: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  data_do: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  caly_dzien: z.boolean().optional().default(true),
  status: z.enum(['Zarezerwowane', 'Wydane', 'Zwrócone', 'Anulowane']).optional().default('Zarezerwowane'),
});

const rezerwacjaStatusBodySchema = z.object({
  status: z.enum(['Zarezerwowane', 'Wydane', 'Zwrócone', 'Anulowane']),
});

/** GET /flota/rezerwacje?from=YYYY-MM-DD&to=YYYY-MM-DD */
router.get('/rezerwacje', authMiddleware, validateQuery(rezerwacjeRangeQuerySchema), async (req, res) => {
  try {
    const { from, to } = req.query;
    const params = [from, to];
    let branchClause = '';
    if (!isDyrektor(req.user)) {
      branchClause = 'AND e.oddzial_id = $3';
      params.push(req.user.oddzial_id);
    }
    const result = await pool.query(
      `SELECT r.id, r.sprzet_id, r.ekipa_id, r.data_od, r.data_do, r.caly_dzien, r.status,
              e.nazwa AS sprzet_nazwa, t.nazwa AS ekipa_nazwa
         FROM equipment_reservations r
         JOIN equipment_items e ON e.id = r.sprzet_id
         JOIN teams t ON t.id = r.ekipa_id
        WHERE r.data_do >= $1::date AND r.data_od <= $2::date
          ${branchClause}
        ORDER BY r.data_od, e.nazwa, t.nazwa`,
      params
    );
    res.json(result.rows);
  } catch (err) {
    if (err.code === '42P01') {
      return res.status(404).json({ error: 'rezerwacje_not_migrated' });
    }
    logger.error('Blad pobierania rezerwacji sprzetu', { message: err.message, requestId: req.requestId });
    res.status(500).json({ error: req.t('errors.http.serverError') });
  }
});

/** POST /flota/rezerwacje */
router.post('/rezerwacje', authMiddleware, validateBody(rezerwacjaPostBodySchema), async (req, res) => {
  try {
    const { sprzet_id, ekipa_id, data_od, data_do, caly_dzien, status } = req.body;
    if (data_do < data_od) {
      return res.status(400).json({ error: 'data_do_przed_data_od' });
    }
    const sRow = await pool.query('SELECT id, oddzial_id FROM equipment_items WHERE id = $1', [sprzet_id]);
    if (!sRow.rows[0]) return res.status(404).json({ error: 'sprzet_nieznaleziony' });
    const tRow = await pool.query('SELECT id, oddzial_id FROM teams WHERE id = $1', [ekipa_id]);
    if (!tRow.rows[0]) return res.status(404).json({ error: 'ekipa_nieznaleziona' });
    const sprOdd = sRow.rows[0].oddzial_id;
    const teamOdd = tRow.rows[0].oddzial_id;
    if (sprOdd != null && teamOdd != null && sprOdd !== teamOdd) {
      return res.status(400).json({ error: 'sprzet_ekipa_oddzial' });
    }
    if (!isDyrektor(req.user)) {
      if (req.user.oddzial_id !== sprOdd || req.user.oddzial_id !== teamOdd) {
        return res.status(403).json({ error: 'brak_dostepu_oddzial' });
      }
    }
    const oddzialId = sprOdd || teamOdd || req.user.oddzial_id;
    const clash = await pool.query(
      `SELECT id FROM equipment_reservations
        WHERE sprzet_id = $1
          AND status NOT IN ('Anulowane', 'Zwrócone')
          AND NOT (data_do < $2::date OR data_od > $3::date)
        LIMIT 1`,
      [sprzet_id, data_od, data_do]
    );
    if (clash.rows.length) {
      return res.status(409).json({ error: 'rezerwacja_kolizja_sprzet' });
    }
    const ins = await pool.query(
      `INSERT INTO equipment_reservations (oddzial_id, sprzet_id, ekipa_id, data_od, data_do, caly_dzien, status, user_id)
       VALUES ($1,$2,$3,$4::date,$5::date,$6,$7,$8)
       RETURNING id`,
      [oddzialId, sprzet_id, ekipa_id, data_od, data_do, caly_dzien, status, req.user.id]
    );
    res.json({ id: ins.rows[0].id });
  } catch (err) {
    if (err.code === '42P01') {
      return res.status(404).json({ error: 'rezerwacje_not_migrated' });
    }
    logger.error('Blad dodawania rezerwacji sprzetu', { message: err.message, requestId: req.requestId });
    res.status(500).json({ error: req.t('errors.http.serverError') });
  }
});

/** PUT /flota/rezerwacje/:id/status */
router.put(
  '/rezerwacje/:id/status',
  authMiddleware,
  validateParams(flotaIdParamsSchema),
  validateBody(rezerwacjaStatusBodySchema),
  async (req, res) => {
    try {
      const { status } = req.body;
      const id = req.params.id;
      let branchClause = '';
      const params = [status, id];
      if (!isDyrektorOrAdmin(req.user)) {
        branchClause = 'AND e.oddzial_id = $3';
        params.push(req.user.oddzial_id);
      }
      const r = await pool.query(
        `UPDATE equipment_reservations r
            SET status = $1, updated_at = NOW()
           FROM equipment_items e
          WHERE r.id = $2::int AND r.sprzet_id = e.id ${branchClause}
        RETURNING r.id`,
        params
      );
      if (!r.rowCount) return res.status(404).json({ error: 'nie_znaleziono' });
      res.json({ message: 'ok' });
    } catch (err) {
      if (err.code === '42P01') {
        return res.status(404).json({ error: 'rezerwacje_not_migrated' });
      }
      logger.error('Blad statusu rezerwacji sprzetu', { message: err.message, requestId: req.requestId });
      res.status(500).json({ error: req.t('errors.http.serverError') });
    }
  }
);

const rezerwacjaPatchBodySchema = z.object({
  data_od: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  data_do: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

/** PATCH /flota/rezerwacje/:id — przesuwa daty rezerwacji (drag & drop) */
router.patch(
  '/rezerwacje/:id',
  authMiddleware,
  validateParams(flotaIdParamsSchema),
  validateBody(rezerwacjaPatchBodySchema),
  async (req, res) => {
    try {
      const { data_od, data_do } = req.body;
      if (data_do < data_od) {
        return res.status(400).json({ error: 'data_do_przed_data_od' });
      }
      const id = req.params.id;
      // Sprawdź czy rezerwacja istnieje i należy do oddziału usera
      let branchClause = '';
      const params = [data_od, data_do, id];
      if (!isDyrektorOrAdmin(req.user)) {
        branchClause = 'AND e.oddzial_id = $4';
        params.push(req.user.oddzial_id);
      }
      // Sprawdź kolizję z innymi rezerwacjami (wyklucz siebie)
      const existing = await pool.query(
        `SELECT r.sprzet_id FROM equipment_reservations r
           JOIN equipment_items e ON e.id = r.sprzet_id
          WHERE r.id = $1 ${!isDyrektorOrAdmin(req.user) ? 'AND e.oddzial_id = $2' : ''}`,
        !isDyrektorOrAdmin(req.user) ? [id, req.user.oddzial_id] : [id]
      );
      if (!existing.rows[0]) return res.status(404).json({ error: 'nie_znaleziono' });
      const sprzetId = existing.rows[0].sprzet_id;
      const clash = await pool.query(
        `SELECT id FROM equipment_reservations
          WHERE sprzet_id = $1 AND id != $2
            AND status NOT IN ('Anulowane', 'Zwrócone')
            AND NOT (data_do < $3::date OR data_od > $4::date)
          LIMIT 1`,
        [sprzetId, id, data_od, data_do]
      );
      if (clash.rows.length) {
        return res.status(409).json({ error: 'rezerwacja_kolizja_sprzet' });
      }
      const r = await pool.query(
        `UPDATE equipment_reservations r
            SET data_od = $1::date, data_do = $2::date, updated_at = NOW()
          FROM equipment_items e
          WHERE r.id = $3::int AND r.sprzet_id = e.id ${branchClause}
        RETURNING r.id`,
        params
      );
      if (!r.rowCount) return res.status(404).json({ error: 'nie_znaleziono' });
      res.json({ message: 'ok' });
    } catch (err) {
      if (err.code === '42P01') {
        return res.status(404).json({ error: 'rezerwacje_not_migrated' });
      }
      logger.error('Blad patch rezerwacji sprzetu', { message: err.message, requestId: req.requestId });
      res.status(500).json({ error: req.t('errors.http.serverError') });
    }
  }
);

module.exports = router;
