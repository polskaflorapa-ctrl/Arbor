/**
 * Rozliczenia ekip — field-entry routes (parity: mobile/app/rozliczenia.tsx)
 *
 * Endpoints:
 *   GET  /rozliczenia/zadanie/:taskId           — dane zadania + godziny + rozliczenie
 *   POST /rozliczenia/zadanie/:taskId/godziny   — dodaj / zaktualizuj godziny pomocnika
 *   PUT  /rozliczenia/godziny/:id/zatwierdz     — zatwierdź / odrzuć wpis godzin
 *   POST /rozliczenia/zadanie/:taskId           — oblicz i zapisz rozliczenie brutto/VAT
 *   GET  /rozliczenia/dzien/:userId             — podsumowanie dnia pracownika
 *
 * Tabele (migrate.sql):
 *   task_pomocnik_godziny, task_rozliczenie, tasks, users
 */
const express = require('express');
const pool    = require('../config/database');
const logger  = require('../config/logger');
const { authMiddleware, isDyrektorOrAdmin } = require('../middleware/auth');
const { z }   = require('zod');

const router = express.Router();
router.use(authMiddleware);

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Role uprawnione do zatwierdzania godzin pomocników. */
const APPROVE_ROLES = ['Brygadzista', 'Kierownik', 'Administrator', 'Dyrektor'];

/** Role które mogą edytować rozliczenie finansowe zlecenia. */
const CALC_ROLES = ['Brygadzista', 'Kierownik', 'Administrator', 'Dyrektor'];

function num(v) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

function money(v) {
  return Math.round((num(v) + Number.EPSILON) * 100) / 100;
}

/** Wylicza netto, koszt pomocników i wynagrodzenie brygadzisty. */
async function recalcTask(client, taskId) {
  // pobierz aktualny koszt pomocników
  const g = await client.query(
    `SELECT COALESCE(SUM(godziny * stawka_godzinowa), 0) AS koszt
       FROM task_pomocnik_godziny
      WHERE task_id = $1`,
    [taskId],
  );
  const kosztPomocnikow = money(g.rows[0]?.koszt);

  // pobierz aktualne brutto i % brygadzisty
  const r = await client.query(
    `SELECT wartosc_brutto, vat_stawka, procent_brygadzisty
       FROM task_rozliczenie WHERE task_id = $1`,
    [taskId],
  );
  if (!r.rows.length) return null;
  const { wartosc_brutto, vat_stawka, procent_brygadzisty } = r.rows[0];
  const brutto = money(wartosc_brutto);
  const vat    = num(vat_stawka);
  const pct    = num(procent_brygadzisty);

  const netto         = money(brutto / (1 + vat / 100));
  const podstawa      = money(Math.max(0, netto - kosztPomocnikow));
  const wynagrodzenie = money(podstawa * (pct / 100));

  await client.query(
    `UPDATE task_rozliczenie
        SET koszt_pomocnikow          = $1,
            wartosc_netto             = $2,
            podstawa_brygadzisty      = $3,
            wynagrodzenie_brygadzisty = $4,
            updated_at                = NOW()
      WHERE task_id = $5`,
    [kosztPomocnikow, netto, podstawa, wynagrodzenie, taskId],
  );

  return { kosztPomocnikow, netto, podstawa, pct, wynagrodzenie };
}

// ─── GET /rozliczenia/zadanie/:taskId ─────────────────────────────────────────

router.get('/zadanie/:taskId', async (req, res) => {
  try {
    const taskId = parseInt(req.params.taskId, 10);
    if (!Number.isFinite(taskId)) return res.status(400).json({ error: 'Nieprawidłowe task_id' });

    // Zadanie
    const { rows: taskRows } = await pool.query(
      `SELECT t.id, t.klient_nazwa, t.adres, t.miasto, t.ekipa_id,
              e.nazwa AS ekipa_nazwa
         FROM tasks t
         LEFT JOIN teams e ON e.id = t.ekipa_id
        WHERE t.id = $1`,
      [taskId],
    );
    if (!taskRows.length) return res.status(404).json({ error: 'Zadanie nie istnieje' });
    const task = taskRows[0];

    // Godziny pomocników
    const { rows: pomocnicy } = await pool.query(
      `SELECT g.id, g.pomocnik_id, u.imie, u.nazwisko,
              g.godziny, g.stawka_godzinowa,
              (g.godziny * g.stawka_godzinowa) AS koszt,
              g.status, g.data_pracy
         FROM task_pomocnik_godziny g
         JOIN users u ON u.id = g.pomocnik_id
        WHERE g.task_id = $1
        ORDER BY u.nazwisko, u.imie`,
      [taskId],
    );

    // Rozliczenie finansowe
    const { rows: rzRows } = await pool.query(
      `SELECT * FROM task_rozliczenie WHERE task_id = $1`,
      [taskId],
    );
    const rozliczenie = rzRows[0] || null;

    const { rows: kosztyOperacyjne } = await pool.query(
      `SELECT id, task_id, category, label, amount, source, note, recorded_at
         FROM task_operational_costs
        WHERE task_id = $1
        ORDER BY recorded_at DESC, id DESC`,
      [taskId],
    );

    res.json({ task, pomocnicy, rozliczenie, koszty_operacyjne: kosztyOperacyjne });
  } catch (err) {
    logger.error('rozliczenia.zadanie.get', { message: err.message, requestId: req.requestId });
    res.status(500).json({ error: req.t('errors.http.serverError') });
  }
});

