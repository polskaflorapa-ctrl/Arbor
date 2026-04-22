/**
 * ARBOR-OS: Wyceny backend v2
 * SKOPIUJ DO: arbor-os/src/routes/wyceny.js
 *
 * Dostęp: Wyceniający (własne), Dyrektor/Administrator (wszystkie), Kierownik (swój oddział)
 */

const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { authMiddleware } = require('../middleware/auth');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// ── Multer ────────────────────────────────────────────────────────────────────
const uploadDir = path.join(__dirname, '../../uploads/wyceny');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.jpg';
    cb(null, `wycena_${Date.now()}${ext}`);
  },
});
const upload = multer({ storage, limits: { fileSize: 15 * 1024 * 1024 } });

// ── Role helpers ──────────────────────────────────────────────────────────────
const isDyrektor  = (u) => u.rola === 'Dyrektor' || u.rola === 'Administrator';
const isKierownik = (u) => u.rola === 'Kierownik';
const isWyceniajacy = (u) => u.rola === 'Wyceniający';
const hasAccess = (u) => isDyrektor(u) || isKierownik(u) || isWyceniajacy(u);

// ── GET /api/wyceny ───────────────────────────────────────────────────────────
router.get('/', authMiddleware, async (req, res) => {
  if (!hasAccess(req.user)) return res.status(403).json({ error: 'Brak dostępu' });
  try {
    const { oddzial_id, wynik, status } = req.query;
    let conditions = [];
    let params = [];
    let idx = 1;

    if (isDyrektor(req.user)) {
      // widzi wszystko
    } else if (isKierownik(req.user)) {
      conditions.push(`w.oddzial_id = $${idx++}`);
      params.push(req.user.oddzial_id);
    } else {
      // Wyceniający — tylko własne
      conditions.push(`w.autor_id = $${idx++}`);
      params.push(req.user.id);
    }

    if (oddzial_id) { conditions.push(`w.oddzial_id = $${idx++}`); params.push(oddzial_id); }
    if (wynik)      { conditions.push(`w.wynik = $${idx++}`);      params.push(wynik); }
    if (status)     { conditions.push(`w.status = $${idx++}`);     params.push(status); }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const { rows } = await pool.query(`
      SELECT w.*,
             u.imie || ' ' || u.nazwisko AS autor_nazwa,
             o.nazwa AS oddzial_nazwa
      FROM wyceny w
      LEFT JOIN users    u ON u.id = w.autor_id
      LEFT JOIN oddzialy o ON o.id = w.oddzial_id
      ${where}
      ORDER BY w.created_at DESC
    `, params);
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/wyceny ──────────────────────────────────────────────────────────
router.post('/', authMiddleware, async (req, res) => {
  if (!hasAccess(req.user)) return res.status(403).json({ error: 'Brak dostępu' });
  try {
    const {
      klient_nazwa, klient_telefon, adres, miasto,
      typ_uslugi, wartosc_szacowana, opis, notatki_wewnetrzne, lat, lon,
      oddzial_id,
      // v2 fields
      pozycje, wywoz, usuwanie_pni, czas_realizacji, ilosc_osob,
      wynik, budzet, rabat, kwota_minimalna,
      rebak, pila_wysiegniku, nozyce_dlugie, kosiarka,
      podkaszarka, lopata, mulczer, arborysta, zrebki, drewno,
    } = req.body;

    if (!klient_nazwa) return res.status(400).json({ error: 'klient_nazwa jest wymagane' });

    const total = Array.isArray(pozycje)
      ? pozycje.reduce((s, p) => s + (parseFloat(p.kwota) || 0), 0)
      : (parseFloat(wartosc_szacowana) || null);

    const { rows } = await pool.query(`
      INSERT INTO wyceny (
        klient_nazwa, klient_telefon, adres, miasto, typ_uslugi,
        wartosc_szacowana, opis, notatki_wewnetrzne, lat, lon,
        autor_id, status, oddzial_id,
        pozycje, wywoz, usuwanie_pni, czas_realizacji, ilosc_osob,
        wynik, budzet, rabat, kwota_minimalna,
        rebak, pila_wysiegniku, nozyce_dlugie, kosiarka,
        podkaszarka, lopata, mulczer, arborysta, zrebki, drewno
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'Nowa',$12,
        $13,$14,$15,$16,$17,$18,$19,$20,$21,
        $22,$23,$24,$25,$26,$27,$28,$29,$30,$31
      ) RETURNING *`,
      [
        klient_nazwa, klient_telefon||null, adres||null, miasto||null, typ_uslugi||null,
        total, opis||null, notatki_wewnetrzne||null,
        lat ? parseFloat(lat) : null, lon ? parseFloat(lon) : null,
        req.user.id, oddzial_id||null,
        JSON.stringify(pozycje||[]),
        wywoz||false, usuwanie_pni||false, czas_realizacji||null, ilosc_osob||1,
        wynik||'oczekuje', budzet ? parseFloat(budzet) : null,
        rabat ? parseFloat(rabat) : 0, kwota_minimalna ? parseFloat(kwota_minimalna) : null,
        rebak||false, pila_wysiegniku||false, nozyce_dlugie||false, kosiarka||false,
        podkaszarka||false, lopata||false, mulczer||false, arborysta||false,
        zrebki||0, drewno||false,
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
  if (!hasAccess(req.user)) return res.status(403).json({ error: 'Brak dostępu' });
  try {
    const { rows } = await pool.query(`
      SELECT w.*, u.imie || ' ' || u.nazwisko AS autor_nazwa,
             o.nazwa AS oddzial_nazwa
      FROM wyceny w
      LEFT JOIN users    u ON u.id = w.autor_id
      LEFT JOIN oddzialy o ON o.id = w.oddzial_id
      WHERE w.id = $1`, [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Nie znaleziono' });
    const w = rows[0];
    if (isWyceniajacy(req.user) && w.autor_id !== req.user.id)
      return res.status(403).json({ error: 'Brak dostępu' });
    res.json(w);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── PATCH /api/wyceny/:id ─────────────────────────────────────────────────────
router.patch('/:id', authMiddleware, async (req, res) => {
  if (!hasAccess(req.user)) return res.status(403).json({ error: 'Brak dostępu' });
  try {
    const allowed = [
      'status','wynik','pozycje','wywoz','usuwanie_pni','czas_realizacji','ilosc_osob',
      'budzet','rabat','kwota_minimalna','rebak','pila_wysiegniku','nozyce_dlugie',
      'kosiarka','podkaszarka','lopata','mulczer','arborysta','zrebki','drewno',
      'notatki_wewnetrzne','opis','wartosc_szacowana','klient_telefon','oddzial_id',
    ];
    const sets = [];
    const vals = [];
    let idx = 1;
    for (const key of allowed) {
      if (req.body[key] !== undefined) {
        sets.push(`${key} = $${idx++}`);
        vals.push(key === 'pozycje' ? JSON.stringify(req.body[key]) : req.body[key]);
      }
    }
    if (!sets.length) return res.status(400).json({ error: 'Brak pól do aktualizacji' });
    vals.push(req.params.id);
    const { rows } = await pool.query(
      `UPDATE wyceny SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $${idx} RETURNING *`,
      vals
    );
    if (!rows.length) return res.status(404).json({ error: 'Nie znaleziono' });
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── PATCH /api/wyceny/:id/status ─────────────────────────────────────────────
router.patch('/:id/status', authMiddleware, async (req, res) => {
  if (!hasAccess(req.user)) return res.status(403).json({ error: 'Brak dostępu' });
  try {
    const dozwolone = ['Nowa','W_Opracowaniu','Wyslana','Zaakceptowana','Odrzucona'];
    const { status } = req.body;
    if (!dozwolone.includes(status)) return res.status(400).json({ error: 'Nieprawidłowy status' });
    const { rows } = await pool.query(
      `UPDATE wyceny SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
      [status, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Nie znaleziono' });
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── GET /api/wyceny/:id/zdjecia ───────────────────────────────────────────────
router.get('/:id/zdjecia', authMiddleware, async (req, res) => {
  if (!hasAccess(req.user)) return res.status(403).json({ error: 'Brak dostępu' });
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
  if (!hasAccess(req.user)) return res.status(403).json({ error: 'Brak dostępu' });
  try {
    if (!req.file) return res.status(400).json({ error: 'Brak pliku' });
    const { lat, lon } = req.body;
    const url = `/uploads/wyceny/${req.file.filename}`;
    const { rows } = await pool.query(
      `INSERT INTO wyceny_zdjecia (wycena_id, sciezka, url, lat, lon)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [req.params.id, req.file.path, url,
       lat ? parseFloat(lat) : null, lon ? parseFloat(lon) : null]
    );
    res.status(201).json(rows[0]);
  } catch (e) { console.error(e); res.status(500).json({ error: e.message }); }
});

// ── POST /api/wyceny/:id/konwertuj ────────────────────────────────────────────
router.post('/:id/konwertuj', authMiddleware, async (req, res) => {
  if (!isDyrektor(req.user)) return res.status(403).json({ error: 'Brak uprawnień' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: [w] } = await client.query('SELECT * FROM wyceny WHERE id = $1', [req.params.id]);
    if (!w) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Nie znaleziono' }); }

    const { rows: [task] } = await client.query(`
      INSERT INTO tasks (klient_nazwa, klient_telefon, adres, miasto, typ_uslugi,
        wartosc_planowana, notatki_wewnetrzne, status, created_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,'Nowe',NOW()) RETURNING *`,
      [w.klient_nazwa, w.klient_telefon, w.adres, w.miasto,
       w.typ_uslugi, w.wartosc_szacowana, w.notatki_wewnetrzne]
    );
    await client.query(
      `UPDATE wyceny SET task_id = $1, status = 'Zlecenie', updated_at = NOW() WHERE id = $2`,
      [task.id, w.id]
    );
    try {
      const { rows: zdjecia } = await client.query('SELECT * FROM wyceny_zdjecia WHERE wycena_id = $1', [w.id]);
      for (const z of zdjecia) {
        await client.query(
          `INSERT INTO task_photos (task_id, user_id, url, opis, typ) VALUES ($1,$2,$3,$4,'wycena')`,
          [task.id, req.user.id, z.url, 'Zdjęcie z wyceny']
        );
      }
    } catch (_) {}
    await client.query('COMMIT');
    res.json({ task_id: task.id, task });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: e.message });
  } finally { client.release(); }
});

// ── DELETE /api/wyceny/:id ────────────────────────────────────────────────────
router.delete('/:id', authMiddleware, async (req, res) => {
  if (!isDyrektor(req.user)) return res.status(403).json({ error: 'Brak uprawnień' });
  try {
    await pool.query('DELETE FROM wyceny WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
