const express = require('express');
const pool = require('../config/database');
const logger = require('../config/logger');
const { authMiddleware } = require('../middleware/auth');
const { validateBody, validateParams, validateQuery } = require('../middleware/validate');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { z } = require('zod');
const { TASK_ACCESS_DENIED, VALIDATION_FAILED } = require('../constants/error-codes');

const router = express.Router();

const isDyrektor = (user) => user.rola === 'Dyrektor' || user.rola === 'Administrator';
const isKierownik = (user) => user.rola === 'Kierownik';
const isTeamScoped = (user) => user.rola === 'Brygadzista' || user.rola === 'Pomocnik';

const getTaskScope = (user, alias = 't', startParam = 1) => {
  if (isDyrektor(user)) {
    return { clause: '', params: [], nextParam: startParam };
  }

  if (isTeamScoped(user)) {
    const clause = `${alias}.ekipa_id IN (
      SELECT tm.team_id FROM team_members tm WHERE tm.user_id = $${startParam}
      UNION
      SELECT te.id FROM teams te WHERE te.brygadzista_id = $${startParam}
    )`;
    return { clause, params: [user.id], nextParam: startParam + 1 };
  }

  const clause = `${alias}.oddzial_id = $${startParam}`;
  return { clause, params: [user.oddzial_id], nextParam: startParam + 1 };
};

