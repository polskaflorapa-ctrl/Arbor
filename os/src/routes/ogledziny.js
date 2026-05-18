const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const pool = require('../config/database');
const logger = require('../config/logger');
const { uploadsPath } = require('../config/uploadPaths');
const { authMiddleware } = require('../middleware/auth');
const { validateQuery, validateBody, validateParams } = require('../middleware/validate');
const { z } = require('zod');

const router = express.Router();

const OGLEDZINY_STATUS = ['Zaplanowane', 'W_Trakcie', 'Zakonczone', 'Anulowane'];
const OGLEDZINY_FIELD_EVENT_TYPES = ['start', 'delay', 'done', 'heartbeat', 'note'];

const ogledzinyIdParamsSchema = z.object({
  id: z.coerce.number().int().positive(),
});

const ogledzinyListQuerySchema = z.object({
  status: z.string().max(30).optional(),
  from: z.string().max(40).optional(),
  to: z.string().max(40).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

const optionalIdTransform = z
  .any()
  .optional()
  .transform((v) => {
    if (v === undefined || v === null || v === '') return null;
    const n = parseInt(String(v), 10);
    return Number.isNaN(n) ? null : n;
  });

const ogledzinyCreateSchema = z.object({
  klient_id: z.coerce.number().int().positive({ message: 'Podaj klient_id' }),
  brygadzista_id: optionalIdTransform,
  data_planowana: z.string().max(40).optional().nullable(),
  adres: z.string().max(255).optional().nullable(),
  miasto: z.string().max(100).optional().nullable(),
  notatki: z.string().optional().nullable(),
});

const ogledzinyUpdateSchema = z.object({
  brygadzista_id: optionalIdTransform,
  data_planowana: z.string().max(40).optional().nullable(),
  adres: z.string().max(255).optional().nullable(),
  miasto: z.string().max(100).optional().nullable(),
  notatki: z.string().optional().nullable(),
  notatki_wyniki: z.string().optional().nullable(),
  status: z.enum(OGLEDZINY_STATUS).optional(),
});

const ogledzinyStatusBodySchema = z.object({
  status: z.enum(OGLEDZINY_STATUS),
  notatki_wyniki: z.string().optional().nullable(),
});

const ogledzinyFieldEventBodySchema = z.object({
  event_type: z.enum(OGLEDZINY_FIELD_EVENT_TYPES),
  lat: z.union([z.number(), z.string()]).optional().nullable(),
  lng: z.union([z.number(), z.string()]).optional().nullable(),
  eta_min: z.coerce.number().int().min(0).max(600).optional().nullable(),
  note: z.string().max(2000).optional().nullable(),
});

const fieldEventsTodayQuerySchema = z.object({
  date: z.string().max(20).optional(),
});

const ogledzinyWycenaBodySchema = z.object({
  wycena_id: z.coerce.number().int().positive(),
});

const isDyrektor = (u) => ['Prezes', 'Dyrektor'].includes(u.rola);
const canManage = (u) => isDyrektor(u) || u.rola === 'Kierownik';
const _isBrygadzista = (u) => u.rola === 'Brygadzista';

const toNum = (v) => {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};

const ogledzinyMediaDir = uploadsPath('ogledziny');
const ogledzinyMediaStorage = multer.diskStorage({
  destination: (_, __, cb) => {
    fs.mkdirSync(ogledzinyMediaDir, { recursive: true });
    cb(null, ogledzinyMediaDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || '') || '.mp4';
    cb(null, `ogl_${req.params.id}_${Date.now()}${ext}`);
  },
});
const ogledzinyMediaUpload = multer({
  storage: ogledzinyMediaStorage,
  limits: { fileSize: 200 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const mime = String(file.mimetype || '');
    if (mime.startsWith('image/') || mime.startsWith('video/')) {
      cb(null, true);
      return;
    }
    cb(new Error('Dozwolone sa tylko pliki image/video'));
  },
});

/** Kierownik / Dyrektor lub przypisany brygadzista (jak lista GET /ogledziny). */
function canAccessOgledzinyRecord(user, row) {
  if (!row || !user) return false;
  if (canManage(user)) return true;
  const uid = Number(user.id);
  const directMatch = [row.brygadzista_id, row.wyceniajacy_id, row.created_by]
    .some((id) => id != null && Number(id) === uid);
  if (directMatch) return true;
  if (['Wyceniający', 'Wyceniajacy', 'Specjalista', 'Brygadzista'].includes(user.rola)) {
    if (row.oddzial_id == null || user.oddzial_id == null) return true;
    return Number(row.oddzial_id) === Number(user.oddzial_id);
  }
  return false;
}

// ── Migracja tabel ────────────────────────────────────────────────────────────
let _migDone = false;
const runMigration = async () => {
  if (_migDone) return;
  _migDone = true;
  const safe = async (sql) => {
    try { await pool.query(sql); } catch (e) {
      if (!['42P07','42701','42710'].includes(e.code)) throw e;
    }
  };

  // Tabela klientów (może już istnieć z klienci.js)
  await safe(`
    CREATE TABLE IF NOT EXISTS klienci (
      id            SERIAL PRIMARY KEY,
      imie          VARCHAR(100),
      nazwisko      VARCHAR(100),
      firma         VARCHAR(200),
      telefon       VARCHAR(30),
      email         VARCHAR(255),
      adres         VARCHAR(255),
      miasto        VARCHAR(100),
      kod_pocztowy  VARCHAR(10),
      notatki       TEXT,
      zrodlo        VARCHAR(50) DEFAULT 'telefon',
      created_by    INTEGER REFERENCES users(id),
      created_at    TIMESTAMP DEFAULT NOW(),
      updated_at    TIMESTAMP DEFAULT NOW()
    )
  `);

  await safe(`
    CREATE TABLE IF NOT EXISTS ogledziny (
      id               SERIAL PRIMARY KEY,
      klient_id        INTEGER REFERENCES klienci(id) ON DELETE SET NULL,
      brygadzista_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
      data_planowana   TIMESTAMP,
      status           VARCHAR(30) DEFAULT 'Zaplanowane',
      adres            VARCHAR(255),
      miasto           VARCHAR(100),
      notatki          TEXT,
      notatki_wyniki   TEXT,
      wycena_id        INTEGER REFERENCES wyceny(id) ON DELETE SET NULL,
      task_id          INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
      created_by       INTEGER REFERENCES users(id),
      created_at       TIMESTAMP DEFAULT NOW(),
      updated_at       TIMESTAMP DEFAULT NOW()
    )
  `);

  await safe(`CREATE INDEX IF NOT EXISTS idx_ogledziny_brygadzista ON ogledziny(brygadzista_id)`);
  await safe(`CREATE INDEX IF NOT EXISTS idx_ogledziny_status      ON ogledziny(status)`);
  await safe(`CREATE INDEX IF NOT EXISTS idx_ogledziny_data        ON ogledziny(data_planowana)`);

  await safe(`
    CREATE TABLE IF NOT EXISTS ogledziny_media (
      id             SERIAL PRIMARY KEY,
      ogledziny_id   INTEGER NOT NULL REFERENCES ogledziny(id) ON DELETE CASCADE,
      url            VARCHAR(512) NOT NULL,
      mime           VARCHAR(120),
      kind           VARCHAR(20) DEFAULT 'video',
      created_at     TIMESTAMP DEFAULT NOW()
    )
  `);
  await safe(`CREATE INDEX IF NOT EXISTS idx_ogledziny_media_ogl ON ogledziny_media(ogledziny_id)`);

  await safe(`
    CREATE TABLE IF NOT EXISTS ogledziny_field_events (
      id             SERIAL PRIMARY KEY,
      ogledziny_id   INTEGER NOT NULL REFERENCES ogledziny(id) ON DELETE CASCADE,
      user_id        INTEGER REFERENCES users(id) ON DELETE SET NULL,
      event_type     VARCHAR(30) NOT NULL,
      lat            NUMERIC(10,7),
      lng            NUMERIC(10,7),
      eta_min        INTEGER,
      note           TEXT,
      recorded_at    TIMESTAMP DEFAULT NOW()
    )
  `);
  await safe(`CREATE INDEX IF NOT EXISTS idx_ogledziny_field_events_ogl ON ogledziny_field_events(ogledziny_id, recorded_at DESC)`);
  await safe(`CREATE INDEX IF NOT EXISTS idx_ogledziny_field_events_time ON ogledziny_field_events(recorded_at DESC)`);
};

// ── GET /api/ogledziny ────────────────────────────────────────────────────────
// Kierownik/Admin: wszystkie | Brygadzista: tylko swoje
router.get('/', authMiddleware, validateQuery(ogledzinyListQuerySchema), async (req, res) => {
  await runMigration();
  try {
    const { status, from, to, limit, offset } = req.query;

    let where = 'WHERE 1=1';
    const params = [];

    if (!canManage(req.user)) {
      params.push(req.user.id);
      where += ` AND o.brygadzista_id = $${params.length}`;
    }
    if (status) {
      params.push(status);
      where += ` AND o.status = $${params.length}`;
    }
    if (from) {
      params.push(from);
      where += ` AND o.data_planowana >= $${params.length}`;
    }
    if (to) {
      params.push(to);
      where += ` AND o.data_planowana <= $${params.length}`;
    }

    const fromJoin = `
      FROM ogledziny o
      LEFT JOIN klienci k ON k.id = o.klient_id
      LEFT JOIN users u   ON u.id = o.brygadzista_id
      LEFT JOIN users c   ON c.id = o.created_by
      LEFT JOIN wyceny w  ON w.id = o.wycena_id
      LEFT JOIN LATERAL (
        SELECT event_type, lat, lng, eta_min, note, recorded_at
        FROM ogledziny_field_events e
        WHERE e.ogledziny_id = o.id
        ORDER BY e.recorded_at DESC, e.id DESC
        LIMIT 1
      ) live ON true
      ${where}`;

    if (limit != null) {
      const lim = Number(limit);
      const off = Number(offset ?? 0);
      const countR = await pool.query(`SELECT COUNT(*)::int AS c FROM ogledziny o ${where}`, params);
      const total = countR.rows[0]?.c ?? 0;
      const limIdx = params.length + 1;
      const offIdx = params.length + 2;
      const q = `
      SELECT o.*,
        k.imie || ' ' || COALESCE(k.nazwisko,'') AS klient_nazwa,
        k.telefon AS klient_telefon,
        k.firma AS klient_firma,
        u.imie || ' ' || u.nazwisko AS brygadzista_nazwa,
        c.imie || ' ' || c.nazwisko AS created_by_nazwa,
        w.wartosc_szacowana, w.status_akceptacji AS wycena_status,
        live.event_type AS live_event_type,
        live.recorded_at AS live_recorded_at,
        live.lat AS live_lat,
        live.lng AS live_lng,
        live.eta_min AS live_eta_min,
        live.note AS live_note
      ${fromJoin}
      ORDER BY o.data_planowana ASC NULLS LAST, o.created_at DESC
      LIMIT $${limIdx} OFFSET $${offIdx}`;
      const { rows } = await pool.query(q, [...params, lim, off]);
      return res.json({ items: rows, total, limit: lim, offset: off });
    }

    const q = `
      SELECT o.*,
        k.imie || ' ' || COALESCE(k.nazwisko,'') AS klient_nazwa,
        k.telefon AS klient_telefon,
        k.firma AS klient_firma,
        u.imie || ' ' || u.nazwisko AS brygadzista_nazwa,
        c.imie || ' ' || c.nazwisko AS created_by_nazwa,
        w.wartosc_szacowana, w.status_akceptacji AS wycena_status,
        live.event_type AS live_event_type,
        live.recorded_at AS live_recorded_at,
        live.lat AS live_lat,
        live.lng AS live_lng,
        live.eta_min AS live_eta_min,
        live.note AS live_note
      ${fromJoin}
      ORDER BY o.data_planowana ASC NULLS LAST, o.created_at DESC`;

    const { rows } = await pool.query(q, params);
    res.json(rows);
  } catch (e) {
    logger.error('Blad pobierania ogledzin', { message: e.message, requestId: req.requestId });
    res.status(500).json({ error: req.t('errors.http.serverError') });
  }
});

// ── GET /api/ogledziny/field-events/today ───────────────────────────────────
// Widok dla biura: ostatnie zdarzenia terenowe wyceniajacych z wybranego dnia.
router.get('/field-events/today', authMiddleware, validateQuery(fieldEventsTodayQuerySchema), async (req, res) => {
  await runMigration();
  try {
    if (!canManage(req.user)) return res.status(403).json({ error: req.t('errors.auth.forbidden') });
    const day = req.query.date || new Date().toISOString().slice(0, 10);
    const { rows } = await pool.query(
      `SELECT e.*,
        o.status AS ogledziny_status,
        o.data_planowana,
        o.adres,
        o.miasto,
        k.imie || ' ' || COALESCE(k.nazwisko,'') AS klient_nazwa,
        k.telefon AS klient_telefon,
        u.imie || ' ' || u.nazwisko AS user_nazwa
       FROM ogledziny_field_events e
       JOIN ogledziny o ON o.id = e.ogledziny_id
       LEFT JOIN klienci k ON k.id = o.klient_id
       LEFT JOIN users u ON u.id = e.user_id
       WHERE e.recorded_at::date = $1::date
       ORDER BY e.recorded_at DESC, e.id DESC
       LIMIT 300`,
      [day],
    );
    res.json({ date: day, items: rows });
  } catch (e) {
    logger.error('ogledziny.fieldEvents.today', { message: e.message, requestId: req.requestId });
    res.status(500).json({ error: req.t('errors.http.serverError') });
  }
});

// ── GET /api/ogledziny/:id ────────────────────────────────────────────────────
router.get('/:id', authMiddleware, validateParams(ogledzinyIdParamsSchema), async (req, res) => {
  await runMigration();
  try {
    const { rows } = await pool.query(`
      SELECT o.*,
        k.imie, k.nazwisko, k.firma, k.telefon AS klient_telefon, k.email AS klient_email,
        k.imie || ' ' || COALESCE(k.nazwisko,'') AS klient_nazwa,
        u.imie || ' ' || u.nazwisko AS brygadzista_nazwa,
        c.imie || ' ' || c.nazwisko AS created_by_nazwa,
        w.wartosc_szacowana, w.status_akceptacji AS wycena_status,
        w.opis AS wycena_opis,
        live.event_type AS live_event_type,
        live.recorded_at AS live_recorded_at,
        live.lat AS live_lat,
        live.lng AS live_lng,
        live.eta_min AS live_eta_min,
        live.note AS live_note
      FROM ogledziny o
      LEFT JOIN klienci k ON k.id = o.klient_id
      LEFT JOIN users u   ON u.id = o.brygadzista_id
      LEFT JOIN users c   ON c.id = o.created_by
      LEFT JOIN wyceny w  ON w.id = o.wycena_id
      LEFT JOIN LATERAL (
        SELECT event_type, lat, lng, eta_min, note, recorded_at
        FROM ogledziny_field_events e
        WHERE e.ogledziny_id = o.id
        ORDER BY e.recorded_at DESC, e.id DESC
        LIMIT 1
      ) live ON true
      WHERE o.id = $1
    `, [req.params.id]);

    if (!rows.length) return res.status(404).json({ error: req.t('errors.ogledziny.inspectionNotFound') });

    // Zdjęcia z wyceny powiązanej (jeśli jest)
    let zdjecia = [];
    if (rows[0].wycena_id) {
      const zdQ = await pool.query(`SELECT * FROM wyceny_zdjecia WHERE wycena_id=$1 ORDER BY created_at`, [rows[0].wycena_id]).catch(() => ({ rows: [] }));
      zdjecia = zdQ.rows.map((z) => ({ ...z, url: z.url || z.sciezka || null }));
    }

    const medQ = await pool
      .query(
        `SELECT id, ogledziny_id, url, mime, kind, created_at
         FROM ogledziny_media WHERE ogledziny_id=$1 ORDER BY created_at`,
        [req.params.id],
      )
      .catch(() => ({ rows: [] }));
    const media = medQ.rows;

    res.json({ ...rows[0], zdjecia, media });
  } catch (e) {
    logger.error('Blad pobierania ogledzin po id', { message: e.message, requestId: req.requestId });
    res.status(500).json({ error: req.t('errors.http.serverError') });
  }
});

// ── POST /api/ogledziny ───────────────────────────────────────────────────────
// Biuro/Kierownik planuje oględziny dla klienta
router.post('/', authMiddleware, validateBody(ogledzinyCreateSchema), async (req, res) => {
  await runMigration();
  try {
    const { klient_id, brygadzista_id, data_planowana, adres, miasto, notatki } = req.body;

    const { rows } = await pool.query(`
      INSERT INTO ogledziny (klient_id, brygadzista_id, data_planowana, adres, miasto, notatki, created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7)
      RETURNING *
    `, [klient_id, brygadzista_id || null, data_planowana || null, adres, miasto, notatki, req.user.id]);

    res.status(201).json(rows[0]);
  } catch (e) {
    logger.error('Blad tworzenia ogledzin', { message: e.message, requestId: req.requestId });
    res.status(500).json({ error: req.t('errors.http.serverError') });
  }
});

// ── PUT /api/ogledziny/:id ────────────────────────────────────────────────────
router.put('/:id', authMiddleware, validateParams(ogledzinyIdParamsSchema), validateBody(ogledzinyUpdateSchema), async (req, res) => {
  await runMigration();
  try {
    const { id } = req.params;
    const { brygadzista_id, data_planowana, adres, miasto, notatki, notatki_wyniki, status } = req.body;

    const existing = await pool.query('SELECT * FROM ogledziny WHERE id=$1', [id]);
    if (!existing.rows.length) return res.status(404).json({ error: req.t('errors.generic.notFound') });
    if (!canAccessOgledzinyRecord(req.user, existing.rows[0])) {
      return res.status(403).json({ error: req.t('errors.auth.forbidden') });
    }

    const newStatus = status;

    const { rows } = await pool.query(`
      UPDATE ogledziny SET
        brygadzista_id = COALESCE($1, brygadzista_id),
        data_planowana = COALESCE($2, data_planowana),
        adres          = COALESCE($3, adres),
        miasto         = COALESCE($4, miasto),
        notatki        = COALESCE($5, notatki),
        notatki_wyniki = COALESCE($6, notatki_wyniki),
        status         = COALESCE($7, status),
        updated_at     = NOW()
      WHERE id = $8 RETURNING *
    `, [brygadzista_id||null, data_planowana||null, adres||null, miasto||null, notatki||null, notatki_wyniki||null, newStatus||null, id]);

    if (!rows.length) return res.status(404).json({ error: req.t('errors.generic.notFound') });
    res.json(rows[0]);
  } catch (e) {
    logger.error('Blad aktualizacji ogledzin', { message: e.message, requestId: req.requestId });
    res.status(500).json({ error: req.t('errors.http.serverError') });
  }
});

// ── PUT /api/ogledziny/:id/status ─────────────────────────────────────────────
router.put('/:id/status', authMiddleware, validateParams(ogledzinyIdParamsSchema), validateBody(ogledzinyStatusBodySchema), async (req, res) => {
  await runMigration();
  try {
    const { status, notatki_wyniki } = req.body;

    const existing = await pool.query('SELECT * FROM ogledziny WHERE id=$1', [req.params.id]);
    if (!existing.rows.length) return res.status(404).json({ error: req.t('errors.generic.notFound') });
    if (!canAccessOgledzinyRecord(req.user, existing.rows[0])) {
      return res.status(403).json({ error: req.t('errors.auth.forbidden') });
    }

    const { rows } = await pool.query(`
      UPDATE ogledziny SET status=$1, notatki_wyniki=COALESCE($2, notatki_wyniki), updated_at=NOW()
      WHERE id=$3 RETURNING *
    `, [status, notatki_wyniki || null, req.params.id]);

    if (!rows.length) return res.status(404).json({ error: req.t('errors.generic.notFound') });
    res.json(rows[0]);
  } catch (e) {
    logger.error('Blad aktualizacji statusu ogledzin', { message: e.message, requestId: req.requestId });
    res.status(500).json({ error: req.t('errors.http.serverError') });
  }
});

// ── POST /api/ogledziny/:id/field-event ──────────────────────────────────────
// Teren: start, opoznienie, heartbeat, notatka, koniec wizyty z GPS/ETA.
router.post('/:id/field-event', authMiddleware, validateParams(ogledzinyIdParamsSchema), validateBody(ogledzinyFieldEventBodySchema), async (req, res) => {
  await runMigration();
  try {
    const { id } = req.params;
    const { event_type, eta_min, note } = req.body;
    const lat = toNum(req.body.lat);
    const lng = toNum(req.body.lng);

    const ogQ = await pool.query('SELECT * FROM ogledziny WHERE id=$1', [id]);
    const row = ogQ.rows[0];
    if (!row) return res.status(404).json({ error: req.t('errors.ogledziny.inspectionNotFound') });

    if (!canAccessOgledzinyRecord(req.user, row)) {
      return res.status(403).json({ error: req.t('errors.auth.forbidden') });
    }

    const ins = await pool.query(
      `INSERT INTO ogledziny_field_events (ogledziny_id, user_id, event_type, lat, lng, eta_min, note)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING id, ogledziny_id, user_id, event_type, lat, lng, eta_min, note, recorded_at`,
      [id, req.user.id, event_type, lat, lng, eta_min ?? null, note || null],
    );

    if (event_type === 'start') {
      await pool.query(`UPDATE ogledziny SET status='W_Trakcie', updated_at=NOW() WHERE id=$1 AND status <> 'Zakonczone'`, [id]);
    } else if (event_type === 'done') {
      await pool.query(`UPDATE ogledziny SET status='Zakonczone', updated_at=NOW() WHERE id=$1`, [id]);
    } else if (event_type === 'delay' && note) {
      await pool.query(
        `UPDATE ogledziny
         SET notatki_wyniki = CONCAT_WS(E'\n', NULLIF(notatki_wyniki, ''), $2),
             updated_at = NOW()
         WHERE id=$1`,
        [id, `Opoznienie: ${note}`],
      );
    }

    res.status(201).json(ins.rows[0]);
  } catch (e) {
    logger.error('ogledziny.fieldEvent', { message: e.message, requestId: req.requestId });
    res.status(500).json({ error: req.t('errors.http.serverError') });
  }
});

// ── POST /api/ogledziny/:id/media ─────────────────────────────────────────────
// Wideo z terenu (pole formularza jak w mobile: „wideo”).
router.post(
  '/:id/media',
  authMiddleware,
  validateParams(ogledzinyIdParamsSchema),
  ogledzinyMediaUpload.any(),
  async (req, res) => {
    await runMigration();
    try {
      const id = String(req.params.id);
      const file = Array.isArray(req.files) ? req.files[0] : req.file;
      if (!file) return res.status(400).json({ error: 'Brak pliku (pole: media / zdjecie / wideo)' });

      const ogQ = await pool.query('SELECT * FROM ogledziny WHERE id=$1', [id]);
      const row = ogQ.rows[0];
      if (!row) {
        fs.unlink(file.path, () => {});
        return res.status(404).json({ error: req.t('errors.ogledziny.inspectionNotFound') });
      }
      if (!canAccessOgledzinyRecord(req.user, row)) {
        fs.unlink(file.path, () => {});
        return res.status(403).json({ error: req.t('errors.auth.forbidden') });
      }

      const mime = file.mimetype || 'application/octet-stream';
      const requestedKind = String(req.body?.kind || req.body?.typ || '').toLowerCase();
      const kind = requestedKind === 'photo' || requestedKind === 'image'
        ? 'photo'
        : requestedKind === 'video'
          ? 'video'
          : mime.startsWith('image/')
            ? 'photo'
            : 'video';
      const url = `/uploads/ogledziny/${file.filename}`;
      const ins = await pool.query(
        `INSERT INTO ogledziny_media (ogledziny_id, url, mime, kind) VALUES ($1,$2,$3,$4) RETURNING id, ogledziny_id, url, mime, kind, created_at`,
        [id, url, mime, kind],
      );
      res.status(201).json(ins.rows[0]);
    } catch (e) {
      const files = Array.isArray(req.files) ? req.files : req.file ? [req.file] : [];
      for (const file of files) {
        if (file?.path) fs.unlink(file.path, () => {});
      }
      logger.error('ogledziny.media', { message: e.message, requestId: req.requestId });
      res.status(500).json({ error: req.t('errors.http.serverError') });
    }
  },
);

// ── POST /api/ogledziny/:id/wycena ────────────────────────────────────────────
// Powiąż istniejącą wycenę z oględzinami lub utwórz nową
router.post('/:id/wycena', authMiddleware, validateParams(ogledzinyIdParamsSchema), validateBody(ogledzinyWycenaBodySchema), async (req, res) => {
  await runMigration();
  try {
    const { id } = req.params;
    const { wycena_id } = req.body;

    const ogQ = await pool.query('SELECT * FROM ogledziny WHERE id=$1', [id]);
    if (!ogQ.rows.length) return res.status(404).json({ error: req.t('errors.ogledziny.inspectionNotFound') });

    const { rows } = await pool.query(`
      UPDATE ogledziny SET wycena_id=$1, status='Zakonczone', updated_at=NOW()
      WHERE id=$2 RETURNING *
    `, [wycena_id, id]);

    res.json(rows[0]);
  } catch (e) {
    logger.error('Blad podpinania wyceny do ogledzin', { message: e.message, requestId: req.requestId });
    res.status(500).json({ error: req.t('errors.http.serverError') });
  }
});

// ── DELETE /api/ogledziny/:id ─────────────────────────────────────────────────
router.delete('/:id', authMiddleware, validateParams(ogledzinyIdParamsSchema), async (req, res) => {
  if (!canManage(req.user)) return res.status(403).json({ error: req.t('errors.auth.forbidden') });
  await runMigration();
  try {
    await pool.query('DELETE FROM ogledziny WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) {
    logger.error('Blad usuwania ogledzin', { message: e.message, requestId: req.requestId });
    res.status(500).json({ error: req.t('errors.http.serverError') });
  }
});

module.exports = router;
