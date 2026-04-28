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
const {
  buildKommoTaskPayload,
  postKommoWebhook,
  kommoWebhookConfigured,
} = require('../services/kommo');
const {
  validateClientPayment,
  grossForTask,
  netSettlementValue,
  settlementCalcDetail,
} = require('../services/taskSettlement');
const { tryAutoTeamDayCloseAfterTaskFinish } = require('../services/payrollTeamDay');
const { sendSmsOptional } = require('../services/twilioSms');
const { tryConsumeIdempotencyKey } = require('../lib/idempotency');

const router = express.Router();

let _kommoTaskCols = false;
async function ensureKommoTaskColumns() {
  if (_kommoTaskCols) return;
  _kommoTaskCols = true;
  const stmts = [
    'ALTER TABLE tasks ADD COLUMN IF NOT EXISTS kommo_last_sync_at TIMESTAMPTZ',
    'ALTER TABLE tasks ADD COLUMN IF NOT EXISTS kommo_last_sync_status VARCHAR(32)',
    'ALTER TABLE tasks ADD COLUMN IF NOT EXISTS kommo_last_sync_http INTEGER',
    'ALTER TABLE tasks ADD COLUMN IF NOT EXISTS kommo_last_sync_error TEXT',
  ];
  for (const sql of stmts) {
    await pool.query(sql);
  }
}

function kommoActor(req) {
  const u = req.user;
  if (!u) return null;
  return { id: u.id ?? null, login: u.login ?? null, rola: u.rola ?? null };
}

const isDyrektor = (user) => user.rola === 'Dyrektor' || user.rola === 'Administrator';
const isKierownik = (user) => user.rola === 'Kierownik';
const isTeamScoped = (user) => user.rola === 'Brygadzista' || user.rola === 'Pomocnik';

/** F3.5 — wymuszenie zdjęcia „Po” przy finish (ekipa): ustaw `TASK_FINISH_REQUIRE_PO_PHOTO=1` na serwerze. */
function finishRequirePoPhoto() {
  return process.env.TASK_FINISH_REQUIRE_PO_PHOTO === '1';
}

/** F3.6 — opcjonalnie wymagane zdjęcie „Przed” lub check-in: `TASK_FINISH_REQUIRE_PRZED_PHOTO=1`. */
function finishRequirePrzedPhoto() {
  return process.env.TASK_FINISH_REQUIRE_PRZED_PHOTO === '1';
}

/** F3.7 — wymuszenie listy `zuzyte_materialy` przy finish (ekipa): `TASK_FINISH_REQUIRE_MATERIAL_USAGE=1`. */
function finishRequireMaterialUsage() {
  return process.env.TASK_FINISH_REQUIRE_MATERIAL_USAGE === '1';
}

/** @param {import('pg').PoolClient} client */
async function assertTeamFinishPhotoRules(client, taskId) {
  if (!finishRequirePoPhoto()) return;
  const po = await client.query(
    `SELECT 1 FROM photos WHERE task_id = $1 AND LOWER(TRIM(COALESCE(typ, ''))) IN ('po', 'after') LIMIT 1`,
    [taskId]
  );
  if (!po.rows[0]) {
    const e = new Error('po');
    e.code = 'TASK_FINISH_PO_PHOTO_REQUIRED';
    throw e;
  }
  if (!finishRequirePrzedPhoto()) return;
  const pr = await client.query(
    `SELECT 1 FROM photos WHERE task_id = $1 AND LOWER(TRIM(COALESCE(typ, ''))) IN ('przed', 'before', 'checkin') LIMIT 1`,
    [taskId]
  );
  if (!pr.rows[0]) {
    const e = new Error('przed');
    e.code = 'TASK_FINISH_PRZED_PHOTO_REQUIRED';
    throw e;
  }
}