// ─── POST /rozliczenia/zadanie/:taskId/godziny ────────────────────────────────

const godzinySchema = z.object({
  pomocnik_id:      z.coerce.number().int().positive(),
  godziny:          z.coerce.number().min(0.25).max(24),
  stawka_godzinowa: z.coerce.number().min(0),
  data_pracy:       z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

router.post('/zadanie/:taskId/godziny', async (req, res) => {
  try {
    const taskId = parseInt(req.params.taskId, 10);
    if (!Number.isFinite(taskId)) return res.status(400).json({ error: 'Nieprawidłowe task_id' });

    const parsed = godzinySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Nieprawidłowe dane', details: parsed.error.errors });

    const { pomocnik_id, godziny, stawka_godzinowa, data_pracy } = parsed.data;
    const dataPracy = data_pracy || new Date().toISOString().slice(0, 10);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Upsert godzin pomocnika
      const { rows } = await client.query(
        `INSERT INTO task_pomocnik_godziny
              (task_id, pomocnik_id, godziny, stawka_godzinowa, data_pracy, status)
         VALUES ($1, $2, $3, $4, $5::date, 'Oczekuje')
         ON CONFLICT (task_id, pomocnik_id, data_pracy)
         DO UPDATE SET godziny          = EXCLUDED.godziny,
                       stawka_godzinowa = EXCLUDED.stawka_godzinowa,
                       status           = 'Oczekuje',
                       updated_at       = NOW()
         RETURNING *`,
        [taskId, pomocnik_id, godziny, stawka_godzinowa, dataPracy],
      );

      // Przelicz rozliczenie (jeśli istnieje)
      await recalcTask(client, taskId);

      await client.query('COMMIT');
      res.status(201).json(rows[0]);
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  } catch (err) {
    logger.error('rozliczenia.godziny.post', { message: err.message, requestId: req.requestId });
    res.status(500).json({ error: req.t('errors.http.serverError') });
  }
});

// ─── PUT /rozliczenia/godziny/:id/zatwierdz ───────────────────────────────────

const zatwierdzSchema = z.object({
  status: z.enum(['Potwierdzone', 'Odrzucone']),
});

router.put('/godziny/:id/zatwierdz', async (req, res) => {
  try {
    if (!APPROVE_ROLES.includes(req.user.rola)) {
      return res.status(403).json({ error: 'Brak uprawnień do zatwierdzania godzin' });
    }

    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Nieprawidłowe id' });

    const parsed = zatwierdzSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Nieprawidłowy status', details: parsed.error.errors });

    const { status } = parsed.data;

    const { rows } = await pool.query(
      `UPDATE task_pomocnik_godziny
          SET status          = $1,
              potwierdzone_at = CASE WHEN $1 = 'Potwierdzone' THEN NOW() ELSE NULL END,
              updated_at      = NOW()
        WHERE id = $2
        RETURNING *`,
      [status, id],
    );

    if (!rows.length) return res.status(404).json({ error: 'Wpis godzin nie istnieje' });
    res.json(rows[0]);
  } catch (err) {
    logger.error('rozliczenia.zatwierdz', { message: err.message, requestId: req.requestId });
    res.status(500).json({ error: req.t('errors.http.serverError') });
  }
});

// ─── POST /rozliczenia/zadanie/:taskId — oblicz brutto/VAT ───────────────────

const kalkulatorSchema = z.object({
  wartosc_brutto:       z.coerce.number().min(0),
  vat_stawka:           z.coerce.number().min(0).max(100).default(8),
  procent_brygadzisty:  z.coerce.number().min(0).max(100).optional(),
});

const operationalCostSchema = z.object({
  category: z.enum(['sprzet', 'paliwo', 'utylizacja', 'inne']),
  amount: z.coerce.number().positive().max(50000),
  label: z.string().trim().max(120).optional().default(''),
  note: z.string().trim().max(500).optional().default(''),
});

router.post('/zadanie/:taskId/koszty-operacyjne', async (req, res) => {
  try {
    if (!CALC_ROLES.includes(req.user.rola)) {
      return res.status(403).json({ error: 'Brak uprawnien do edycji kosztow operacyjnych' });
    }

    const taskId = parseInt(req.params.taskId, 10);
    if (!Number.isFinite(taskId)) return res.status(400).json({ error: 'Nieprawidlowe task_id' });

    const parsed = operationalCostSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Nieprawidlowe dane', details: parsed.error.errors });

    const { rows: taskRows } = await pool.query(
      'SELECT id, oddzial_id FROM tasks WHERE id = $1',
      [taskId],
    );
    if (!taskRows.length) return res.status(404).json({ error: 'Zadanie nie istnieje' });
    const task = taskRows[0];
    if (!isDyrektorOrAdmin(req.user) && String(task.oddzial_id || '') !== String(req.user.oddzial_id || '')) {
      return res.status(403).json({ error: 'Brak dostepu do oddzialu zadania' });
    }

    const { category, amount, label, note } = parsed.data;
    const resolvedLabel = label || {
      sprzet: 'Sprzet',
      paliwo: 'Paliwo',
      utylizacja: 'Utylizacja',
      inne: 'Inne koszty',
    }[category];

    const { rows } = await pool.query(
      `INSERT INTO task_operational_costs
            (task_id, recorded_by, category, label, amount, source, note)
       VALUES ($1, $2, $3, $4, $5, 'field_settlement', $6)
       RETURNING id, task_id, recorded_by, category, label, amount, source, note, recorded_at`,
      [taskId, req.user.id, category, resolvedLabel, amount, note || null],
    );

    await req.auditLog?.({
      action: 'task.operational_cost_add',
      entityType: 'task',
      entityId: taskId,
      metadata: {
        oddzial_id: task.oddzial_id ?? req.user.oddzial_id ?? null,
        cost: rows[0],
      },
    });

    res.status(201).json(rows[0]);
  } catch (err) {
    logger.error('rozliczenia.operational_cost.post', { message: err.message, requestId: req.requestId });
    res.status(500).json({ error: req.t('errors.http.serverError') });
  }
});

router.post('/zadanie/:taskId', async (req, res) => {
  try {
    if (!CALC_ROLES.includes(req.user.rola)) {
      return res.status(403).json({ error: 'Brak uprawnień do edycji rozliczenia' });
    }

    const taskId = parseInt(req.params.taskId, 10);
    if (!Number.isFinite(taskId)) return res.status(400).json({ error: 'Nieprawidłowe task_id' });

    const parsed = kalkulatorSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Nieprawidłowe dane', details: parsed.error.errors });

    const { wartosc_brutto, vat_stawka } = parsed.data;
    const procent_brygadzisty = parsed.data.procent_brygadzisty ?? 15;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const previousSettlement = await client.query(
        `SELECT wartosc_brutto, vat_stawka, wartosc_netto,
                koszt_pomocnikow, podstawa_brygadzisty,
                procent_brygadzisty, wynagrodzenie_brygadzisty
           FROM task_rozliczenie WHERE task_id = $1`,
        [taskId],
      );

      // Koszt pomocników
      const g = await client.query(
        `SELECT COALESCE(SUM(godziny * stawka_godzinowa), 0) AS koszt
           FROM task_pomocnik_godziny WHERE task_id = $1`,
        [taskId],
      );
      const kosztPomocnikow = money(g.rows[0]?.koszt);

      const netto         = money(wartosc_brutto / (1 + vat_stawka / 100));
      const podstawa      = money(Math.max(0, netto - kosztPomocnikow));
      const wynagrodzenie = money(podstawa * (procent_brygadzisty / 100));

      // Upsert task_rozliczenie
      const { rows } = await client.query(
        `INSERT INTO task_rozliczenie
              (task_id, wartosc_brutto, vat_stawka, wartosc_netto,
               koszt_pomocnikow, podstawa_brygadzisty, procent_brygadzisty,
               wynagrodzenie_brygadzisty)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (task_id)
         DO UPDATE SET wartosc_brutto            = EXCLUDED.wartosc_brutto,
                       vat_stawka                = EXCLUDED.vat_stawka,
                       wartosc_netto             = EXCLUDED.wartosc_netto,
                       koszt_pomocnikow          = EXCLUDED.koszt_pomocnikow,
                       podstawa_brygadzisty      = EXCLUDED.podstawa_brygadzisty,
                       procent_brygadzisty       = EXCLUDED.procent_brygadzisty,
                       wynagrodzenie_brygadzisty = EXCLUDED.wynagrodzenie_brygadzisty,
                       updated_at                = NOW()
         RETURNING *`,
        [taskId, wartosc_brutto, vat_stawka, netto,
          kosztPomocnikow, podstawa, procent_brygadzisty, wynagrodzenie],
      );

      await client.query('COMMIT');
      await req.auditLog?.({
        action: 'task.financial_settlement_upsert',
        entityType: 'task',
        entityId: taskId,
        metadata: {
          oddzial_id: req.user.oddzial_id ?? null,
          previous: previousSettlement.rows[0] || null,
          next: rows[0],
          changed_fields: [
            'wartosc_brutto',
            'vat_stawka',
            'wartosc_netto',
            'koszt_pomocnikow',
            'podstawa_brygadzisty',
            'procent_brygadzisty',
            'wynagrodzenie_brygadzisty',
          ],
        },
      });
      res.json(rows[0]);
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  } catch (err) {
    logger.error('rozliczenia.kalkulator.post', { message: err.message, requestId: req.requestId });
    res.status(500).json({ error: req.t('errors.http.serverError') });
  }
});

// ─── GET /rozliczenia/dzien/:userId ──────────────────────────────────────────

router.get('/dzien/:userId', async (req, res) => {
  try {
    const userId = parseInt(req.params.userId, 10);
    if (!Number.isFinite(userId)) return res.status(400).json({ error: 'Nieprawidłowe userId' });

    // Kierownik może zobaczyć każdego; pracownik — tylko siebie
    const u = req.user;
    if (!['Kierownik', 'Administrator', 'Dyrektor'].includes(u.rola) && u.id !== userId) {
      return res.status(403).json({ error: 'Brak uprawnień' });
    }

    const data = req.query.data || new Date().toISOString().slice(0, 10);

    // Podsumowanie zadań (zlecenia) dnia
    const zleceniaQ = await pool.query(
      `SELECT t.id, t.klient_nazwa, t.adres, t.miasto,
              r.wartosc_brutto, r.wartosc_netto,
              r.koszt_pomocnikow, r.wynagrodzenie_brygadzisty
         FROM tasks t
         JOIN teams te ON te.id = t.ekipa_id
         JOIN team_members tm ON tm.team_id = te.id AND tm.user_id = $1
         LEFT JOIN task_rozliczenie r ON r.task_id = t.id
        WHERE DATE(COALESCE(t.data_planowana, t.data_wykonania)) = $2::date`,
      [userId, data],
    );

    const zlecenia = zleceniaQ.rows;
    const liczba_zlecen             = zlecenia.length;
    const koszt_pomocnikow          = zlecenia.reduce((s, z) => s + num(z.koszt_pomocnikow), 0);
    const wynagrodzenie_brygadzisty = zlecenia.reduce((s, z) => s + num(z.wynagrodzenie_brygadzisty), 0);

    // Godziny pomocników dnia
    const godzinyQ = await pool.query(
      `SELECT g.id, g.pomocnik_id, u.imie, u.nazwisko,
              g.godziny, g.stawka_godzinowa,
              (g.godziny * g.stawka_godzinowa) AS koszt,
              g.status, t.klient_nazwa
         FROM task_pomocnik_godziny g
         JOIN users u ON u.id = g.pomocnik_id
         JOIN tasks t ON t.id = g.task_id
         JOIN teams te ON te.id = t.ekipa_id
         JOIN team_members tm ON tm.team_id = te.id AND tm.user_id = $1
        WHERE g.data_pracy = $2::date
        ORDER BY u.nazwisko, u.imie`,
      [userId, data],
    );

    res.json({
      data,
      podsumowanie: { liczba_zlecen, koszt_pomocnikow, wynagrodzenie_brygadzisty },
      zlecenia,
      pomocnicy_godziny: godzinyQ.rows,
    });
  } catch (err) {
    logger.error('rozliczenia.dzien.get', { message: err.message, requestId: req.requestId });
    res.status(500).json({ error: req.t('errors.http.serverError') });
  }
});

module.exports = router;
