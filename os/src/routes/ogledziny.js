const express = require('express');
const pool = require('../config/database');
const logger = require('../config/logger');
const { authMiddleware } = require('../middleware/auth');
const { validateQuery, validateBody, validateParams } = require('../middleware/validate');
const { z } = require('zod');

const router = express.Router();

const OGLEDZINY_STATUS = ['Zaplanowane', 'W_Trakcie', 'Zakonczone', 'Anulowane'];

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

const ogledzinyWycenaBodySchema = z.object({
  wycena_id: z.coerce.number().int().positive(),
});

const isDyrektor = (u) => u.rola === 'Dyrektor' || u.rola === 'Administrator';
const canManage = (u) => isDyrektor(u) || u.rola === 'Kierownik';
const isBrygadzista = (u) => u.rola === 'Brygadzista';

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
        w.wartosc_szacowana, w.status_akceptacji AS wycena_status
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
        w.wartosc_szacowana, w.status_akceptacji AS wycena_status
      ${fromJoin}
      ORDER BY o.data_planowana ASC NULLS LAST, o.created_at DESC`;

    const { rows } = await pool.query(q, params);
    res.json(rows);
  } catch (e) {
    logger.error('Blad pobierania ogledzin', { message: e.message, requestId: req.requestId });
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
        w.opis AS wycena_opis
      FROM ogledziny o
      LEFT JOIN klienci k ON k.id = o.klient_id
      LEFT JOIN users u   ON u.id = o.brygadzista_id
      LEFT JOIN users c   ON c.id = o.created_by
      LEFT JOIN wyceny w  ON w.id = o.wycena_id
      WHERE o.id = $1
    `, [req.params.id]);

    if (!rows.length) return res.status(404).json({ error: req.t('errors.ogledziny.inspectionNotFound') });

    // Zdjęcia z wyceny powiązanej (jeśli jest)
    let zdjecia = [];
    if (rows[0].wycena_id) {
      const zdQ = await pool.query(`SELECT * FROM wyceny_zdjecia WHERE wycena_id=$1 ORDER BY created_at`, [rows[0].wycena_id]).catch(() => ({ rows: [] }));
      zdjecia = zdQ.rows;
    }

    res.json({ ...rows[0], zdjecia });
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