/** @param {import('pg').PoolClient} client */
async function insertFinishMaterialUsageRows(client, taskId, userId, rows) {
  if (!Array.isArray(rows) || rows.length === 0) return;
  for (const row of rows.slice(0, 50)) {
    const nazwa = row?.nazwa != null ? String(row.nazwa).trim() : '';
    if (!nazwa) continue;
    try {
      await client.query(
        `INSERT INTO task_finish_material_usage (task_id, recorded_by, nazwa, ilosc, jednostka, notatka)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          taskId,
          userId,
          nazwa.slice(0, 200),
          row.ilosc != null && row.ilosc !== '' ? Number(row.ilosc) : null,
          row.jednostka ? String(row.jednostka).trim().slice(0, 24) : null,
          row.notatka ? String(row.notatka).trim().slice(0, 500) : null,
        ]
      );
    } catch (err) {
      if (String(err.message || '').includes('task_finish_material_usage')) {
        const e = new Error('migration');
        e.code = 'TASK_FINISH_USAGE_TABLE_MISSING';
        throw e;
      }
      throw err;
    }
  }
}

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

/** Tagi zdjęcia (PATCH / web) — max 20 etykiet, każda do 80 znaków. */
function normalizePhotoTagi(val) {
  if (val == null) return [];
  const list = Array.isArray(val)
    ? val.map((x) => String(x ?? '').trim()).filter(Boolean)
    : String(val)
        .split(/[,;]+/)
        .map((s) => s.trim())
        .filter(Boolean);
  return list.map((s) => s.slice(0, 80)).slice(0, 20);
}

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

const paymentCloseSchema = z.object({
  forma_platnosc: z.enum(['Gotowka', 'Przelew', 'Faktura_VAT', 'Brak']),
  kwota_odebrana: z.union([z.number(), z.string()]).optional().nullable(),
  faktura_vat: z.boolean().optional(),
  nip: z.string().max(20).optional().nullable(),
  notatki: z.string().max(2000).optional().nullable(),
});

const taskFinishMaterialRowSchema = z.object({
  nazwa: z.string().trim().min(1).max(200),
  ilosc: z.coerce.number().optional().nullable(),
  jednostka: z.string().trim().max(24).optional().nullable(),
  notatka: z.string().trim().max(500).optional().nullable(),
});

const taskFinishSchema = z.object({
  lat: z.union([z.number(), z.string().trim().min(1)]).optional().nullable(),
  lng: z.union([z.number(), z.string().trim().min(1)]).optional().nullable(),
  notatki: z.string().optional().nullable(),
  payment: paymentCloseSchema.optional(),
  zuzyte_materialy: z.array(taskFinishMaterialRowSchema).max(50).optional(),
});

const extraWorkCreateSchema = z.object({
  opis: z.string().trim().min(1).max(4000),
});

const extraWorkQuoteSchema = z.object({
  amount_pln: z.union([z.number(), z.string()]),
});

const extraWorkAcceptSchema = z.object({
  channel: z.enum(['na_miejscu', 'sms']),
});

const ewIdParamSchema = z.object({
  id: z.coerce.number().int().positive(),
  ewId: z.coerce.number().int().positive(),
});

const taskProblemSchema = z.object({
  typ: z.string().trim().min(1, 'typ jest wymagany'),
});

const taskIdParamsSchema = z.object({
  id: z.coerce.number().int().positive(),
});

const taskPhotoIdParamsSchema = z.object({
  id: z.coerce.number().int().positive(),
  photoId: z.coerce.number().int().positive(),
});

const taskPhotoPatchSchema = z
  .object({
    opis: z.string().max(4000).nullable().optional(),
    typ: z.string().trim().max(80).nullable().optional(),
    tagi: z.union([z.string(), z.array(z.string()), z.null()]).optional(),
  })
  .passthrough();

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

router.get(
  '/:id/kommo-payload',
  authMiddleware,
  validateParams(taskIdParamsSchema),
  requireTaskAccess,
  async (req, res) => {
    await ensureKommoTaskColumns();
    try {
      const result = await pool.query('SELECT t.* FROM tasks t WHERE t.id = $1', [req.params.id]);
      if (!result.rows.length) return res.status(404).json({ error: req.t('errors.generic.notFound') });
      res.json(buildKommoTaskPayload(result.rows[0], kommoActor(req)));
    } catch (err) {
      logger.error('Blad kommo-payload zlecenia', { message: err.message, requestId: req.requestId });
      res.status(500).json({ error: req.t('errors.http.serverError') });
    }
  }
);

router.post(
  '/:id/kommo-push',
  authMiddleware,
  validateParams(taskIdParamsSchema),
  requireTaskAccess,
  async (req, res) => {
    await ensureKommoTaskColumns();
    try {
      const result = await pool.query('SELECT t.* FROM tasks t WHERE t.id = $1', [req.params.id]);
      if (!result.rows.length) return res.status(404).json({ error: req.t('errors.generic.notFound') });
      const row = result.rows[0];
      if (!kommoWebhookConfigured('crm')) {
        return res.status(400).json({
          error:
            'Brak konfiguracji webhooka Kommo dla CRM. Ustaw KOMMO_CRM_WEBHOOK_URL lub KOMMO_WEBHOOK_URL.',
        });
      }
      const payload = buildKommoTaskPayload(row, kommoActor(req));
      const markSync = async (next) => {
        await pool.query(
          `UPDATE tasks SET
            kommo_last_sync_at = NOW(),
            kommo_last_sync_status = $1,
            kommo_last_sync_http = $2,
            kommo_last_sync_error = $3,
            updated_at = NOW()
          WHERE id = $4`,
          [next.status || null, next.http ?? null, next.error || null, row.id]
        );
      };
      try {
        const { response, bodyText } = await postKommoWebhook(payload, 'crm');
        if (!response.ok) {
          await markSync({
            status: 'error',
            http: response.status,
            error: `HTTP ${response.status}: ${bodyText.slice(0, 500)}`,
          });
          return res.status(502).json({
            ok: false,
            status: 'error',
            http_status: response.status,
            body: bodyText.slice(0, 500),
          });
        }
        await markSync({ status: 'ok', http: response.status, error: null });
        return res.json({ ok: true, status: 'ok', http_status: response.status });
      } catch (err) {
        await markSync({ status: 'error', http: null, error: err.message || 'network error' });
        return res.status(502).json({
          ok: false,
          status: 'error',
          error: err.message || 'Nie udało się wysłać danych do Kommo',
        });
      }
    } catch (err) {
      logger.error('Blad kommo-push zlecenia', { message: err.message, requestId: req.requestId });
      res.status(500).json({ error: req.t('errors.http.serverError') });
    }
  }
);

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
    const row = result.rows[0];
    try {
      const pay = await pool.query(`SELECT * FROM task_client_payments WHERE task_id = $1`, [req.params.id]);
      row.client_payment = pay.rows[0] || null;
    } catch {
      row.client_payment = null;
    }
    try {
      const ex = await pool.query(`SELECT * FROM task_extra_work WHERE task_id = $1 ORDER BY id DESC`, [req.params.id]);
      row.extra_work = ex.rows;
    } catch {
      row.extra_work = [];
    }
    const tid = req.params.id;
    const [poR, prR] = await Promise.all([
      pool.query(
        `SELECT 1 FROM photos WHERE task_id = $1 AND LOWER(TRIM(COALESCE(typ, ''))) IN ('po', 'after') LIMIT 1`,
        [tid]
      ),
      pool.query(
        `SELECT 1 FROM photos WHERE task_id = $1 AND LOWER(TRIM(COALESCE(typ, ''))) IN ('przed', 'before', 'checkin') LIMIT 1`,
        [tid]
      ),
    ]);
    row.finish_requirements = {
      require_po_photo: finishRequirePoPhoto(),
      require_przed_photo: finishRequirePrzedPhoto(),
      require_material_usage: finishRequireMaterialUsage(),
      has_po_photo: !!poR.rows[0],
      has_przed_photo: !!prR.rows[0],
    };
    res.json(row);
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
  const taskId = Number(req.params.id);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const replay = await tryConsumeIdempotencyKey(client, req, `task:${taskId}:status`);
    if (replay) {
      await client.query('ROLLBACK');
      return res.json({ message: 'Status zmieniony', idempotent_replay: true });
    }
    const { status } = req.body;
    await client.query('UPDATE tasks SET status = $1 WHERE id = $2', [status, req.params.id]);
    await client.query('COMMIT');
    res.json({ message: 'Status zmieniony' });
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* ignore */
    }
    logger.error('Blad aktualizacji statusu', { message: err.message, requestId: req.requestId });
    res.status(500).json({ error: req.t('errors.http.serverError') });
  } finally {
    client.release();
  }
});

router.post('/:id/start', authMiddleware, validateParams(taskIdParamsSchema), validateBody(taskStartSchema), requireTaskAccess, async (req, res) => {
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

  const taskId = Number(req.params.id);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const replay = await tryConsumeIdempotencyKey(client, req, `task:${taskId}:start`);
    if (replay) {
      const wl = await client.query(
        `SELECT id FROM work_logs WHERE task_id = $1 AND end_time IS NULL ORDER BY start_time DESC LIMIT 1`,
        [taskId]
      );
      await client.query('ROLLBACK');
      return res.json({ work_log_id: wl.rows[0]?.id ?? null, idempotent_replay: true });
    }
    const result = await client.query(
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
    await client.query(
      `UPDATE tasks SET status = 'W_Realizacji', data_rozpoczecia = COALESCE(data_rozpoczecia, NOW()) WHERE id = $1`,
      [req.params.id]
    );
    await client.query('COMMIT');
    res.json({ work_log_id: result.rows[0].id });
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* ignore */
    }
    logger.error('Blad rozpoczecia pracy', { message: err.message, requestId: req.requestId });
    res.status(500).json({ error: req.t('errors.http.serverError') });
  } finally {
    client.release();
  }
});

router.post('/:id/stop', authMiddleware, validateParams(taskIdParamsSchema), validateBody(taskStopSchema), requireTaskAccess, async (req, res) => {
  const taskId = Number(req.params.id);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const replay = await tryConsumeIdempotencyKey(client, req, `task:${taskId}:stop`);
    if (replay) {
      await client.query('ROLLBACK');
      return res.json({ message: 'Czas zapisany', idempotent_replay: true });
    }
    const { lat, lng, work_log_id } = req.body;
    await client.query(
      `UPDATE work_logs SET end_time = NOW(), end_lat = $1, end_lng = $2,
       status = 'Zakończony',
       czas_pracy_minuty = EXTRACT(EPOCH FROM (NOW() - start_time))/60
       WHERE id = $3`,
      [toNum(lat), toNum(lng), work_log_id]
    );
    await client.query("UPDATE tasks SET status = 'Zakonczone' WHERE id = $1", [req.params.id]);
    await client.query('COMMIT');
    res.json({ message: 'Czas zapisany' });
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* ignore */
    }
    logger.error('Blad zakonczenia pracy', { message: err.message, requestId: req.requestId });
    res.status(500).json({ error: req.t('errors.http.serverError') });
  } finally {
    client.release();
  }
});

/** M3 F3.9 — zakończenie zlecenia z obowiązkową formą płatności dla ekipy (mobile: POST /finish). */
router.post(
  '/:id/finish',
  authMiddleware,
  validateParams(taskIdParamsSchema),
  validateBody(taskFinishSchema),
  requireTaskAccess,
  async (req, res) => {
    const taskId = Number(req.params.id);
    const cardPct = parseFloat(process.env.PAYROLL_CARD_COMMISSION_PCT || '1.5', 10);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const replay = await tryConsumeIdempotencyKey(client, req, `task:${taskId}:finish`);
      if (replay) {
        await client.query('ROLLBACK');
        const t2 = await pool.query(
          `SELECT status, wartosc_netto_do_rozliczenia FROM tasks WHERE id = $1`,
          [taskId]
        );
        const tr = t2.rows[0];
        if (tr && tr.status === 'Zakonczone') {
          return res.json({
            message: 'Zlecenie zakończone',
            wartosc_netto_do_rozliczenia: Number(tr.wartosc_netto_do_rozliczenia) || 0,
            idempotent_replay: true,
          });
        }
        return res.status(409).json({
          error:
            'Idempotency-Key już użyty, a zlecenie nie jest zakończone — nie można bezpiecznie powtórzyć.',
          code: 'IDEMPOTENCY_INCOMPLETE',
          requestId: req.requestId,
        });
      }
      const tRes = await client.query(`SELECT * FROM tasks WHERE id = $1 FOR UPDATE`, [taskId]);
      const task = tRes.rows[0];
      if (!task) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: req.t('errors.generic.notFound') });
      }
      if (task.status === 'Zakonczone') {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Zlecenie już zakończone', code: VALIDATION_FAILED });
      }
      const payment = req.body.payment;
      if (isTeamScoped(req.user)) {
        const payErr = validateClientPayment(payment, { requireAll: true });
        if (payErr.length) {
          await client.query('ROLLBACK');
          return res.status(400).json({ error: payErr.join('; '), code: 'PAYMENT_REQUIRED' });
        }
      }
      if (isTeamScoped(req.user)) {
        try {
          await assertTeamFinishPhotoRules(client, taskId);
        } catch (e) {
          await client.query('ROLLBACK');
          if (e.code === 'TASK_FINISH_PO_PHOTO_REQUIRED') {
            return res.status(400).json({
              error: req.t('errors.tasks.finishPoPhotoRequired'),
              code: e.code,
              requestId: req.requestId,
            });
          }
          if (e.code === 'TASK_FINISH_PRZED_PHOTO_REQUIRED') {
            return res.status(400).json({
              error: req.t('errors.tasks.finishPrzedPhotoRequired'),
              code: e.code,
              requestId: req.requestId,
            });
          }
          throw e;
        }
        const zu = req.body.zuzyte_materialy;
        if (finishRequireMaterialUsage()) {
          const ok = Array.isArray(zu) && zu.some((r) => r && String(r.nazwa || '').trim().length > 0);
          if (!ok) {
            await client.query('ROLLBACK');
            return res.status(400).json({
              error: req.t('errors.tasks.finishMaterialUsageRequired'),
              code: 'TASK_FINISH_MATERIAL_USAGE_REQUIRED',
              requestId: req.requestId,
            });
          }
        }
      }
      const wl = await client.query(
        `SELECT id FROM work_logs WHERE task_id = $1 AND end_time IS NULL ORDER BY start_time DESC LIMIT 1`,
        [taskId]
      );
      if (!wl.rows[0]) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          error: 'Brak aktywnego wpisu czasu pracy — użyj START przed zakończeniem.',
          code: VALIDATION_FAILED,
        });
      }
      const work_log_id = wl.rows[0].id;
      const lat = toNum(req.body.lat);
      const lng = toNum(req.body.lng);
      const notatki = toStr(req.body.notatki);

      let net;
      const grossVal = grossForTask(task, payment || {});
      if (isTeamScoped(req.user) && payment) {
        net = netSettlementValue(payment.forma_platnosc, grossVal, { cardCommissionPct: cardPct });
      } else {
        net = Number.isFinite(grossVal) && grossVal > 0 ? grossVal : 0;
      }
      if (isTeamScoped(req.user) && payment) {
        await client.query(
          `INSERT INTO task_client_payments (
            task_id, forma_platnosc, kwota_odebrana, faktura_vat, nip, notatki, recorded_by
          ) VALUES ($1,$2,$3,$4,$5,$6,$7)
          ON CONFLICT (task_id) DO UPDATE SET
            forma_platnosc = EXCLUDED.forma_platnosc,
            kwota_odebrana = EXCLUDED.kwota_odebrana,
            faktura_vat = EXCLUDED.faktura_vat,
            nip = EXCLUDED.nip,
            notatki = EXCLUDED.notatki,
            recorded_by = EXCLUDED.recorded_by,
            recorded_at = NOW()`,
          [
            taskId,
            payment.forma_platnosc,
            toNum(payment.kwota_odebrana),
            !!payment.faktura_vat,
            payment.nip ? String(payment.nip).replace(/\s/g, '').slice(0, 20) : null,
            payment.notatki || notatki || null,
            req.user.id,
          ]
        );
      }
      await client.query(
        `UPDATE work_logs SET end_time = NOW(), end_lat = $1, end_lng = $2,
         status = 'Zakończony',
         czas_pracy_minuty = EXTRACT(EPOCH FROM (NOW() - start_time))/60
         WHERE id = $3`,
        [lat, lng, work_log_id]
      );
      await client.query(
        `UPDATE tasks SET status = 'Zakonczone', data_zakonczenia = NOW(),
         wartosc_netto_do_rozliczenia = $1,
         notatki_wewnetrzne = COALESCE($2, notatki_wewnetrzne),
         updated_at = NOW()
         WHERE id = $3`,
        [net, notatki, taskId]
      );
      if (isTeamScoped(req.user) && Array.isArray(req.body.zuzyte_materialy)) {
        try {
          await insertFinishMaterialUsageRows(client, taskId, req.user.id, req.body.zuzyte_materialy);
        } catch (e) {
          if (e.code === 'TASK_FINISH_USAGE_TABLE_MISSING') {
            await client.query('ROLLBACK');
            return res.status(503).json({
              error: 'Uruchom migrację (task_finish_material_usage).',
              requestId: req.requestId,
            });
          }
          throw e;
        }
      }
      const calcDetail = settlementCalcDetail({
        task,
        payment: payment || null,
        gross: grossVal,
        net,
        cardCommissionPct: cardPct,
        teamScoped: isTeamScoped(req.user),
      });
      await client.query(
        `INSERT INTO task_calc_log (task_id, gross, forma_platnosc, net_result, detail_json, recorded_by)
         VALUES ($1,$2,$3,$4,$5::jsonb,$6)`,
        [
          taskId,
          grossVal,
          payment?.forma_platnosc ?? null,
          net,
          JSON.stringify(calcDetail),
          req.user.id,
        ]
      );
      if (task.wyceniajacy_id && net > 0) {
        const accMonth = new Date();
        accMonth.setUTCDate(1);
        accMonth.setUTCHours(0, 0, 0, 0);
        const monthKey = accMonth.toISOString().slice(0, 10);
        await client.query(
          `INSERT INTO estimator_month_accrual (wyceniajacy_id, accrual_month, commission_base, extra_work_pln)
           VALUES ($1, $2::date, $3, 0)
           ON CONFLICT (wyceniajacy_id, accrual_month) DO UPDATE SET
             commission_base = estimator_month_accrual.commission_base + EXCLUDED.commission_base,
             updated_at = NOW()`,
          [task.wyceniajacy_id, monthKey, net]
        );
      }
      await client.query('COMMIT');
      try {
        await tryAutoTeamDayCloseAfterTaskFinish(pool, taskId);
      } catch (e) {
        logger.warn('tasks.finish.autoReport', { message: e.message, taskId });
      }
      res.json({ message: 'Zlecenie zakończone', wartosc_netto_do_rozliczenia: net });
    } catch (e) {
      try {
        await client.query('ROLLBACK');
      } catch {
        /* ignore */
      }
      if (String(e.message || '').includes('task_client_payments')) {
        return res.status(503).json({
          error: 'Brak tabeli płatności — uruchom migrację bazy (task_client_payments).',
        });
      }
      if (String(e.message || '').includes('task_calc_log')) {
        return res.status(503).json({
          error: 'Brak tabeli audytu wyliczeń — uruchom migrację (task_calc_log).',
        });
      }
      logger.error('tasks.finish', { message: e.message, requestId: req.requestId });
      res.status(500).json({ error: req.t('errors.http.serverError') });
    } finally {
      client.release();
    }
  }
);

router.post(
  '/:id/extra-work',
  authMiddleware,
  validateParams(taskIdParamsSchema),
  validateBody(extraWorkCreateSchema),
  requireTaskAccess,
  async (req, res) => {
    if (!isTeamScoped(req.user)) {
      return res.status(403).json({ error: 'Tylko ekipa w terenie zgłasza prace dodatkowe' });
    }
    const taskId = Number(req.params.id);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const replay = await tryConsumeIdempotencyKey(client, req, `task:${taskId}:extra-work`);
      if (replay) {
        await client.query('ROLLBACK');
        return res.status(200).json({ idempotent_replay: true });
      }
      const { rows } = await client.query(
        `INSERT INTO task_extra_work (task_id, created_by, opis, status) VALUES ($1,$2,$3,'OczekujeWyceny') RETURNING *`,
        [req.params.id, req.user.id, req.body.opis.trim()]
      );
      await client.query('COMMIT');
      res.status(201).json(rows[0]);
    } catch (e) {
      try {
        await client.query('ROLLBACK');
      } catch {
        /* ignore */
      }
      if (String(e.message || '').includes('task_extra_work')) {
        return res.status(503).json({ error: 'Uruchom migrację (task_extra_work).' });
      }
      logger.error('tasks.extra-work', { message: e.message });
      res.status(500).json({ error: req.t('errors.http.serverError') });
    } finally {
      client.release();
    }
  }
);

router.patch(
  '/:id/extra-work/:ewId/quote',
  authMiddleware,
  validateParams(ewIdParamSchema),
  validateBody(extraWorkQuoteSchema),
  requireTaskAccess,
  async (req, res) => {
    try {
      const u = req.user;
      const taskR = await pool.query(`SELECT wyceniajacy_id FROM tasks WHERE id = $1`, [req.params.id]);
      const t = taskR.rows[0];
      if (!t) return res.status(404).json({ error: req.t('errors.generic.notFound') });
      const canQuote =
        isDyrektor(u) ||
        isKierownik(u) ||
        (u.rola === 'Wyceniający' && Number(t.wyceniajacy_id) === Number(u.id));
      if (!canQuote) return res.status(403).json({ error: 'Brak uprawnień do wyceny pracy dodatkowej' });
      const amt = toNum(req.body.amount_pln);
      if (amt == null || amt <= 0) return res.status(400).json({ error: 'Kwota musi być > 0' });
      const { rows } = await pool.query(
        `UPDATE task_extra_work SET amount_pln = $1, quoted_by = $2, quoted_at = NOW(), status = 'Wycenione'
         WHERE id = $3 AND task_id = $4 AND status = 'OczekujeWyceny'
         RETURNING *`,
        [amt, u.id, req.params.ewId, req.params.id]
      );
      if (!rows[0]) return res.status(400).json({ error: 'Brak oczekującej pracy dodatkowej' });
      res.json(rows[0]);
    } catch (e) {
      logger.error('tasks.extra-work.quote', { message: e.message });
      res.status(500).json({ error: req.t('errors.http.serverError') });
    }
  }
);

router.post(
  '/:id/extra-work/:ewId/accept',
  authMiddleware,
  validateParams(ewIdParamSchema),
  validateBody(extraWorkAcceptSchema),
  requireTaskAccess,
  async (req, res) => {
    if (!isTeamScoped(req.user)) {
      return res.status(403).json({ error: 'Akceptacja z terenu — brygadzista / pomocnik' });
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const taskId = Number(req.params.id);
      const ewId = Number(req.params.ewId);
      const replay = await tryConsumeIdempotencyKey(client, req, `task:${taskId}:extra-work-accept:${ewId}`);
      if (replay) {
        await client.query('ROLLBACK');
        return res.json({ ok: true, idempotent_replay: true });
      }
      const ewR = await client.query(`SELECT * FROM task_extra_work WHERE id = $1 AND task_id = $2 FOR UPDATE`, [
        req.params.ewId,
        req.params.id,
      ]);
      const ew = ewR.rows[0];
      if (!ew || ew.status !== 'Wycenione') {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Praca musi być najpierw wyceniona' });
      }
      const taskR = await client.query(`SELECT * FROM tasks WHERE id = $1 FOR UPDATE`, [req.params.id]);
      const task = taskR.rows[0];
      if (!task) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: req.t('errors.generic.notFound') });
      }
      const amt = Number(ew.amount_pln);
      await client.query(
        `UPDATE task_extra_work SET status = 'Zaakceptowane', accepted_at = NOW(), acceptance_channel = $1 WHERE id = $2`,
        [req.body.channel, req.params.ewId]
      );
      await client.query(
        `UPDATE tasks SET wartosc_rzeczywista = COALESCE(wartosc_rzeczywista, COALESCE(wartosc_planowana,0)) + $1, updated_at = NOW() WHERE id = $2`,
        [amt, req.params.id]
      );
      if (task.wyceniajacy_id && amt > 0) {
        const accMonth = new Date();
        accMonth.setUTCDate(1);
        const monthKey = accMonth.toISOString().slice(0, 10);
        await client.query(
          `INSERT INTO estimator_month_accrual (wyceniajacy_id, accrual_month, commission_base, extra_work_pln)
           VALUES ($1, $2::date, 0, $3)
           ON CONFLICT (wyceniajacy_id, accrual_month) DO UPDATE SET
             extra_work_pln = estimator_month_accrual.extra_work_pln + EXCLUDED.extra_work_pln,
             updated_at = NOW()`,
          [task.wyceniajacy_id, monthKey, amt]
        );
      }
      await client.query('COMMIT');
      if (req.body.channel === 'sms' && task.klient_telefon) {
        const msg = `ARBOR: akceptacja dopłaty ${amt} PLN do zlecenia #${req.params.id}. Dziękujemy!`;
        void sendSmsOptional({ to: task.klient_telefon, body: msg, taskId: Number(req.params.id) });
      }
      res.json({ ok: true, amount_pln: amt });
    } catch (e) {
      try {
        await client.query('ROLLBACK');
      } catch {
        /* ignore */
      }
      logger.error('tasks.extra-work.accept', { message: e.message });
      res.status(500).json({ error: req.t('errors.http.serverError') });
    } finally {
      client.release();
    }
  }
);