const requireTaskAccess = async (req, res, next) => {
  try {
    const taskId = Number(req.params.id);
    const scope = getTaskScope(req.user, 't', 2);
    const where = scope.clause ? `id = $1 AND ${scope.clause}` : 'id = $1';
    const result = await pool.query(`SELECT id FROM tasks t WHERE ${where} LIMIT 1`, [taskId, ...scope.params]);
    if (result.rows.length === 0) {
      return res.status(403).json({
        error: req.t('errors.tasks.accessDenied'),
        code: TASK_ACCESS_DENIED,
        requestId: req.requestId,
      });
    }
    return next();
  } catch (err) {
    logger.error('Blad sprawdzania dostepu do zlecenia', { message: err.message, requestId: req.requestId });
    return res.status(500).json({ error: req.t('errors.http.serverError') });
  }
};

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join('uploads', 'tasks');
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `task_${Date.now()}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Tylko obrazy'), false);
    }
  }
});

const toNum = (val) => {
  if (val === '' || val === null || val === undefined) return null;
  const n = parseFloat(val);
  return isNaN(n) ? null : n;
};

const toInt = (val) => {
  if (val === '' || val === null || val === undefined) return null;
  const n = parseInt(String(val), 10);
  return Number.isNaN(n) ? null : n;
};

const toStr = (val) => {
  if (val === '' || val === null || val === undefined) return null;
  return val;
};

const taskCreateSchema = z.object({
  klient_nazwa: z.string().trim().min(1, 'klient_nazwa jest wymagane'),
  klient_telefon: z.string().trim().optional().nullable(),
  adres: z.string().trim().min(1, 'adres jest wymagany'),
  miasto: z.string().trim().min(1, 'miasto jest wymagane'),
  typ_uslugi: z.string().trim().optional().nullable(),
  priorytet: z.string().trim().optional().nullable(),
  wartosc_planowana: z.union([z.number(), z.string()]).optional().nullable(),
  czas_planowany_godziny: z.union([z.number(), z.string()]).optional().nullable(),
  data_planowana: z.string().trim().min(1, 'data_planowana jest wymagana'),
  notatki_wewnetrzne: z.string().optional().nullable(),
  oddzial_id: z.union([z.number().int().positive(), z.string().trim()]).optional().nullable(),
  ekipa_id: z.union([z.number().int().positive(), z.string().trim()]).optional().nullable(),
  wyceniajacy_id: z.union([z.number().int().positive(), z.string().trim()]).optional().nullable(),
  pin_lat: z.union([z.number(), z.string()]).optional().nullable(),
  pin_lng: z.union([z.number(), z.string()]).optional().nullable(),
  ankieta_uproszczona: z.boolean().optional(),
});

const taskUpdateSchema = z.object({
  klient_nazwa: z.string().trim().min(1, 'klient_nazwa jest wymagane'),
  klient_telefon: z.string().trim().optional().nullable(),
  adres: z.string().trim().min(1, 'adres jest wymagany'),
  miasto: z.string().trim().min(1, 'miasto jest wymagane'),
  typ_uslugi: z.string().trim().optional().nullable(),
  priorytet: z.string().trim().optional().nullable(),
  wartosc_planowana: z.union([z.number(), z.string()]).optional().nullable(),
  /** Kwota po dodatkowych pracach / korekcie (opcjonalnie przy realizacji). */
  wartosc_rzeczywista: z.union([z.number(), z.string()]).optional().nullable(),
  czas_planowany_godziny: z.union([z.number(), z.string()]).optional().nullable(),
  data_planowana: z.string().trim().min(1, 'data_planowana jest wymagana'),
  notatki_wewnetrzne: z.string().optional().nullable(),
  /** Zakres / dodatkowa praca (opis dla ekipy i biura). */
  opis: z.string().optional().nullable(),
  notatki_klienta: z.string().optional().nullable(),
});

const taskAssignSchema = z.object({
  ekipa_id: z.union([z.number().int().positive(), z.string().trim().min(1)]),
});

const taskStatusSchema = z.object({
  status: z.enum(['Nowe', 'Zaplanowane', 'W_Realizacji', 'Zakonczone']),
});

const taskStartSchema = z.object({
  lat: z.union([z.number(), z.string().trim().min(1)]).optional().nullable(),
  lng: z.union([z.number(), z.string().trim().min(1)]).optional().nullable(),
  /** Dmuchawa / filtr — sprawny i wyczyszczony (Brygadzista / Pomocnik — wymagane przy starcie). */
  dmuchawa_filtr_ok: z.boolean().optional(),
  /** Rębak zatankowany (wymagane dla ekipy). */
  rebak_zatankowany: z.boolean().optional(),
  /** Pomocnicy i brygadzysta w kaskach (wymagane dla ekipy). */
  kaski_zespol: z.boolean().optional(),
  /** Krótkie BHP — potwierdzenie zapoznania (musi być true dla ekipy). */
  bhp_potwierdzone: z.boolean().optional(),
});

const taskStopSchema = z.object({
  lat: z.union([z.number(), z.string().trim().min(1)]).optional().nullable(),
  lng: z.union([z.number(), z.string().trim().min(1)]).optional().nullable(),
  work_log_id: z.union([z.number().int().positive(), z.string().trim().min(1)]),
});

const taskProblemSchema = z.object({
  typ: z.string().trim().min(1, 'typ jest wymagany'),
});

const taskIdParamsSchema = z.object({
  id: z.coerce.number().int().positive(),
});

const taskListQuerySchema = z.object({
  oddzial_id: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

const taskMojeQuerySchema = z.object({
  data: z.string().max(20).optional(),
});

router.get('/moje', authMiddleware, validateQuery(taskMojeQuerySchema), async (req, res) => {
  try {
    const dzisiaj = req.query.data || new Date().toISOString().split('T')[0];
    const result = await pool.query(
      `SELECT t.*, te.nazwa as ekipa_nazwa
       FROM tasks t
       LEFT JOIN teams te ON t.ekipa_id = te.id
       LEFT JOIN team_members tm ON tm.team_id = te.id AND tm.user_id = $2
       WHERE t.data_planowana = $1
       AND (t.brygadzista_id = $2 OR te.brygadzista_id = $2 OR tm.user_id = $2)
       ORDER BY t.id ASC`,
      [dzisiaj, req.user.id]
    );
    res.json(result.rows);
  } catch (err) {
    logger.error('Blad pobierania moich zlecen', { message: err.message, requestId: req.requestId });
    res.status(500).json({ error: req.t('errors.http.serverError') });
  }
});

router.get('/stats', authMiddleware, async (req, res) => {
  try {
    const scope = getTaskScope(req.user, 't', 1);
    const query = `SELECT
      COUNT(*) FILTER (WHERE status = 'Nowe') as nowe,
      COUNT(*) FILTER (WHERE status = 'W_Realizacji') as w_realizacji,
      COUNT(*) FILTER (WHERE status = 'Zakonczone') as zakonczone
      FROM tasks t ${scope.clause ? `WHERE ${scope.clause}` : ''}`;
    const params = scope.params;
    const result = await pool.query(query, params);
    res.json(result.rows[0]);
  } catch (err) {
    logger.error('Blad pobierania statystyk zlecen', { message: err.message, requestId: req.requestId });
    res.status(500).json({ error: req.t('errors.http.serverError') });
  }
});

router.get('/wszystkie', authMiddleware, validateQuery(taskListQuerySchema), async (req, res) => {
  try {
    const { oddzial_id, limit, offset } = req.query;
    let whereClause = '';
    let params = [];
    if (isTeamScoped(req.user)) {
      const scope = getTaskScope(req.user, 't', 1);
      whereClause = `WHERE ${scope.clause}`;
      params = scope.params;
    } else if (oddzial_id && (isDyrektor(req.user) || isKierownik(req.user))) {
      whereClause = 'WHERE t.oddzial_id = $1';
      params = [oddzial_id];
    } else if (!isDyrektor(req.user)) {
      const scope = getTaskScope(req.user, 't', 1);
      whereClause = `WHERE ${scope.clause}`;
      params = scope.params;
    }

    const baseFrom = `
       FROM tasks t
       LEFT JOIN teams te ON t.ekipa_id = te.id
       LEFT JOIN users u ON t.brygadzista_id = u.id
       LEFT JOIN branches b ON t.oddzial_id = b.id
       ${whereClause}`;

    if (limit != null) {
      const lim = limit;
      const off = offset ?? 0;
      const countResult = await pool.query(`SELECT COUNT(*)::int AS c ${baseFrom}`, params);
      const total = countResult.rows[0]?.c ?? 0;
      const p2 = [...params, lim, off];
      const limIdx = params.length + 1;
      const offIdx = params.length + 2;
      const result = await pool.query(
        `SELECT t.*,
        te.nazwa as ekipa_nazwa,
        u.imie || ' ' || u.nazwisko as kierownik_nazwa,
        b.nazwa as oddzial_nazwa
        ${baseFrom}
       ORDER BY t.data_planowana DESC, t.id DESC
       LIMIT $${limIdx} OFFSET $${offIdx}`,
        p2
      );
      return res.json({ items: result.rows, total, limit: Number(lim), offset: Number(off) });
    }

    const result = await pool.query(
      `SELECT t.*,
        te.nazwa as ekipa_nazwa,
        u.imie || ' ' || u.nazwisko as kierownik_nazwa,
        b.nazwa as oddzial_nazwa
       ${baseFrom}
       ORDER BY t.data_planowana DESC, t.id DESC`,
      params
    );
    res.json(result.rows);
  } catch (err) {
    logger.error('Blad pobierania listy zlecen', { message: err.message, requestId: req.requestId });
    res.status(500).json({ error: req.t('errors.http.serverError') });
  }
});

router.post('/nowe', authMiddleware, validateBody(taskCreateSchema), async (req, res) => {
  try {
    const {
      klient_nazwa, klient_telefon, adres, miasto,
      typ_uslugi, priorytet, wartosc_planowana,
      czas_planowany_godziny, data_planowana,
      notatki_wewnetrzne, oddzial_id, ekipa_id,
      wyceniajacy_id, pin_lat, pin_lng, ankieta_uproszczona
    } = req.body;

    const finalOddzialId = isDyrektor(req.user)
      ? (oddzial_id || req.user.oddzial_id)
      : req.user.oddzial_id;

    const result = await pool.query(
      `INSERT INTO tasks (
        klient_nazwa, klient_telefon, adres, miasto,
        typ_uslugi, priorytet, wartosc_planowana,
        czas_planowany_godziny, data_planowana,
        notatki_wewnetrzne, status, kierownik_id,
        oddzial_id, ekipa_id, wyceniajacy_id, pin_lat, pin_lng, ankieta_uproszczona
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'Nowe',$11,$12,$13,$14,$15,$16,$17)
      RETURNING id`,
      [
        klient_nazwa,
        toStr(klient_telefon),
        adres,
        miasto,
        typ_uslugi || 'Wycinka',
        priorytet || 'Normalny',
        toNum(wartosc_planowana),
        toNum(czas_planowany_godziny),
        data_planowana,
        toStr(notatki_wewnetrzne),
        req.user.id,
        toNum(finalOddzialId),
        toNum(ekipa_id),
        toInt(wyceniajacy_id),
        toNum(pin_lat),
        toNum(pin_lng),
        ankieta_uproszczona === true
      ]
    );
    const taskId = result.rows[0].id;

    let wycenaId = null;
    if (toInt(wyceniajacy_id)) {
      const wycenaR = await pool.query(
        `INSERT INTO wyceny (
          klient_nazwa, klient_telefon, adres, miasto, typ_uslugi,
          wartosc_szacowana, wartosc_planowana, opis, notatki_wewnetrzne,
          lat, lon, autor_id, status, status_akceptacji, data_wykonania
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$6,$7,$8,$9,$10,$11,'Nowa','oczekuje',$12
        ) RETURNING id`,
        [
          klient_nazwa,
          toStr(klient_telefon),
          adres,
          miasto,
          typ_uslugi || 'Wycena',
          toNum(wartosc_planowana),
          `AUTO zlecenie #${taskId} (${ankieta_uproszczona ? 'ankieta uproszczona' : 'pełna ankieta'})`,
          toStr(notatki_wewnetrzne),
          toNum(pin_lat),
          toNum(pin_lng),
          toInt(wyceniajacy_id),
          data_planowana,
        ]
      );
      wycenaId = wycenaR.rows[0]?.id || null;
    }

    res.json({ id: taskId, wycena_id: wycenaId });
  } catch (err) {
    logger.error('Blad tworzenia zlecenia', { message: err.message, requestId: req.requestId });
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', authMiddleware, validateParams(taskIdParamsSchema), requireTaskAccess, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT t.*,
        te.nazwa as ekipa_nazwa,
        u.imie || ' ' || u.nazwisko as kierownik_nazwa,
        b.nazwa as oddzial_nazwa
       FROM tasks t
       LEFT JOIN teams te ON t.ekipa_id = te.id
       LEFT JOIN users u ON t.brygadzista_id = u.id
       LEFT JOIN branches b ON t.oddzial_id = b.id
       WHERE t.id = $1`,
      [req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: req.t('errors.generic.notFound') });
    res.json(result.rows[0]);
  } catch (err) {
    logger.error('Blad pobierania zlecenia', { message: err.message, requestId: req.requestId });
    res.status(500).json({ error: req.t('errors.http.serverError') });
  }
});

router.put('/:id', authMiddleware, validateParams(taskIdParamsSchema), validateBody(taskUpdateSchema), requireTaskAccess, async (req, res) => {
  try {
    const {
      klient_nazwa, klient_telefon, adres, miasto,
      typ_uslugi, priorytet, wartosc_planowana,
      wartosc_rzeczywista, czas_planowany_godziny, data_planowana,
      notatki_wewnetrzne, opis, notatki_klienta
    } = req.body;

    const curR = await pool.query(
      'SELECT wartosc_rzeczywista, opis, notatki_klienta FROM tasks WHERE id = $1',
      [req.params.id]
    );
    if (!curR.rows.length) return res.status(404).json({ error: req.t('errors.generic.notFound') });
    const cur = curR.rows[0];
    const wr = Object.prototype.hasOwnProperty.call(req.body, 'wartosc_rzeczywista')
      ? toNum(wartosc_rzeczywista)
      : cur.wartosc_rzeczywista;
    const op = Object.prototype.hasOwnProperty.call(req.body, 'opis') ? toStr(opis) : cur.opis;
    const nk = Object.prototype.hasOwnProperty.call(req.body, 'notatki_klienta')
      ? toStr(notatki_klienta)
      : cur.notatki_klienta;

    await pool.query(
      `UPDATE tasks SET
        klient_nazwa=$1, klient_telefon=$2, adres=$3, miasto=$4,
        typ_uslugi=$5, priorytet=$6, wartosc_planowana=$7,
        czas_planowany_godziny=$8, data_planowana=$9, notatki_wewnetrzne=$10,
        wartosc_rzeczywista=$11, opis=$12, notatki_klienta=$13
       WHERE id=$14`,
      [
        klient_nazwa,
        toStr(klient_telefon),
        adres,
        miasto,
        typ_uslugi,
        priorytet,
        toNum(wartosc_planowana),
        toNum(czas_planowany_godziny),
        data_planowana,
        toStr(notatki_wewnetrzne),
        wr,
        op,
        nk,
        req.params.id
      ]
    );
    res.json({ message: 'Zaktualizowano' });
  } catch (err) {
    logger.error('Blad aktualizacji zlecenia', { message: err.message, requestId: req.requestId });
    res.status(500).json({ error: req.t('errors.http.serverError') });
  }
});

router.put('/:id/przypisz', authMiddleware, validateParams(taskIdParamsSchema), validateBody(taskAssignSchema), requireTaskAccess, async (req, res) => {
  try {
    const { ekipa_id } = req.body;
    await pool.query(
      "UPDATE tasks SET ekipa_id = $1, status = 'Zaplanowane' WHERE id = $2",
      [toNum(ekipa_id), req.params.id]
    );
    res.json({ message: 'Ekipa przypisana' });
  } catch (err) {
    logger.error('Blad przypisywania ekipy', { message: err.message, requestId: req.requestId });
    res.status(500).json({ error: req.t('errors.http.serverError') });
  }
});

router.put('/:id/status', authMiddleware, validateParams(taskIdParamsSchema), validateBody(taskStatusSchema), requireTaskAccess, async (req, res) => {
  try {
    const { status } = req.body;
    await pool.query('UPDATE tasks SET status = $1 WHERE id = $2', [status, req.params.id]);
    res.json({ message: 'Status zmieniony' });
  } catch (err) {
    logger.error('Blad aktualizacji statusu', { message: err.message, requestId: req.requestId });
    res.status(500).json({ error: req.t('errors.http.serverError') });
  }
});

router.post('/:id/start', authMiddleware, validateParams(taskIdParamsSchema), validateBody(taskStartSchema), requireTaskAccess, async (req, res) => {
  try {
    const { lat, lng, dmuchawa_filtr_ok, rebak_zatankowany, kaski_zespol, bhp_potwierdzone } = req.body;
    const latN = toNum(lat);
    const lngN = toNum(lng);

    if (isTeamScoped(req.user)) {
      if (latN == null || lngN == null) {
        return res.status(400).json({
          error: req.t('errors.tasks.startLocationRequired'),
          code: VALIDATION_FAILED,
          requestId: req.requestId,
        });
      }
      const need = [
        ['dmuchawa_filtr_ok', dmuchawa_filtr_ok],
        ['rebak_zatankowany', rebak_zatankowany],
        ['kaski_zespol', kaski_zespol],
      ];
      for (const [, v] of need) {
        if (typeof v !== 'boolean') {
          return res.status(400).json({
            error: req.t('errors.tasks.startChecklistIncomplete'),
            code: VALIDATION_FAILED,
            requestId: req.requestId,
          });
        }
      }
      if (bhp_potwierdzone !== true) {
        return res.status(400).json({
          error: req.t('errors.tasks.bhpMustConfirm'),
          code: VALIDATION_FAILED,
          requestId: req.requestId,
        });
      }
    }

    const result = await pool.query(
      `INSERT INTO work_logs (
        task_id, user_id, start_time, start_lat, start_lng, status,
        dmuchawa_filtr_ok, rebak_zatankowany, kaski_zespol, bhp_potwierdzone
      ) VALUES ($1, $2, NOW(), $3, $4, 'W_Trakcie', $5, $6, $7, $8) RETURNING id`,
      [
        req.params.id,
        req.user.id,
        latN,
        lngN,
        isTeamScoped(req.user) ? dmuchawa_filtr_ok : null,
        isTeamScoped(req.user) ? rebak_zatankowany : null,
        isTeamScoped(req.user) ? kaski_zespol : null,
        isTeamScoped(req.user) ? bhp_potwierdzone : null,
      ]
    );
    await pool.query(
      `UPDATE tasks SET status = 'W_Realizacji', data_rozpoczecia = COALESCE(data_rozpoczecia, NOW()) WHERE id = $1`,
      [req.params.id]
    );
    res.json({ work_log_id: result.rows[0].id });
  } catch (err) {
    logger.error('Blad rozpoczecia pracy', { message: err.message, requestId: req.requestId });
    res.status(500).json({ error: req.t('errors.http.serverError') });
  }
});

router.post('/:id/stop', authMiddleware, validateParams(taskIdParamsSchema), validateBody(taskStopSchema), requireTaskAccess, async (req, res) => {
  try {
    const { lat, lng, work_log_id } = req.body;
    await pool.query(
      `UPDATE work_logs SET end_time = NOW(), end_lat = $1, end_lng = $2,
       status = 'Zakończony',
       czas_pracy_minuty = EXTRACT(EPOCH FROM (NOW() - start_time))/60
       WHERE id = $3`,
      [toNum(lat), toNum(lng), work_log_id]
    );
    await pool.query("UPDATE tasks SET status = 'Zakonczone' WHERE id = $1", [req.params.id]);
    res.json({ message: 'Czas zapisany' });
  } catch (err) {
    logger.error('Blad zakonczenia pracy', { message: err.message, requestId: req.requestId });
    res.status(500).json({ error: req.t('errors.http.serverError') });
  }
});

router.post('/:id/problem', authMiddleware, validateParams(taskIdParamsSchema), validateBody(taskProblemSchema), requireTaskAccess, async (req, res) => {
  try {
    const { typ } = req.body;
    await pool.query(
      `INSERT INTO issues (task_id, user_id, typ, status, data_zgloszenia)
       VALUES ($1, $2, $3, 'Zgłoszony', NOW())`,
      [req.params.id, req.user.id, typ]
    );
    res.json({ message: 'Problem zgloszony' });
  } catch (err) {
    logger.error('Blad zglaszania problemu', { message: err.message, requestId: req.requestId });
    res.status(500).json({ error: req.t('errors.http.serverError') });
  }
});

router.get('/:id/logi', authMiddleware, validateParams(taskIdParamsSchema), requireTaskAccess, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT wl.*, u.imie || ' ' || u.nazwisko as pracownik
       FROM work_logs wl
       LEFT JOIN users u ON wl.user_id = u.id
       WHERE wl.task_id = $1
       ORDER BY wl.start_time`,
      [req.params.id]
    );
    res.json(result.rows);
  } catch (err) {
    logger.error('Blad pobierania logow pracy', { message: err.message, requestId: req.requestId });
    res.status(500).json({ error: req.t('errors.http.serverError') });
  }
});

