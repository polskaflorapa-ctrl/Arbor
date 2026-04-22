/**
 * SKOPIUJ DO: arbor-os/src/routes/wyceny.js
 *
 * Zarejestruj w server.js:
 *   const wycenyRouter = require('./routes/wyceny');
 *   app.use('/api/wyceny', wycenyRouter);
 *
 * Uruchom SQL z create_tables_wyceny.sql w pgAdmin przed pierwszym użyciem.
 */

const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const logger = require('../config/logger');
const { authMiddleware } = require('../middleware/auth');
const { validateQuery, validateBody, validateParams } = require('../middleware/validate');
const { z } = require('zod');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const uploadDir = path.join(__dirname, '../../uploads/wyceny');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.jpg';
    cb(null, `wycena_${Date.now()}${ext}`);
  },
});
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } });

const isDyrektor = (u) => u.rola === 'Dyrektor' || u.rola === 'Administrator';
const isKierownik = (u) => u.rola === 'Kierownik';
const isSpecjalista = (u) => u.rola === 'Specjalista';
const canManage = (u) => isDyrektor(u) || isKierownik(u) || isSpecjalista(u);

const wycenyListQuerySchema = z.object({
  status_akceptacji: z.string().max(30).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

const wycenaIdParamsSchema = z.object({
  id: z.coerce.number().int().positive(),
});

const wycenaPatchStatusSchema = z.object({
  status: z.string().trim().min(1).max(80),
});

const wycenaZatwierdzSchema = z.object({
  ekipa_id: z.union([z.number(), z.string()]).optional().nullable(),
  data_wykonania: z.string().optional().nullable(),
  godzina_rozpoczecia: z.string().optional().nullable(),
  wartosc_planowana: z.union([z.number(), z.string()]).optional().nullable(),
});

const wycenaOdrzucSchema = z.object({
  powod: z.string().optional().nullable(),
});

const wycenaKlientAcceptSchema = z.object({
  uwagi: z.string().optional().nullable(),
});

function buildTaskPlannedDateTime(dataWykonania, godzinaRozpoczecia) {
  if (!dataWykonania) return null;
  const hhmm = (godzinaRozpoczecia || '08:00').slice(0, 5);
  return `${dataWykonania} ${hhmm}:00`;
}

const wycenyCreateSchema = z.object({
  klient_nazwa: z.string().trim().min(1, 'klient_nazwa jest wymagane'),
  klient_telefon: z.string().optional().nullable(),
  adres: z.string().optional().nullable(),
  miasto: z.string().optional().nullable(),
  typ_uslugi: z.string().optional().nullable(),
  wartosc_szacowana: z.union([z.number(), z.string()]).optional().nullable(),
  opis: z.string().optional().nullable(),
  notatki_wewnetrzne: z.string().optional().nullable(),
  lat: z.union([z.number(), z.string()]).optional().nullable(),
  lon: z.union([z.number(), z.string()]).optional().nullable(),
  ekipa_id: z.union([z.number(), z.string()]).optional().nullable(),
  data_wykonania: z.string().optional().nullable(),
  godzina_rozpoczecia: z.string().optional().nullable(),
  czas_planowany_godziny: z.union([z.number(), z.string()]).optional().nullable(),
});

router.get('/', authMiddleware, validateQuery(wycenyListQuerySchema), async (req, res) => {
  try {
    const { status_akceptacji, limit, offset } = req.query;
    const dopuszczalne = ['oczekuje', 'do_specjalisty', 'zatwierdzono', 'odrzucono'];
    const filterStatus = dopuszczalne.includes(status_akceptacji) ? status_akceptacji : null;

    let whereClause = '';
    let params = [];
    if (canManage(req.user)) {
      if (filterStatus) {
        whereClause = 'WHERE w.status_akceptacji = $1';
        params = [filterStatus];
      }
    } else if (filterStatus) {
      whereClause = 'WHERE w.autor_id = $1 AND w.status_akceptacji = $2';
      params = [req.user.id, filterStatus];
    } else {
      whereClause = 'WHERE w.autor_id = $1';
      params = [req.user.id];
    }

    const joins = `FROM wyceny w LEFT JOIN users u ON u.id = w.autor_id LEFT JOIN teams e ON e.id = w.ekipa_id LEFT JOIN tasks t ON t.source_wycena_id = w.id`;
    const selectList = `SELECT w.*, u.imie || ' ' || u.nazwisko AS autor_nazwa, e.nazwa AS ekipa_nazwa, t.id AS task_id`;

    if (limit != null) {
      const lim = Number(limit);
      const off = Number(offset ?? 0);
      const countR = await pool.query(`SELECT COUNT(*)::int AS c ${joins} ${whereClause}`, params);
      const total = countR.rows[0]?.c ?? 0;
      const limIdx = params.length + 1;
      const offIdx = params.length + 2;
      const { rows } = await pool.query(
        `${selectList} ${joins} ${whereClause} ORDER BY w.created_at DESC LIMIT $${limIdx} OFFSET $${offIdx}`,
        [...params, lim, off]
      );
      return res.json({ items: rows, total, limit: lim, offset: off });
    }

    const { rows } = await pool.query(
      `${selectList} ${joins} ${whereClause} ORDER BY w.created_at DESC`,
      params
    );
    res.json(rows);
  } catch (e) {
    logger.error('Blad pobierania wycen', { message: e.message, requestId: req.requestId });
    res.status(500).json({ error: req.t('errors.http.serverError') });
  }
});

router.post('/', authMiddleware, validateBody(wycenyCreateSchema), async (req, res) => {
  try {
    const { klient_nazwa, klient_telefon, adres, miasto, typ_uslugi, wartosc_szacowana, opis, notatki_wewnetrzne, lat, lon, ekipa_id, data_wykonania, godzina_rozpoczecia, czas_planowany_godziny } = req.body;
    const { rows } = await pool.query(
      `INSERT INTO wyceny (klient_nazwa,klient_telefon,adres,miasto,typ_uslugi,wartosc_szacowana,wartosc_planowana,opis,notatki_wewnetrzne,lat,lon,autor_id,status,ekipa_id,data_wykonania,godzina_rozpoczecia,czas_planowany_godziny,status_akceptacji) VALUES ($1,$2,$3,$4,$5,$6,$6,$7,$8,$9,$10,$11,'Nowa',$12,$13,$14,$15,'oczekuje') RETURNING *`,
      [klient_nazwa, klient_telefon||null, adres||null, miasto||null, typ_uslugi||null, wartosc_szacowana?parseFloat(wartosc_szacowana):null, opis||null, notatki_wewnetrzne||null, lat?parseFloat(lat):null, lon?parseFloat(lon):null, req.user.id, ekipa_id?parseInt(ekipa_id):null, data_wykonania||null, godzina_rozpoczecia||null, czas_planowany_godziny?parseFloat(czas_planowany_godziny):null]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    logger.error('Blad tworzenia wyceny', { message: e.message, requestId: req.requestId });
    res.status(500).json({ error: req.t('errors.http.serverError') });
  }
});

router.get('/:id', authMiddleware, validateParams(wycenaIdParamsSchema), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT w.*, u.imie || ' ' || u.nazwisko AS autor_nazwa, t.id AS task_id
       FROM wyceny w
       LEFT JOIN users u ON u.id = w.autor_id
       LEFT JOIN tasks t ON t.source_wycena_id = w.id
       WHERE w.id = $1`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: req.t('errors.generic.notFound') });
    res.json(rows[0]);
  } catch (e) {
    logger.error('Blad pobierania wyceny po id', { message: e.message, requestId: req.requestId });
    res.status(500).json({ error: req.t('errors.http.serverError') });
  }
});

router.patch('/:id/status', authMiddleware, validateParams(wycenaIdParamsSchema), validateBody(wycenaPatchStatusSchema), async (req, res) => {
  try {
    const { status } = req.body;
    const { rows } = await pool.query(`UPDATE wyceny SET status=$1, updated_at=NOW() WHERE id=$2 RETURNING *`, [status, req.params.id]);
    if (!rows.length) return res.status(404).json({ error: req.t('errors.generic.notFound') });
    res.json(rows[0]);
  } catch (e) {
    logger.error('Blad aktualizacji statusu wyceny', { message: e.message, requestId: req.requestId });
    res.status(500).json({ error: req.t('errors.http.serverError') });
  }
});

router.post('/:id/zatwierdz', authMiddleware, validateParams(wycenaIdParamsSchema), validateBody(wycenaZatwierdzSchema), async (req, res) => {
  if (!canManage(req.user)) return res.status(403).json({ error: req.t('errors.auth.forbidden') });
  try {
    const { ekipa_id, data_wykonania, godzina_rozpoczecia, wartosc_planowana } = req.body;
    if (!ekipa_id || !data_wykonania || !godzina_rozpoczecia) {
      return res.status(400).json({
        error: 'Do zatwierdzenia wymagane są: ekipa, data realizacji i godzina rozpoczęcia.',
      });
    }
    const { rows } = await pool.query(
      `UPDATE wyceny SET
         status_akceptacji='zatwierdzono',
         ekipa_id=$1,
         data_wykonania=COALESCE($2,data_wykonania),
         godzina_rozpoczecia=COALESCE($3,godzina_rozpoczecia),
         wartosc_planowana=COALESCE($4,wartosc_planowana),
         zatwierdzone_przez=$5,
         zatwierdzone_at=NOW(),
         status='Zaakceptowana',
         updated_at=NOW()
       WHERE id=$6
       RETURNING *`,
      [
        ekipa_id ? parseInt(ekipa_id, 10) : null,
        data_wykonania || null,
        godzina_rozpoczecia || null,
        wartosc_planowana ? parseFloat(wartosc_planowana) : null,
        req.user.id,
        req.params.id,
      ]
    );
    if (!rows.length) return res.status(404).json({ error: req.t('errors.generic.notFound') });
    const wycena = rows[0];
    const existingTask = await pool.query('SELECT id FROM tasks WHERE source_wycena_id = $1 LIMIT 1', [wycena.id]);
    let taskId = existingTask.rows[0]?.id || null;
    if (!taskId) {
      const taskInsert = await pool.query(
        `INSERT INTO tasks (
          klient_nazwa, klient_telefon, adres, miasto, typ_uslugi,
          priorytet, wartosc_planowana, data_planowana, notatki_wewnetrzne,
          status, oddzial_id, ekipa_id, wyceniajacy_id, pin_lat, pin_lng, source_wycena_id
        )
        VALUES (
          $1,$2,$3,$4,$5,'Normalny',$6,$7,$8,'Zaplanowane',$9,$10,$11,$12,$13,$14
        ) RETURNING id`,
        [
          wycena.klient_nazwa,
          wycena.klient_telefon,
          wycena.adres,
          wycena.miasto,
          wycena.typ_uslugi || 'Wycena',
          wycena.wartosc_planowana,
          buildTaskPlannedDateTime(wycena.data_wykonania, wycena.godzina_rozpoczecia),
          wycena.notatki_wewnetrzne,
          req.user.oddzial_id || null,
          wycena.ekipa_id || null,
          wycena.autor_id || null,
          wycena.lat || null,
          wycena.lon || null,
          wycena.id,
        ]
      );
      taskId = taskInsert.rows[0]?.id || null;
    } else {
      await pool.query(
        `UPDATE tasks SET
          ekipa_id = COALESCE($1, ekipa_id),
          wartosc_planowana = COALESCE($2, wartosc_planowana),
          data_planowana = COALESCE($3, data_planowana),
          status = 'Zaplanowane'
        WHERE id = $4`,
        [
          wycena.ekipa_id || null,
          wycena.wartosc_planowana || null,
          buildTaskPlannedDateTime(wycena.data_wykonania, wycena.godzina_rozpoczecia),
          taskId,
        ]
      );
    }
    res.json({ ...wycena, task_id: taskId });
  } catch (e) {
    logger.error('Blad zatwierdzania wyceny', { message: e.message, requestId: req.requestId });
    res.status(500).json({ error: req.t('errors.http.serverError') });
  }
});

router.post('/:id/klient-akceptuje', authMiddleware, validateParams(wycenaIdParamsSchema), validateBody(wycenaKlientAcceptSchema), async (req, res) => {
  try {
    const { uwagi } = req.body;
    const { rows } = await pool.query(
      `UPDATE wyceny
       SET status_akceptacji='do_specjalisty',
           status='Klient zaakceptował - do specjalisty',
           wycena_uwagi = COALESCE(NULLIF($1,''), wycena_uwagi),
           updated_at = NOW()
       WHERE id=$2
       RETURNING *`,
      [uwagi || null, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: req.t('errors.generic.notFound') });
    res.json(rows[0]);
  } catch (e) {
    logger.error('Blad oznaczania akceptacji klienta', { message: e.message, requestId: req.requestId });
    res.status(500).json({ error: req.t('errors.http.serverError') });
  }
});

router.post('/:id/odrzuc', authMiddleware, validateParams(wycenaIdParamsSchema), validateBody(wycenaOdrzucSchema), async (req, res) => {
  if (!canManage(req.user)) return res.status(403).json({ error: req.t('errors.auth.forbidden') });
  try {
    const { powod } = req.body;
    const { rows } = await pool.query(
      `UPDATE wyceny SET status_akceptacji='odrzucono', uwagi_kierownika=$1, zatwierdzone_przez=$2, zatwierdzone_at=NOW(), status='Odrzucona', updated_at=NOW() WHERE id=$3 RETURNING *`,
      [powod||'', req.user.id, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: req.t('errors.generic.notFound') });
    res.json(rows[0]);
  } catch (e) {
    logger.error('Blad odrzucania wyceny', { message: e.message, requestId: req.requestId });
    res.status(500).json({ error: req.t('errors.http.serverError') });
  }
});

router.delete('/:id', authMiddleware, validateParams(wycenaIdParamsSchema), async (req, res) => {
  if (!isDyrektor(req.user)) return res.status(403).json({ error: req.t('errors.auth.forbidden') });
  try {
    await pool.query('DELETE FROM wyceny WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) {
    logger.error('Blad usuwania wyceny', { message: e.message, requestId: req.requestId });
    res.status(500).json({ error: req.t('errors.http.serverError') });
  }
});

module.exports = router;