const postTaskProblem = async (req, res) => {
  const taskId = Number(req.params.id);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const replay = await tryConsumeIdempotencyKey(client, req, `task:${taskId}:problem`);
    if (replay) {
      await client.query('ROLLBACK');
      return res.json({ message: 'Problem zgloszony', idempotent_replay: true });
    }
    const { typ } = req.body;
    await client.query(
      `INSERT INTO issues (task_id, user_id, typ, status, data_zgloszenia)
       VALUES ($1, $2, $3, 'Zgłoszony', NOW())`,
      [req.params.id, req.user.id, typ]
    );
    await client.query('COMMIT');
    res.json({ message: 'Problem zgloszony' });
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* ignore */
    }
    logger.error('Blad zglaszania problemu', { message: err.message, requestId: req.requestId });
    res.status(500).json({ error: req.t('errors.http.serverError') });
  } finally {
    client.release();
  }
};

router.post(
  '/:id/problem',
  authMiddleware,
  validateParams(taskIdParamsSchema),
  validateBody(taskProblemSchema),
  requireTaskAccess,
  postTaskProblem
);
router.post(
  '/:id/problemy',
  authMiddleware,
  validateParams(taskIdParamsSchema),
  validateBody(taskProblemSchema),
  requireTaskAccess,
  postTaskProblem
);

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
    const opisRaw = req.body.opis;
    const photoOpis =
      opisRaw != null && String(opisRaw).trim() ? String(opisRaw).trim().slice(0, 4000) : null;
    let photoTagi = [];
    const tagiRaw = req.body.tagi;
    if (tagiRaw != null && String(tagiRaw).trim()) {
      const s = String(tagiRaw).trim();
      try {
        const parsed = JSON.parse(s);
        photoTagi = normalizePhotoTagi(Array.isArray(parsed) ? parsed : s);
      } catch {
        photoTagi = normalizePhotoTagi(s);
      }
    }
    await pool.query(
      `INSERT INTO photos (task_id, user_id, typ, url, sciezka, data_dodania, lat, lon, opis, tagi)
       VALUES ($1, $2, $3, $4, $4, NOW(), $5, $6, $7, $8)`,
      [req.params.id, req.user.id, typ, sciezka, photoLat, photoLon, photoOpis, photoTagi]
    );
    res.json({ message: 'Zdjecie dodane', sciezka });
  } catch (err) {
    logger.error('Blad dodawania zdjecia', { message: err.message, requestId: req.requestId });
    res.status(500).json({ error: err.message });
  }
});

