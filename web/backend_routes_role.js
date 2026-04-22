// ============================================================
// BACKEND ROUTES: Zarządzanie rolami
// Wklej do swojego pliku routes (np. routes/role.js)
// i zarejestruj: app.use('/role', roleRouter);
// ============================================================

const express = require('express');
const router = express.Router();
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const JWT_SECRET = process.env.JWT_SECRET || 'your_secret';

// ─── Middleware auth ────────────────────────────────────────
function auth(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Brak tokenu' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'Nieprawidłowy token' });
  }
}

// Tylko Dyrektor i Administrator mogą zarządzać rolami
function requireRoleAdmin(req, res, next) {
  const allowed = ['Dyrektor', 'Administrator'];
  if (!allowed.includes(req.user.rola)) {
    return res.status(403).json({ error: 'Brak uprawnień do zarządzania rolami' });
  }
  next();
}

// ─── GET /role ── lista wszystkich ról ──────────────────────
router.get('/', auth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM role ORDER BY poziom DESC, nazwa ASC'
    );
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Błąd serwera' });
  }
});

// ─── GET /role/:id ── pojedyncza rola ───────────────────────
router.get('/:id', auth, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM role WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Rola nie istnieje' });
    res.json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: 'Błąd serwera' });
  }
});

// ─── POST /role ── nowa rola ─────────────────────────────────
router.post('/', auth, requireRoleAdmin, async (req, res) => {
  const { nazwa, kolor, opis, poziom, uprawnienia } = req.body;
  if (!nazwa?.trim()) return res.status(400).json({ error: 'Nazwa roli jest wymagana' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO role (nazwa, kolor, opis, poziom, uprawnienia)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [
        nazwa.trim(),
        kolor || '#94A3B8',
        opis || null,
        poziom || 1,
        JSON.stringify(uprawnienia || defaultPermissions()),
      ]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(400).json({ error: 'Rola o tej nazwie już istnieje' });
    console.error(e);
    res.status(500).json({ error: 'Błąd serwera' });
  }
});

// ─── PUT /role/:id ── edycja roli ───────────────────────────
router.put('/:id', auth, requireRoleAdmin, async (req, res) => {
  const { nazwa, kolor, opis, poziom, uprawnienia, aktywna } = req.body;
  try {
    // Sprawdź czy rola stała (systemowa) - można edytować uprawnienia, ale nie nazwę/poziom
    const check = await pool.query('SELECT stala FROM role WHERE id = $1', [req.params.id]);
    if (!check.rows.length) return res.status(404).json({ error: 'Rola nie istnieje' });

    const isStala = check.rows[0].stala;

    const { rows } = await pool.query(
      `UPDATE role SET
        nazwa      = CASE WHEN $1 AND $2::text IS NOT NULL THEN $2 ELSE nazwa END,
        kolor      = COALESCE($3, kolor),
        opis       = COALESCE($4, opis),
        poziom     = CASE WHEN $1 THEN poziom ELSE COALESCE($5, poziom) END,
        uprawnienia = COALESCE($6::jsonb, uprawnienia),
        aktywna    = COALESCE($7, aktywna)
       WHERE id = $8
       RETURNING *`,
      [
        isStala,            // $1 - czy stała (blokuje zmianę nazwy/poziomu)
        nazwa || null,      // $2
        kolor || null,      // $3
        opis || null,       // $4
        poziom || null,     // $5
        uprawnienia ? JSON.stringify(uprawnienia) : null, // $6
        aktywna !== undefined ? aktywna : null,           // $7
        req.params.id,      // $8
      ]
    );
    res.json(rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(400).json({ error: 'Rola o tej nazwie już istnieje' });
    console.error(e);
    res.status(500).json({ error: 'Błąd serwera' });
  }
});

// ─── DELETE /role/:id ── usuń rolę ──────────────────────────
router.delete('/:id', auth, requireRoleAdmin, async (req, res) => {
  try {
    const check = await pool.query('SELECT stala, nazwa FROM role WHERE id = $1', [req.params.id]);
    if (!check.rows.length) return res.status(404).json({ error: 'Rola nie istnieje' });
    if (check.rows[0].stala) {
      return res.status(400).json({ error: 'Nie można usunąć roli systemowej' });
    }
    // Sprawdź czy ktoś ma tę rolę
    const inUse = await pool.query('SELECT COUNT(*) FROM users WHERE rola = $1', [check.rows[0].nazwa]);
    if (parseInt(inUse.rows[0].count) > 0) {
      return res.status(400).json({
        error: `Nie można usunąć — ${inUse.rows[0].count} użytkownik(ów) ma tę rolę`,
      });
    }
    await pool.query('DELETE FROM role WHERE id = $1', [req.params.id]);
    res.json({ message: 'Rola usunięta' });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Błąd serwera' });
  }
});

// ─── GET /role/:id/uzytkownicy ── użytkownicy z daną rolą ───
router.get('/:id/uzytkownicy', auth, requireRoleAdmin, async (req, res) => {
  try {
    const rola = await pool.query('SELECT nazwa FROM role WHERE id = $1', [req.params.id]);
    if (!rola.rows.length) return res.status(404).json({ error: 'Rola nie istnieje' });
    const { rows } = await pool.query(
      `SELECT id, imie, nazwisko, email, rola, aktywny
       FROM users WHERE rola = $1 ORDER BY nazwisko`,
      [rola.rows[0].nazwa]
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: 'Błąd serwera' });
  }
});

// ─── GET /role/permissions/schema ── lista wszystkich uprawnień ─
router.get('/permissions/schema', auth, (req, res) => {
  res.json(PERMISSIONS_SCHEMA);
});

// ─── Domyślne uprawnienia dla nowej roli ────────────────────
function defaultPermissions() {
  const perms = {};
  PERMISSIONS_SCHEMA.forEach(group => {
    group.permissions.forEach(p => { perms[p.key] = false; });
  });
  return perms;
}

// ─── Schema uprawnień (etykiety do UI) ──────────────────────
const PERMISSIONS_SCHEMA = [
  {
    group: 'Zlecenia',
    permissions: [
      { key: 'zlecenia_widok',          label: 'Przeglądanie zleceń' },
      { key: 'zlecenia_tworzenie',       label: 'Tworzenie zleceń' },
      { key: 'zlecenia_edycja',          label: 'Edycja zleceń' },
      { key: 'zlecenia_usuniecie',       label: 'Usuwanie zleceń' },
      { key: 'zlecenia_zmiana_statusu',  label: 'Zmiana statusu zlecenia' },
    ],
  },
  {
    group: 'Wyceny',
    permissions: [
      { key: 'wyceny_widok',          label: 'Przeglądanie wycen' },
      { key: 'wyceny_tworzenie',       label: 'Tworzenie wycen' },
      { key: 'wyceny_zatwierdzanie',   label: 'Zatwierdzanie wycen' },
    ],
  },
  {
    group: 'Dniówki',
    permissions: [
      { key: 'dniowki_widok',          label: 'Przeglądanie dniówek' },
      { key: 'dniowki_zatwierdzanie',  label: 'Zatwierdzanie dniówek' },
    ],
  },
  {
    group: 'Użytkownicy',
    permissions: [
      { key: 'uzytkownicy_widok',      label: 'Przeglądanie użytkowników' },
      { key: 'uzytkownicy_tworzenie',  label: 'Tworzenie użytkowników' },
      { key: 'uzytkownicy_edycja',     label: 'Edycja użytkowników' },
      { key: 'uzytkownicy_usuniecie',  label: 'Usuwanie użytkowników' },
      { key: 'role_zarzadzanie',       label: 'Zarządzanie rolami' },
    ],
  },
  {
    group: 'Raporty i Rozliczenia',
    permissions: [
      { key: 'raporty_widok',    label: 'Przeglądanie raportów' },
      { key: 'raporty_eksport',  label: 'Eksport raportów' },
      { key: 'rozliczenia_widok', label: 'Przeglądanie rozliczeń' },
    ],
  },
  {
    group: 'Harmonogram i Ekipy',
    permissions: [
      { key: 'harmonogram_widok',   label: 'Przeglądanie harmonogramu' },
      { key: 'harmonogram_edycja',  label: 'Edycja harmonogramu' },
      { key: 'ekipy_zarzadzanie',   label: 'Zarządzanie ekipami' },
    ],
  },
  {
    group: 'Flota i Oddziały',
    permissions: [
      { key: 'flota_widok',           label: 'Przeglądanie floty' },
      { key: 'flota_zarzadzanie',     label: 'Zarządzanie flotą' },
      { key: 'oddzialy_zarzadzanie',  label: 'Zarządzanie oddziałami' },
    ],
  },
];

module.exports = router;
