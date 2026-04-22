const express = require('express');
const pool = require('../config/database');
const logger = require('../config/logger');
const { authMiddleware } = require('../middleware/auth');
const { validateQuery, validateBody, validateParams } = require('../middleware/validate');
const { z } = require('zod');

const router = express.Router();

const isDyrektor = (u) => u.rola === 'Dyrektor' || u.rola === 'Administrator';

const klienciListQuerySchema = z.object({
  szukaj: z.string().max(200).optional(),
  miasto: z.string().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

const klientIdParamsSchema = z.object({
  id: z.coerce.number().int().positive(),
});

const klientWriteFields = {
  imie: z.string().max(100).optional().nullable(),
  nazwisko: z.string().max(100).optional().nullable(),
  firma: z.string().max(200).optional().nullable(),
  telefon: z.string().max(30).optional().nullable(),
  email: z.string().max(255).optional().nullable(),
  adres: z.string().max(255).optional().nullable(),
  miasto: z.string().max(100).optional().nullable(),
  kod_pocztowy: z.string().max(10).optional().nullable(),
  notatki: z.string().optional().nullable(),
  zrodlo: z.string().max(50).optional().nullable(),
};

const klientCreateSchema = z
  .object(klientWriteFields)
  .refine(
    (d) =>
      (d.telefon != null && String(d.telefon).trim().length > 0) ||
      (d.email != null && String(d.email).trim().length > 0),
    { message: 'Podaj telefon lub email', path: ['telefon'] }
  );

const klientUpdateSchema = z
  .object(klientWriteFields)
  .refine(
    (d) =>
      (d.telefon != null && String(d.telefon).trim().length > 0) ||
      (d.email != null && String(d.email).trim().length > 0),
    { message: 'Podaj telefon lub email', path: ['telefon'] }
  );

// ── Migracja tabel ────────────────────────────────────────────────────
let _migDone = false;
const runMigration = async () => {
  if (_migDone) return;
  _migDone = true;
  const safe = async (sql) => {
    try { await pool.query(sql); } catch (e) {
      if (!['42P07','42701','42710'].includes(e.code)) throw e;
    }
  };

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

  await safe(`CREATE INDEX IF NOT EXISTS idx_klienci_telefon ON klienci(telefon)`);
  await safe(`CREATE INDEX IF NOT EXISTS idx_klienci_miasto  ON klienci(miasto)`);
};

// ── GET /api/klienci ────────────────────────────────────────────────
router.get('/', authMiddleware, validateQuery(klienciListQuerySchema), async (req, res) => {
  await runMigration();
  try {
    const { szukaj, miasto, limit, offset } = req.query;
    let where = 'WHERE 1=1';
    const params = [];
    if (szukaj) {
      params.push(`%${szukaj}%`);
      where += ` AND (k.imie ILIKE $${params.length} OR k.nazwisko ILIKE $${params.length}
              OR k.firma ILIKE $${params.length} OR k.telefon ILIKE $${params.length}
              OR k.email ILIKE $${params.length})`;
    }
    if (miasto) {
      params.push(`%${miasto}%`);
      where += ` AND k.miasto ILIKE $${params.length}`;
    }

    const selectBody = `
      FROM klienci k
      LEFT JOIN users u ON u.id = k.created_by
      ${where}`;

    if (limit != null) {
      const lim = Number(limit);
      const off = Number(offset ?? 0);
      const countR = await pool.query(`SELECT COUNT(*)::int AS c ${selectBody}`, params);
      const total = countR.rows[0]?.c ?? 0;
      const limIdx = params.length + 1;
      const offIdx = params.length + 2;
      const { rows } = await pool.query(
        `SELECT k.*,
        u.imie || ' ' || u.nazwisko AS created_by_nazwa,
        (SELECT COUNT(*) FROM tasks t WHERE t.klient_telefon = k.telefon) AS liczba_zlecen,
        (SELECT COUNT(*) FROM ogledziny o WHERE o.klient_id = k.id) AS liczba_ogledzen
        ${selectBody}
        ORDER BY k.created_at DESC
        LIMIT $${limIdx} OFFSET $${offIdx}`,
        [...params, lim, off]
      );
      return res.json({ items: rows, total, limit: lim, offset: off });
    }

    const q = `
      SELECT k.*,
        u.imie || ' ' || u.nazwisko AS created_by_nazwa,
        (SELECT COUNT(*) FROM tasks t WHERE t.klient_telefon = k.telefon) AS liczba_zlecen,
        (SELECT COUNT(*) FROM ogledziny o WHERE o.klient_id = k.id) AS liczba_ogledzen
      FROM klienci k
      LEFT JOIN users u ON u.id = k.created_by
      ${where}
      ORDER BY k.created_at DESC`;
    const { rows } = await pool.query(q, params);
    res.json(rows);
  } catch (e) {
    logger.error('Blad pobierania klientow', { message: e.message, requestId: req.requestId });
    res.status(500).json({ error: req.t('errors.http.serverError') });
  }
});

// ── GET /api/klienci/:id ────────────────────────────────────────────
router.get('/:id', authMiddleware, validateParams(klientIdParamsSchema), async (req, res) => {
  await runMigration();
  try {
    const { id } = req.params;

    const klientQ = await pool.query(`
      SELECT k.*, u.imie || ' ' || u.nazwisko AS created_by_nazwa
      FROM klienci k
      LEFT JOIN users u ON u.id = k.created_by
      WHERE k.id = $1
    `, [id]);

    if (!klientQ.rows.length) return res.status(404).json({ error: req.t('errors.klienci.clientNotFound') });

    const klient = klientQ.rows[0];

    const zleceniaQ = await pool.query(`
      SELECT t.id, t.status, t.typ_uslugi, t.adres, t.miasto,
             t.data_planowana, t.wartosc_planowana, t.created_at,
             e.nazwa AS ekipa_nazwa
      FROM tasks t
      LEFT JOIN teams e ON e.id = t.ekipa_id
      WHERE t.klient_telefon = $1
      ORDER BY t.created_at DESC
      LIMIT 20
    `, [klient.telefon]);

    const ogledzynyQ = await pool.query(`
      SELECT o.*, u.imie || ' ' || u.nazwisko AS brygadzista_nazwa
      FROM ogledziny o
      LEFT JOIN users u ON u.id = o.brygadzista_id
      WHERE o.klient_id = $1
      ORDER BY o.created_at DESC
    `, [id]).catch(() => ({ rows: [] }));

    res.json({
      ...klient,
      zlecenia: zleceniaQ.rows,
      ogledziny: ogledzynyQ.rows,
    });
  } catch (e) {
    logger.error('Blad pobierania klienta po id', { message: e.message, requestId: req.requestId });
    res.status(500).json({ error: req.t('errors.http.serverError') });
  }
});

// ── POST /api/klienci ───────────────────────────────────────────────
router.post('/', authMiddleware, validateBody(klientCreateSchema), async (req, res) => {
  await runMigration();
  try {
    const { imie, nazwisko, firma, telefon, email, adres, miasto, kod_pocztowy, notatki, zrodlo } = req.body;

    const { rows } = await pool.query(`
      INSERT INTO klienci (imie, nazwisko, firma, telefon, email, adres, miasto, kod_pocztowy, notatki, zrodlo, created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      RETURNING *
    `, [imie, nazwisko, firma, telefon, email, adres, miasto, kod_pocztowy, notatki, zrodlo || 'telefon', req.user.id]);

    res.status(201).json(rows[0]);
  } catch (e) {
    logger.error('Blad tworzenia klienta', { message: e.message, requestId: req.requestId });
    res.status(500).json({ error: req.t('errors.http.serverError') });
  }
});

// ── PUT /api/klienci/:id ────────────────────────────────────────────
router.put('/:id', authMiddleware, validateParams(klientIdParamsSchema), validateBody(klientUpdateSchema), async (req, res) => {
  await runMigration();
  try {
    const { id } = req.params;
    const { imie, nazwisko, firma, telefon, email, adres, miasto, kod_pocztowy, notatki, zrodlo } = req.body;

    const { rows } = await pool.query(`
      UPDATE klienci SET
        imie=$1, nazwisko=$2, firma=$3, telefon=$4, email=$5,
        adres=$6, miasto=$7, kod_pocztowy=$8, notatki=$9, zrodlo=$10,
        updated_at=NOW()
      WHERE id=$11 RETURNING *
    `, [imie, nazwisko, firma, telefon, email, adres, miasto, kod_pocztowy, notatki, zrodlo, id]);

    if (!rows.length) return res.status(404).json({ error: req.t('errors.klienci.clientNotFound') });
    res.json(rows[0]);
  } catch (e) {
    logger.error('Blad aktualizacji klienta', { message: e.message, requestId: req.requestId });
    res.status(500).json({ error: req.t('errors.http.serverError') });
  }
});

// ── DELETE /api/klienci/:id ─────────────────────────────────────────
router.delete('/:id', authMiddleware, validateParams(klientIdParamsSchema), async (req, res) => {
  if (!isDyrektor(req.user)) return res.status(403).json({ error: req.t('errors.auth.forbidden') });
  await runMigration();
  try {
    await pool.query('DELETE FROM klienci WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) {
    logger.error('Blad usuwania klienta', { message: e.message, requestId: req.requestId });
    res.status(500).json({ error: req.t('errors.http.serverError') });
  }
});

module.exports = router;