router.patch(
  '/:id/zdjecia/:photoId',
  authMiddleware,
  validateParams(taskPhotoIdParamsSchema),
  validateBody(taskPhotoPatchSchema),
  requireTaskAccess,
  async (req, res) => {
    try {
      const taskId = Number(req.params.id);
      const photoId = Number(req.params.photoId);
      const b = req.body;
      const parts = [];
      const vals = [];
      if (Object.prototype.hasOwnProperty.call(b, 'typ') && b.typ != null) {
        parts.push(`typ = $${parts.length + 1}`);
        vals.push(String(b.typ).slice(0, 80));
      }
      if (Object.prototype.hasOwnProperty.call(b, 'opis')) {
        parts.push(`opis = $${parts.length + 1}`);
        const raw = b.opis;
        vals.push(raw == null || String(raw).trim() === '' ? null : String(raw).trim().slice(0, 4000));
      }
      if (Object.prototype.hasOwnProperty.call(b, 'tagi')) {
        parts.push(`tagi = $${parts.length + 1}`);
        vals.push(b.tagi == null ? [] : normalizePhotoTagi(b.tagi));
      }
      if (!parts.length) {
        const cur = await pool.query(`SELECT p.*, u.imie || ' ' || u.nazwisko AS autor FROM photos p LEFT JOIN users u ON u.id = p.user_id WHERE p.id = $1 AND p.task_id = $2`, [photoId, taskId]);
        if (!cur.rows.length) return res.status(404).json({ error: req.t('errors.generic.notFound') });
        const r = cur.rows[0];
        return res.json({
          ...r,
          sciezka: r.sciezka || r.url,
          data_dodania: r.data_dodania || r.timestamp,
        });
      }
      const idPh = vals.length + 1;
      const taskPh = vals.length + 2;
      vals.push(photoId, taskId);
      const result = await pool.query(
        `UPDATE photos SET ${parts.join(', ')} WHERE id = $${idPh} AND task_id = $${taskPh}
         RETURNING *`,
        vals
      );
      if (!result.rows.length) return res.status(404).json({ error: req.t('errors.generic.notFound') });
      const r = result.rows[0];
      const u = await pool.query(`SELECT imie || ' ' || nazwisko AS autor FROM users WHERE id = $1`, [r.user_id]);
      res.json({
        ...r,
        autor: u.rows[0]?.autor || null,
        sciezka: r.sciezka || r.url,
        data_dodania: r.data_dodania || r.timestamp,
      });
    } catch (err) {
      logger.error('Blad patch zdjecia', { message: err.message, requestId: req.requestId });
      res.status(500).json({ error: req.t('errors.http.serverError') });
    }
  }
);

