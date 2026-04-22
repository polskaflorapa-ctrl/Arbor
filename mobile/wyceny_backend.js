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
const { pool } = require('../config/database');
const { authMiddleware } = require('../middleware/auth');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// ── Multer dla zdjęć ──────────────────────────────────────────────────────────
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

// ── Helpery ───────────────────────────────────────────────────────────────────
const isDyrektor = (u) => u.rola === 'Dyrektor' || u.rola === 'Administrator';
const isKierownik = (u) => u.rola === 'Kierownik';
const canManage = (u) => isDyrektor(u) || isKierownik(u);

// ── GET /api/wyceny ───────────────────────────────────────────────────────────
// Dyrektor/Administrator/Kierownik: wszystkie | Brygadzista/Pomocnik: tylko własne
router.get('/', authMiddleware, async (req, res) => {
  try {
    let query, params;
    if (canManage(req.user)) {
      query = `
        SELECT w.*, u.imie || ' ' || u.nazwisko AS autor_nazwa
        FROM wyceny w
        LEFT JOIN users u ON u.id = w.autor_id
        ORDER BY w.created_at DESC
      `;
      params = [];
    } else {
      query = `
        SELECT w.*, u.imie || ' ' || u.nazwisko AS autor_nazwa
        FROM wyceny w
        LEFT JOIN users u ON u.id = w.autor_id
        WHERE w.autor_id = $1
        ORDER BY w.created_at DESC
      `;
      params = [req.user.id];
    }
    const { rows } = await pool.query(query, params);
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/wyceny ──────────────────────────────────────────────────────────
router.post('/', authMiddleware, async (req, res) => {
  try {
    const {
      klient_nazwa, klient_telefon, adres, miasto,
      typ_uslugi, wartosc_szacowana, opis, notatki_wewnetrzne, lat, lon
    } = req.body;

    if (!klient_nazwa) return res.status(400).json({ error: 'klient_nazwa jest wymagane' });

    const { rows } = await pool.query(
      `INSERT INTO wyceny
       (klient_nazwa, klient_telefon, adres, miasto, typ_uslugi,
        wartosc_szacowana, opis, notatki_wewnetrzne, lat, lon, autor_id, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'Nowa') RETURNING *`,
      [
        klient_nazwa,
        klient_telefon || null,
        adres || null,
        miasto || null,
        typ_uslugi || null,
        wartosc_szacowana ? parseFloat(wartosc_szacowana) : null,
        opis || null,
        notatki_wewnetrzne || null,
        lat ? parseFloat(lat) : null,
        lon ? parseFloat(lon) : null,
        req.user.id
      ]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/wyceny/:id ───────────────────────────────────────────────────────
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT w.*, u.imie || ' ' || u.nazwisko AS autor_nazwa
       FROM wyceny w LEFT JOIN users u ON u.id = w.autor_id WHERE w.id = $1`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Wycena nie znaleziona' });
    const w = rows[0];
    if (!canManage(req.user) && w.autor_id !== req.user.id)
      return res.status(403).json({ error: 'Brak dostępu' });
    res.json(w);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── PATCH /api/wyceny/:id/status ─────────────────────────────────────────────
router.patch('/:id/status', authMiddleware, async (req, res) => {
  try {
    const dozwolone = ['Nowa', 'W_Opracowaniu', 'Wyslana', 'Zaakceptowana', 'Odrzucona'];
    const { status } = req.body;
    if (!dozwolone.includes(status))
      return res.status(400).json({ error: 'Nieprawidłowy status' });

    const { rows } = await pool.query(
      `UPDATE wyceny SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
      [status, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Nie znaleziono' });
    res.json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/wyceny/:id/zdjecia ───────────────────────────────────────────────
router.get('/:id/zdjecia', authMiddleware, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM wyceny_zdjecia WHERE wycena_id = $1 ORDER BY created_at`,
      [req.params.id]
    );
    res.json(rows);
  } catch (e) {
    if (e.code === '42P01') return res.json([]);
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/wyceny/:id/zdjecia ──────────────────────────────────────────────
router.post('/:id/zdjecia', authMiddleware, upload.single('zdjecie'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Brak pliku' });
    const { lat, lon } = req.body;
    const url = `/uploads/wyceny/${req.file.filename}`;

    const { rows } = await pool.query(
      `INSERT INTO wyceny_zdjecia (wycena_id, sciezka, url, lat, lon)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [
        req.params.id,
        req.file.path,
        url,
        lat ? parseFloat(lat) : null,
        lon ? parseFloat(lon) : null
      ]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/wyceny/:id/konwertuj → tworzy task z danych wyceny ──────────────
router.post('/:id/konwertuj', authMiddleware, async (req, res) => {
  if (!canManage(req.user)) return res.status(403).json({ error: 'Brak uprawnień' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: [w] } = await client.query('SELECT * FROM wyceny WHERE id = $1', [req.params.id]);
    if (!w) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Nie znaleziono' }); }

    const { rows: [task] } = await client.query(
      `INSERT INTO tasks
       (klient_nazwa, klient_telefon, adres, miasto, typ_uslugi,
        wartosc_planowana, notatki_wewnetrzne, status, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'Nowe',NOW()) RETURNING *`,
      [w.klient_nazwa, w.klient_telefon, w.adres, w.miasto,
       w.typ_uslugi, w.wartosc_szacowana, w.notatki_wewnetrzne]
    );

    await client.query(
      `UPDATE wyceny SET task_id = $1, status = 'Zlecenie', updated_at = NOW() WHERE id = $2`,
      [task.id, w.id]
    );

    // Kopiuj zdjęcia do task_photos jeśli tabela istnieje
    try {
      const { rows: zdjecia } = await client.query(
        'SELECT * FROM wyceny_zdjecia WHERE wycena_id = $1', [w.id]
      );
      for (const z of zdjecia) {
        await client.query(
          `INSERT INTO task_photos (task_id, user_id, url, opis, typ)
           VALUES ($1,$2,$3,$4,'wycena')`,
          [task.id, req.user.id, z.url, 'Zdjęcie z wyceny']
        );
      }
    } catch (_) { /* task_photos może nie istnieć, ignoruj */ }

    await client.query('COMMIT');
    res.json({ task_id: task.id, task });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error(e);
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
});

// ── DELETE /api/wyceny/:id ────────────────────────────────────────────────────
router.delete('/:id', authMiddleware, async (req, res) => {
  if (!isDyrektor(req.user)) return res.status(403).json({ error: 'Brak uprawnień' });
  try {
    await pool.query('DELETE FROM wyceny WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
