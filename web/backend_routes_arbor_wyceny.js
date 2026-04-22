// ============================================================
// BACKEND — API wycen + rozliczenie wyceniających (arbor-web)
//
// Rejestracja (przykład): app.use('/api', router);
// Wymaga: express, pg (pool), requireAuth, opcjonalnie multer (npm i multer)
// Najpierw uruchom: sql/arbor_wyceny_wynagrodzenie_media.sql
//
// Gotowy lokalny serwer (plik JSON zamiast Postgres): folder server/ → npm install && npm start
//
// Wyceny / media:
//   GET    /wyceny
//   POST   /wyceny
//   POST   /wyceny/:id/zatwierdz
//   POST   /wyceny/:id/odrzuc
//   POST   /wyceny/:id/wideo   (multipart, pole "wideo")
//   GET    /wyceny/:id/zalaczniki
//
// Wynagrodzenie wyceniającego:
//   GET  /wynagrodzenie-wyceniajacy/reguly/:userId
//   PUT  /wynagrodzenie-wyceniajacy/reguly/:userId
//   GET  /wynagrodzenie-wyceniajacy/podsumowanie?user_id=&rok=&miesiac=&dni_robocze=
// ============================================================

const express = require('express');
const fs = require('fs');
const path = require('path');

const router = express.Router();

// Opcjonalnie — jeśli brak multer, zakomentuj trasę /wyceny/:id/wideo
let multer;
try {
  multer = require('multer');
} catch {
  multer = null;
}

