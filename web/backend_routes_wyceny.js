// ============================================================
// BACKEND ROUTES — Wyceny + Dniówki (starszy szablon, ścieżki /tasks/...)
//
// Dla frontendu arbor-web (GET/POST /wyceny, zatwierdzanie, wideo, rozliczenia)
// użyj: backend_routes_arbor_wyceny.js + sql/arbor_wyceny_wynagrodzenie_media.sql
// ============================================================

// ---- WYCENY ----

// Lista wycen oczekujących na zatwierdzenie (dla menedżera/dyrektora)
router.get('/tasks/wyceny/oczekujace', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT z.*,
        u.imie || ' ' || u.nazwisko AS wyceniajacy_nazwa,
        t.nazwa AS ekipa_nazwa,
        o.nazwa AS oddzial_nazwa
      FROM zlecenia z
      LEFT JOIN users u ON u.id = z.created_by
      LEFT JOIN teams t ON t.id = z.ekipa_id
      LEFT JOIN oddzialy o ON o.id = z.oddzial_id
      WHERE z.typ = 'wycena'
        AND z.status_akceptacji = 'oczekuje'
      ORDER BY z.created_at DESC
    `);
    res.json({ wyceny: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Lista wszystkich wycen (historia)
router.get('/tasks/wyceny', requireAuth, async (req, res) => {
  try {
    const { oddzial_id, status_akceptacji } = req.query;
    let where = `z.typ = 'wycena'`;
    const params = [];
    if (oddzial_id) { params.push(oddzial_id); where += ` AND z.oddzial_id = $${params.length}`; }
    if (status_akceptacji) { params.push(status_akceptacji); where += ` AND z.status_akceptacji = $${params.length}`; }

    const { rows } = await pool.query(`
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
      LIMIT 200
    `, params);
    res.json({ wyceny: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Utwórz wycenę (wyceniający)
router.post('/tasks/wycena', requireAuth, async (req, res) => {
  try {
    const {
      klient_nazwa, adres, miasto, oddzial_id, ekipa_id,
      typ_uslugi, data_wykonania, godzina_rozpoczecia,
      czas_planowany_godziny, wartosc_planowana,
      notatki_wewnetrzne, wycena_uwagi
    } = req.body;

    const { rows } = await pool.query(`
      INSERT INTO zlecenia (
        klient_nazwa, adres, miasto, oddzial_id, ekipa_id,
        typ_uslugi, data_wykonania, godzina_rozpoczecia,
        czas_planowany_godziny, wartosc_planowana,
        notatki_wewnetrzne, wycena_uwagi,
        typ, status, status_akceptacji, created_by, created_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,
        'wycena', 'Nowe', 'oczekuje', $13, NOW()
      ) RETURNING *
    `, [
      klient_nazwa, adres, miasto, oddzial_id, ekipa_id,
      typ_uslugi, data_wykonania, godzina_rozpoczecia,
      czas_planowany_godziny, wartosc_planowana,
      notatki_wewnetrzne, wycena_uwagi,
      req.user.id
    ]);
    res.json({ zlecenie: rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Zatwierdź wycenę → zamienia w normalne zlecenie
router.post('/tasks/:id/zatwierdz-wycene', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { ekipa_id, data_wykonania, godzina_rozpoczecia, wartosc_planowana, uwagi } = req.body;

    const { rows } = await pool.query(`
      UPDATE zlecenia
      SET status_akceptacji = 'zatwierdzono',
          zatwierdzone_przez = $1,
          zatwierdzone_at = NOW(),
          status = 'Zaplanowane',
          typ = 'zlecenie',
          ekipa_id = COALESCE($2, ekipa_id),
          data_wykonania = COALESCE($3, data_wykonania),
          godzina_rozpoczecia = COALESCE($4, godzina_rozpoczecia),
          wartosc_planowana = COALESCE($5, wartosc_planowana),
          wycena_uwagi = COALESCE($6, wycena_uwagi)
      WHERE id = $7
        AND typ = 'wycena'
        AND status_akceptacji = 'oczekuje'
      RETURNING *
    `, [req.user.id, ekipa_id, data_wykonania, godzina_rozpoczecia, wartosc_planowana, uwagi, id]);

    if (!rows.length) return res.status(404).json({ error: 'Wycena nie znaleziona lub już zatwierdzona' });
    res.json({ zlecenie: rows[0], message: 'Wycena zatwierdzona i przekształcona w zlecenie' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Odrzuć wycenę
router.post('/tasks/:id/odrzuc-wycene', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { powod } = req.body;
    const { rows } = await pool.query(`
      UPDATE zlecenia
      SET status_akceptacji = 'odrzucono',
          zatwierdzone_przez = $1,
          zatwierdzone_at = NOW(),
          wycena_uwagi = $2
      WHERE id = $3 AND typ = 'wycena'
      RETURNING *
    `, [req.user.id, powod, id]);
    res.json({ zlecenie: rows[0], message: 'Wycena odrzucona' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---- DNIÓWKI ----

// Pobierz dniówki użytkownika (zakres dat)
router.get('/dniowki/user/:user_id', requireAuth, async (req, res) => {
  try {
    const { user_id } = req.params;
    const { od, do: doDate } = req.query;
    const { rows } = await pool.query(`
      SELECT d.*,
        z.klient_nazwa, z.adres, z.miasto, z.typ_uslugi,
        z.data_wykonania
      FROM dniowki d
      JOIN zlecenia z ON z.id = d.zlecenie_id
      WHERE d.user_id = $1
        AND ($2::date IS NULL OR d.data_wypracowania >= $2::date)
        AND ($3::date IS NULL OR d.data_wypracowania <= $3::date)
      ORDER BY d.data_wypracowania DESC
    `, [user_id, od || null, doDate || null]);
    res.json({ dniowki: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Dniówki czekające na zatwierdzenie (dla kierownika)
router.get('/dniowki/oczekujace', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT d.*,
        u.imie, u.nazwisko, u.rola,
        z.klient_nazwa, z.adres, z.data_wykonania
      FROM dniowki d
      JOIN users u ON u.id = d.user_id
      JOIN zlecenia z ON z.id = d.zlecenie_id
      WHERE d.zatwierdzona = false
      ORDER BY d.data_wypracowania DESC
      LIMIT 100
    `);
    res.json({ dniowki: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Zatwierdź dniówkę
router.post('/dniowki/:id/zatwierdz', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      UPDATE dniowki
      SET zatwierdzona = true, zatwierdzona_przez = $1, zatwierdzona_at = NOW()
      WHERE id = $2 RETURNING *
    `, [req.user.id, req.params.id]);
    res.json({ dniowka: rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Podsumowanie dniówek za miesiąc (dla rozliczeń)
router.get('/dniowki/podsumowanie', requireAuth, async (req, res) => {
  try {
    const { rok, miesiac } = req.query;
    const { rows } = await pool.query(`
      SELECT
        u.id AS user_id,
        u.imie, u.nazwisko, u.rola,
        COUNT(d.id) AS liczba_zlecen,
        SUM(d.godziny) AS suma_godzin,
        SUM(d.kwota) AS suma_kwota,
        SUM(CASE WHEN d.zatwierdzona THEN d.kwota ELSE 0 END) AS suma_zatwierdzona
      FROM dniowki d
      JOIN users u ON u.id = d.user_id
      WHERE EXTRACT(YEAR FROM d.data_wypracowania) = $1
        AND EXTRACT(MONTH FROM d.data_wypracowania) = $2
      GROUP BY u.id, u.imie, u.nazwisko, u.rola
      ORDER BY suma_kwota DESC
    `, [rok || new Date().getFullYear(), miesiac || new Date().getMonth() + 1]);
    res.json({ podsumowanie: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Dniówki dla konkretnego zlecenia
router.get('/dniowki/zlecenie/:zlecenie_id', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT d.*, u.imie, u.nazwisko, u.rola
      FROM dniowki d
      JOIN users u ON u.id = d.user_id
      WHERE d.zlecenie_id = $1
      ORDER BY d.rola, u.nazwisko
    `, [req.params.zlecenie_id]);
    res.json({ dniowki: rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});