router.get('/:id/problemy', authMiddleware, validateParams(taskIdParamsSchema), requireTaskAccess, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT i.*, u.imie || ' ' || u.nazwisko as zglaszajacy
       FROM issues i
       LEFT JOIN users u ON i.user_id = u.id
       WHERE i.task_id = $1
       ORDER BY i.data_zgloszenia DESC`,
      [req.params.id]
    );
    res.json(result.rows);
  } catch (err) {
    logger.error('Blad pobierania problemow', { message: err.message, requestId: req.requestId });
    res.status(500).json({ error: req.t('errors.http.serverError') });
  }
});

router.get('/:id/zdjecia', authMiddleware, validateParams(taskIdParamsSchema), requireTaskAccess, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT p.*, u.imie || ' ' || u.nazwisko as autor
       FROM photos p
       LEFT JOIN users u ON p.user_id = u.id
       WHERE p.task_id = $1
       ORDER BY COALESCE(p.data_dodania, p.id)`,
      [req.params.id]
    );
    const rows = result.rows.map(r => ({
      ...r,
      sciezka: r.sciezka || r.url,
      data_dodania: r.data_dodania || r.timestamp
    }));
    res.json(rows);
  } catch (err) {
    logger.error('Blad pobierania zdjec', { message: err.message, requestId: req.requestId });
    res.status(500).json({ error: req.t('errors.http.serverError') });
  }
});

router.post('/:id/zdjecia', authMiddleware, validateParams(taskIdParamsSchema), requireTaskAccess, upload.single('zdjecie'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: req.t('errors.tasks.missingFile') });
    }
    const typ = req.body.typ || 'Przed';
    const sciezka = '/uploads/tasks/' + req.file.filename;
    const photoLat = toNum(req.body.lat);
    const photoLon = toNum(req.body.lon);
    await pool.query(
      `INSERT INTO photos (task_id, user_id, typ, url, sciezka, data_dodania, lat, lon)
       VALUES ($1, $2, $3, $4, $4, NOW(), $5, $6)`,
      [req.params.id, req.user.id, typ, sciezka, photoLat, photoLon]
    );
    res.json({ message: 'Zdjecie dodane', sciezka });
  } catch (err) {
    logger.error('Blad dodawania zdjecia', { message: err.message, requestId: req.requestId });
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