router.delete(
  '/:id/zdjecia/:photoId',
  authMiddleware,
  validateParams(taskPhotoIdParamsSchema),
  requireTaskAccess,
  async (req, res) => {
    try {
      const taskId = Number(req.params.id);
      const photoId = Number(req.params.photoId);
      const sel = await pool.query(`SELECT sciezka FROM photos WHERE id = $1 AND task_id = $2`, [photoId, taskId]);
      if (!sel.rows.length) return res.status(404).json({ error: req.t('errors.generic.notFound') });
      const sciezka = sel.rows[0].sciezka;
      await pool.query(`DELETE FROM photos WHERE id = $1 AND task_id = $2`, [photoId, taskId]);
      if (sciezka && typeof sciezka === 'string') {
        const rel = sciezka.replace(/^\/+/, '');
        const abs = path.isAbsolute(rel) ? rel : path.join(process.cwd(), rel);
        try {
          if (fs.existsSync(abs)) fs.unlinkSync(abs);
        } catch (e) {
          logger.warn('photo.unlink', { message: e.message, abs });
        }
      }
      res.json({ ok: true });
    } catch (err) {
      logger.error('Blad usuwania zdjecia', { message: err.message, requestId: req.requestId });
      res.status(500).json({ error: req.t('errors.http.serverError') });
    }
  }
);

module.exports = router;