function toNum(v) {
  if (v === '' || v === undefined || v === null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function parseAdnotacje(body) {
  const raw = body.zdjecia_adnotowane_json;
  if (!raw || typeof raw !== 'string') return null;
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return null;
    return JSON.stringify(arr.slice(0, 3));
  } catch {
    return null;
  }
}

// ---------- GET /wyceny ----------
router.get('/wyceny', requireAuth, async (req, res) => {
  try {
    const { status_akceptacji, oddzial_id } = req.query;
    const params = [];
    let where = `z.typ = 'wycena'`;
    if (status_akceptacji) {
      params.push(status_akceptacji);
      where += ` AND z.status_akceptacji = $${params.length}`;
    }
    if (oddzial_id) {
      params.push(oddzial_id);
      where += ` AND z.oddzial_id = $${params.length}`;
    }

    const { rows } = await pool.query(
      `
      SELECT z.*,
        u.imie || ' ' || u.nazwisko AS wyceniajacy_nazwa,
        t.nazwa AS ekipa_nazwa,
        zat.imie || ' ' || zat.nazwisko AS zatwierdzone_przez_nazwa
      FROM zlecenia z
      LEFT JOIN users u ON u.id = z.created_by
      LEFT JOIN teams t ON t.id = z.ekipa_id
      LEFT JOIN users zat ON zat.id = z.zatwierdzone_przez
      WHERE ${where}
      ORDER BY z.created_at DESC
      LIMIT 300
    `,
      params
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- POST /wyceny ----------
router.post('/wyceny', requireAuth, async (req, res) => {
  try {
    const b = req.body;
    const zdjeciaJson = parseAdnotacje(b);

    const { rows } = await pool.query(
      `
      INSERT INTO zlecenia (
        klient_nazwa, adres, miasto, oddzial_id, ekipa_id,
        typ_uslugi, data_wykonania, godzina_rozpoczecia,
        czas_planowany_godziny, wartosc_planowana,
        notatki_wewnetrzne, wycena_uwagi,
        zdjecia_adnotowane,
        typ, status, status_akceptacji, created_by, created_at
      ) VALUES (
        $1,$2,$3,$4,$5,
        $6,$7,$8,
        $9,$10,
        $11,$12,
        $13::jsonb,
        'wycena', 'Nowe', 'oczekuje', $14, NOW()
      ) RETURNING *
    `,
      [
        b.klient_nazwa || null,
        b.adres,
        b.miasto || null,
        toNum(b.oddzial_id),
        toNum(b.ekipa_id),
        b.typ_uslugi || null,
        b.data_wykonania || null,
        b.godzina_rozpoczecia || null,
        toNum(b.czas_planowany_godziny),
        toNum(b.wartosc_planowana),
        b.notatki_wewnetrzne || null,
        b.wycena_uwagi || null,
        zdjeciaJson,
        req.user.id,
      ]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- POST /wyceny/:id/zatwierdz ----------
router.post('/wyceny/:id/zatwierdz', requireAuth, async (req, res) => {
  try {
    const id = toNum(req.params.id);
    if (!id) return res.status(400).json({ error: 'Nieprawidłowe id' });
    const b = req.body;

    const { rows } = await pool.query(
      `
      UPDATE zlecenia
      SET status_akceptacji = 'zatwierdzono',
          zatwierdzone_przez = $1,
          zatwierdzone_at = NOW(),
          status = 'Zaplanowane',
          typ = 'zlecenie',
          wyceniajacy_id = COALESCE(wyceniajacy_id, (SELECT created_by FROM zlecenia z0 WHERE z0.id = $7)),
          ekipa_id = COALESCE($2::int, ekipa_id),
          data_wykonania = COALESCE($3::date, data_wykonania),
          godzina_rozpoczecia = COALESCE($4, godzina_rozpoczecia),
          wartosc_planowana = COALESCE($5::numeric, wartosc_planowana),
          wycena_uwagi = COALESCE($6, wycena_uwagi)
      WHERE id = $7
        AND typ = 'wycena'
        AND status_akceptacji = 'oczekuje'
      RETURNING *
    `,
      [
        req.user.id,
        toNum(b.ekipa_id),
        b.data_wykonania || null,
        b.godzina_rozpoczecia || null,
        toNum(b.wartosc_planowana),
        b.uwagi || null,
        id,
      ]
    );

    if (!rows.length) {
      return res.status(404).json({ error: 'Wycena nie znaleziona lub już rozpatrzona' });
    }
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- POST /wyceny/:id/odrzuc ----------
router.post('/wyceny/:id/odrzuc', requireAuth, async (req, res) => {
  try {
    const id = toNum(req.params.id);
    const powod = req.body?.powod || '';
    const { rows } = await pool.query(
      `
      UPDATE zlecenia
      SET status_akceptacji = 'odrzucono',
          zatwierdzone_przez = $1,
          zatwierdzone_at = NOW(),
          wycena_uwagi = TRIM(COALESCE(wycena_uwagi, '') || E'\\n' || $2)
      WHERE id = $3 AND typ = 'wycena'
      RETURNING *
    `,
      [req.user.id, `[Odrzucono] ${powod}`, id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Nie znaleziono' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- Katalog uploadów (względem cwd serwera) ----------
const UPLOAD_ROOT = process.env.WYCENY_UPLOAD_DIR || path.join(process.cwd(), 'uploads', 'wyceny');

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

// ---------- POST /wyceny/:id/wideo (multipart, pole "wideo") ----------
if (multer) {
  const disk = multer.diskStorage({
    destination: (req, file, cb) => {
      const dir = path.join(UPLOAD_ROOT, String(req.params.id));
      ensureDir(dir);
      cb(null, dir);
    },
    filename: (req, file, cb) => {
      const safe = `${Date.now()}_${file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
      cb(null, safe);
    },
  });
  const up = multer({ storage: disk, limits: { fileSize: 250 * 1024 * 1024 } });

  router.post('/wyceny/:id/wideo', requireAuth, up.single('wideo'), async (req, res) => {
    try {
      const zlecenieId = toNum(req.params.id);
      if (!zlecenieId || !req.file) {
        return res.status(400).json({ error: 'Brak pliku (pole formularza: wideo) lub id' });
      }
      const rel = path.relative(process.cwd(), req.file.path).split(path.sep).join('/');
      await pool.query(
        `
        INSERT INTO wycena_zalaczniki (zlecenie_id, typ, nazwa_pliku, sciezka_relatywna, rozmiar_bajtow)
        VALUES ($1, 'video', $2, $3, $4)
      `,
        [zlecenieId, req.file.originalname, rel, req.file.size]
      );
      res.status(201).json({ ok: true, sciezka_relatywna: rel, rozmiar: req.file.size });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
}

// ---------- GET /wyceny/:id/zalaczniki ----------
router.get('/wyceny/:id/zalaczniki', requireAuth, async (req, res) => {
  try {
    const id = toNum(req.params.id);
    const { rows } = await pool.query(
      `SELECT id, typ, nazwa_pliku, sciezka_relatywna, rozmiar_bajtow, created_at
       FROM wycena_zalaczniki WHERE zlecenie_id = $1 ORDER BY created_at DESC`,
      [id]
    );
    res.json({ zalaczniki: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Rozliczenie wyceniających (ten sam router) ─────────────────────────────

function toIntW(v) {
  const n = parseInt(String(v), 10);
  return Number.isFinite(n) ? n : null;
}

function canEditUserRules(req, targetUserId) {
  const r = req.user?.rola;
  if (['Dyrektor', 'Administrator', 'Kierownik'].includes(r)) return true;
  if (r === 'Wyceniający' && req.user.id === targetUserId) return true;
  return false;
}

router.get('/wynagrodzenie-wyceniajacy/reguly/:userId', requireAuth, async (req, res) => {
  try {
    const uid = toIntW(req.params.userId);
    if (!uid) return res.status(400).json({ error: 'Nieprawidłowe userId' });
    if (!canEditUserRules(req, uid)) return res.status(403).json({ error: 'Brak uprawnień' });

    const { rows } = await pool.query(
      `
      SELECT id,
        wynagrodzenie_stawka_dzienna_pln,
        wynagrodzenie_procent_realizacji,
        wynagrodzenie_dodatki_pln,
        wynagrodzenie_dodatki_opis
      FROM users WHERE id = $1
    `,
      [uid]
    );
    if (!rows.length) return res.status(404).json({ error: 'Użytkownik nie znaleziony' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/wynagrodzenie-wyceniajacy/reguly/:userId', requireAuth, async (req, res) => {
  try {
    const uid = toIntW(req.params.userId);
    if (!uid) return res.status(400).json({ error: 'Nieprawidłowe userId' });
    if (!canEditUserRules(req, uid)) return res.status(403).json({ error: 'Brak uprawnień' });

    const b = req.body || {};
    const { rows } = await pool.query(
      `
      UPDATE users SET
        wynagrodzenie_stawka_dzienna_pln = COALESCE($1::numeric, wynagrodzenie_stawka_dzienna_pln),
        wynagrodzenie_procent_realizacji = COALESCE($2::numeric, wynagrodzenie_procent_realizacji),
        wynagrodzenie_dodatki_pln = COALESCE($3::numeric, wynagrodzenie_dodatki_pln),
        wynagrodzenie_dodatki_opis = COALESCE($4, wynagrodzenie_dodatki_opis)
      WHERE id = $5
      RETURNING id, wynagrodzenie_stawka_dzienna_pln, wynagrodzenie_procent_realizacji,
                wynagrodzenie_dodatki_pln, wynagrodzenie_dodatki_opis
    `,
      [
        b.wynagrodzenie_stawka_dzienna_pln,
        b.wynagrodzenie_procent_realizacji,
        b.wynagrodzenie_dodatki_pln,
        b.wynagrodzenie_dodatki_opis ?? null,
        uid,
      ]
    );
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/wynagrodzenie-wyceniajacy/podsumowanie', requireAuth, async (req, res) => {
  try {
    const uid = toIntW(req.query.user_id);
    const rok = toIntW(req.query.rok) || new Date().getFullYear();
    const miesiac = toIntW(req.query.miesiac) || new Date().getMonth() + 1;
    const dniRobocze = toIntW(req.query.dni_robocze) ?? 22;

    if (!uid) return res.status(400).json({ error: 'Brak user_id' });
    if (!canEditUserRules(req, uid)) return res.status(403).json({ error: 'Brak uprawnień' });

    const uRes = await pool.query(
      `
      SELECT id, imie, nazwisko, rola,
        wynagrodzenie_stawka_dzienna_pln,
        wynagrodzenie_procent_realizacji,
        wynagrodzenie_dodatki_pln,
        wynagrodzenie_dodatki_opis
      FROM users WHERE id = $1
    `,
      [uid]
    );
    if (!uRes.rows.length) return res.status(404).json({ error: 'Użytkownik nie znaleziony' });
    const u = uRes.rows[0];

    const sRes = await pool.query(
      `
      SELECT COALESCE(SUM(z.wartosc_planowana), 0)::numeric AS suma_pln
      FROM zlecenia z
      WHERE (z.typ IS NULL OR z.typ <> 'wycena')
        AND z.status IN ('Zakonczone', 'Zakończone')
        AND z.wyceniajacy_id = $1
        AND z.data_wykonania IS NOT NULL
        AND z.data_wykonania::date >= make_date($2, $3, 1)
        AND z.data_wykonania::date < (make_date($2, $3, 1) + INTERVAL '1 month')::date
    `,
      [uid, rok, miesiac]
    );

    const suma = parseFloat(sRes.rows[0].suma_pln) || 0;
    const stawka = parseFloat(u.wynagrodzenie_stawka_dzienna_pln) || 0;
    const proc = parseFloat(u.wynagrodzenie_procent_realizacji) || 0;
    const dod = parseFloat(u.wynagrodzenie_dodatki_pln) || 0;

    const czescDzienna = Math.round(stawka * dniRobocze * 100) / 100;
    const czescProcentowa = Math.round(suma * (proc / 100) * 100) / 100;
    const razem = Math.round((czescDzienna + czescProcentowa + dod) * 100) / 100;

    res.json({
      user: { id: u.id, imie: u.imie, nazwisko: u.nazwisko, rola: u.rola },
      okres: { rok, miesiac, dni_robocze: dniRobocze },
      suma_zrealizowanych_pln: suma,
      reguly: {
        wynagrodzenie_stawka_dzienna_pln: stawka,
        wynagrodzenie_procent_realizacji: proc,
        wynagrodzenie_dodatki_pln: dod,
        wynagrodzenie_dodatki_opis: u.wynagrodzenie_dodatki_opis,
      },
      wyliczenie: {
        czesc_dzienna: czescDzienna,
        czesc_procentowa: czescProcentowa,
        dodatki: dod,
        razem,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// module.exports = router; // jeśli łączysz przez require()
